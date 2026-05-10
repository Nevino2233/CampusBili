/**
 * node-cache 封装模块
 * 提供统一的缓存接口
 */

const NodeCache = require('node-cache');

// 创建缓存实例（默认 TTL: 300秒，检查周期: 120秒）
const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 120,
  useClones: false // 性能优化：不克隆对象
});

/**
 * 获取缓存值
 * @param {string} key - 缓存键
 * @returns {any|null} 缓存的值，不存在返回 null
 */
function get(key) {
  return cache.get(key);
}

/**
 * 设置缓存值
 * @param {string} key - 缓存键
 * @param {any} value - 缓存值
 * @param {number} ttl - 过期时间（秒），可选，默认使用全局 TTL
 */
function set(key, value, ttl) {
  if (ttl && typeof ttl === 'number') {
    cache.set(key, value, ttl);
  } else {
    cache.set(key, value);
  }
}

/**
 * 删除缓存
 * @param {string|string[]} keys - 要删除的键或键数组
 */
function del(keys) {
  cache.del(keys);
}

/**
 * 清空所有缓存
 */
function flush() {
  cache.flushAll();
}

/**
 * 获取缓存统计信息
 * @returns {object} 统计信息对象
 */
function getStats() {
  return cache.getStats();
}

/**
 * 检查键是否存在
 * @param {string} key - 缓存键
 * @returns {boolean} 是否存在
 */
function has(key) {
  return cache.has(key);
}

module.exports = {
  get: get,
  set: set,
  del: del,
  flush: flush,
  getStats: getStats,
  has: has,
  // 导出原始实例以便高级用法
  instance: cache
};
