const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const indexRouter = require('./routes/index');
const apiRouter = require('./routes/api');
const imageRouter = require('./routes/image');
const videoStreamRouter = require('./routes/videoStream');
const authRouter = require('./routes/auth');
const rateLimit = require('./middleware/rateLimit');
const expressLayouts = require('express-ejs-layouts');
const sessionStore = require('./lib/sessionStore');
const authService = require('./lib/authService');
const logger = require('./lib/logger');

const app = express();

const PORT = process.env.PORT || 3003;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');
app.use(expressLayouts);

app.use(compression({
  threshold: 1024,
  level: 6
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: { action: 'sameorigin' }
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// 频率限制中间件（仅对页面和API生效，静态资源/图片代理不计入）
app.use(function(req, res, next) {
  var path = req.path || '';
  if (path.startsWith('/css/') || path.startsWith('/js/') ||
      path.startsWith('/image/') || path.startsWith('/video/stream') ||
      path.endsWith('.ico') || path.endsWith('.txt') || path.includes('robots')) {
    return next();
  }
  return rateLimit({
    windowMs: 60 * 10000,
    maxRequests: 300,
    message: '请求过于频繁，请稍后再试'
  })(req, res, next);
});

// 注入当前路径到所有视图模板（用于导航栏高亮）
app.use(function(req, res, next) {
  res.locals.currentPath = req.path;
  next();
});

// 注入用户登录状态到所有视图模板
app.use(function(req, res, next) {
  var deviceId = req.cookies.device_id
    || (req.body && req.body.device_id)
    || (req.query && req.query.device_id)
    || '';
  if (!deviceId) {
    var ip = req.headers['x-forwarded-for'] || '';
    if (ip) { var parts = ip.split(','); ip = parts[parts.length - 1].trim(); }
    if (!ip) ip = req.headers['x-real-ip'] || '';
    if (!ip) ip = req.connection.remoteAddress || '';
    if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);
    var ua = req.headers['user-agent'] || '';
    var fingerprint = sessionStore.generateFingerprint(ip, ua);
    deviceId = sessionStore.findDeviceIdByFingerprint(fingerprint);
  }
  if (deviceId) {
    res.cookie('device_id', deviceId, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      path: '/',
      sameSite: false
    });
    var session = sessionStore.getSession(deviceId);
    if (session && session.sessdata) {
      res.locals.isLoggedIn = true;
      res.locals.currentUser = {
        mid: session.mid,
        uname: session.uname,
        face: session.face,
        vipType: session.vipType,
        vipStatus: session.vipStatus,
        level: session.level
      };
    } else {
      res.locals.isLoggedIn = false;
      res.locals.currentUser = null;
    }
  } else {
    res.locals.isLoggedIn = false;
    res.locals.currentUser = null;
  }
  next();
});

// 设置静态文件服务（public 目录）
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

app.use('/xgplayer', express.static(path.join(__dirname, 'node_modules/xgplayer/dist'), {
  maxAge: 86400000,
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// 路由配置（注意：/video 必须在 / 之前，否则 /video/stream 会被 /video/:bvid 拦截）
app.use('/video', videoStreamRouter);
app.use('/api', apiRouter);
app.use('/image', imageRouter);
app.use('/auth', authRouter);
app.use('/', indexRouter);

// 404 错误处理中间件
app.use(function(req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  err.errorType = 'not_found';
  next(err);
});

// 全局错误处理中间件（增强版）
app.use(function(err, req, res, next) {
  // 分类错误类型
  var status = err.status || err.statusCode || 500;
  var errorType = err.errorType || 'server_error';
  var userMessage = err.message || '服务器内部错误';

  // 根据错误类型生成用户友好的提示信息
  switch (status) {
    case 400:
      errorType = 'bad_request';
      userMessage = '请求参数有误，请检查后重试';
      break;
    case 401:
      errorType = 'unauthorized';
      userMessage = '未授权访问，请登录后重试';
      break;
    case 403:
      errorType = 'forbidden';
      userMessage = '没有权限访问此资源';
      break;
    case 404:
      errorType = 'not_found';
      userMessage = '您访问的页面不存在或已被删除';
      break;
    case 408:
      errorType = 'timeout';
      userMessage = '请求超时，请检查网络连接后重试';
      break;
    case 429:
      errorType = 'rate_limited';
      userMessage = '请求过于频繁，请稍后再试';
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        errorType = 'network_error';
        userMessage = '网络连接失败，请检查您的网络设置';
        status = 503;
      } else if (err.message && err.message.includes('timeout')) {
        errorType = 'timeout';
        userMessage = 'API 请求超时，服务可能暂时不可用，请稍后重试';
      } else {
        errorType = 'server_error';
        userMessage = '服务器内部错误，我们正在努力修复中';
      }
      break;
    default:
      // 保持原始错误信息
      break;
  }

  // 设置 locals
  res.locals.message = userMessage;
  res.locals.errorType = errorType;

  // 开发环境显示详细堆栈，生产环境隐藏
  var isDev = req.app.get('env') === 'development';
  res.locals.error = isDev ? err : {};
  res.locals.showStack = isDev;

  // 记录错误日志（非 404 错误）
  if (status !== 404) {
    logger.error(req.method + ' ' + req.originalUrl + ' - ' + err.message + ' (Status: ' + status + ')');
    if (isDev && err.stack) {
      logger.error(err.stack);
    }
  }

  // 渲染错误页面
  res.status(status);
  res.render('error', {
    pageTitle: status + ' - CampusBili',
    message: userMessage,
    error: isDev ? err : {},
    errorType: errorType,
    status: status,
    showStack: isDev,
    layoutFullwidth: true
  });
});

// 监听端口启动
app.listen(PORT, function() {
  console.log('====================================');
  console.log('  CampusBili Proxy Server');
  console.log('  Running on http://localhost:' + PORT);
  console.log('====================================');
});

setInterval(function() {
  fs.readFile(path.join(__dirname, 'data', 'sessions', 'sessions.json'), 'utf8', function(err, data) {
    if (err) return;
    try {
      var sessions = JSON.parse(data);
      var deviceIds = Object.keys(sessions);
      for (var i = 0; i < deviceIds.length; i++) {
        var deviceId = deviceIds[i];
        var session = sessions[deviceId];
        if (!session || !session.sessdata) continue;
        var now = Date.now();
        if (session.lastRefreshCheck && (now - session.lastRefreshCheck) < 24 * 60 * 60 * 1000) continue;
        authService.tryRefreshCookie(deviceId).catch(function() {});
      }
    } catch(e) {
      logger.error('[cookieRefresh] 解析会话文件失败: ' + e.message);
    }
  });
}, 6 * 60 * 60 * 1000);
