/**
 * 参数验证中间件框架
 * 用于验证和清洗请求参数
 */

const logger = require('../lib/logger');

/**
 * 创建参数验证规则
 * @param {object} rules - 验证规则对象
 * @returns {function} Express 中间件函数
 *
 * 规则示例：
 * {
 *   bvid: {
 *     required: true,
 *     type: 'string',
 *     pattern: /^BV[A-Za-z0-9]+$/,
 *     minLength: 10,
 *     maxLength: 15
 *   },
 *   page: {
 *     required: false,
 *     type: 'integer',
 *     min: 1,
 *     max: 50,
 *     default: 1
 *   }
 * }
 */
function validateParams(rules) {
  return function(req, res, next) {
    var errors = [];
    var validatedParams = {};

    // 根据请求方法选择参数来源
    var params = req.method === 'GET' ? req.query : req.body;

    // 验证每个字段
    var fieldNames = Object.keys(rules || {});

    fieldNames.forEach(function(fieldName) {
      var rule = rules[fieldName];
      var value = params[fieldName];

      // 必填验证
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: fieldName,
          message: (rule.message || fieldName) + ' 是必填项'
        });
        return;
      }

      // 如果非必填且值为空，使用默认值或跳过
      if (!rule.required && (value === undefined || value === null || value === '')) {
        if (rule.default !== undefined) {
          validatedParams[fieldName] = rule.default;
        }
        return;
      }

      // 类型验证
      if (rule.type) {
        var typeError = validateType(value, rule.type, fieldName);
        if (typeError) {
          errors.push(typeError);
          return;
        }
      }

      // 字符串长度验证
      if (rule.type === 'string' && typeof value === 'string') {
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          errors.push({
            field: fieldName,
            message: fieldName + ' 长度不能小于 ' + rule.minLength
          });
          return;
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          errors.push({
            field: fieldName,
            message: fieldName + ' 长度不能大于 ' + rule.maxLength
          });
          return;
        }
      }

      // 数值范围验证
      if ((rule.type === 'integer' || rule.type === 'number') && typeof value === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push({
            field: fieldName,
            message: fieldName + ' 不能小于 ' + rule.min
          });
          return;
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push({
            field: fieldName,
            message: fieldName + ' 不能大于 ' + rule.max
          });
          return;
        }
      }

      // 正则表达式验证
      if (rule.pattern && typeof value === 'string') {
        if (!rule.pattern.test(value)) {
          errors.push({
            field: fieldName,
            message: rule.message || fieldName + ' 格式不正确'
          });
          return;
        }
      }

      // 自定义验证函数
      if (typeof rule.custom === 'function') {
        var customResult = rule.custom(value, params);
        if (customResult !== true) {
          errors.push({
            field: fieldName,
            message: customResult || (fieldName + ' 验证失败')
          });
          return;
        }
      }

      // 通过所有验证，保存到已验证参数中
      validatedParams[fieldName] = value;
    });

    // 如果有错误，返回错误信息
    if (errors.length > 0) {
      logger.warn('参数验证失败:', errors);

      return res.status(400).json({
        code: -1,
        message: '参数验证失败',
        errors: errors
      });
    }

    // 将验证后的参数附加到请求对象上
    req.validatedParams = validatedParams;

    next();
  };
}

/**
 * 验证参数类型
 * @param {any} value - 参数值
 * @param {string} type - 期望类型
 * @param {string} fieldName - 字段名
 * @returns {object|null} 错误对象或 null
 */
function validateType(value, type, fieldName) {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        return { field: fieldName, message: fieldName + ' 必须是字符串类型' };
      }
      break;

    case 'integer':
      if (!Number.isInteger(Number(value))) {
        return { field: fieldName, message: fieldName + ' 必须是整数' };
      }
      // 转换为数字类型
      value = Number(value);
      break;

    case 'number':
      if (isNaN(Number(value))) {
        return { field: fieldName, message: fieldName + ' 必须是数字' };
      }
      value = Number(value);
      break;

    case 'boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        return { field: fieldName, message: fieldName + ' 必须是布尔值' };
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return { field: fieldName, message: fieldName + ' 必须是数组' };
      }
      break;

    default:
      logger.warn('未知的验证类型: ' + type);
  }

  return null;
}

/**
 * 常用验证规则预设
 */
const validators = {
  // BVID 格式验证
  bvid: {
    required: true,
    type: 'string',
    pattern: /^BV[A-Za-z0-9]{10,15}$/,
    message: 'BVID 格式不正确'
  },

  // 分页参数
  pagination: {
    page: {
      required: false,
      type: 'integer',
      min: 1,
      max: 50,
      default: 1
    },
    pageSize: {
      required: false,
      type: 'integer',
      min: 1,
      max: 100,
      default: 20
    }
  },

  // 搜索关键词
  keyword: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 100,
    message: '搜索关键词长度应在 1-100 个字符之间'
  }
};

module.exports = validateParams;
module.exports.validators = validators;
