/**
 * 字段映射器 - 动态字段适配核心模块
 * 基于type值进行字段分类，不依赖固定字段名
 *
 * 支持的字段类型：
 * - 15: 链接类字段 (必需)
 * - 1: 文本类字段 (可选)
 * - 3: 单选字段 (可选)
 * - 4: 多选字段 (可选)
 */

// 字段类型映射表 - 基于飞书API的type值
const FIELD_TYPES = {
  15: 'link',    // 链接类字段 - 必需字段
  1: 'text',     // 文本类字段 - 可选
  3: 'single',   // 单选字段 - 可选
  4: 'multi'     // 多选字段 - 可选
};

/**
 * 动态字段分类函数
 * @param {Object} field - 字段对象，包含type、ui_type、name等属性
 * @returns {Object|null} - 返回分类结果或null（不支持的字段类型）
 */
function classifyField(field) {
  if (!field || typeof field.type !== 'number') {
    return null;
  }

  const fieldType = FIELD_TYPES[field.type];
  if (!fieldType) {
    // 不支持的字段类型，返回null
    return null;
  }

  return {
    name: field.field_name, // 修复：API返回的是field_name而不是name
    type: fieldType,
    originalType: field.type,
    uiType: field.ui_type,
    required: fieldType === 'link', // 链接字段是必需的
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
    unsupportedFields: [], // 不支持的字段列表
    allSupportedFields: []   // 所有支持的字段（按原始顺序）
  };

  fields.forEach(field => {
    const classified = classifyField(field);

    if (classified) {
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
      }
    } else {
      result.unsupportedFields.push(field);
    }
  });

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
    const value = userInput[field.name];
    if (Array.isArray(value) && value.length > 0) {
      // 过滤空值并去除首尾空格
      const cleanValues = value
        .filter(item => item && typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (cleanValues.length > 0) {
        fieldsData[field.name] = cleanValues;
      }
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
    const value = userInput[field.name];
    if (Array.isArray(value) && value.length > 0) {
      const cleanValues = value
        .filter(item => item && typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (cleanValues.length > 0) {
        updateData[field.name] = cleanValues;
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

// 在Service Worker环境中使用
if (typeof globalThis !== 'undefined' && !globalThis.FieldMapper) {
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