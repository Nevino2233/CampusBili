var express = require('express');
var router = express.Router();
var fetch = require('node-fetch');
var logger = require('../lib/logger');

var ALLOWED_DOMAINS = [
  'bilivideo.com',
  'hdslb.com',
  'biliapi.net',
  'akamaized.net',
  'cos.ap-shanghai.myqcloud.com',
  'mcdn.bilivideo.cn',
  'szbdyd.com',
  'cn-zjhz1-cu-v06.bilivideo.com',
  'cn-gddg1-cmcc-v04.bilivideo.com'
];

var MAX_RETRIES = 2;
var CONNECT_TIMEOUT = 10000;
var STREAM_TIMEOUT = 300000;
var HIGH_WATER_MARK = 512 * 1024;

function isAllowedDomain(urlStr) {
  try {
    var parsedUrl = new URL(urlStr);
    var hostname = parsedUrl.hostname.toLowerCase();
    for (var i = 0; i < ALLOWED_DOMAINS.length; i++) {
      if (hostname === ALLOWED_DOMAINS[i] || hostname.endsWith('.' + ALLOWED_DOMAINS[i])) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function proxyVideoStream(videoUrl, req, res, attempt) {
  attempt = attempt || 1;

  var controller = new AbortController();
  var connectTimer = setTimeout(function() { controller.abort(); }, CONNECT_TIMEOUT);
  var streamTimer = null;
  var clientClosed = false;

  var requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.bilibili.com/',
    'Origin': 'https://www.bilibili.com'
  };

  if (req.headers.range) {
    requestHeaders['Range'] = req.headers.range;
  }

  fetch(videoUrl, {
    method: 'GET',
    headers: requestHeaders,
    signal: controller.signal,
    follow: 5,
    compress: false,
    size: 0,
    highWaterMark: HIGH_WATER_MARK
  })
  .then(function(proxyRes) {
    clearTimeout(connectTimer);

    if (!proxyRes.ok && proxyRes.status !== 206 && proxyRes.status !== 304) {
      if (attempt < MAX_RETRIES && proxyRes.status >= 500) {
        logger.warn('[videoStream] 上游返回 ' + proxyRes.status + '，第 ' + attempt + ' 次重试');
        return proxyRes.buffer().catch(function() {}).then(function() {
          return proxyVideoStream(videoUrl, req, res, attempt + 1);
        });
      }
      throw new Error('上游返回 HTTP ' + proxyRes.status);
    }

    streamTimer = setTimeout(function() {
      controller.abort();
    }, STREAM_TIMEOUT);

    var contentType = proxyRes.headers.get('content-type') || 'video/mp4';
    var contentLength = proxyRes.headers.get('content-length');
    var contentRange = proxyRes.headers.get('content-range');

    var resHeaders = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=7200',
      'X-Video-Proxy': 'campusbili',
      'Connection': 'keep-alive'
    };

    if (proxyRes.status === 206 && contentRange) {
      resHeaders['Content-Range'] = contentRange;
      if (contentLength) { resHeaders['Content-Length'] = contentLength; }
      res.writeHead(206, resHeaders);
    } else {
      if (contentLength) { resHeaders['Content-Length'] = contentLength; }
      res.writeHead(proxyRes.status === 206 ? 206 : 200, resHeaders);
    }

    proxyRes.body.on('error', function(err) {
      clearTimeout(streamTimer);
      logger.error('[videoStream] 流传输错误: ' + err.message);
      if (!res.writableEnded && !clientClosed) {
        res.end();
      }
    });

    proxyRes.body.pipe(res, { highWaterMark: HIGH_WATER_MARK });

    proxyRes.body.on('end', function() {
      clearTimeout(streamTimer);
    });

    logger.info('[videoStream] 传输开始 status=' + proxyRes.status +
      ' type=' + contentType + (contentLength ? ' size=' + contentLength : '') +
      (attempt > 1 ? ' retry=' + attempt : ''));
  })
  .catch(function(err) {
    clearTimeout(connectTimer);
    clearTimeout(streamTimer);

    if (clientClosed) return;

    if ((err.name === 'AbortError' || err.type === 'aborted') && attempt <= 1 && !streamTimer) {
      logger.warn('[videoStream] 连接超时，第 ' + attempt + ' 次重试');
      return proxyVideoStream(videoUrl, req, res, attempt + 1);
    }

    if (err.name === 'AbortError' || err.type === 'aborted') {
      if (!res.headersSent) { return res.status(504).json({ code: -1, message: '视频加载超时' }); }
      return;
    }

    var errMsg;
    if (err.code === 'ENOTFOUND') { errMsg = 'DNS解析失败'; }
    else if (err.code === 'ECONNREFUSED') { errMsg = '连接被拒绝'; }
    else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') { errMsg = '网络中断'; }
    else { errMsg = err.message; }

    logger.error('[videoStream] 错误: ' + errMsg + (attempt > 1 ? ' (retry=' + attempt + ')' : ''));
    if (!res.headersSent) {
      res.status(502).json({ code: -1, message: '视频代理失败: ' + errMsg });
    }
  });

  req.on('close', function() {
    clientClosed = true;
    clearTimeout(connectTimer);
    clearTimeout(streamTimer);
    controller.abort();
  });
}

router.get('/stream', function(req, res, next) {
  var rawUrl = req.query.url;

  if (!rawUrl || rawUrl.trim() === '') {
    return res.status(400).json({ code: -1, message: '缺少视频URL参数' });
  }

  var videoUrl;
  try {
    videoUrl = decodeURIComponent(rawUrl);
  } catch (e) {
    return res.status(400).json({ code: -1, message: 'URL解码失败' });
  }

  if (videoUrl.indexOf('http://') !== 0 && videoUrl.indexOf('https://') !== 0) {
    return res.status(400).json({ code: -1, message: 'URL格式非法' });
  }

  if (!isAllowedDomain(videoUrl)) {
    logger.error('[videoStream] 非法域名: ' + videoUrl.substring(0, 80));
    return res.status(403).json({ code: -1, message: '不允许代理该域名的视频' });
  }

  logger.info('[videoStream] 开始代理: ' + videoUrl.substring(0, 80) + '...');
  proxyVideoStream(videoUrl, req, res, 1);
});

module.exports = router;
