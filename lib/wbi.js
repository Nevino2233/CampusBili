/**
 * Bilibili WBI 签名模块
 * 用于生成 Bilibili API 所需的 WBI 签名参数
 */

const fetch = require('node-fetch');
const md5 = require('md5');
const cache = require('./cache');
const logger = require('./logger');

// WBI keys 缓存键名
var CACHE_KEY = 'wbi_keys';

// 缓存 TTL: 1 小时 (3600 秒)
var CACHE_TTL = 3600;

// MIXIN_KEY_ENC_TAB 重排映射表
var MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

/**
 * 从 URL 中提取文件名作为 key
 * @param {string} url - 图片 URL
 * @returns {string} 提取的 key
 */
function extractKeyFromUrl(url) {
  if (!url) {
    return '';
  }
  // 获取 URL 最后部分（文件名），去除扩展名
  var parts = url.split('/');
  var filename = parts[parts.length - 1] || '';
  // 去除 .png 扩展名
  if (filename.indexOf('.png') > -1) {
    filename = filename.substring(0, filename.lastIndexOf('.png'));
  }
  return filename;
}

/**
 * 打乱重排获取 mixin_key
 * @param {string} orig - 原始拼接后的 key 字符串 (img_key + sub_key)
 * @returns {string} 32位的 mixin_key
 */
function getMixinKey(orig) {
  var result = '';
  for (var i = 0; i < MIXIN_KEY_ENC_TAB.length; i++) {
    result += orig[MIXIN_KEY_ENC_TAB[i]];
  }
  return result.substring(0, 32);
}

/**
 * 获取并缓存 img_key/sub_key
 * @returns {Promise<{img_key: string, sub_key: string}>} WBI 密钥对象
 */
function getWbiKeys() {
  return new Promise(function(resolve, reject) {
    // 先检查缓存
    var cachedKeys = cache.get(CACHE_KEY);
    if (cachedKeys) {
      logger.debug('使用缓存的 WBI keys');
      resolve(cachedKeys);
      return;
    }

    logger.info('正在从 Bilibili API 获取 WBI keys...');

    fetch('https://api.bilibili.com/x/web-interface/nav', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com'
      }
    })
      .then(function(res) {
        if (!res.ok) {
          throw new Error('HTTP error! status: ' + res.status);
        }
        return res.json();
      })
      .then(function(data) {
        if (!data) {
          throw new Error('无响应数据');
        }

        if (!data.data || !data.data.wbi_img) {
          throw new Error('API 返回错误: ' + (data.message || '响应中缺少 wbi_img 数据'));
        }

        var wbiImg = data.data.wbi_img;
        var imgKey = extractKeyFromUrl(wbiImg.img_url);
        var subKey = extractKeyFromUrl(wbiImg.sub_url);

        if (!imgKey || !subKey) {
          throw new Error('无法提取 img_key 或 sub_key');
        }

        var keys = {
          img_key: imgKey,
          sub_key: subKey
        };

        // 存入缓存
        cache.set(CACHE_KEY, keys, CACHE_TTL);

        logger.info('成功获取并缓存 WBI keys');

        resolve(keys);
      })
      .catch(function(err) {
        logger.error('获取 WBI keys 失败: ' + err.message);
        reject(err);
      });
  });
}

/**
 * 对参数对象进行 WBI 签名
 * @param {Object} params - 待签名的参数对象
 * @returns {Promise<Object>} 添加了 w_rid 和 wts 的新参数对象
 */
function signParams(params) {
  return new Promise(function(resolve, reject) {
    if (!params || typeof params !== 'object') {
      reject(new Error('params 必须是一个非空对象'));
      return;
    }

    getWbiKeys()
      .then(function(keys) {
        // 1. 将参数对象复制一份，添加 wts 时间戳
        var signedParams = {};
        for (var key in params) {
          if (params.hasOwnProperty(key)) {
            signedParams[key] = params[key];
          }
        }
        
        // 当前 Unix 时间戳（秒）
        var wts = Math.floor(Date.now() / 1000).toString();
        signedParams.wts = wts;

        // 2. 将参数按键名字典序升序排列
        var sortedKeys = Object.keys(signedParams).sort();

        // 3. 进行 URL 编码并拼接成 query string 格式
        var queryStringParts = [];
        for (var i = 0; i < sortedKeys.length; i++) {
          var k = sortedKeys[i];
          var v = signedParams[k];
          // 进行 URL 编码
          var encodedKey = encodeURIComponent(k);
          var encodedValue = encodeURIComponent(v.toString());
          queryStringParts.push(encodedKey + '=' + encodedValue);
        }
        var queryString = queryStringParts.join('&');

        // 4. 生成 mixin_key 并追加到末尾
        var rawWbiKey = keys.img_key + keys.sub_key;
        var mixinKey = getMixinKey(rawWbiKey);
        var signString = queryString + mixinKey;

        logger.debug('签名原始字符串长度: ' + signString.length);

        // 5. 计算 MD5 得到 w_rid
        var wRid = md5(signString);

        // 6. 将 w_rid 加入结果对象
        signedParams.w_rid = wRid;

        logger.debug('WBI 签名完成, wts=' + wts + ', w_rid=' + wRid.substring(0, 8) + '...');

        resolve(signedParams);
      })
      .catch(function(err) {
        logger.error('WBI 签名失败: ' + err.message);
        reject(err);
      });
  });
}

module.exports = {
  getWbiKeys: getWbiKeys,
  signParams: signParams,
  getMixinKey: getMixinKey
};
