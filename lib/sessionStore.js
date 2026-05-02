var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var logger = require('./logger');

var DATA_DIR = path.join(__dirname, '..', 'data');
var SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
var SESSIONS_FILE = path.join(SESSIONS_DIR, 'sessions.json');

var sessions = {};
var fingerprintIndex = {};
var saveTimer = null;
var dirty = false;
var saving = false;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function loadSessions() {
  try {
    ensureDir();
    if (fs.existsSync(SESSIONS_FILE)) {
      var data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      sessions = JSON.parse(data);
      var count = Object.keys(sessions).length;
      logger.info('[sessionStore] 已加载 ' + count + ' 个会话记录');
      rebuildFingerprintIndex();
    } else {
      sessions = {};
      logger.info('[sessionStore] 无历史会话记录，初始化空存储');
    }
  } catch (e) {
    logger.error('[sessionStore] 加载会话记录失败: ' + e.message);
    sessions = {};
  }
}

function scheduleSave() {
  if (saveTimer) return;
  dirty = true;
  saveTimer = setTimeout(function() {
    saveTimer = null;
    if (dirty) {
      saveNow();
    }
  }, 2000);
}

function saveNow() {
  if (saving) {
    dirty = true;
    return;
  }
  saving = true;
  dirty = false;
  var data;
  try {
    data = JSON.stringify(sessions, null, 2);
  } catch (e) {
    saving = false;
    logger.error('[sessionStore] 序列化会话数据失败: ' + e.message);
    return;
  }
  ensureDir();
  fs.writeFile(SESSIONS_FILE, data, 'utf8', function(err) {
    saving = false;
    if (err) {
      dirty = true;
      logger.error('[sessionStore] 保存会话数据失败: ' + err.message);
    } else {
      logger.debug('[sessionStore] 会话数据已保存');
    }
  });
}

function generateDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateFingerprint(ip, userAgent) {
  var raw = (ip || 'unknown') + '|' + (userAgent || 'unknown');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function rebuildFingerprintIndex() {
  fingerprintIndex = {};
  var keys = Object.keys(sessions);
  for (var i = 0; i < keys.length; i++) {
    var s = sessions[keys[i]];
    if (s && s.fingerprint) {
      if (!fingerprintIndex[s.fingerprint]) {
        fingerprintIndex[s.fingerprint] = [];
      }
      fingerprintIndex[s.fingerprint].push(keys[i]);
    }
  }
}

function findDeviceIdByFingerprint(fingerprint) {
  if (!fingerprint) return '';
  var deviceIds = fingerprintIndex[fingerprint];
  if (!deviceIds || deviceIds.length === 0) return '';
  var latestId = '';
  var latestTime = 0;
  for (var i = 0; i < deviceIds.length; i++) {
    var s = sessions[deviceIds[i]];
    if (s && s.loginTime > latestTime) {
      latestTime = s.loginTime;
      latestId = deviceIds[i];
    }
  }
  return latestId;
}

function getSession(deviceId) {
  if (!deviceId) return null;
  var session = sessions[deviceId];
  if (!session) return null;

  if (session.expiresAt && Date.now() > session.expiresAt) {
    delete sessions[deviceId];
    scheduleSave();
    return null;
  }

  return session;
}

function saveSession(deviceId, sessionData) {
  if (!deviceId) return;

  sessions[deviceId] = {
    sessdata: sessionData.sessdata || '',
    biliJct: sessionData.biliJct || '',
    dedeUserId: sessionData.dedeUserId || '',
    dedeUserIdCkMd5: sessionData.dedeUserIdCkMd5 || '',
    refreshToken: sessionData.refreshToken || '',
    mid: sessionData.mid || '',
    uname: sessionData.uname || '',
    face: sessionData.face || '',
    vipType: sessionData.vipType || 0,
    vipStatus: sessionData.vipStatus || 0,
    level: sessionData.level || 0,
    fingerprint: sessionData.fingerprint || '',
    loginTime: sessionData.loginTime || Date.now(),
    expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
    lastRefreshCheck: 0
  };

  if (sessions[deviceId].fingerprint) {
    if (!fingerprintIndex[sessions[deviceId].fingerprint]) {
      fingerprintIndex[sessions[deviceId].fingerprint] = [];
    }
    if (fingerprintIndex[sessions[deviceId].fingerprint].indexOf(deviceId) === -1) {
      fingerprintIndex[sessions[deviceId].fingerprint].push(deviceId);
    }
  }

  scheduleSave();
  logger.info('[sessionStore] 保存会话: deviceId=' + deviceId.substring(0, 8) + '..., mid=' + sessionData.mid);
}

function deleteSession(deviceId) {
  if (!deviceId) return;
  var s = sessions[deviceId];
  if (s && s.fingerprint && fingerprintIndex[s.fingerprint]) {
    var idx = fingerprintIndex[s.fingerprint].indexOf(deviceId);
    if (idx !== -1) {
      fingerprintIndex[s.fingerprint].splice(idx, 1);
    }
    if (fingerprintIndex[s.fingerprint].length === 0) {
      delete fingerprintIndex[s.fingerprint];
    }
  }
  delete sessions[deviceId];
  scheduleSave();
  logger.info('[sessionStore] 删除会话: deviceId=' + deviceId.substring(0, 8) + '...');
}

function updateSessionField(deviceId, fields) {
  if (!deviceId || !sessions[deviceId]) return;
  var keys = Object.keys(fields);
  for (var i = 0; i < keys.length; i++) {
    sessions[deviceId][keys[i]] = fields[keys[i]];
  }
  scheduleSave();
}

function getCookieString(deviceId) {
  var session = getSession(deviceId);
  if (!session || !session.sessdata) return '';
  var parts = [];
  if (session.sessdata) parts.push('SESSDATA=' + session.sessdata);
  if (session.biliJct) parts.push('bili_jct=' + session.biliJct);
  if (session.dedeUserId) parts.push('DedeUserID=' + session.dedeUserId);
  if (session.dedeUserIdCkMd5) parts.push('DedeUserID__ckMd5=' + session.dedeUserIdCkMd5);
  return parts.join('; ');
}

function getAllSessionCount() {
  return Object.keys(sessions).length;
}

function cleanExpiredSessions() {
  var now = Date.now();
  var count = 0;
  var keys = Object.keys(sessions);
  for (var i = 0; i < keys.length; i++) {
    var s = sessions[keys[i]];
    if (s.expiresAt && now > s.expiresAt) {
      delete sessions[keys[i]];
      count++;
    }
  }
  if (count > 0) {
    scheduleSave();
    logger.info('[sessionStore] 清理了 ' + count + ' 个过期会话');
  }
}

loadSessions();

setInterval(function() {
  cleanExpiredSessions();
}, 24 * 60 * 60 * 1000);

setInterval(function() {
  if (dirty) saveNow();
}, 30000);

process.on('exit', function() {
  if (dirty) {
    try {
      ensureDir();
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (e) {
      logger.error('[sessionStore] 退出时保存失败: ' + e.message);
    }
  }
});

module.exports = {
  generateDeviceId: generateDeviceId,
  generateFingerprint: generateFingerprint,
  findDeviceIdByFingerprint: findDeviceIdByFingerprint,
  getSession: getSession,
  saveSession: saveSession,
  deleteSession: deleteSession,
  updateSessionField: updateSessionField,
  getCookieString: getCookieString,
  getAllSessionCount: getAllSessionCount,
  cleanExpiredSessions: cleanExpiredSessions
};
