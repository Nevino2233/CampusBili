/**
 * 简单日志模块
 * 提供不同级别的日志输出功能
 */

const logger = {
  /**
   * 输出信息级别日志
   * @param {string} message - 日志消息
   * @param {...any} args - 额外参数
   */
  info: function(message) {
    var args = Array.prototype.slice.call(arguments, 1);
    var timestamp = new Date().toISOString();
    console.log('[' + timestamp + '] [INFO] ' + message, args.length > 0 ? args : '');
  },

  /**
   * 输出警告级别日志
   * @param {string} message - 日志消息
   * @param {...any} args - 额外参数
   */
  warn: function(message) {
    var args = Array.prototype.slice.call(arguments, 1);
    var timestamp = new Date().toISOString();
    console.warn('[' + timestamp + '] [WARN] ' + message, args.length > 0 ? args : '');
  },

  /**
   * 输出错误级别日志
   * @param {string} message - 日志消息
   * @param {...any} args - 额外参数
   */
  error: function(message) {
    var args = Array.prototype.slice.call(arguments, 1);
    var timestamp = new Date().toISOString();
    console.error('[' + timestamp + '] [ERROR] ' + message, args.length > 0 ? args : '');
  },

  /**
   * 输出调试级别日志（仅在开发环境）
   * @param {string} message - 日志消息
   * @param {...any} args - 额外参数
   */
  debug: function(message) {
    if (process.env.NODE_ENV === 'development') {
      var args = Array.prototype.slice.call(arguments, 1);
      var timestamp = new Date().toISOString();
      console.log('[' + timestamp + '] [DEBUG] ' + message, args.length > 0 ? args : '');
    }
  }
};

module.exports = logger;
