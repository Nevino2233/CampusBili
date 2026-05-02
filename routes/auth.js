var express = require('express');
var router = express.Router();
var authService = require('../lib/authService');
var sessionStore = require('../lib/sessionStore');
var apiService = require('../lib/apiService');
var logger = require('../lib/logger');

function getDeviceId(req) {
  return req.cookies.device_id
    || (req.body && req.body.device_id)
    || (req.query && req.query.device_id)
    || '';
}

function getClientIp(req) {
  var ip = req.headers['x-forwarded-for'] || '';
  if (ip) {
    var parts = ip.split(',');
    ip = parts[parts.length - 1].trim();
  }
  if (!ip) ip = req.headers['x-real-ip'] || '';
  if (!ip) ip = req.connection.remoteAddress || '';
  if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);
  return ip;
}

function getFingerprint(req) {
  var ip = getClientIp(req);
  var ua = req.headers['user-agent'] || '';
  return sessionStore.generateFingerprint(ip, ua);
}

function ensureDeviceId(req, res) {
  var deviceId = req.cookies.device_id
    || (req.body && req.body.device_id)
    || (req.query && req.query.device_id)
    || '';

  if (!deviceId) {
    var ip = getClientIp(req);
    var ua = req.headers['user-agent'] || '';
    var fingerprint = sessionStore.generateFingerprint(ip, ua);
    var recoveredId = sessionStore.findDeviceIdByFingerprint(fingerprint);
    if (recoveredId) {
      deviceId = recoveredId;
      logger.info('[auth] 通过指纹恢复 deviceId=' + deviceId.substring(0, 8) + '..., ip=' + ip);
    } else {
      deviceId = sessionStore.generateDeviceId();
      logger.info('[auth] 生成新 deviceId=' + deviceId.substring(0, 8) + '..., ip=' + ip);
    }
  }

  res.cookie('device_id', deviceId, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    path: '/',
    sameSite: false
  });
  return deviceId;
}

function getUserInfo(req, overrideDeviceId) {
  var deviceId = overrideDeviceId || getDeviceId(req);
  if (!deviceId) return null;
  var session = sessionStore.getSession(deviceId);
  if (!session || !session.sessdata) return null;
  return {
    mid: session.mid,
    uname: session.uname,
    face: session.face,
    vipType: session.vipType,
    vipStatus: session.vipStatus,
    level: session.level
  };
}

router.use(function(req, res, next) {
  res.locals.getUserInfo = function() {
    var deviceId = res.locals.deviceId || getDeviceId(req);
    return getUserInfo(req, deviceId);
  };
  var deviceId = getDeviceId(req);
  if (deviceId) {
    res.locals.deviceId = deviceId;
  }
  next();
});

router.get('/login', function(req, res) {
  var deviceId = ensureDeviceId(req, res);
  var userInfo = getUserInfo(req, deviceId);

  if (userInfo) {
    return res.redirect('/profile');
  }

  res.render('pages/login', {
    pageTitle: '登录 - CampusBili',
    error: null
  });
});

router.get('/profile', function(req, res) {
  var deviceId = ensureDeviceId(req, res);
  var userInfo = getUserInfo(req, deviceId);

  if (!userInfo) {
    return res.redirect('/login');
  }

  var cookieString = sessionStore.getCookieString(deviceId);

  authService.tryRefreshCookie(deviceId).then(function() {
    return authService.getNavStat(cookieString);
  }).then(function(statResult) {
    var stat = {};
    if (statResult && statResult.code === 0 && statResult.data) {
      stat = statResult.data;
    }

    apiService.getUserInfo(userInfo.mid, {cookieString: cookieString}, function(err, userData) {
      var profileData = null;
      if (!err && userData && userData.code === 0 && userData.data) {
        profileData = userData.data;
      }

      apiService.getUserVideos(userInfo.mid, 1, {cookieString: cookieString}, function(vErr, videoData) {
        var videos = [];
        if (!vErr && videoData && videoData.code === 0 && videoData.data && videoData.data.videos) {
          videos = videoData.data.videos;
        }

        res.render('pages/profile', {
          pageTitle: userInfo.uname + ' 的个人空间 - CampusBili',
          user: Object.assign({}, userInfo, profileData || {}),
          stat: stat,
          videos: videos,
          formatCount: function(count) {
            if (!count || isNaN(count)) return '0';
            count = parseInt(count);
            if (count >= 100000000) return (count / 100000000).toFixed(1) + '亿';
            if (count >= 10000) return (count / 10000).toFixed(1) + '万';
            return count.toString();
          },
          formatDate: function(timestamp) {
            if (!timestamp) return '';
            var date = new Date(timestamp * 1000);
            var y = date.getFullYear();
            var m = ('0' + (date.getMonth() + 1)).slice(-2);
            var d = ('0' + date.getDate()).slice(-2);
            var h = ('0' + date.getHours()).slice(-2);
            var min = ('0' + date.getMinutes()).slice(-2);
            return y + '-' + m + '-' + d + ' ' + h + ':' + min;
          },
          formatDuration: function(seconds) {
            if (!seconds || isNaN(seconds)) return '00:00';
            seconds = parseInt(seconds);
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            var s = seconds % 60;
            if (h > 0) return h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
            return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
          },
          stripHtmlTags: function(text) {
            if (!text || typeof text !== 'string') return '';
            return text.replace(/<[^>]*>/g, '');
          }
        });
      });
    });
  }).catch(function(err) {
    logger.error('[auth] 获取个人空间数据失败: ' + err.message);
    res.render('pages/profile', {
      pageTitle: '个人空间 - CampusBili',
      user: userInfo,
      stat: {},
      videos: [],
      formatCount: function(c) { return c || '0'; },
      formatDate: function() { return ''; },
      formatDuration: function() { return '00:00'; },
      stripHtmlTags: function(t) { return t || ''; }
    });
  });
});

router.get('/api/qrcode', function(req, res) {
  var deviceId = ensureDeviceId(req, res);

  authService.generateQRCode()
    .then(function(result) {
      if (result.data && result.data.code === 0 && result.data.data) {
        res.json({
          code: 0,
          data: {
            url: result.data.data.url,
            qrcode_key: result.data.data.qrcode_key,
            device_id: deviceId
          }
        });
      } else {
        res.json({
          code: -1,
          message: (result.data && result.data.message) || '获取二维码失败'
        });
      }
    })
    .catch(function(err) {
      logger.error('[auth] 获取二维码失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.get('/api/qrcode/poll', function(req, res) {
  var qrcodeKey = req.query.qrcode_key;
  if (!qrcodeKey) {
    return res.json({ code: -1, message: '缺少qrcode_key参数' });
  }

  var deviceId = ensureDeviceId(req, res);

  logger.info('[auth] 二维码轮询 qrcode_key=' + qrcodeKey + ' device_id=' + (deviceId || 'none'));

  authService.pollQRCode(qrcodeKey)
    .then(function(result) {
      logger.info('[auth] 二维码轮询原始响应: ' + JSON.stringify(result.data).substring(0, 300));

      if (!result.data || result.data.code !== 0) {
        logger.warn('[auth] 二维码轮询外层code非0: ' + JSON.stringify(result.data).substring(0, 200));
        return res.json({
          code: -1,
          message: (result.data && result.data.message) || '查询失败'
        });
      }

      var pollData = result.data.data;
      if (!pollData) {
        logger.warn('[auth] 二维码轮询无data.data字段');
        return res.json({ code: -1, message: '响应数据异常' });
      }

      var statusCode = pollData.code;
      logger.info('[auth] 二维码轮询状态码: ' + statusCode + ' message: ' + (pollData.message || ''));

      if (statusCode === 0) {
        if (!deviceId) {
          logger.error('[auth] 二维码登录成功但deviceId为空，无法保存会话');
          return res.json({ code: -1, message: '设备标识异常，请刷新页面重试' });
        }
        var fingerprint = getFingerprint(req);
        return authService.handleQRLoginSuccess(deviceId, result, fingerprint)
          .then(function(loginResult) {
            res.json({
              code: 0,
              status: 0,
              message: '登录成功',
              user: loginResult.user,
              device_id: deviceId
            });
          });
      } else if (statusCode === 86090) {
        res.json({
          code: 0,
          status: 86090,
          message: '已扫码，等待确认'
        });
      } else if (statusCode === 86101) {
        res.json({
          code: 0,
          status: 86101,
          message: '等待扫码'
        });
      } else if (statusCode === 86038) {
        res.json({
          code: 0,
          status: 86038,
          message: '二维码已失效'
        });
      } else {
        res.json({
          code: 0,
          status: statusCode,
          message: pollData.message || '未知状态'
        });
      }
    })
    .catch(function(err) {
      logger.error('[auth] 轮询二维码失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.get('/api/captcha', function(req, res) {
  authService.getCaptcha()
    .then(function(result) {
      if (result.data && result.data.code === 0 && result.data.data) {
        res.json({
          code: 0,
          data: result.data.data
        });
      } else {
        res.json({
          code: -1,
          message: (result.data && result.data.message) || '获取验证码失败'
        });
      }
    })
    .catch(function(err) {
      logger.error('[auth] 获取验证码失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.post('/api/login/password', function(req, res) {
  var deviceId = ensureDeviceId(req, res);
  var fingerprint = getFingerprint(req);

  var username = req.body.username || '';
  var password = req.body.password || '';
  var token = req.body.token || '';
  var challenge = req.body.challenge || '';
  var validate = req.body.validate || '';
  var seccode = req.body.seccode || '';

  if (!username || !password) {
    return res.json({ code: -1, message: '请输入账号和密码' });
  }

  if (!token || !challenge || !validate || !seccode) {
    return res.json({ code: -1, message: '请先完成人机验证' });
  }

  authService.getLoginKey()
    .then(function(keyResult) {
      if (!keyResult.data || keyResult.data.code !== 0 || !keyResult.data.data) {
        return res.json({
          code: -1,
          message: (keyResult.data && keyResult.data.message) || '获取加密密钥失败'
        });
      }

      var hash = keyResult.data.data.hash;
      var pubKey = keyResult.data.data.key;
      var encryptedPassword = authService.rsaEncrypt(pubKey, hash + password);

      return authService.passwordLogin(username, encryptedPassword, token, challenge, validate, seccode)
        .then(function(loginResult) {
          if (!loginResult.data) {
            return res.json({ code: -1, message: '登录请求失败' });
          }

          var data = loginResult.data;
          if (data.code !== 0) {
            var errMsg = data.message || '登录失败';
            if (data.code === -629) errMsg = '账号或密码错误';
            if (data.code === -105) errMsg = '验证码错误，请重新验证';
            if (data.code === -2100) errMsg = '需要验证手机号';
            if (data.code === -662) errMsg = '提交超时，请重试';
            if (data.code === -653) errMsg = '用户名或密码不能为空';
            return res.json({ code: data.code, message: errMsg });
          }

          if (data.data && data.data.status === 2) {
            return res.json({
              code: 2,
              message: data.data.message || '本次登录环境存在风险，需使用手机号验证',
              data: {
                url: data.data.url || ''
              }
            });
          }

          return authService.handlePasswordLoginSuccess(deviceId, loginResult, fingerprint)
            .then(function(loginRes) {
              res.json({
                code: 0,
                message: '登录成功',
                user: loginRes.user,
                device_id: deviceId
              });
            });
        });
    })
    .catch(function(err) {
      logger.error('[auth] 密码登录失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.post('/api/login/sms/send', function(req, res) {
  var cid = req.body.cid || '1';
  var tel = req.body.tel || '';
  var token = req.body.token || '';
  var challenge = req.body.challenge || '';
  var validate = req.body.validate || '';
  var seccode = req.body.seccode || '';

  if (!tel) {
    return res.json({ code: -1, message: '请输入手机号' });
  }

  if (!token || !challenge || !validate || !seccode) {
    return res.json({ code: -1, message: '请先完成人机验证' });
  }

  authService.sendSmsCode(cid, tel, 'main_web', token, challenge, validate, seccode)
    .then(function(result) {
      if (!result.data) {
        return res.json({ code: -1, message: '发送请求失败' });
      }

      var data = result.data;
      if (data.code !== 0) {
        var errMsg = data.message || '发送失败';
        if (data.code === 1002) errMsg = '手机号格式错误';
        if (data.code === 1003) errMsg = '验证码已发送，请稍后再试';
        if (data.code === 86203) errMsg = '短信发送次数已达上限';
        return res.json({ code: data.code, message: errMsg });
      }

      res.json({
        code: 0,
        message: '验证码已发送',
        data: {
          captcha_key: data.data.captcha_key
        }
      });
    })
    .catch(function(err) {
      logger.error('[auth] 发送短信验证码失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.post('/api/login/sms/verify', function(req, res) {
  var deviceId = ensureDeviceId(req, res);
  var fingerprint = getFingerprint(req);

  var cid = req.body.cid || '1';
  var tel = req.body.tel || '';
  var code = req.body.code || '';
  var captchaKey = req.body.captcha_key || '';

  if (!tel || !code) {
    return res.json({ code: -1, message: '请输入手机号和验证码' });
  }

  if (!captchaKey) {
    return res.json({ code: -1, message: '请先发送验证码' });
  }

  authService.smsLogin(cid, tel, code, captchaKey, 'main_web')
    .then(function(result) {
      if (!result.data) {
        return res.json({ code: -1, message: '验证请求失败' });
      }

      var data = result.data;
      if (data.code !== 0) {
        var errMsg = data.message || '验证失败';
        if (data.code === 1006) errMsg = '验证码错误';
        if (data.code === 1007) errMsg = '验证码已过期';
        return res.json({ code: data.code, message: errMsg });
      }

      return authService.handleSmsLoginSuccess(deviceId, result, fingerprint)
        .then(function(loginRes) {
          res.json({
            code: 0,
            message: '登录成功',
            user: loginRes.user,
            device_id: deviceId
          });
        });
    })
    .catch(function(err) {
      logger.error('[auth] 短信验证登录失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.post('/api/logout', function(req, res) {
  var deviceId = getDeviceId(req);
  if (!deviceId) {
    return res.json({ code: -1, message: '未登录' });
  }

  var session = sessionStore.getSession(deviceId);
  if (!session || !session.sessdata) {
    return res.json({ code: -1, message: '未登录' });
  }

  authService.logout(session.sessdata, session.biliJct, session.dedeUserId)
    .then(function() {
      sessionStore.deleteSession(deviceId);
      res.json({ code: 0, message: '已退出登录' });
    })
    .catch(function(err) {
      logger.error('[auth] 退出登录失败: ' + err.message);
      sessionStore.deleteSession(deviceId);
      res.json({ code: 0, message: '已退出登录' });
    });
});

router.get('/api/user/info', function(req, res) {
  var deviceId = getDeviceId(req);
  if (!deviceId) {
    var fingerprint = getFingerprint(req);
    deviceId = sessionStore.findDeviceIdByFingerprint(fingerprint);
  }
  if (!deviceId) {
    return res.json({ code: -101, message: '未登录', data: { isLogin: false } });
  }

  var session = sessionStore.getSession(deviceId);
  if (!session || !session.sessdata) {
    return res.json({ code: -101, message: '未登录', data: { isLogin: false } });
  }

  res.json({
    code: 0,
    data: {
      isLogin: true,
      mid: session.mid,
      uname: session.uname,
      face: session.face,
      vipType: session.vipType,
      vipStatus: session.vipStatus,
      level: session.level
    }
  });
});

router.get('/api/country/list', function(req, res) {
  authService.getCountryList()
    .then(function(result) {
      if (result && result.code === 0 && result.data) {
        res.json({ code: 0, data: result.data });
      } else {
        res.json({
          code: 0,
          data: {
            common: [{ id: 1, cname: '中国大陆', country_id: '86' }],
            others: []
          }
        });
      }
    })
    .catch(function() {
      res.json({
        code: 0,
        data: {
          common: [{ id: 1, cname: '中国大陆', country_id: '86' }],
          others: []
        }
      });
    });
});

router.post('/api/risk/captcha', function(req, res) {
  authService.getRiskCaptcha()
    .then(function(result) {
      if (result.data && result.data.code === 0 && result.data.data) {
        res.json({
          code: 0,
          data: {
            recaptcha_token: result.data.data.recaptcha_token || '',
            gee_gt: result.data.data.gee_gt || '',
            gee_challenge: result.data.data.gee_challenge || ''
          }
        });
      } else {
        res.json({
          code: -1,
          message: (result.data && result.data.message) || '获取风险验证码失败'
        });
      }
    })
    .catch(function(err) {
      logger.error('[auth] 获取风险验证码失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.post('/api/risk/sms/send', function(req, res) {
  var tmpCode = req.body.tmp_code || '';
  var recaptchaToken = req.body.recaptcha_token || '';
  var geeChallenge = req.body.gee_challenge || '';
  var geeValidate = req.body.gee_validate || '';
  var geeSeccode = req.body.gee_seccode || '';

  if (!tmpCode) {
    return res.json({ code: -1, message: '缺少验证参数' });
  }
  if (!geeValidate || !geeSeccode) {
    return res.json({ code: -1, message: '请先完成人机验证' });
  }

  authService.sendRiskSms(tmpCode, recaptchaToken, geeChallenge, geeValidate, geeSeccode)
    .then(function(result) {
      if (!result.data) {
        return res.json({ code: -1, message: '发送请求失败' });
      }

      var data = result.data;
      if (data.code !== 0) {
        return res.json({ code: data.code, message: data.message || '发送失败' });
      }

      res.json({
        code: 0,
        message: '验证码已发送',
        data: {
          captcha_key: data.data.captcha_key
        }
      });
    })
    .catch(function(err) {
      logger.error('[auth] 发送风险验证短信失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

router.post('/api/risk/verify', function(req, res) {
  var deviceId = ensureDeviceId(req, res);
  var fingerprint = getFingerprint(req);

  var tmpCode = req.body.tmp_code || '';
  var captchaKey = req.body.captcha_key || '';
  var code = req.body.code || '';
  var requestId = req.body.request_id || '';

  if (!tmpCode || !captchaKey || !code || !requestId) {
    return res.json({ code: -1, message: '缺少必要参数' });
  }

  authService.verifyRiskTel(tmpCode, captchaKey, code, requestId)
    .then(function(verifyResult) {
      if (!verifyResult.data || verifyResult.data.code !== 0) {
        return res.json({
          code: -1,
          message: (verifyResult.data && verifyResult.data.message) || '验证失败'
        });
      }

      var exchangeCode = '';
      if (verifyResult.data.data && verifyResult.data.data.code) {
        exchangeCode = verifyResult.data.data.code;
      }

      if (!exchangeCode) {
        return res.json({ code: -1, message: '获取交换码失败' });
      }

      return authService.exchangeCookie(exchangeCode)
        .then(function(exchangeResult) {
          if (!exchangeResult.data || exchangeResult.data.code !== 0) {
            return res.json({
              code: -1,
              message: (exchangeResult.data && exchangeResult.data.message) || 'Cookie交换失败'
            });
          }

          var cookies = authService.extractCookiesFromLoginResponse(exchangeResult.cookies);
          var refreshToken = '';
          if (exchangeResult.data.data && exchangeResult.data.data.refresh_token) {
            refreshToken = exchangeResult.data.data.refresh_token;
          }

          if (!cookies.sessdata && exchangeResult.data.data && exchangeResult.data.data.url) {
            var urlCookies = authService.extractCookiesFromUrl(exchangeResult.data.data.url);
            if (urlCookies.sessdata) cookies = urlCookies;
          }

          sessionStore.saveSession(deviceId, {
            sessdata: cookies.sessdata,
            biliJct: cookies.biliJct,
            dedeUserId: cookies.dedeUserId,
            dedeUserIdCkMd5: cookies.dedeUserIdCkMd5,
            refreshToken: refreshToken,
            fingerprint: fingerprint || '',
            loginTime: Date.now()
          });

          return authService.fetchUserInfo(deviceId)
            .then(function(loginRes) {
              res.json({
                code: 0,
                message: '验证成功，已登录',
                user: loginRes.user,
                device_id: deviceId
              });
            });
        });
    })
    .catch(function(err) {
      logger.error('[auth] 风险验证失败: ' + err.message);
      res.json({ code: -1, message: '网络错误，请重试' });
    });
});

module.exports = router;
