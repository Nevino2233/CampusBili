const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
const logger = require('../lib/logger');
const cache = require('../lib/cache');
const sessionStore = require('../lib/sessionStore');

var wbi = null;
try {
  wbi = require('../lib/wbi');
  logger.info('WBI 签名模块加载成功');
} catch (e) {
  logger.warn('WBI 签名模块未找到，将跳过签名处理');
}

function getUserCookie(req) {
  var deviceId = (req.cookies && req.cookies.device_id)
    || (req.body && req.body.device_id)
    || (req.query && req.query.device_id)
    || '';
  if (!deviceId) return '';
  return sessionStore.getCookieString(deviceId);
}

/**
 * 统一配置
 */
var CONFIG = {
  // Bilibili API 基础 URL
  BILIBILI_API: 'https://api.bilibili.com',
  BILIBILI_LIVE_API: 'https://api.live.bilibili.com',
  
  // 默认请求头
  HEADERS: {
    'Referer': 'https://www.bilibili.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  },
  
  // 缓存 TTL（秒）
  CACHE_TTL: 300,
  
  // SESSDATA 配置（从环境变量读取）
  SESSDATA: process.env.BILIBILI_SESSDATA || ''
};

/**
 * 统一的代理请求函数
 * @param {string} apiUrl - 目标 API URL
 * @param {object} options - 请求选项
 * @returns {Promise<object>} API 响应数据
 */
function proxyRequest(apiUrl, options) {
  options = options || {};
  
  return new Promise(function(resolve, reject) {
    var headers = Object.assign({}, CONFIG.HEADERS);
    
    if (options.headers) {
      Object.keys(options.headers).forEach(function(key) {
        headers[key] = options.headers[key];
      });
    }
    
    var cookieParts = [];
    if (options.cookieString) {
      cookieParts.push(options.cookieString);
    } else if (CONFIG.SESSDATA) {
      cookieParts.push('SESSDATA=' + CONFIG.SESSDATA);
    }
    if (cookieParts.length > 0) {
      headers['Cookie'] = cookieParts.join('; ');
    }
    
    var timeout = options.timeout || 10000;
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, timeout);
    
    var fetchOptions = {
      method: options.method || 'GET',
      headers: headers,
      signal: controller.signal
    };
    
    if (options.method === 'POST' && options.body) {
      fetchOptions.body = options.body;
    }
    
    logger.debug('发送代理请求: ' + apiUrl);
    
    fetch(apiUrl, fetchOptions)
      .then(function(response) {
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error('HTTP error! status: ' + response.status);
        }
        return response.json();
      })
      .then(function(data) {
        resolve(data);
      })
      .catch(function(error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          logger.error('代理请求超时: ' + apiUrl + ' (' + timeout + 'ms)');
          reject(new Error('请求超时'));
        } else {
          logger.error('代理请求失败: ' + apiUrl + ' - ' + error.message);
          reject(error);
        }
      });
  });
}

/**
 * 带缓存的代理请求函数
 * @param {string} cacheKey - 缓存键
 * @param {string} apiUrl - 目标 API URL
 * @param {object} options - 请求选项
 * @returns {Promise<object>} API 响应数据
 */
function cachedProxyRequest(cacheKey, apiUrl, options) {
  return new Promise(function(resolve, reject) {
    // 尝试从缓存获取
    var cachedData = cache.get(cacheKey);
    if (cachedData) {
      logger.debug('使用缓存数据: ' + cacheKey);
      resolve(cachedData);
      return;
    }
    
    // 缓存未命中，发起请求
    proxyRequest(apiUrl, options)
      .then(function(data) {
        // 缓存响应数据
        cache.set(cacheKey, data, options.cacheTTL || CONFIG.CACHE_TTL);
        resolve(data);
      })
      .catch(function(error) {
        reject(error);
      });
  });
}

/**
 * 处理 API 响应的统一方法
 * @param {object} res - Express 响应对象
 * @param {object} data - API 返回的数据
 */
function handleApiResponse(res, data) {
  if (data && data.code === 0) {
    res.json({
      code: 0,
      message: 'success',
      data: data.data
    });
  } else {
    var errorMsg = (data && data.message) ? data.message : 'API 请求失败';
    logger.error('B站 API 返回错误: ' + errorMsg);
    res.status(500).json({
      code: -1,
      message: errorMsg,
      data: null
    });
  }
}

/**
 * 处理错误的统一方法
 * @param {object} res - Express 响应对象
 * @param {Error} error - 错误对象
 * @param {string} defaultMessage - 默认错误消息
 */
function handleError(res, error, defaultMessage) {
  logger.error(defaultMessage + ': ' + error.message);
  res.status(500).json({
    code: -1,
    message: defaultMessage + ': ' + error.message,
    data: null
  });
}

// ==================== API 路由定义 ====================

/**
 * GET /api/video - 视频信息代理
 * 参数：bvid 或 aid（二选一）
 */
router.get('/video', function(req, res, next) {
  var bvid = req.query.bvid;
  var aid = req.query.aid;
  
  if (!bvid && !aid) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：bvid 或 aid',
      data: null
    });
  }
  
  // 构建 API URL
  var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/view?';
  if (bvid) {
    apiUrl += 'bvid=' + encodeURIComponent(bvid);
  } else {
    apiUrl += 'aid=' + encodeURIComponent(aid);
  }
  
  var cacheKey = 'video:' + (bvid || aid);
  var userCookie = getUserCookie(req);

  cachedProxyRequest(cacheKey, apiUrl, { cookieString: userCookie })
    .then(function(data) {
      handleApiResponse(res, data);
    })
    .catch(function(error) {
      handleError(res, error, '获取视频信息失败');
    });
});

/**
 * GET /api/playurl - 视频播放地址代理
 * 参数：bvid, cid（必须），可选 qn, fnval
 */
router.get('/playurl', function(req, res, next) {
  var bvid = req.query.bvid;
  var cid = req.query.cid;
  var qn = req.query.qn || '64';
  var fnval = req.query.fnval || '16';
  var userCookie = getUserCookie(req);

  if (!bvid || !cid) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：bvid 和 cid',
      data: null
    });
  }

  // 构建请求参数
  var params = {
    bvid: bvid,
    cid: cid,
    qn: parseInt(qn),
    fnval: parseInt(fnval),
    fourk: 1
  };

  // WBI 签名（如果可用）- 正确处理 Promise
  var signPromise;
  if (wbi && typeof wbi.signParams === 'function') {
    signPromise = wbi.signParams(params).then(function(signed) {
      logger.info('已应用 WBI 签名');
      return signed;
    }).catch(function(signError) {
      logger.warn('WBI 签名失败，使用原始参数: ' + signError.message);
      return params;
    });
  } else {
    signPromise = Promise.resolve(params);
  }

  signPromise.then(function(signedParams) {
    // 构建带参数的 URL
    var queryString = Object.keys(signedParams)
      .map(function(key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
      })
      .join('&');

    var apiUrl = CONFIG.BILIBILI_API + '/x/player/wbi/playurl?' + queryString;

    // 播放地址不缓存或短时间缓存
    var cacheKey = 'playurl:' + bvid + ':' + cid + ':' + qn + ':' + fnval;

    return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 60, cookieString: userCookie });
  }).then(function(data) {
    handleApiResponse(res, data);
  }).catch(function(error) {
    handleError(res, error, '获取播放地址失败');
  });
});

/**
 * GET /api/search - 搜索代理
 * 参数：keyword（必须），search_type, order, page, duration, tids 等
 */
router.get('/search', function(req, res, next) {
  var keyword = req.query.keyword;
  var userCookie = getUserCookie(req);

  if (!keyword) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：keyword',
      data: null
    });
  }

  var params = {
    keyword: keyword,
    search_type: req.query.search_type || 'video',
    order: req.query.order || '',
    page: parseInt(req.query.page) || 1,
    duration: req.query.duration || '0',
    tids: req.query.tids || '0'
  };

  var signPromise;
  if (wbi && typeof wbi.signParams === 'function') {
    signPromise = wbi.signParams(params).then(function(signed) {
      logger.info('搜索接口已应用 WBI 签名');
      return signed;
    }).catch(function(signError) {
      logger.warn('搜索接口 WBI 签名失败，使用原始参数');
      return params;
    });
  } else {
    signPromise = Promise.resolve(params);
  }

  signPromise.then(function(signedParams) {
    var queryString = Object.keys(signedParams)
      .map(function(key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
      })
      .join('&');

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/wbi/search/type?' + queryString;

    var cacheKey = 'search:' + keyword + ':' + params.search_type + ':' + params.page;

    return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 120, cookieString: userCookie });
  }).then(function(data) {
    handleApiResponse(res, data);
  }).catch(function(error) {
    handleError(res, error, '搜索失败');
  });
});

/**
 * GET /api/ranking - 排行榜代理
 * 参数：rid（分区ID），type（all/rokkie/origin）
 */
router.get('/ranking', function(req, res, next) {
  var rid = req.query.rid || '0';
  var type = req.query.type || 'all';
  
  var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/ranking/v2?rid=' + 
               encodeURIComponent(rid) + '&type=' + encodeURIComponent(type);
  
  var cacheKey = 'ranking:' + rid + ':' + type;
  
  cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 180 }) // 3分钟缓存
    .then(function(data) {
      handleApiResponse(res, data);
    })
    .catch(function(error) {
      handleError(res, error, '获取排行榜失败');
    });
});

/**
 * GET /api/popular - 热门视频代理
 * 参数：pn（页码），ps（每页数量）
 */
router.get('/popular', function(req, res, next) {
  var pn = req.query.pn || '1';
  var ps = req.query.ps || '20';
  
  var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/popular?pn=' + 
               encodeURIComponent(pn) + '&ps=' + encodeURIComponent(ps);
  
  var cacheKey = 'popular:' + pn + ':' + ps;
  
  cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 180 }) // 3分钟缓存
    .then(function(data) {
      handleApiResponse(res, data);
    })
    .catch(function(error) {
      handleError(res, error, '获取热门视频失败');
    });
});

// 引入 apiService 模块
var apiService = require('../lib/apiService');

/**
 * GET /api/related - 相关推荐视频
 * 参数：bvid（必须）
 */
router.get('/related', function(req, res, next) {
  var bvid = req.query.bvid;
  var userCookie = getUserCookie(req);

  if (!bvid) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：bvid',
      data: null
    });
  }

  apiService.getRelated(bvid, userCookie ? {cookieString: userCookie} : null, function(err, data) {
    if (err) {
      handleError(res, err, '获取相关视频失败');
      return;
    }
    handleApiResponse(res, data);
  });
});

/**
 * GET /api/comments - 视频评论列表
 * 参数：oid (aid) 必须，pn、ps、sort 可选
 */
router.get('/comments', function(req, res, next) {
  var oid = req.query.oid;
  var userCookie = getUserCookie(req);

  if (!oid) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：oid (aid)',
      data: null
    });
  }

  var options = {
    pn: parseInt(req.query.pn) || 1,
    ps: parseInt(req.query.ps) || 20,
    sort: parseInt(req.query.sort) || 0,
    cookieString: userCookie
  };

  apiService.getComments(oid, options, function(err, data) {
    if (err) {
      handleError(res, err, '获取评论失败');
      return;
    }
    handleApiResponse(res, data);
  });
});

router.get('/user/:mid', function(req, res, next) {
  var mid = req.params.mid;
  var userCookie = getUserCookie(req);

  if (!mid) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：mid',
      data: null
    });
  }

  apiService.getUserInfo(mid, userCookie ? {cookieString: userCookie} : null, function(err, data) {
    if (err) {
      handleError(res, err, '获取用户信息失败');
      return;
    }
    handleApiResponse(res, data);
  });
});

router.get('/tags', function(req, res, next) {
  var bvid = req.query.bvid;
  var userCookie = getUserCookie(req);

  if (!bvid) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：bvid',
      data: null
    });
  }

  apiService.getVideoTags(bvid, userCookie ? {cookieString: userCookie} : null, function(err, data) {
    if (err) {
      handleError(res, err, '获取视频标签失败');
      return;
    }
    handleApiResponse(res, data);
  });
});

/**
 * GET /api/hot - 热搜列表代理
 * 参数：limit（可选，默认10，最大50）
 */
router.get('/hot', function(req, res, next) {
  var limit = parseInt(req.query.limit) || 10;
  if (limit < 1) limit = 1;
  if (limit > 50) limit = 50;

  var apiUrl = 'https://s.search.bilibili.com/main/hotword';

  var cacheKey = 'hot:' + limit;

  cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 300 })
    .then(function(data) {
      if (data && data.code === 0 && data.list) {
        var list = data.list.slice(0, limit).map(function(item) {
          return {
            keyword: item.keyword || '',
            show_name: item.show_name || item.keyword || '',
            icon: item.icon || '',
            word_type: item.word_type || 0,
            pos: item.pos || item.id || 0
          };
        });
        res.json({
          code: 0,
          message: 'success',
          data: list
        });
      } else {
        handleApiResponse(res, data);
      }
    })
    .catch(function(error) {
      handleError(res, error, '获取热搜失败');
    });
});

/**
 * GET /api/suggest - 搜索建议代理
 * 参数：term（必须，搜索关键词）
 */
router.get('/suggest', function(req, res, next) {
  var term = req.query.term;

  if (!term || !term.trim()) {
    return res.status(400).json({
      code: -1,
      message: '缺少必要参数：term',
      data: null
    });
  }

  var apiUrl = 'https://s.search.bilibili.com/main/suggest?term=' +
               encodeURIComponent(term.trim());

  var cacheKey = 'suggest:' + term.trim();

  cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 120 })
    .then(function(data) {
      if (data && data.code === 0 && data.result && data.result.tag) {
        var list = data.result.tag.map(function(item) {
          return {
            value: item.value || '',
            name: item.name || ''
          };
        });
        res.json({
          code: 0,
          message: 'success',
          data: list
        });
      } else {
        res.json({
          code: 0,
          message: 'success',
          data: []
        });
      }
    })
    .catch(function(error) {
      handleError(res, error, '获取搜索建议失败');
    });
});

router.get('/recommend/feed', function(req, res, next) {
  var userCookie = getUserCookie(req);
  var ps = parseInt(req.query.ps) || 30;
  var freshIdx = parseInt(req.query.fresh_idx) || 1;

  if (ps < 1) ps = 1;
  if (ps > 30) ps = 30;

  var options = {
    ps: ps,
    fresh_idx: freshIdx,
    cookieString: userCookie
  };

  apiService.getPersonalizedRecommend(options, function(err, data) {
    if (err) {
      handleError(res, err, '获取个性化推荐失败');
      return;
    }
    handleApiResponse(res, data);
  });
});

router.get('/dynamic', function(req, res, next) {
  var type = req.query.type || 'all';
  var offset = req.query.offset || '';
  var userCookie = getUserCookie(req);

  if (!userCookie) {
    return res.status(401).json({
      code: -101,
      message: '需要登录才能查看动态',
      data: null
    });
  }

  var apiUrl = CONFIG.BILIBILI_API + '/x/polymer/web-dynamic/v1/feed/' + type;
  var queryParts = [];
  if (offset) queryParts.push('offset=' + encodeURIComponent(offset));
  queryParts.push('type=' + encodeURIComponent(type));
  queryParts.push('features=itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete');
  queryParts.push('platform=web');

  if (queryParts.length > 0) {
    apiUrl += '?' + queryParts.join('&');
  }

  var cacheKey = 'dynamic:' + type + ':' + offset;

  cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 60, cookieString: userCookie })
    .then(function(data) {
      handleApiResponse(res, data);
    })
    .catch(function(error) {
      handleError(res, error, '获取动态失败');
    });
});

module.exports = router;
