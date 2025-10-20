/**
 * 字段映射器 - 动态字段适配核心模块
 * 基于type值进行字段分类，不依赖固定字段名
 *
 * 支持的字段类型：
 * - 15: 链接类字段 (必需)
 * - 1: 文本类字段 (可选)
 * - 3: 单选字段 (可选)
 * - 4: 多选字段 (可选)
 * - 1001: 创建时间 (系统字段，跳过处理)
 * - 1002: 最后更新时间 (系统字段，跳过处理)
 */

// 字段类型映射表 - 基于飞书API的type值
const FIELD_TYPES = {
  15: 'link',    // 链接类字段 - 必需字段
  1: 'text',     // 文本类字段 - 可选
  2: 'number',   // 数字字段 - 可选（只读显示）
  3: 'single',   // 单选字段 - 可选
  4: 'multi',    // 多选字段 - 可选
  5: 'date',     // 日期字段 - 可选（只读显示）
  13: 'phone',   // 电话字段 - 可选（只读显示）
  17: 'person',  // 人员字段 - 可选（只读显示）
  18: 'attachment', // 附件字段 - 可选（只读显示）
  19: 'checkbox', // 复选框字段 - 可选（只读显示）
  23: 'file',     // 文件字段 - 可选（只读显示）
  1001: 'created_time', // 创建时间 - 跳过处理
  1002: 'modified_time', // 最后更新时间 - 跳过处理
  1003: 'email',   // 邮箱字段 - 可选（只读显示）
  1004: 'phone2',  // 电话字段2 - 可选（只读显示）
  1005: 'datetime', // 日期时间字段 - 可选（只读显示）
  1006: 'time',    // 时间字段 - 可选（只读显示）
  1007: 'progress', // 进度字段 - 可选（只读显示）
  1008: 'rating',   // 评分字段 - 可选（只读显示）
  1009: 'currency', // 货币字段 - 可选（只读显示）
  1010: 'percent',  // 百分号字段 - 可选（只读显示）
  1011: 'auto_number' // 自动编号字段 - 可选（只读显示）
};

/**
 * 动态字段分类函数
 * @param {Object} field - 字段对象，包含type、ui_type、name等属性
 * @returns {Object|null} - 返回分类结果或null（不支持的字段类型）
 */
function classifyField(field) {
  if (!field || typeof field.type !== 'number') {
    return { error: 'invalid_field' };
  }

  const fieldType = FIELD_TYPES[field.type];
  if (!fieldType) {
    // 不支持的字段类型，返回特殊标记
    return { error: 'unsupported_type', originalType: field.type };
  }

  // 系统时间字段标记为跳过处理
  const isSystemTimeField = fieldType === 'created_time' || fieldType === 'modified_time';

  return {
    name: field.field_name, // 修复：API返回的是field_name而不是name
    type: fieldType,
    originalType: field.type,
    uiType: field.ui_type,
    required: fieldType === 'link', // 链接字段是必需的
    skipProcessing: isSystemTimeField, // 标记是否跳过处理
    options: extractOptions(field)
  };
}

/**
 * 提取字段的选项列表（用于单选和多选字段）
 * @param {Object} field - 字段对象
 * @returns {Array} - 选项名称数组
 */
function extractOptions(field) {
  if ((field.type === 3 || field.type === 4) &&
      field.property &&
      field.property.options) {
    return field.property.options.map(option => option.name);
  }
  return [];
}

/**
 * 对字段列表进行分类和分组
 * @param {Array} fields - 从API获取的字段列表
 * @returns {Object} - 分类后的字段结构
 */
function classifyFields(fields) {
  const result = {
    linkFields: [],    // 链接类字段列表
    textFields: [],    // 文本类字段列表
    singleFields: [],  // 单选字段列表
    multiFields: [],   // 多选字段列表
    readOnlyFields: [], // 只读字段列表（数字、日期等）
    unsupportedFields: [], // 不支持的字段列表
    systemTimeFields: [], // 系统时间字段列表
    allSupportedFields: []   // 所有支持的字段（按原始顺序）
  };

  fields.forEach(field => {
    const classified = classifyField(field);

    // 处理错误情况
    if (classified && classified.error) {
      if (classified.error === 'invalid_field') {
        console.log(`无效字段: ${field.field_name} (type: ${field.type})`);
        // 不计入任何分类，静默跳过
        return;
      } else if (classified.error === 'unsupported_type') {
        console.log(`不支持字段: ${field.field_name} (type: ${field.type})`);
        result.unsupportedFields.push(field);
        return;
      }
    }

    // 正常字段处理
    if (classified && !classified.error) {
      // 系统时间字段单独处理，不计入支持字段
      if (classified.skipProcessing) {
        console.log(`系统时间字段: ${field.field_name} (type: ${field.type})`);
        result.systemTimeFields.push(classified);
        return; // 跳过后续处理
      }

      result.allSupportedFields.push(classified);

      switch (classified.type) {
        case 'link':
          result.linkFields.push(classified);
          break;
        case 'text':
          result.textFields.push(classified);
          break;
        case 'single':
          result.singleFields.push(classified);
          break;
        case 'multi':
          result.multiFields.push(classified);
          break;
        default:
          // 其他字段类型（数字、日期等）归类为只读字段
          result.readOnlyFields.push(classified);
          break;
      }
    }
  });

  console.log(`字段分类结果: 支持${result.allSupportedFields.length}个, 系统时间${result.systemTimeFields.length}个, 只读${result.readOnlyFields.length}个, 不支持${result.unsupportedFields.length}个`);

    // 详细调试信息：列出所有不支持的字段
    if (result.unsupportedFields.length > 0) {
      console.log('🔍 不支持的字段详情:');
      result.unsupportedFields.forEach((field, index) => {
        console.log(`  ${index + 1}. 字段名: ${field.field_name}, type: ${field.type}, ui_type: ${field.ui_type}`);
      });
    }

    return result;
}

/**
 * 验证必需字段是否存在
 * @param {Object} classifiedFields - 分类后的字段结构
 * @returns {Object} - 验证结果
 */
function validateRequiredFields(classifiedFields) {
  const issues = [];

  // 检查是否有链接类字段
  if (classifiedFields.linkFields.length === 0) {
    issues.push({
      type: 'missing_required',
      field_type: 'link',
      message: '请先在表中新建链接列'
    });
  }

  // 检查是否完全没有支持的字段
  if (classifiedFields.allSupportedFields.length === 0) {
    issues.push({
      type: 'no_supported_fields',
      message: '当前表不包含支持的字段类型'
    });
  }

  return {
    valid: issues.length === 0,
    issues: issues,
    hasRequiredFields: classifiedFields.linkFields.length > 0
  };
}

/**
 * 获取默认使用的链接字段（用于查重）
 * @param {Array} linkFields - 链接字段列表
 * @returns {Object|null} - 默认链接字段
 */
function getDefaultLinkField(linkFields) {
  return linkFields.length > 0 ? linkFields[0] : null;
}

/**
 * 创建超链接字段的数据格式
 * 遵循飞书API格式要求：link和text都是URL
 * @param {string} url - URL地址
 * @returns {Object} - 超链接字段数据
 */
function createHyperlinkField(url) {
  const trimmedUrl = url.trim();
  return {
    link: trimmedUrl,  // 实际URL地址
    text: trimmedUrl   // 显示文本，也是URL
  };
}

/**
 * 构建用于API调用的字段数据
 * @param {Object} classifiedFields - 分类后的字段结构
 * @param {Object} userInput - 用户输入的数据
 * @returns {Object} - 格式化后的字段数据
 */
function buildFieldsData(classifiedFields, userInput) {
  const fieldsData = {};

  // 处理链接字段（使用第一个链接字段）
  const defaultLinkField = getDefaultLinkField(classifiedFields.linkFields);
  if (defaultLinkField && userInput.url) {
    fieldsData[defaultLinkField.name] = createHyperlinkField(userInput.url);
  }

  // 处理文本字段
  classifiedFields.textFields.forEach(field => {
    const value = userInput[field.name];
    if (value && value.trim()) {
      fieldsData[field.name] = value.trim();
    }
  });

  // 处理单选字段
  classifiedFields.singleFields.forEach(field => {
    const value = userInput[field.name];
    if (value && typeof value === 'string' && value.trim()) {
      fieldsData[field.name] = value.trim();
    }
  });

  // 处理多选字段
  classifiedFields.multiFields.forEach(field => {
    const selectedValues = userInput[field.name] || [];
    const rawInputKey = `${field.name}_rawInput`;
    const rawInput = userInput[rawInputKey];

    let allValues = [...selectedValues]; // 开始时使用已选中的标签

    // 如果有原始输入，解析并合并
    if (rawInput && typeof rawInput === 'string' && rawInput.trim()) {
      const rawValues = rawInput
        .split(/[,，]/)  // 支持中英文逗号
        .map(item => item.trim())
        .filter(item => item.length > 0);

      // 合并已选标签和原始输入，去重
      allValues = [...new Set([...allValues, ...rawValues])];
    }

    // 过滤和清理最终值
    const cleanValues = allValues
      .filter(item => item && typeof item === 'string')
      .map(item => item.trim())
      .filter(item => item.length > 0);

    if (cleanValues.length > 0) {
      fieldsData[field.name] = cleanValues;
      console.log(`🏷️ 多选字段 ${field.name}: 已选[${selectedValues.join(', ')}] + 原始输入[${rawInput || ''}] = 最终[${cleanValues.join(', ')}]`);
    }
  });

  return fieldsData;
}

/**
 * 构建更新数据（只包含非空字段）
 * @param {Object} existingRecord - 现有记录数据
 * @param {Object} userInput - 用户输入的数据
 * @param {Object} classifiedFields - 分类后的字段结构
 * @returns {Object} - 更新数据
 */
function buildUpdateData(existingRecord, userInput, classifiedFields) {
  const updateData = {};

  // 处理链接字段
  const defaultLinkField = getDefaultLinkField(classifiedFields.linkFields);
  if (defaultLinkField && userInput.url) {
    updateData[defaultLinkField.name] = createHyperlinkField(userInput.url);
  }

  // 处理文本字段（非空更新）
  classifiedFields.textFields.forEach(field => {
    const value = userInput[field.name];
    if (value !== undefined && value !== null && value !== '') {
      updateData[field.name] = value.trim();
    }
  });

  // 处理单选字段（非空更新）
  classifiedFields.singleFields.forEach(field => {
    const value = userInput[field.name];
    if (value !== undefined && value !== null && value !== '') {
      updateData[field.name] = value.trim();
    }
  });

  // 处理多选字段（非空更新）
  classifiedFields.multiFields.forEach(field => {
    const selectedValues = userInput[field.name] || [];
    const rawInputKey = `${field.name}_rawInput`;
    const rawInput = userInput[rawInputKey];

    // 只有当有数据时才更新
    if (selectedValues.length > 0 || (rawInput && rawInput.trim())) {
      let allValues = [...selectedValues];

      // 如果有原始输入，解析并合并
      if (rawInput && typeof rawInput === 'string' && rawInput.trim()) {
        const rawValues = rawInput
          .split(/[,，]/)  // 支持中英文逗号
          .map(item => item.trim())
          .filter(item => item.length > 0);

        // 合并已选标签和原始输入，去重
        allValues = [...new Set([...allValues, ...rawValues])];
      }

      // 过滤和清理最终值
      const cleanValues = allValues
        .filter(item => item && typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (cleanValues.length > 0) {
        updateData[field.name] = cleanValues;
        console.log(`🔄 更新多选字段 ${field.name}: 已选[${selectedValues.join(', ')}] + 原始输入[${rawInput || ''}] = 最终[${cleanValues.join(', ')}]`);
      }
    }
  });

  return updateData;
}

// 导出核心函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FIELD_TYPES,
    classifyField,
    classifyFields,
    validateRequiredFields,
    getDefaultLinkField,
    createHyperlinkField,
    buildFieldsData,
    buildUpdateData
  };
}

// 在Chrome扩展环境中使用
if (typeof window !== 'undefined') {
  window.FieldMapper = {
    FIELD_TYPES,
    classifyField,
    classifyFields,
    validateRequiredFields,
    getDefaultLinkField,
    createHyperlinkField,
    buildFieldsData,
    buildUpdateData
  };
}

// 在Service Worker环境中使用 - 确保总是可用
if (typeof globalThis !== 'undefined') {
  globalThis.FieldMapper = {
    FIELD_TYPES,
    classifyField,
    classifyFields,
    validateRequiredFields,
    getDefaultLinkField,
    createHyperlinkField,
    buildFieldsData,
    buildUpdateData
  };
}