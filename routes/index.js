const express = require('express');
const router = express.Router();
const apiService = require('../lib/apiService');
const logger = require('../lib/logger');
const sessionStore = require('../lib/sessionStore');

/**
 * 格式化数字显示（如：12345 -> 1.2万）
 * @param {number} count - 数字
 * @returns {string} 格式化后的字符串
 */
function formatCount(count) {
  if (!count || isNaN(count)) {
    return '0';
  }

  count = parseInt(count);

  if (count >= 100000000) {
    return (count / 100000000).toFixed(1) + '亿';
  } else if (count >= 10000) {
    return (count / 10000).toFixed(1) + '万';
  } else {
    return count.toString();
  }
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
 * 格式化日期显示
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string} 格式化后的日期字符串
 */
function formatDate(timestamp) {
  if (!timestamp) {
    return '';
  }

  var date = new Date(timestamp * 1000);
  var year = date.getFullYear();
  var month = ('0' + (date.getMonth() + 1)).slice(-2);
  var day = ('0' + date.getDate()).slice(-2);
  var hours = ('0' + date.getHours()).slice(-2);
  var minutes = ('0' + date.getMinutes()).slice(-2);

  return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
}

/**
 * 格式化视频时长
 * @param {number} seconds - 时长（秒）
 * @returns {string} 格式化后的时长字符串（如：12:34）
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) {
    return '00:00';
  }

  seconds = parseInt(seconds);
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var secs = seconds % 60;

  if (hours > 0) {
    return hours + ':' +
           ('0' + minutes).slice(-2) + ':' +
           ('0' + secs).slice(-2);
  } else {
    return ('0' + minutes).slice(-2) + ':' +
           ('0' + secs).slice(-2);
  }
}

/**
 * 从标题中提取搜索关键词
 * 取前 4-6 个中文字符作为关键词，去除常见无意义词
 * @param {string} title - 视频标题
 * @returns {string} 提取的关键词
 */
function extractKeyword(title) {
  if (!title || typeof title !== 'string') {
    return '';
  }

  // 去除常见的括号内容（如【xxx】、【正式版】等）
  var cleaned = title
    .replace(/【[^】]*】/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/《[^》]*》/g, '')
    .trim();

  if (!cleaned) {
    cleaned = title.trim();
  }

  // 提取前 4-6 个中文字符（或等价的字符长度）
  var keyword = '';
  var count = 0;
  var maxLen = 6;

  for (var i = 0; i < cleaned.length && count < maxLen; i++) {
    var ch = cleaned.charAt(i);
    // 中文字符算1个，其他字符也算1个但优先保留中文
    keyword += ch;
    count++;
  }

  // 如果关键词太短（少于2个字符），返回原标题截断
  if (keyword.length < 2) {
    keyword = title.slice(0, 8);
  }

  return keyword;
}

function sanitizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title.replace(/<[^>]*>/g, '');
}

function highlightKeyword(text, keyword) {
  if (!text || !keyword) return text || '';
  var clean = text.replace(/<[^>]*>/g, '');
  var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return clean.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark class="search-highlight">$1</mark>');
}

/**
 * 去除 HTML 标签，保留纯文本内容
 * @param {string} text - 可能包含 HTML 标签的文本
 * @returns {string} 去除 HTML 标签后的纯文本
 */
function stripHtmlTags(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // 替换 <br> 和 <br/> 为换行符
  var result = text.replace(/<br\s*\/?>/gi, '\n');
  
  // 去除所有 HTML 标签
  result = result.replace(/<[^>]*>/g, '');
  
  // 解码 HTML 实体
  result = result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  
  // 去除多余的空白行
  result = result.replace(/\n\s*\n/g, '\n').trim();
  
  return result;
}

/**
 * 首页路由
 * GET /
 * 异步获取热门视频和排行榜数据
 *
 * 重构说明：原来通过 httpGet('http://localhost:3003/api/popular') 和
 * httpGet('http://localhost:3003/api/ranking') 调用自身 API，现在改为直接调用 apiService
 */

// 频道导航配置（首页使用）
var CHANNEL_CONFIG = [
  { rid: 0, name: '全站', icon: '\u{1F3E0}', color: '#FB7299' },
  { rid: 1, name: '动画', icon: '\u{1F3AC}', color: '#FF6633' },
  { rid: 3, name: '音乐', icon: '\u{1F3B5}', color: '#33CCFF' },
  { rid: 129, name: '舞蹈', icon: '\u{1F483}', color: '#E91E63' },
  { rid: 4, name: '游戏', icon: '\u{1F3AE}', color: '#9933FF' },
  { rid: 36, name: '知识', icon: '\u{1F4D6}', color: '#00B5E5' },
  { rid: 188, name: '科技', icon: '\u{1F4BB}', color: '#00B5E5' },
  { rid: 234, name: '运动', icon: '\u26BD\uFE0F', color: '#4CAF50' },
  { rid: 223, name: '汽车', icon: '\u{1F697}', color: '#795548' },
  { rid: 160, name: '生活', icon: '\u{1F3E1}', color: '#33CC99' },
  { rid: 138, name: '搞笑', icon: '\u{1F602}', color: '#FFCC33' },
  { rid: 211, name: '美食', icon: '\u{1F35C}', color: '#FF6B35' },
  { rid: 217, name: '动物圈', icon: '\u{1F436}', color: '#8BC34A' },
  { rid: 119, name: '鬼畜', icon: '\u{1F47B}', color: '#9C27B0' },
  { rid: 155, name: '时尚', icon: '\u{1F457}', color: '#FF4081' },
  { rid: 5, name: '娱乐', icon: '\u{1F31F}', color: '#FF9800' },
  { rid: 181, name: '影视', icon: '\u{1F3AC}', color: '#9B59B6' }
];

/**
 * 将B站CDN视频URL包装为本地代理URL
 * 内网设备通过本地服务器代理访问B站CDN视频
 * @param {string} url - 原始CDN URL
 * @returns {string} 代理URL或null
 */
function wrapVideoUrl(url) {
  if (!url) return null;
  return '/video/stream?url=' + encodeURIComponent(url);
}

/**
 * 将qualityList中的所有URL包装为本地代理URL
 * @param {Array} list - qualityList数组
 * @returns {Array} 包装后的数组
 */
function wrapQualityList(list) {
  if (!list || !list.length) return [];
  return list.map(function(item) {
    var wrapped = Object.assign({}, item);
    if (wrapped.url) {
      wrapped.url = wrapVideoUrl(wrapped.url);
    }
    return wrapped;
  });
}

router.get('/login', function(req, res) {
  res.redirect('/auth/login');
});

router.get('/profile', function(req, res) {
  res.redirect('/auth/profile');
});

router.get('/', function(req, res, next) {
  var popularVideos = [];
  var errorPopular = null;

  apiService.getPopular(12, function(err, popularData) {
    if (err) {
      logger.error('获取热门视频失败: ' + err.message);
      errorPopular = err;
    } else if (popularData && popularData.code === 0 && popularData.data && popularData.data.list) {
      popularVideos = popularData.data.list.slice(0, 12);
    }

    res.render('pages/index', {
      pageTitle: 'CampusBili - 首页',
      popularVideos: popularVideos,
      formatCount: formatCount,
      formatDuration: formatDuration,
      error: errorPopular
    });
  });
});

/**
 * 视频详情页路由
 * GET /video/:bvid
 * 增强版：获取视频信息和播放地址
 *
 * 重构说明：原来需要 2 次 HTTP 调用（video + playurl），现在改为 2 次直接函数调用
 */
router.get('/video/:bvid', function(req, res, next) {
  var bvid = req.params.bvid;
  var cid = req.query.cid;
  var userCookie = getUserCookie(req);

  apiService.getVideoInfo(bvid, userCookie ? {cookieString: userCookie} : null, function(err, videoData) {
    if (err) {
      logger.error('获取视频信息失败: ' + err.message);
      return next(err);
    }

    if (!videoData || videoData.code !== 0 || !videoData.data) {
      return res.status(404).render('error', {
        pageTitle: '视频不存在 - CampusBili',
        message: '视频不存在或已被删除',
        errorType: 'not_found',
        status: 404,
        showStack: false,
        error: {},
        layoutFullwidth: true
      });
    }

    var videoInfo = videoData.data;

    // 获取分P列表（pages）
    var pages = videoInfo.pages || [];
    var targetCid = null;

    // 如果有指定cid，使用指定的；否则使用第一个分P的cid
    if (cid) {
      targetCid = parseInt(cid);
    } else if (pages.length > 0) {
      targetCid = pages[0].cid;
    }

    if (!targetCid) {
      logger.error('无法获取视频 cid');
      return res.status(500).render('error', {
        pageTitle: '播放失败 - CampusBili',
        message: '无法获取视频播放地址',
        errorType: 'server_error',
        status: 500,
        showStack: false,
        error: {},
        layoutFullwidth: true
      });
    }

    // 获取当前分P信息（用于显示标题等）
    var currentPageInfo = null;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].cid === targetCid) {
        currentPageInfo = pages[i];
        break;
      }
    }
    if (!currentPageInfo && pages.length > 0) {
      currentPageInfo = pages[0];
    }

    // 获取视频播放地址（直接调用 apiService）
    apiService.getPlayUrl(bvid, targetCid, userCookie ? {cookieString: userCookie} : null, function(playErr, playUrlData) {
      var playUrl = null;
      var qualityList = [];
      var playErrorReason = null;

      if (!playErr && playUrlData && playUrlData.code === 0 && playUrlData.data) {
        var playData = playUrlData.data;

        // 提取播放URL（支持多种格式）
        // 格式1: durl（MP4 直链）
        if (playData.durl && playData.durl.length > 0) {
          playUrl = playData.durl[0].url;
          logger.info('[video] 使用 durl 格式播放地址');
        }
        // 格式2: dash.video（DASH 视频流）
        else if (playData.dash) {
          if (playData.dash.video && playData.dash.video.length > 0) {
            // 尝试多种字段名获取 URL
            playUrl = playData.dash.video[0].baseUrl ||
                      playData.dash.video[0].base_url ||
                      playData.dash.video[0].url;
            logger.info('[video] 使用 dash.video 格式播放地址');

            // 提取清晰度列表
            qualityList = playData.dash.video.map(function(v) {
              return {
                id: v.id,
                quality: getQualityName(v.id),
                url: v.baseUrl || v.base_url || v.url,
                codecs: v.codecs,
                width: v.width,
                height: v.height
              };
            });
          }
          // 格式3: dash.dash（DASH MPD XML URL）
          else if (playData.dash.dash) {
            playUrl = playData.dash.dash;
            logger.info('[video] 使用 dash.dash (MPD) 格式');
          }
          // 格式4: dash 中只有 audio（备用方案）
          else if (playData.dash.audio && playData.dash.audio.length > 0) {
            logger.warn('[video] 只有音频流，尝试使用 audio URL 作为备选');
            playUrl = playData.dash.audio[0].baseUrl || playData.dash.audio[0].base_url || playData.dash.audio[0].url;
          }
        }

        // 记录提取结果
        if (playUrl) {
          logger.info('[video] 成功提取播放地址, URL前缀: ' + playUrl.substring(0, 50) + '...');
        } else {
          logger.warn('[video] API 返回数据中未找到可用播放地址, 数据字段: ' +
            Object.keys(playData).join(','));
        }
      }

      // 构建详细错误原因
      if (playErr) {
        playErrorReason = '网络错误: ' + playErr.message;
        logger.error('[video] 获取播放地址网络错误: ' + playErr.message);
      } else if (!playUrlData) {
        playErrorReason = 'API 无响应';
        logger.error('[video] 播放地址 API 无响应');
      } else if (playUrlData.code !== 0) {
        playErrorReason = 'B站 API 错误(' + playUrlData.code + '): ' + (playUrlData.message || '未知错误');
        // 特殊错误码处理
        if (playUrlData.code === -404) {
          playErrorReason = '视频已失效或被删除';
        } else if (playUrlData.code === -403) {
          playErrorReason = '该视频需要登录后才能观看';
        } else if (playUrlData.code === 62002) {
          playErrorReason = '视频正在转码中，请稍后再试';
        }
        logger.error('[video] B站 API 返回错误: code=' + playUrlData.code + ', reason=' + playErrorReason);
      } else if (!playUrl) {
        playErrorReason = 'API 返回数据中未找到可用播放地址(数据格式: ' +
          (playUrlData.data ? Object.keys(playUrlData.data).join(',') : '空') + ')';
        logger.warn('[video] ' + playErrorReason);
      }

      // 提取视频标题关键词，搜索相关推荐视频
      var videoTitle = videoInfo.title || '';
      var keyword = extractKeyword(videoTitle);

      // 并行请求3组额外数据：相关推荐、评论、标签
      var pending = 3;
      var relatedData = null;
      var commentsData = null;
      var tagsData = null;

      function checkAllDone() {
        pending--;
        if (pending === 0) {
          // 所有请求完成，准备渲染数据
          var recommendVideos = [];
          var relatedFromApi = false;

          // 优先使用官方API推荐数据
          if (relatedData && relatedData.length > 0) {
            recommendVideos = relatedData.slice(0, 12);
            relatedFromApi = true;
            logger.info('[video] 使用官方API推荐视频, 数量: ' + recommendVideos.length);
          } else {
            // 降级：使用搜索关键词方案（原有逻辑）
            // 这里需要重新发起搜索请求作为降级方案
            apiService.getSearch(keyword, 'video', '', 1, function(searchErr, searchData) {
              if (!searchErr && searchData && searchData.code === 0 && searchData.data) {
                var results = searchData.data.result || searchData.data.list || [];
                // 过滤掉当前视频，取前6个作为推荐
                recommendVideos = results
                  .filter(function(item) { return item.bvid !== bvid; })
                  .slice(0, 6);
              }

              // 如果搜索推荐为空，降级标记（前端会加载热门视频）
              if (recommendVideos.length === 0) {
                logger.warn('相关推荐搜索无结果，将使用热门视频降级');
              }

              // 渲染页面，传递完整数据
              res.render('pages/video-detail', {
                pageTitle: (currentPageInfo ? currentPageInfo.part : videoInfo.title) + ' - CampusBili',
                video: videoInfo,
                bvid: bvid,
                cid: targetCid,
                currentPage: currentPageInfo,
                pages: pages,
                playUrl: wrapVideoUrl(playUrl),
                qualityList: wrapQualityList(qualityList),
                playErrorReason: playErrorReason,
                recommendVideos: recommendVideos,
                formatCount: formatCount,
                formatDate: formatDate,
                formatDuration: formatDuration,
                stripHtmlTags: stripHtmlTags,
                commentsData: commentsData || null,
                tagsData: tagsData || [],
                relatedFromApi: relatedFromApi,
                layoutFullwidth: true
              });
            });
            return; // 提前返回，等搜索完成后再渲染
          }

          // 直接使用官方 API 数据渲染页面
          res.render('pages/video-detail', {
            pageTitle: (currentPageInfo ? currentPageInfo.part : videoInfo.title) + ' - CampusBili',
            video: videoInfo,
            bvid: bvid,
            cid: targetCid,
            currentPage: currentPageInfo,
            pages: pages,
            playUrl: wrapVideoUrl(playUrl),
            qualityList: wrapQualityList(qualityList),
            playErrorReason: playErrorReason,
            recommendVideos: recommendVideos,
            formatCount: formatCount,
            formatDate: formatDate,
            formatDuration: formatDuration,
            stripHtmlTags: stripHtmlTags,
            commentsData: commentsData || null,
            tagsData: tagsData || [],
            relatedFromApi: relatedFromApi,
            layoutFullwidth: true
          });
        }
      }

      // 请求1: 获取官方相关推荐
      apiService.getRelated(bvid, function(err, data) {
        if (!err && data && data.code === 0 && data.data) {
          relatedData = data.data;
        } else {
          logger.warn('[video] 获取官方推荐失败: ' + (err ? err.message : 'API返回错误'));
        }
        checkAllDone();
      });

      // 请求2: 获取评论数据
      apiService.getComments(videoInfo.aid, {pn:1, ps:5, sort:0, cookieString: userCookie}, function(err, data) {
        if (!err && data && data.code === 0 && data.data) {
          commentsData = data.data;
          logger.info('[video] 成功获取评论数据');
        } else {
          logger.warn('[video] 获取评论失败: ' + (err ? err.message : 'API返回错误'));
        }
        checkAllDone();
      });

      // 请求3: 获取视频标签
      apiService.getVideoTags(bvid, userCookie ? {cookieString: userCookie} : null, function(err, data) {
        if (!err && data && data.code === 0 && data.data) {
          tagsData = data.data;
          logger.info('[video] 成功获取标签数据, 数量: ' + tagsData.length);
        } else {
          logger.warn('[video] 获取标签失败: ' + (err ? err.message : 'API返回错误'));
        }
        checkAllDone();
      });
    });
  });
});

/**
 * 根据质量ID获取质量名称
 * @param {number} qn - 质量ID
 * @returns {string}
 */
function getQualityName(qn) {
  var qualityMap = {
    127: '8K 超高清',
    126: '杜比视界',
    125: 'HDR',
    120: '4K 超清',
    116: '1080P60',
    112: '1080P+',
    80: '1080P 高清',
    64: '720P 高清',
    32: '480P 清晰',
    16: '360P 流畅'
  };
  return qualityMap[qn] || qn + 'P';
}

/**
 * 排行榜页面路由
 * GET /ranking
 * 支持 rid 参数切换分区
 *
 * 重构说明：原来通过 httpGet 调用自身 API，现在直接调用 apiService.getRanking
 */
router.get('/ranking', function(req, res, next) {
  var rid = req.query.rid || '0'; // 默认全站排行
  var page = parseInt(req.query.page) || 1;
  var ps = 100; // 每页数量（新 API 固定返回 100 条）

  // 直接调用 apiService 获取排行榜数据
  apiService.getRanking(rid, page, ps, function(err, rankingData) {
    if (err) {
      return next(err);
    }

    var rankingList = [];
    var total = 0;

    if (rankingData && rankingData.code === 0 && rankingData.data) {
      rankingList = rankingData.data.list || [];
      total = rankingList.length; // 新 API 没有 page_info，直接使用列表长度
    }

    res.render('pages/ranking', {
      pageTitle: '排行榜 - CampusBili',
      rankingList: rankingList,
      currentRid: rid,
      currentPage: page,
      total: total,
      formatCount: formatCount,
      formatDuration: formatDuration
    });
  });
});

/**
 * 搜索结果页路由
 * GET /search
 * 参数：keyword（必须），search_type, order, page
 *
 * 重构说明：原来通过 httpGet 调用自身 API，现在直接调用 apiService.getSearch
 */
router.get('/search', function(req, res, next) {
  var keyword = req.query.keyword || '';
  var searchType = req.query.search_type || 'video';
  var order = req.query.order || '';
  var page = parseInt(req.query.page) || 1;
  var tids = req.query.tids || '0'; // 分区筛选

  if (!keyword.trim()) {
    // 如果没有关键词，重定向到首页
    return res.redirect('/');
  }

  // 直接调用 apiService 执行搜索（传入 tids 分区参数）
  apiService.getSearch(keyword, searchType, order, page, tids, function(err, searchData) {
    if (err) {
      return next(err);
    }

    var searchResults = [];
    var total = 0;
    var numResults = 0;

    if (searchData && searchData.code === 0 && searchData.data) {
      searchResults = searchData.data.result || searchData.data.list || [];
      numResults = searchData.data.numResults || searchResults.length;
      total = searchData.data.numPages || Math.ceil(numResults / 20);
    }

    res.render('pages/search', {
      pageTitle: '搜索 ' + keyword + ' - CampusBili',
      keyword: keyword,
      searchResults: searchResults,
      currentSearchType: searchType,
      order: order,
      currentTids: tids,
      currentPage: page,
      total: total,
      numResults: numResults,
      formatCount: formatCount,
      sanitizeTitle: sanitizeTitle,
      highlightKeyword: highlightKeyword
    });
  });
});

/**
 * UP主空间页路由
 * GET /space/:mid
 */
router.get('/space/:mid', function(req, res, next) {
  var mid = req.params.mid;
  var userCookie = getUserCookie(req);

  if (!mid || isNaN(parseInt(mid))) {
    return res.status(400).render('error', {
      pageTitle: '参数错误 - CampusBili',
      message: '无效的用户 ID',
      errorType: 'bad_request',
      status: 400,
      showStack: false,
      error: {},
      layoutFullwidth: true
    });
  }

  var userInfo = null;
  var userVideos = [];
  var pending = 2;
  var userError = null;

  function done() {
    pending--;
    if (pending > 0) return;

    res.render('pages/space', {
      pageTitle: (userInfo ? userInfo.name : '用户') + ' 的空间 - CampusBili',
      user: userInfo,
      videos: userVideos,
      mid: mid,
      formatCount: formatCount,
      formatDate: formatDate,
      formatDuration: formatDuration,
      stripHtmlTags: stripHtmlTags,
      error: userError,
      layoutFullwidth: true
    });
  }

  apiService.getUserInfo(mid, userCookie ? {cookieString: userCookie} : null, function(err, userData) {
    if (err) {
      logger.error('获取用户信息失败: ' + err.message);
      userError = err;
    } else if (userData && userData.code === 0 && userData.data) {
      userInfo = userData.data;
    }
    done();
  });

  apiService.getUserVideos(mid, 1, {cookieString: userCookie}, function(err, videoData) {
    if (err) {
      logger.error('获取用户投稿失败: ' + err.message);
    } else if (videoData && videoData.code === 0 && videoData.data && videoData.data.videos) {
      userVideos = videoData.data.videos;
    }
    done();
  });
});

/**
 * 推荐视频页路由
 * GET /recommend
 */
router.get('/recommend', function(req, res, next) {
  var userCookie = getUserCookie(req);
  var isLoggedIn = !!userCookie;
  var recommendVideos = [];
  var errorRecommend = null;

  apiService.getRecommend(30, function(err, data) {
    if (err) {
      logger.error('获取推荐视频失败: ' + err.message);
      errorRecommend = err;
    } else if (data && data.code === 0 && data.data) {
      recommendVideos = data.data;
    }

    res.render('pages/recommend', {
      pageTitle: '推荐视频 - CampusBili',
      recommendVideos: recommendVideos,
      isLoggedIn: isLoggedIn,
      formatCount: formatCount,
      formatDuration: formatDuration,
      error: errorRecommend
    });
  });
});

router.get('/dynamic', function(req, res, next) {
  var userCookie = getUserCookie(req);
  var isLoggedIn = !!userCookie;

  res.render('pages/dynamic', {
    pageTitle: '动态 - CampusBili',
    isLoggedIn: isLoggedIn,
    formatCount: formatCount,
    formatDate: formatDate
  });
});

module.exports = router;
