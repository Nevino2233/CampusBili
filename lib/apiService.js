/**
 * 内部 API 服务模块
 * 提供同步/回调方式的 API 数据获取接口
 * 供页面路由内部调用，避免 HTTP 循环调用
 *
 * 重构说明：
 * - 原来 routes/index.js 通过 httpGet('http://localhost:3003/api/...') 调用自身 API
 * - 现在改为直接调用本模块的函数，消除内部 HTTP 循环
 * - 保持与原 HTTP 接口相同的数据格式：{code, message, data}
 */

var fetch = require('node-fetch');
var logger = require('./logger');
var cache = require('./cache');

// 尝试加载 WBI 签名模块（容错处理）
var wbi = null;
try {
  wbi = require('./wbi');
  logger.info('[apiService] WBI 签名模块加载成功');
} catch (e) {
  logger.warn('[apiService] WBI 签名模块未找到，将跳过签名处理');
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
    'Referer': 'https://www.bilibili.com/',
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
 * 基础代理请求函数（与 routes/api.js 中的 proxyRequest 相同逻辑）
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

    logger.debug('[apiService] 发送代理请求：' + apiUrl);

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
          logger.error('[apiService] 代理请求超时：' + apiUrl + ' (' + timeout + 'ms)');
          reject(new Error('请求超时'));
        } else {
          logger.error('[apiService] 代理请求失败：' + apiUrl + ' - ' + error.message);
          reject(error);
        }
      });
  });
}

/**
 * 带缓存的代理请求函数（与 routes/api.js 中的 cachedProxyRequest 相同逻辑）
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
      logger.debug('[apiService] 使用缓存数据：' + cacheKey);
      resolve(cachedData);
      return;
    }

    // 缓存未命中，发起请求
    proxyRequest(apiUrl, options)
      .then(function(data) {
        var ttl = (options && options.cacheTTL) ? options.cacheTTL : CONFIG.CACHE_TTL;
        cache.set(cacheKey, data, ttl);
        resolve(data);
      })
      .catch(function(error) {
        reject(error);
      });
  });
}

/**
 * 统一处理 B 站 API 返回数据，包装成标准格式
 * 与 routes/api.js 中的 handleApiResponse 逻辑一致
 * @param {object} data - B 站 API 原始返回数据
 * @returns {object} 标准格式数据 {code, message, data}
 */
function formatApiResponse(data) {
  if (data && data.code === 0) {
    return {
      code: 0,
      message: 'success',
      data: data.data
    };
  } else {
    var errorMsg = (data && data.message) ? data.message : 'API 请求失败';
    logger.error('[apiService] B 站 API 返回错误：' + errorMsg);
    return {
      code: -1,
      message: errorMsg,
      data: null
    };
  }
}

// ==================== 导出的 API 服务函数 ====================

module.exports = {

  /**
   * 获取视频信息
   * @param {string} bvid - 视频 BV 号
   * @param {string|number} aid - 视频 AV 号
   * @param {function} callback - 回调函数 callback(err, responseData)
   *   responseData 格式：{code: 0, message: 'success', data: {...}}
   */
  getVideoInfo: function(bvid, aidOrOptions, callback) {
    if (!bvid && !aidOrOptions) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：bvid 或 aid',
        data: null
      });
    }

    var aid = null;
    var requestOptions = {};
    if (typeof aidOrOptions === 'object' && aidOrOptions !== null && typeof callback === 'function') {
      if (aidOrOptions.cookieString) {
        requestOptions.cookieString = aidOrOptions.cookieString;
      }
      callback = callback;
    } else {
      aid = aidOrOptions;
    }

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/view?';
    if (bvid) {
      apiUrl += 'bvid=' + encodeURIComponent(bvid);
    } else {
      apiUrl += 'aid=' + encodeURIComponent(aid);
    }

    var cacheKey = 'video:' + (bvid || aid);

    cachedProxyRequest(cacheKey, apiUrl, requestOptions)
      .then(function(data) {
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        callback(error, null);
      });
  },

  /**
   * 获取视频播放地址
   * @param {string} bvid - 视频 BV 号
   * @param {string|number} cid - 分 P ID
   * @param {string} qn - 清晰度（默认 64 = 720P）
   * @param {function} callback - 回调函数
   */
  getPlayUrl: function(bvid, cid, qnOrOptions, callback) {
    if (!bvid || !cid) {
      logger.warn('[apiService][getPlayUrl] 缺少必要参数：bvid=' + (bvid || '空') + ', cid=' + (cid || '空'));
      return callback(null, {
        code: -1,
        message: '缺少必要参数：bvid 和 cid',
        data: null
      });
    }

    var qn = '64';
    var requestOptions = {};
    if (typeof qnOrOptions === 'object' && qnOrOptions !== null) {
      if (qnOrOptions.cookieString) requestOptions.cookieString = qnOrOptions.cookieString;
    } else {
      qn = qnOrOptions || '64';
    }

    var fnval = '1';

    var params = {
      bvid: bvid,
      cid: cid,
      qn: parseInt(qn),
      fnval: parseInt(fnval),
      fourk: 1
    };

    logger.info('[apiService][getPlayUrl] 开始获取播放地址：bvid=' + bvid + ', cid=' + cid + ', qn=' + qn);

    var signPromise;
    if (wbi && typeof wbi.signParams === 'function') {
      signPromise = wbi.signParams(params).then(function(signed) {
        logger.info('[apiService][getPlayUrl] 已应用 WBI 签名');
        return signed;
      }).catch(function(signError) {
        logger.warn('[apiService][getPlayUrl] WBI 签名失败，使用原始参数：' + signError.message +
          '\n提示：无签名的 playurl 请求可能返回受限数据或被拒绝');
        return params;
      });
    } else {
      signPromise = Promise.resolve(params);
    }

    var cacheKey = 'playurl:' + bvid + ':' + cid + ':' + qn + ':' + fnval;

    signPromise.then(function(signedParams) {
      var queryString = Object.keys(signedParams)
        .map(function(key) {
          return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
        })
        .join('&');

      var apiUrl = CONFIG.BILIBILI_API + '/x/player/wbi/playurl?' + queryString;
      logger.debug('[apiService][getPlayUrl] 请求 URL: ' + apiUrl.substring(0, 100) + '...');

      return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 60, cookieString: requestOptions.cookieString });
    }).then(function(data) {
      // 记录 API 返回的关键信息
      if (data && data.code !== undefined) {
        logger.info('[apiService][getPlayUrl] API 返回：code=' + data.code +
          (data.message ? ', message=' + data.message : '') +
          (data.data ? ', 有 data 字段' : ', 无 data 字段'));

        // 检查返回数据结构
        if (data.code === 0 && data.data) {
          var d = data.data;
          var hasDurl = !!(d.durl && d.durl.length > 0);
          var hasDashVideo = !!(d.dash && d.dash.video && d.dash.video.length > 0);
          var hasDashDash = !!(d.dash && d.dash.dash);
          var hasAudioOnly = !!(d.dash && !d.dash.video && d.dash.audio);
          logger.info('[apiService][getPlayUrl] 数据结构分析：durl=' + hasDurl +
            ', dash.video=' + hasDashVideo + ', dash.dash(MPD)=' + hasDashDash +
            ', audioOnly=' + hasAudioOnly);
        }
      }

      callback(null, formatApiResponse(data));
    }).catch(function(error) {
      logger.error('[apiService][getPlayUrl] 请求失败：' + error.message);
      callback(error, null);
    });
  },

  /**
   * 获取热门视频列表
   * @param {number} ps - 每页数量（默认 20）
   * @param {function} callback - 回调函数
   */
  getPopular: function(ps, callback) {
    ps = ps || 20;
    var pn = 1; // 默认第一页

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/popular?pn=' +
                 encodeURIComponent(pn) + '&ps=' + encodeURIComponent(ps);

    var cacheKey = 'popular:' + pn + ':' + ps;

    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 180 }) // 3 分钟缓存
      .then(function(data) {
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        callback(error, null);
      });
  },

  /**
   * 获取排行榜数据
   * @param {string} rid - 分区 ID（默认 '0' 全站）
   * @param {number} page - 页码（默认 1）
   * @param {number} ps - 每页数量（默认 20）
   * @param {function} callback - 回调函数
   */
  getRanking: function(rid, page, ps, callback) {
    rid = rid || '0';
    page = page || 1;
    ps = ps || 20;
    var type = 'all';

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/ranking/v2?rid=' +
                 encodeURIComponent(rid) + '&type=' + encodeURIComponent(type) +
                 '&page=' + page + '&ps=' + ps;

    var cacheKey = 'ranking:' + rid + ':' + type;

    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 180 }) // 3 分钟缓存
      .then(function(data) {
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        callback(error, null);
      });
  },

  /**
   * 搜索视频
   * @param {string} keyword - 搜索关键词
   * @param {string} searchType - 搜索类型（默认 'video'）
   * @param {string} order - 排序方式（默认 ''）
   * @param {number} page - 页码（默认 1）
   * @param {string} tids - 分区 ID（默认 '0' 全站）
   * @param {function} callback - 回调函数
   */
  getSearch: function(keyword, searchType, order, page, tids, callback) {
    if (!keyword || !keyword.trim()) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：keyword',
        data: null
      });
    }

    // 兼容旧调用方式：getSearch(keyword, searchType, order, page, callback)
    if (typeof tids === 'function') {
      callback = tids;
      tids = '0';
    }

    searchType = searchType || 'video';
    order = order || '';
    page = page || 1;
    tids = tids || '0';

    // 构建请求参数
    var params = {
      keyword: keyword,
      search_type: searchType,
      order: order,
      page: page,
      duration: '0',
      tids: tids
    };

    // WBI 签名（如果可用）
    var signPromise;
    if (wbi && typeof wbi.signParams === 'function') {
      signPromise = wbi.signParams(params).then(function(signed) {
        logger.info('[apiService] 搜索接口已应用 WBI 签名');
        return signed;
      }).catch(function(signError) {
        logger.warn('[apiService] 搜索接口 WBI 签名失败，使用原始参数');
        return params;
      });
    } else {
      signPromise = Promise.resolve(params);
    }

    var cacheKey = 'search:' + keyword + ':' + searchType + ':' + page;

    signPromise.then(function(signedParams) {
      var queryString = Object.keys(signedParams)
        .map(function(key) {
          return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
        })
        .join('&');

      var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/wbi/search/type?' + queryString;

      return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 120 });
    }).then(function(data) {
      callback(null, formatApiResponse(data));
    }).catch(function(error) {
      callback(error, null);
    });
  },

  /**
   * 获取番剧信息
   * @param {string} seasonId - 季度 ID
   * @param {string} ep_id - 集数 ID
   * @param {function} callback - 回调函数
   */
  getBangumi: function(seasonId, epId, callback) {
    if (!seasonId && !epId) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：season_id 或 ep_id',
        data: null
      });
    }

    var apiUrl = CONFIG.BILIBILI_API + '/pgc/view/web/season?';
    if (seasonId) {
      apiUrl += 'season_id=' + encodeURIComponent(seasonId);
    } else {
      apiUrl += 'ep_id=' + encodeURIComponent(epId);
    }

    var cacheKey = 'bangumi:' + (seasonId || epId);

    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 300 }) // 5 分钟缓存
      .then(function(data) {
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        callback(error, null);
      });
  },

  /**
   * 获取直播信息
   * @param {string|number} roomId - 直播间 ID
   * @param {function} callback - 回调函数
   */
  getLive: function(roomId, callback) {
    if (!roomId) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：room_id',
        data: null
      });
    }

    // 直播间播放信息 API
    var apiUrl = CONFIG.BILIBILI_LIVE_API +
                 '/xlive/web-room/v2/index/getRoomPlayInfo?' +
                 'room_id=' + encodeURIComponent(roomId) +
                 '&protocol=0,1' +
                 '&format=0,1,2' +
                 '&codec=0,1' +
                 '&qn=10000' +
                 '&platform=web' +
                 '&ptype=8';

    var cacheKey = 'live:' + roomId;

    // 直播信息短时间缓存（10 秒）
    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 10 })
      .then(function(data) {
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        callback(error, null);
      });
  },

  /**
   * 获取相关推荐视频
   * @param {string} bvid - 视频 BV 号
   * @param {function} callback - 回调函数 callback(err, responseData)
   */
  getRelated: function(bvid, callback) {
    if (!bvid) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：bvid',
        data: null
      });
    }

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/archive/related?bvid=' + encodeURIComponent(bvid);
    var cacheKey = 'related:' + bvid;

    logger.info('[apiService][getRelated] 开始获取相关视频：bvid=' + bvid);

    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 300 }) // 5 分钟缓存
      .then(function(data) {
        logger.info('[apiService][getRelated] 获取成功：bvid=' + bvid);
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        logger.error('[apiService][getRelated] 请求失败：bvid=' + bvid + ' - ' + error.message);
        callback(error, null);
      });
  },

  /**
   * 获取视频评论列表
   * @param {number} aid - 视频 aid
   * @param {object} options - 可选参数 { pn, ps, sort }
   * @param {function} callback - 回调函数 callback(err, responseData)
   */
  getComments: function(aid, options, callback) {
    if (!aid) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：aid',
        data: null
      });
    }

    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    options = options || {};
    var ps = options.ps || 20;
    var mode = options.sort === 1 ? 1 : 3;

    logger.info('[apiService][getComments] 开始获取评论：aid=' + aid + ', mode=' + mode + ', ps=' + ps);

    function tryWbiApi() {
      var params = {
        type: 1,
        oid: aid,
        mode: mode,
        plat: 1,
        web_location: 1315875
      };

      if (options.next_offset) {
        params.pagination_str = JSON.stringify({ offset: options.next_offset });
      } else {
        params.pagination_str = JSON.stringify({ offset: '' });
      }

      var signPromise;
      if (wbi && typeof wbi.signParams === 'function') {
        signPromise = wbi.signParams(params).then(function(signed) {
          logger.info('[apiService][getComments] 已应用 WBI 签名');
          return signed;
        }).catch(function(signError) {
          logger.warn('[apiService][getComments] WBI 签名失败：' + signError.message);
          return null;
        });
      } else {
        signPromise = Promise.resolve(null);
      }

      return signPromise.then(function(signedParams) {
        if (!signedParams) {
          return tryLegacyApi();
        }

        var queryString = Object.keys(signedParams)
          .map(function(key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
          })
          .join('&');

        var apiUrl = CONFIG.BILIBILI_API + '/x/v2/reply/wbi/main?' + queryString;
        var cacheKey = 'comments:wbi:' + aid + ':' + mode + ':' + ps;

        return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 120, cookieString: options.cookieString })
          .then(function(data) {
            if (data && data.code === 0) {
              logger.info('[apiService][getComments] WBI API 获取成功：aid=' + aid);
              return formatApiResponse(data);
            } else {
              logger.warn('[apiService][getComments] WBI API 返回错误，回退到旧 API：' + (data ? data.message : 'unknown'));
              return tryLegacyApi();
            }
          })
          .catch(function() {
            return tryLegacyApi();
          });
      });
    }

    function tryLegacyApi() {
      var sort = mode === 1 ? 1 : 0;
      var pn = options.pn || 1;
      var apiUrl = CONFIG.BILIBILI_API +
        '/x/v2/reply?type=1&oid=' + encodeURIComponent(aid) +
        '&pn=' + encodeURIComponent(pn) +
        '&ps=' + encodeURIComponent(ps) +
        '&sort=' + encodeURIComponent(sort) +
        '&nohot=0';

      var cacheKey = 'comments:' + aid + ':' + pn + ':' + ps + ':' + sort;

      logger.info('[apiService][getComments] 使用旧版 API 获取评论：aid=' + aid);

      return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 120, cookieString: options.cookieString })
        .then(function(data) {
          logger.info('[apiService][getComments] 旧版 API 获取成功：aid=' + aid);
          return formatApiResponse(data);
        });
    }

    tryWbiApi()
      .then(function(result) {
        callback(null, result);
      })
      .catch(function(error) {
        logger.error('[apiService][getComments] 请求失败：aid=' + aid + ' - ' + error.message);
        callback(error, null);
      });
  },

  /**
   * 获取用户信息
   * @param {number|string} mid - 用户 mid
   * @param {function} callback - 回调函数 callback(err, responseData)
   */
  getUserInfo: function(mid, optionsOrCallback, callback) {
    if (!mid) {
      var cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      return cb(null, {
        code: -1,
        message: '缺少必要参数：mid',
        data: null
      });
    }

    var requestOptions = {};
    if (typeof optionsOrCallback === 'object' && optionsOrCallback !== null) {
      if (optionsOrCallback.cookieString) requestOptions.cookieString = optionsOrCallback.cookieString;
    } else if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
    }

    logger.info('[apiService][getUserInfo] 开始获取用户信息：mid=' + mid);

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/card?mid=' + encodeURIComponent(mid) + '&photo=true';
    var cacheKey = 'userCard:' + mid;

    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 600, cookieString: requestOptions.cookieString })
      .then(function(data) {
        if (data && data.code === 0 && data.data) {
          var card = data.data.card || {};
          var normalized = {
            mid: card.mid || mid,
            name: card.name || '',
            sex: card.sex || '保密',
            face: card.face || '',
            sign: card.sign || '',
            level: (card.level_info && card.level_info.current_level) || 0,
            official: card.Official || card.official_verify || { role: -1, title: '', desc: '', type: -1 },
            vip: card.vip || { type: 0, status: 0 },
            top_photo: (data.data.space && data.data.space.l_img) || '',
            fans: card.fans || data.data.follower || 0,
            friend: card.friend || card.attention || 0,
            archive_count: data.data.archive_count || 0,
            like_num: data.data.like_num || 0
          };
          logger.info('[apiService][getUserInfo] 获取成功：mid=' + mid + ' name=' + normalized.name);
          callback(null, { code: 0, message: '0', data: normalized });
        } else {
          logger.warn('[apiService][getUserInfo] API 返回异常：mid=' + mid);
          callback(null, data || { code: -1, message: '获取用户信息失败', data: null });
        }
      })
      .catch(function(error) {
        logger.error('[apiService][getUserInfo] 请求失败：mid=' + mid + ' - ' + error.message);
        callback(error, null);
      });
  },

  /**
   * 获取用户投稿视频列表（使用搜索接口，无需 WBI 签名）
   * @param {number|string} mid - 用户 mid
   * @param {number} page - 页码（默认 1）
   * @param {number} pageSize - 每页数量（默认 30）
   * @param {function} callback - 回调函数 callback(err, responseData)
   */
  getUserVideos: function(mid, page, pageSizeOrOptions, callback) {
    if (!mid) {
      return callback(null, {
        code: -1,
        message: '缺少必要参数：mid',
        data: null
      });
    }

    var page = page || 1;
    var pageSize = 30;
    var requestOptions = {};
    if (typeof pageSizeOrOptions === 'object' && pageSizeOrOptions !== null) {
      if (pageSizeOrOptions.cookieString) requestOptions.cookieString = pageSizeOrOptions.cookieString;
    } else {
      pageSize = pageSizeOrOptions || 30;
    }

    logger.info('[apiService][getUserVideos] 开始获取用户投稿：mid=' + mid + ' page=' + page);

    var params = {
      mid: mid,
      pn: page,
      ps: pageSize,
      order: 'pubdate'
    };

    var signPromise;
    if (wbi && typeof wbi.signParams === 'function') {
      signPromise = wbi.signParams(params).then(function(signed) {
        logger.info('[apiService][getUserVideos] 已应用 WBI 签名');
        return signed;
      }).catch(function(signError) {
        logger.warn('[apiService][getUserVideos] WBI 签名失败，使用原始参数：' + signError.message);
        return params;
      });
    } else {
      signPromise = Promise.resolve(params);
    }

    var cacheKey = 'userVideos:' + mid + ':' + page;

    signPromise.then(function(signedParams) {
      var queryString = Object.keys(signedParams)
        .map(function(key) {
          return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
        })
        .join('&');

      var apiUrl = CONFIG.BILIBILI_API + '/x/space/wbi/arc/search?' + queryString;
      logger.debug('[apiService][getUserVideos] 请求 URL: ' + apiUrl.substring(0, 120) + '...');

      return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 300, cookieString: requestOptions.cookieString });
    }).then(function(data) {
      if (data && data.code === 0 && data.data && data.data.list && data.data.list.vlist) {
        var videos = data.data.list.vlist.map(function(v) {
          return {
            bvid: v.bvid,
            aid: v.aid,
            title: v.title,
            pic: v.pic,
            description: v.description || '',
            length: v.length || '',
            duration: v.length || '',
            play: v.play || 0,
            danmaku: v.video_review || 0,
            created: v.created || 0,
            author: v.author || '',
            mid: v.mid || mid
          };
        });
        var pageData = data.data.page || {};
        var totalCount = pageData.count || videos.length;
        logger.info('[apiService][getUserVideos] 获取成功：mid=' + mid + ' count=' + totalCount);
        callback(null, {
          code: 0,
          message: '0',
          data: {
            videos: videos,
            total: totalCount,
            page: page,
            pageSize: pageSize
          }
        });
      } else {
        logger.warn('[apiService][getUserVideos] API 返回异常：mid=' + mid);
        callback(null, data || { code: -1, message: '获取投稿视频失败', data: null });
      }
    }).catch(function(error) {
      logger.error('[apiService][getUserVideos] 请求失败：mid=' + mid + ' - ' + error.message);
      callback(error, null);
    });
  },

  /**
   * 获取首页推荐视频列表
   * @param {number} pageSize - 每页数量（默认 12）
   * @param {function} callback - 回调函数 callback(err, responseData)
   */
  getRecommend: function(pageSize, callback) {
    pageSize = pageSize || 12;

    logger.info('[apiService][getRecommend] 开始获取推荐视频');

    var params = {
      fresh_type: 4,
      ps: pageSize,
      fresh_idx: 1,
      fresh_idx_1h: 1,
      brush: 1,
      fetch_row: 1,
      web_location: 1430650,
      y_num: 0,
      last_y_num: 0,
      feed_version: 'V8',
      homepage_ver: 1,
      screen: '1920-1080',
      seo_info: '',
      last_showlist: '',
      uniq_id: ''
    };

    var signPromise;
    if (wbi && typeof wbi.signParams === 'function') {
      signPromise = wbi.signParams(params).then(function(signed) {
        logger.info('[apiService][getRecommend] 已应用 WBI 签名');
        return signed;
      }).catch(function(signError) {
        logger.warn('[apiService][getRecommend] WBI 签名失败，使用原始参数：' + signError.message);
        return params;
      });
    } else {
      signPromise = Promise.resolve(params);
    }

    var cacheKey = 'recommend:' + pageSize;

    signPromise.then(function(signedParams) {
      var queryString = Object.keys(signedParams)
        .map(function(key) {
          return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
        })
        .join('&');

      var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/wbi/index/top/feed/rcmd?' + queryString;

      return cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 180 });
    }).then(function(data) {
      if (data && data.code === 0 && data.data && data.data.item) {
        var videos = data.data.item.filter(function(item) {
          return item.goto === 'av' && item.bvid;
        }).map(function(item) {
          return {
            bvid: item.bvid,
            aid: item.id,
            title: item.title,
            pic: item.pic,
            duration: item.duration || '',
            play: (item.stat && item.stat.view) || 0,
            danmaku: (item.stat && item.stat.danmaku) || 0,
            author: item.owner ? item.owner.name : '',
            mid: item.owner ? item.owner.mid : 0
          };
        });
        logger.info('[apiService][getRecommend] 获取成功 count=' + videos.length);
        callback(null, {
          code: 0,
          message: '0',
          data: videos
        });
      } else {
        logger.warn('[apiService][getRecommend] API 返回异常');
        callback(null, data || { code: -1, message: '获取推荐视频失败', data: null });
      }
    }).catch(function(error) {
      logger.error('[apiService][getRecommend] 请求失败 - ' + error.message);
      callback(error, null);
    });
  },

  /**
   * 获取视频标签
   * @param {string} bvid - 视频 BV 号
   * @param {function} callback - 回调函数 callback(err, responseData)
   */
  getPersonalizedRecommend: function(options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    options = options || {};

    var ps = options.ps || 30;
    var freshIdx = options.fresh_idx || 1;
    var cookieString = options.cookieString || '';

    logger.info('[apiService][getPersonalizedRecommend] 开始获取个性化推荐 ps=' + ps + ' fresh_idx=' + freshIdx);

    var params = {
      fresh_type: options.fresh_type || 4,
      ps: ps,
      fresh_idx: freshIdx,
      fresh_idx_1h: freshIdx,
      brush: freshIdx,
      fetch_row: options.fetch_row || 1,
      web_location: 1430650,
      y_num: 0,
      last_y_num: 0,
      feed_version: 'V8',
      homepage_ver: 1,
      screen: '1920-1080',
      seo_info: '',
      last_showlist: options.last_showlist || '',
      uniq_id: ''
    };

    var signPromise;
    if (wbi && typeof wbi.signParams === 'function') {
      signPromise = wbi.signParams(params).then(function(signed) {
        logger.info('[apiService][getPersonalizedRecommend] 已应用 WBI 签名');
        return signed;
      }).catch(function(signError) {
        logger.warn('[apiService][getPersonalizedRecommend] WBI 签名失败，使用原始参数：' + signError.message);
        return params;
      });
    } else {
      signPromise = Promise.resolve(params);
    }

    var cacheKey = 'personalizedRecommend:' + freshIdx + ':' + ps + ':' + (cookieString ? 'auth' : 'anon');

    signPromise.then(function(signedParams) {
      var queryString = Object.keys(signedParams)
        .map(function(key) {
          return encodeURIComponent(key) + '=' + encodeURIComponent(signedParams[key]);
        })
        .join('&');

      var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/wbi/index/top/feed/rcmd?' + queryString;

      return cachedProxyRequest(cacheKey, apiUrl, {
        cacheTTL: cookieString ? 60 : 180,
        cookieString: cookieString
      });
    }).then(function(data) {
      if (data && data.code === 0 && data.data && data.data.item) {
        var videos = data.data.item.filter(function(item) {
          return item.goto === 'av' && item.bvid;
        }).map(function(item) {
          var rcmdReason = '';
          if (item.rcmd_reason) {
            if (item.rcmd_reason.reason_type === 1) rcmdReason = '已关注';
            else if (item.rcmd_reason.reason_type === 3 && item.rcmd_reason.content) rcmdReason = item.rcmd_reason.content;
          }
          return {
            bvid: item.bvid,
            aid: item.id,
            cid: item.cid || 0,
            title: item.title || '',
            pic: item.pic || '',
            duration: item.duration || 0,
            pubdate: item.pubdate || 0,
            play: (item.stat && item.stat.view) || 0,
            like: (item.stat && item.stat.like) || 0,
            danmaku: (item.stat && item.stat.danmaku) || 0,
            author: item.owner ? item.owner.name : '',
            mid: item.owner ? item.owner.mid : 0,
            face: item.owner ? item.owner.face : '',
            rcmd_reason: rcmdReason,
            is_followed: item.is_followed || 0
          };
        });
        var mid = data.data.mid || 0;
        logger.info('[apiService][getPersonalizedRecommend] 获取成功 count=' + videos.length + ' mid=' + mid);
        callback(null, {
          code: 0,
          message: '0',
          data: {
            items: videos,
            mid: mid,
            fresh_idx: freshIdx
          }
        });
      } else {
        logger.warn('[apiService][getPersonalizedRecommend] API 返回异常');
        callback(null, data || { code: -1, message: '获取个性化推荐失败', data: null });
      }
    }).catch(function(error) {
      logger.error('[apiService][getPersonalizedRecommend] 请求失败 - ' + error.message);
      callback(error, null);
    });
  },

  getVideoTags: function(bvid, optionsOrCallback, callback) {
    if (!bvid) {
      var cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      return cb(null, {
        code: -1,
        message: '缺少必要参数：bvid',
        data: null
      });
    }

    var requestOptions = {};
    if (typeof optionsOrCallback === 'object' && optionsOrCallback !== null) {
      if (optionsOrCallback.cookieString) requestOptions.cookieString = optionsOrCallback.cookieString;
    } else if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
    }

    var apiUrl = CONFIG.BILIBILI_API + '/x/web-interface/view/detail/tag?bvid=' + encodeURIComponent(bvid);
    var cacheKey = 'videoTags:' + bvid;

    logger.info('[apiService][getVideoTags] 开始获取视频标签：bvid=' + bvid);

    cachedProxyRequest(cacheKey, apiUrl, { cacheTTL: 300, cookieString: requestOptions.cookieString })
      .then(function(data) {
        logger.info('[apiService][getVideoTags] 获取成功：bvid=' + bvid);
        callback(null, formatApiResponse(data));
      })
      .catch(function(error) {
        logger.error('[apiService][getVideoTags] 请求失败：bvid=' + bvid + ' - ' + error.message);
        callback(error, null);
      });
  }
};