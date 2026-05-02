var fetch = require('node-fetch');
var crypto = require('crypto');
var logger = require('./logger');
var sessionStore = require('./sessionStore');

var PASSPORT_API = 'https://passport.bilibili.com';
var BILIBILI_API = 'https://api.bilibili.com';
var WWW_BILIBILI = 'https://www.bilibili.com';

var DEFAULT_HEADERS = {
  'Referer': 'https://www.bilibili.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};

var CORRESPOND_PATH_PUBKEY = '-----BEGIN PUBLIC KEY-----\n' +
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg\n' +
  'Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71\n' +
  'nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40\n' +
  'JNrRuoEUXpabUzGB8QIDAQAB\n' +
  '-----END PUBLIC KEY-----';

function passportRequest(url, options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    var headers = Object.assign({}, DEFAULT_HEADERS);
    if (options.headers) {
      Object.keys(options.headers).forEach(function(k) {
        headers[k] = options.headers[k];
      });
    }

    var timeout = options.timeout || 15000;
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, timeout);

    var fetchOpts = {
      method: options.method || 'GET',
      headers: headers,
      signal: controller.signal,
      redirect: options.redirect || 'manual'
    };

    if (options.body) {
      fetchOpts.body = options.body;
    }

    fetch(url, fetchOpts)
      .then(function(response) {
        clearTimeout(timeoutId);
        var setCookieHeaders = response.headers.raw()['set-cookie'] || [];
        var cookies = {};
        setCookieHeaders.forEach(function(header) {
          var match = header.match(/^([^=]+)=([^;]*)/);
          if (match) {
            cookies[match[1].trim()] = match[2].trim();
          }
        });

        var redirectUrl = '';
        if (response.status >= 300 && response.status < 400) {
          redirectUrl = response.headers.get('location') || '';
        }

        return response.text().then(function(text) {
          var data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              data = null;
            }
          }
          return { data: data, cookies: cookies, redirectUrl: redirectUrl, status: response.status };
        });
      })
      .then(function(result) {
        resolve(result);
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          reject(new Error('请求超时'));
        } else {
          reject(err);
        }
      });
  });
}

function generateQRCode() {
  return passportRequest(PASSPORT_API + '/x/passport-login/web/qrcode/generate');
}

function pollQRCode(qrcodeKey) {
  var url = PASSPORT_API + '/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(qrcodeKey);
  return passportRequest(url, { timeout: 10000 });
}

function getCaptcha() {
  return passportRequest(PASSPORT_API + '/x/passport-login/captcha?source=main_web');
}

function getLoginKey() {
  return passportRequest(PASSPORT_API + '/x/passport-login/web/key');
}

function rsaEncrypt(publicKeyPem, plaintext) {
  var pem = publicKeyPem;
  if (pem.indexOf('-----BEGIN PUBLIC KEY-----') === -1) {
    pem = '-----BEGIN PUBLIC KEY-----\n' + pem + '\n-----END PUBLIC KEY-----';
  }
  var buffer = Buffer.from(plaintext, 'utf8');
  var encrypted = crypto.publicEncrypt({
    key: pem,
    padding: crypto.constants.RSA_PKCS1_PADDING
  }, buffer);
  return encrypted.toString('base64');
}

function passwordLogin(username, encryptedPassword, token, challenge, validate, seccode) {
  var body = 'username=' + encodeURIComponent(username) +
    '&password=' + encodeURIComponent(encryptedPassword) +
    '&keep=0' +
    '&source=main_web' +
    '&token=' + encodeURIComponent(token) +
    '&challenge=' + encodeURIComponent(challenge) +
    '&validate=' + encodeURIComponent(validate) +
    '&seccode=' + encodeURIComponent(seccode);

  return passportRequest(PASSPORT_API + '/x/passport-login/web/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });
}

function sendSmsCode(cid, tel, source, token, challenge, validate, seccode) {
  var body = 'cid=' + encodeURIComponent(cid) +
    '&tel=' + encodeURIComponent(tel) +
    '&source=' + encodeURIComponent(source || 'main_web') +
    '&token=' + encodeURIComponent(token) +
    '&challenge=' + encodeURIComponent(challenge) +
    '&validate=' + encodeURIComponent(validate) +
    '&seccode=' + encodeURIComponent(seccode);

  return passportRequest(PASSPORT_API + '/x/passport-login/web/sms/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });
}

function smsLogin(cid, tel, code, captchaKey, source) {
  var body = 'cid=' + encodeURIComponent(cid) +
    '&tel=' + encodeURIComponent(tel) +
    '&code=' + encodeURIComponent(code) +
    '&source=' + encodeURIComponent(source || 'main_web') +
    '&captcha_key=' + encodeURIComponent(captchaKey);

  return passportRequest(PASSPORT_API + '/x/passport-login/web/login/sms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });
}

function getNavInfo(cookieString) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  return new Promise(function(resolve, reject) {
    fetch(BILIBILI_API + '/x/web-interface/nav', {
      headers: headers,
      timeout: 10000
    })
      .then(function(res) { return res.json(); })
      .then(function(data) { resolve(data); })
      .catch(function(err) { reject(err); });
  });
}

function getNavStat(cookieString) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  return new Promise(function(resolve, reject) {
    fetch(BILIBILI_API + '/x/web-interface/nav/stat', {
      headers: headers,
      timeout: 10000
    })
      .then(function(res) { return res.json(); })
      .then(function(data) { resolve(data); })
      .catch(function(err) { reject(err); });
  });
}

function logout(sessdata, biliJct, dedeUserId) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  headers['Cookie'] = 'SESSDATA=' + sessdata + '; bili_jct=' + biliJct + '; DedeUserID=' + dedeUserId;
  headers['Content-Type'] = 'application/x-www-form-urlencoded';

  return new Promise(function(resolve, reject) {
    fetch(PASSPORT_API + '/login/exit/v2', {
      method: 'POST',
      headers: headers,
      body: 'biliCSRF=' + encodeURIComponent(biliJct),
      timeout: 10000
    })
      .then(function(res) { return res.json(); })
      .then(function(data) { resolve(data); })
      .catch(function(err) { reject(err); });
  });
}

function extractCookiesFromLoginResponse(cookies) {
  var result = {
    sessdata: '',
    biliJct: '',
    dedeUserId: '',
    dedeUserIdCkMd5: ''
  };

  if (cookies['SESSDATA']) result.sessdata = cookies['SESSDATA'];
  if (cookies['bili_jct']) result.biliJct = cookies['bili_jct'];
  if (cookies['DedeUserID']) result.dedeUserId = cookies['DedeUserID'];
  if (cookies['DedeUserID__ckMd5']) result.dedeUserIdCkMd5 = cookies['DedeUserID__ckMd5'];

  return result;
}

function extractCookiesFromUrl(url) {
  var result = {
    sessdata: '',
    biliJct: '',
    dedeUserId: '',
    dedeUserIdCkMd5: ''
  };

  if (!url) return result;
  try {
    var match;
    match = url.match(/SESSDATA=([^&]+)/);
    if (match) result.sessdata = decodeURIComponent(match[1]);
    match = url.match(/bili_jct=([^&]+)/);
    if (match) result.biliJct = decodeURIComponent(match[1]);
    match = url.match(/DedeUserID=([^&]+)/);
    if (match) result.dedeUserId = decodeURIComponent(match[1]);
    match = url.match(/DedeUserID__ckMd5=([^&]+)/);
    if (match) result.dedeUserIdCkMd5 = decodeURIComponent(match[1]);
  } catch (e) {
    logger.error('[authService] 解析URL中的Cookie失败: ' + e.message);
  }
  return result;
}

function generateCorrespondPath(timestamp) {
  var message = 'refresh_' + timestamp;
  var buffer = Buffer.from(message, 'utf8');

  var encrypted = crypto.publicEncrypt({
    key: CORRESPOND_PATH_PUBKEY,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, buffer);

  return encrypted.toString('hex');
}

function checkCookieRefresh(cookieString) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  return new Promise(function(resolve, reject) {
    fetch(PASSPORT_API + '/x/passport-login/web/cookie/info', {
      headers: headers,
      timeout: 10000
    })
      .then(function(res) { return res.json(); })
      .then(function(data) { resolve(data); })
      .catch(function(err) { reject(err); });
  });
}

function getRefreshCsrf(correspondPath, cookieString) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  return new Promise(function(resolve, reject) {
    fetch(WWW_BILIBILI + '/correspond/1/' + correspondPath, {
      headers: headers,
      timeout: 10000
    })
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var match = html.match(/<div\s+id="1-name">([^<]+)<\/div>/);
        if (match && match[1]) {
          resolve(match[1].trim());
        } else {
          reject(new Error('无法从页面中提取refresh_csrf'));
        }
      })
      .catch(function(err) { reject(err); });
  });
}

function refreshCookie(csrf, refreshCsrf, refreshToken, cookieString) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  headers['Content-Type'] = 'application/x-www-form-urlencoded';

  var body = 'csrf=' + encodeURIComponent(csrf) +
    '&refresh_csrf=' + encodeURIComponent(refreshCsrf) +
    '&source=main_web' +
    '&refresh_token=' + encodeURIComponent(refreshToken);

  return new Promise(function(resolve, reject) {
    fetch(PASSPORT_API + '/x/passport-login/web/cookie/refresh', {
      method: 'POST',
      headers: headers,
      body: body,
      timeout: 10000,
      redirect: 'manual'
    })
      .then(function(response) {
        var setCookieHeaders = response.headers.raw()['set-cookie'] || [];
        var cookies = {};
        setCookieHeaders.forEach(function(header) {
          var m = header.match(/^([^=]+)=([^;]*)/);
          if (m) {
            cookies[m[1].trim()] = m[2].trim();
          }
        });
        return response.text().then(function(text) {
          var data = null;
          if (text) {
            try { data = JSON.parse(text); } catch (e) { data = null; }
          }
          return { data: data, cookies: cookies };
        });
      })
      .then(function(result) { resolve(result); })
      .catch(function(err) { reject(err); });
  });
}

function confirmRefresh(csrf, oldRefreshToken, cookieString) {
  var headers = Object.assign({}, DEFAULT_HEADERS);
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  headers['Content-Type'] = 'application/x-www-form-urlencoded';

  var body = 'csrf=' + encodeURIComponent(csrf) +
    '&refresh_token=' + encodeURIComponent(oldRefreshToken);

  return new Promise(function(resolve, reject) {
    fetch(PASSPORT_API + '/x/passport-login/web/confirm/refresh', {
      method: 'POST',
      headers: headers,
      body: body,
      timeout: 10000
    })
      .then(function(res) { return res.json(); })
      .then(function(data) { resolve(data); })
      .catch(function(err) { reject(err); });
  });
}

function tryRefreshCookie(deviceId) {
  var session = sessionStore.getSession(deviceId);
  if (!session || !session.sessdata) {
    return Promise.resolve({ success: false, reason: 'no_session' });
  }

  var now = Date.now();
  if (session.lastRefreshCheck && (now - session.lastRefreshCheck) < 24 * 60 * 60 * 1000) {
    return Promise.resolve({ success: true, reason: 'not_needed' });
  }

  var cookieString = sessionStore.getCookieString(deviceId);

  return checkCookieRefresh(cookieString)
    .then(function(infoResult) {
      sessionStore.updateSessionField(deviceId, { lastRefreshCheck: now });

      if (!infoResult || infoResult.code !== 0 || !infoResult.data || !infoResult.data.refresh) {
        return { success: true, reason: 'not_needed' };
      }

      logger.info('[authService] 设备 ' + deviceId.substring(0, 8) + '... 需要刷新Cookie');

      var timestamp = infoResult.data.timestamp || Date.now();
      var correspondPath = generateCorrespondPath(timestamp);

      return getRefreshCsrf(correspondPath, cookieString)
        .then(function(refreshCsrf) {
          var oldRefreshToken = session.refreshToken;
          return refreshCookie(session.biliJct, refreshCsrf, oldRefreshToken, cookieString)
            .then(function(refreshResult) {
              if (!refreshResult.data || refreshResult.data.code !== 0) {
                logger.warn('[authService] Cookie刷新失败: ' + (refreshResult.data ? refreshResult.data.message : 'unknown'));
                return { success: false, reason: 'refresh_failed' };
              }

              var newCookies = extractCookiesFromLoginResponse(refreshResult.cookies);
              var newRefreshToken = refreshResult.data.data ? refreshResult.data.data.refresh_token : '';

              var updatedFields = { lastRefreshCheck: now };
              if (newCookies.sessdata) updatedFields.sessdata = newCookies.sessdata;
              if (newCookies.biliJct) updatedFields.biliJct = newCookies.biliJct;
              if (newCookies.dedeUserId) updatedFields.dedeUserId = newCookies.dedeUserId;
              if (newCookies.dedeUserIdCkMd5) updatedFields.dedeUserIdCkMd5 = newCookies.dedeUserIdCkMd5;
              if (newRefreshToken) updatedFields.refreshToken = newRefreshToken;

              sessionStore.updateSessionField(deviceId, updatedFields);

              var newCookieString = sessionStore.getCookieString(deviceId);
              return confirmRefresh(newCookies.biliJct || session.biliJct, oldRefreshToken, newCookieString)
                .then(function() {
                  logger.info('[authService] 设备 ' + deviceId.substring(0, 8) + '... Cookie刷新成功');
                  return { success: true, reason: 'refreshed' };
                });
            });
        });
    })
    .catch(function(err) {
      logger.error('[authService] Cookie刷新异常: ' + err.message);
      return { success: false, reason: 'error', error: err.message };
    });
}

function handleQRLoginSuccess(deviceId, pollResult, fingerprint) {
  if (!deviceId) {
    logger.error('[authService] handleQRLoginSuccess: deviceId为空，无法保存会话');
    return Promise.resolve({ success: false, user: null });
  }

  var cookies = extractCookiesFromLoginResponse(pollResult.cookies);

  if (!cookies.sessdata && pollResult.redirectUrl) {
    var redirectCookies = extractCookiesFromUrl(pollResult.redirectUrl);
    if (redirectCookies.sessdata) cookies = redirectCookies;
  }

  if (!cookies.sessdata && pollResult.data && pollResult.data.data && pollResult.data.data.url) {
    var urlCookies = extractCookiesFromUrl(pollResult.data.data.url);
    if (urlCookies.sessdata) cookies = urlCookies;
  }

  var refreshToken = '';
  if (pollResult.data && pollResult.data.data && pollResult.data.data.refresh_token) {
    refreshToken = pollResult.data.data.refresh_token;
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

  return fetchUserInfo(deviceId);
}

function handlePasswordLoginSuccess(deviceId, loginResult, fingerprint) {
  if (!deviceId) {
    logger.error('[authService] handlePasswordLoginSuccess: deviceId为空，无法保存会话');
    return Promise.resolve({ success: false, user: null });
  }

  var cookies = extractCookiesFromLoginResponse(loginResult.cookies);

  if (!cookies.sessdata && loginResult.redirectUrl) {
    var redirectCookies = extractCookiesFromUrl(loginResult.redirectUrl);
    if (redirectCookies.sessdata) cookies = redirectCookies;
  }

  if (!cookies.sessdata && loginResult.data && loginResult.data.data && loginResult.data.data.url) {
    var urlCookies = extractCookiesFromUrl(loginResult.data.data.url);
    if (urlCookies.sessdata) cookies = urlCookies;
  }

  var refreshToken = '';
  if (loginResult.data && loginResult.data.data && loginResult.data.data.refresh_token) {
    refreshToken = loginResult.data.data.refresh_token;
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

  return fetchUserInfo(deviceId);
}

function handleSmsLoginSuccess(deviceId, smsResult, fingerprint) {
  if (!deviceId) {
    logger.error('[authService] handleSmsLoginSuccess: deviceId为空，无法保存会话');
    return Promise.resolve({ success: false, user: null });
  }

  var cookies = extractCookiesFromLoginResponse(smsResult.cookies);

  if (!cookies.sessdata && smsResult.redirectUrl) {
    var redirectCookies = extractCookiesFromUrl(smsResult.redirectUrl);
    if (redirectCookies.sessdata) cookies = redirectCookies;
  }

  if (!cookies.sessdata && smsResult.data && smsResult.data.data && smsResult.data.data.url) {
    var urlCookies = extractCookiesFromUrl(smsResult.data.data.url);
    if (urlCookies.sessdata) cookies = urlCookies;
  }

  var refreshToken = '';
  if (smsResult.data && smsResult.data.data && smsResult.data.data.refresh_token) {
    refreshToken = smsResult.data.data.refresh_token;
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

  return fetchUserInfo(deviceId);
}

function fetchUserInfo(deviceId) {
  var cookieString = sessionStore.getCookieString(deviceId);
  return getNavInfo(cookieString)
    .then(function(navData) {
      if (navData && navData.code === 0 && navData.data && navData.data.isLogin) {
        sessionStore.updateSessionField(deviceId, {
          mid: navData.data.mid || '',
          uname: navData.data.uname || '',
          face: navData.data.face || '',
          vipType: navData.data.vipType || 0,
          vipStatus: navData.data.vipStatus || 0,
          level: (navData.data.level_info && navData.data.level_info.current_level) || 0
        });
        return { success: true, user: navData.data };
      }
      return { success: true, user: null };
    })
    .catch(function(err) {
      logger.error('[authService] 获取用户信息失败: ' + err.message);
      return { success: true, user: null };
    });
}

function getRiskCaptcha() {
  return passportRequest(PASSPORT_API + '/x/safecenter/captcha/pre', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'source=risk'
  });
}

function sendRiskSms(tmpCode, recaptchaToken, geeChallenge, geeValidate, geeSeccode) {
  var body = 'tmp_code=' + encodeURIComponent(tmpCode) +
    '&sms_type=loginTelCheck' +
    '&recaptcha_token=' + encodeURIComponent(recaptchaToken) +
    '&gee_challenge=' + encodeURIComponent(geeChallenge) +
    '&gee_validate=' + encodeURIComponent(geeValidate) +
    '&gee_seccode=' + encodeURIComponent(geeSeccode);

  return passportRequest(PASSPORT_API + '/x/safecenter/common/sms/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });
}

function verifyRiskTel(tmpCode, captchaKey, code, requestId) {
  var body = 'tmp_code=' + encodeURIComponent(tmpCode) +
    '&captcha_key=' + encodeURIComponent(captchaKey) +
    '&type=loginTelCheck' +
    '&code=' + encodeURIComponent(code) +
    '&request_id=' + encodeURIComponent(requestId) +
    '&source=risk';

  return passportRequest(PASSPORT_API + '/x/safecenter/login/tel/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });
}

function exchangeCookie(exchangeCode) {
  var body = 'source=risk' +
    '&code=' + encodeURIComponent(exchangeCode);

  return passportRequest(PASSPORT_API + '/x/passport-login/web/exchange_cookie', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });
}

function getCountryList() {
  return new Promise(function(resolve, reject) {
    fetch(PASSPORT_API + '/web/generic/country/list', {
      headers: DEFAULT_HEADERS,
      timeout: 10000
    })
      .then(function(res) { return res.json(); })
      .then(function(data) { resolve(data); })
      .catch(function(err) { reject(err); });
  });
}

module.exports = {
  generateQRCode: generateQRCode,
  pollQRCode: pollQRCode,
  getCaptcha: getCaptcha,
  getLoginKey: getLoginKey,
  rsaEncrypt: rsaEncrypt,
  passwordLogin: passwordLogin,
  sendSmsCode: sendSmsCode,
  smsLogin: smsLogin,
  getNavInfo: getNavInfo,
  getNavStat: getNavStat,
  logout: logout,
  extractCookiesFromLoginResponse: extractCookiesFromLoginResponse,
  extractCookiesFromUrl: extractCookiesFromUrl,
  generateCorrespondPath: generateCorrespondPath,
  checkCookieRefresh: checkCookieRefresh,
  getRefreshCsrf: getRefreshCsrf,
  refreshCookie: refreshCookie,
  confirmRefresh: confirmRefresh,
  tryRefreshCookie: tryRefreshCookie,
  handleQRLoginSuccess: handleQRLoginSuccess,
  handlePasswordLoginSuccess: handlePasswordLoginSuccess,
  handleSmsLoginSuccess: handleSmsLoginSuccess,
  fetchUserInfo: fetchUserInfo,
  getCountryList: getCountryList,
  getRiskCaptcha: getRiskCaptcha,
  sendRiskSms: sendRiskSms,
  verifyRiskTel: verifyRiskTel,
  exchangeCookie: exchangeCookie
};
