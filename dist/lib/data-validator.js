/**
 * 增强版数据验证模块
 * 解决popup.js:166 undefined length错误
 */

/**
 * 验证字段数据结构的完整性
 * @param {any} data - 待验证的数据
 * @returns {Object} - 验证结果
 */
function validateFieldsData(data) {
  // 基础空值检查
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      error: '字段数据为空或不是对象',
      data: null
    };
  }

  // 检查必需的属性
  const requiredProps = ['linkFields', 'textFields', 'singleFields', 'multiFields', 'allSupportedFields'];
  for (const prop of requiredProps) {
    if (!(prop in data)) {
      return {
        valid: false,
        error: `缺少必需属性: ${prop}`,
        data: null
      };
    }

    if (!Array.isArray(data[prop])) {
      return {
        valid: false,
        error: `属性 ${prop} 不是数组`,
        data: null
      };
    }
  }

  // 检查链接字段（必需字段）
  if (!Array.isArray(data.linkFields) || data.linkFields.length === 0) {
    return {
      valid: false,
      error: '没有找到链接字段，请先在表中新建链接列',
      data: null
    };
  }

  // 数据结构验证通过
  return {
    valid: true,
    error: null,
    data: data
  };
}

/**
 * 安全的字段数据获取
 * @param {Object} fieldsResponse - API响应
 * @returns {Object} - 安全的字段数据
 */
function safeGetFieldsData(fieldsResponse) {
  // 检查响应结构
  if (!fieldsResponse || !fieldsResponse.success) {
    throw new Error(fieldsResponse?.error || '获取字段失败');
  }

  // 验证字段数据
  const validation = validateFieldsData(fieldsResponse.fields);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return validation.data;
}

// 导出验证函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateFieldsData, safeGetFieldsData };
}