const logger = require('../lib/logger');

var requestRecords = {};
var MAX_IP_RECORDS = 10000;

function rateLimit(options) {
  var config = Object.assign({
    windowMs: 60 * 1000,
    maxRequests: 100,
    message: '请求过于频繁，请稍后再试'
  }, options || {});

  return function(req, res, next) {
    var ip = req.ip || req.connection.remoteAddress;
    var currentTime = Date.now();

    if (!requestRecords[ip]) {
      var ipCount = Object.keys(requestRecords).length;
      if (ipCount >= MAX_IP_RECORDS) {
        evictOldestRecords(Math.floor(MAX_IP_RECORDS * 0.2));
      }
      requestRecords[ip] = {
        requests: [],
        count: 0,
        lastAccess: currentTime
      };
    }

    var record = requestRecords[ip];
    record.lastAccess = currentTime;

    record.requests = record.requests.filter(function(timestamp) {
      return currentTime - timestamp < config.windowMs;
    });

    record.count = record.requests.length;

    if (record.count >= config.maxRequests) {
      logger.warn('Rate limit exceeded for IP: ' + ip);

      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('Retry-After', Math.ceil(config.windowMs / 1000));

      return res.status(429).json({
        code: -1,
        message: config.message,
        retryAfter: Math.ceil(config.windowMs / 1000)
      });
    }

    record.requests.push(currentTime);
    record.count++;

    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', config.maxRequests - record.count);

    next();
  };
}

function evictOldestRecords(count) {
  var entries = Object.keys(requestRecords).map(function(ip) {
    return { ip: ip, lastAccess: requestRecords[ip].lastAccess || 0 };
  });
  entries.sort(function(a, b) { return a.lastAccess - b.lastAccess; });
  for (var i = 0; i < count && i < entries.length; i++) {
    delete requestRecords[entries[i].ip];
  }
}

function cleanup() {
  var currentTime = Date.now();
  var ips = Object.keys(requestRecords);

  ips.forEach(function(ip) {
    var record = requestRecords[ip];
    record.requests = record.requests.filter(function(timestamp) {
      return currentTime - timestamp < 60000;
    });

    if (record.requests.length === 0) {
      delete requestRecords[ip];
    }
  });
}

setInterval(cleanup, 5 * 60 * 1000);

module.exports = rateLimit;
