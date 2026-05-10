var express = require('express');
var router = express.Router();
var fetch = require('node-fetch');
var logger = require('../lib/logger');

var ALLOWED_DOMAINS = [
  'hdslb.com',
  'bilivideo.com',
  'bilibili.com',
  'biliapi.net',
  'bilicdn.com',
  'akamaized.net'
];

var MAX_IMAGE_SIZE = 10 * 1024 * 1024;
var REQUEST_TIMEOUT = 15000;

function isAllowedDomain(url) {
  try {
    var parsedUrl = new URL(url);
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

function getImageMimeType(contentType, url) {
  if (contentType && contentType.indexOf('image/') === 0) {
    return contentType.split(';')[0].trim();
  }
  if (contentType === 'application/octet-stream' || !contentType) {
    var extMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml'
    };
    var urlPath = url.split('?')[0];
    var dotIndex = urlPath.lastIndexOf('.');
    if (dotIndex !== -1) {
      var ext = urlPath.substring(dotIndex).toLowerCase();
      if (extMap[ext]) return extMap[ext];
    }
  }
  return contentType || 'image/jpeg';
}

router.get('/proxy', function(req, res, next) {
  var startTime = Date.now();
  var imageUrl = req.query.url;

  if (!imageUrl || imageUrl.trim() === '') {
    return res.status(400).json({ code: -1, message: '缺少图片 URL 参数' });
  }

  imageUrl = imageUrl.trim();

  if (imageUrl.indexOf('//') === 0 && imageUrl.indexOf('http') !== 0) {
    imageUrl = 'https:' + imageUrl;
  }

  if (imageUrl.indexOf('http://') !== 0 && imageUrl.indexOf('https://') !== 0) {
    return res.status(400).json({ code: -1, message: 'URL 格式非法' });
  }

  if (!isAllowedDomain(imageUrl)) {
    logger.error('[image] 非法域名: ' + imageUrl.substring(0, 80));
    return res.status(403).json({ code: -1, message: '不允许代理该域名的图片' });
  }

  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT);
  var clientClosed = false;
  var bytesReceived = 0;

  fetch(imageUrl, {
    method: 'GET',
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com'
    },
    follow: 5,
    compress: false
  })
  .then(function(response) {
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('HTTP error! status: ' + response.status);
    }

    var contentLength = parseInt(response.headers.get('content-length'), 10);
    if (!isNaN(contentLength) && contentLength > MAX_IMAGE_SIZE) {
      throw new Error('Image size exceeds limit');
    }

    var contentType = response.headers.get('content-type') || '';
    var mimeType = getImageMimeType(contentType, imageUrl);

    var resHeaders = {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=86400',
      'Expires': new Date(Date.now() + 86400000).toUTCString(),
      'X-Image-Proxy': 'campusbili',
      'Access-Control-Allow-Origin': '*'
    };

    if (!isNaN(contentLength) && contentLength > 0) {
      resHeaders['Content-Length'] = contentLength;
    }

    res.writeHead(200, resHeaders);

    response.body.on('data', function(chunk) {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_IMAGE_SIZE) {
        logger.warn('[image] 流式传输超过大小限制: ' + bytesReceived);
        controller.abort();
        if (!res.writableEnded) res.end();
        return;
      }
    });

    response.body.on('error', function(err) {
      logger.error('[image] 流传输错误: ' + err.message);
      if (!res.writableEnded && !clientClosed) res.end();
    });

    response.body.pipe(res);

    response.body.on('end', function() {
      var duration = Date.now() - startTime;
      logger.info('[image] 代理成功: ' + bytesReceived + 'B ' + mimeType + ' ' + duration + 'ms');
    });
  })
  .catch(function(error) {
    clearTimeout(timeoutId);

    if (clientClosed) return;

    if (error.name === 'AbortError' || error.type === 'aborted') {
      if (!res.headersSent) {
        return res.status(502).json({ code: -1, message: '获取图片超时，请稍后重试' });
      }
      return;
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(502).json({ code: -1, message: '无法连接到图片服务器' });
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
      return res.status(502).json({ code: -1, message: '网络连接超时或中断' });
    }

    if (error.message && error.message.indexOf('Image size exceeds') === 0) {
      return res.status(502).json({ code: -1, message: '图片大小超过限制（最大 10MB）' });
    }

    if (error.message && error.message.indexOf('HTTP error!') === 0) {
      return res.status(502).json({ code: -1, message: '无法获取图片' });
    }

    logger.error('[image] 未知错误: ' + error.message);
    if (!res.headersSent) {
      res.status(502).json({ code: -1, message: '获取图片失败' });
    }
  });

  req.on('close', function() {
    clientClosed = true;
    clearTimeout(timeoutId);
    controller.abort();
  });
});

module.exports = router;
