/**
 * FeishuIndex Service Worker
 * 核心业务逻辑层，负责：
 * - Token按需获取
 * - 字段缓存管理
 * - URL查重算法
 * - 记录创建/更新
 * - 错误自愈机制
 */

// 导入依赖模块
try {
  importScripts('../lib/field-mapper.js');
  importScripts('../lib/feishu-api.js');
  importScripts('../lib/storage.js');
  console.log('✅ 依赖模块加载成功');
} catch (error) {
  console.error('❌ 依赖模块加载失败:', error);
}

/**
 * 更新现有记录的专门函数
 * @param {Object} request - 更新请求
 * @param {Object} request.userInput - 用户输入数据
 * @param {string} request.recordId - 要更新的记录ID
 * @returns {Promise<Object>} - 更新结果
 */
async function updateExistingRecord(request, sendResponse) {
  try {
    console.log('🔄 开始更新现有记录:', request.recordId);

    // 1. 频率控制检查
    if (!(await Storage.storage.canSave())) {
      return sendResponse({
        success: false,
        error: '操作过于频繁，请稍后重试'
      });
    }

    // 2. 获取配置
    const configResult = await Storage.storage.validateConfig();
    if (!configResult.valid) {
      return sendResponse({
        success: false,
        error: '配置不完整，请先完成配置'
      });
    }

    const config = configResult.config;

    // 3. 解析表格URL
    const { app_token, table_id } = globalThis.FeishuAPI.feishuAPI.parseTableUrl(config.tableUrl);

    // 4. 获取Token
    const tenantToken = await globalThis.FeishuAPI.feishuAPI.getTenantToken(config.appId, config.appSecret);

    // 5. 获取字段信息
    const fieldData = await getFieldsWithCache(app_token, table_id, tenantToken);

    // 6. 验证字段数据
    if (!fieldData || !fieldData.classifiedFields || !fieldData.classifiedFields.allSupportedFields) {
      return sendResponse({
        success: false,
        error: '当前表不支持的字段类型'
      });
    }

    // 7. 构建更新数据
    const updateData = globalThis.FieldMapper.buildUpdateData(
      {}, // 传入空对象作为现有记录，表示更新所有非空字段
      request.userInput,
      fieldData.classifiedFields
    );

    // 8. 执行更新
    const result = await globalThis.FeishuAPI.feishuAPI.updateRecord(
      app_token,
      table_id,
      request.recordId,
      updateData,
      tenantToken
    );

    if (result.success) {
      return sendResponse({
        success: true,
        action: 'update',
        record: result.record,
        message: '记录更新成功'
      });
    } else {
      return sendResponse({
        success: false,
        error: result.error || '更新失败'
      });
    }

  } catch (error) {
    console.error('更新记录失败:', error);
    return sendResponse({
      success: false,
      error: `更新失败: ${error.message}`
    });
  }
}

/**
 * 保存URL记录的主要处理函数
 * @param {Object} request - 保存请求
 * @param {Object} request.userInput - 用户输入数据
 * @param {boolean} request.skipDuplicationCheck - 是否跳过查重
 * @returns {Promise<Object>} - 保存结果
 */
async function saveUrlRecord(request, sendResponse) {
  try {
    // 1. 频率控制检查
    if (!(await Storage.storage.canSave())) {
      return sendResponse({
        success: false,
        error: '操作过于频繁，请稍后重试'
      });
    }

    // 2. 获取配置
    const configResult = await Storage.storage.validateConfig();
    if (!configResult.valid) {
      return sendResponse({
        success: false,
        error: '配置不完整，请先完成配置'
      });
    }

    const config = configResult.config;

    // 3. 解析表格URL
    const { app_token, table_id } = globalThis.FeishuAPI.feishuAPI.parseTableUrl(config.tableUrl);

    // 4. 获取Token
    const tenantToken = await globalThis.FeishuAPI.feishuAPI.getTenantToken(config.appId, config.appSecret);

    // 5. 获取字段信息（带缓存检查）
    const fieldData = await getFieldsWithCache(app_token, table_id, tenantToken);

    // 6. 验证必需字段
    const validation = globalThis.FieldMapper.validateRequiredFields(fieldData.classifiedFields);
    if (!validation.valid) {
      const missingLinkIssue = validation.issues.find(issue => issue.type === 'missing_required');
      if (missingLinkIssue) {
        return sendResponse({
          success: false,
          error: missingLinkIssue.message,
          requiresLinkField: true
        });
      }

      return sendResponse({
        success: false,
        error: '当前表不支持的字段类型'
      });
    }

    // 7. URL查重（除非跳过）
    let duplicateRecord = null;
    if (!request.skipDuplicationCheck) {
      const defaultLinkField = globalThis.FieldMapper.getDefaultLinkField(fieldData.classifiedFields.linkFields);
      duplicateRecord = await globalThis.FeishuAPI.feishuAPI.checkUrlDuplication(
        app_token,
        table_id,
        defaultLinkField.name,
        request.userInput.url,
        tenantToken
      );
    }

    // 8. 构建字段数据
    const fieldsData = globalThis.FieldMapper.buildFieldsData(fieldData.classifiedFields, request.userInput);

    // 9. 创建或更新记录
    let result;
    if (duplicateRecord) {
      // 覆盖更新
      const updateData = globalThis.FieldMapper.buildUpdateData(
        duplicateRecord.fields,
        request.userInput,
        fieldData.classifiedFields
      );

      result = await globalThis.FeishuAPI.feishuAPI.updateRecord(
        app_token,
        table_id,
        duplicateRecord.record_id,
        updateData,
        tenantToken
      );

      result.action = 'update';
      result.duplicateRecord = duplicateRecord;
    } else {
      // 创建新记录
      result = await globalThis.FeishuAPI.feishuAPI.createRecord(
        app_token,
        table_id,
        fieldsData,
        tenantToken
      );

      result.action = 'create';
    }

    // 10. 记录保存时间
    await Storage.storage.recordLastSaveTime();

    sendResponse({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('保存记录失败:', error);

    // 检查是否需要触发错误自愈
    if (error.message.includes('FieldNameNotFound') ||
        error.message.includes('字段不存在') ||
        error.message.includes('field_name')) {

      // 触发错误自愈机制
      await triggerErrorRecovery(app_token, table_id);

      return sendResponse({
        success: false,
        error: '表结构已变更，已刷新字段信息，请重新填写',
        requiresFieldRefresh: true
      });
    }

    // 映射用户友好的错误信息
    const friendlyError = mapErrorToUserMessage(error.message);
    sendResponse({
      success: false,
      error: friendlyError,
      technicalError: error.message
    });
  }
}

/**
 * 获取字段信息（带缓存）
 * @param {string} appToken - 应用token
 * @param {string} tableId - 表格ID
 * @param {string} tenantToken - 访问令牌
 * @returns {Promise<Object>} - 字段数据和分类结果
 */
async function getFieldsWithCache(appToken, tableId, tenantToken) {
  try {
    // 检查是否需要刷新字段缓存
    const shouldRefresh = await storage.shouldRefreshFieldCache(tableId);

    if (!shouldRefresh) {
      // 尝试从缓存获取
      const cachedData = await storage.getFieldCache(tableId);
      if (cachedData) {
        console.log('📦 使用缓存数据');
        // 统一缓存数据结构，确保与API返回结构一致
        return {
          fields: cachedData.fields,
          classifiedFields: cachedData.classified || cachedData.classifiedFields
        };
      }
    }

    // 从API获取最新字段信息
    const fields = await feishuAPI.getTableFields(appToken, tableId, tenantToken);
    console.log('🔍 API获取到的原始字段:', fields);

    // 对字段进行分类
    const classifiedFields = FieldMapper.classifyFields(fields);
    console.log('🔍 分类后的字段:', classifiedFields);

    // 保存到缓存
    await storage.saveFieldCache(tableId, fields, classifiedFields);

    const result = {
      fields: fields,
      classifiedFields: classifiedFields
    };
    console.log('🔍 getFieldsWithCache返回:', result);
    return result;

  } catch (error) {
    console.error('获取字段信息失败:', error);
    throw error;
  }
}

/**
 * 错误自愈机制
 * @param {string} appToken - 应用token
 * @param {string} tableId - 表格ID
 * @returns {Promise<void>}
 */
async function triggerErrorRecovery(appToken, tableId) {
  try {
    console.log('触发错误自愈机制...');

    // 1. 清除字段缓存
    await Storage.storage.clearFieldCache(tableId);

    // 2. 清除选项缓存
    await Storage.storage.clearOptionsCache(tableId);

    console.log('错误自愈完成：已清除所有缓存');
  } catch (error) {
    console.error('错误自愈失败:', error);
  }
}

/**
 * 映射错误信息为用户友好提示
 * @param {string} errorMessage - 原始错误信息
 * @returns {string} - 用户友好的错误信息
 */
function mapErrorToUserMessage(errorMessage) {
  const errorMappings = {
    '应用权限不足': '应用权限不足，请检查飞书开放平台配置',
    '表格权限不足': '表格权限不足，请确认应用已添加到协作者',
    '链接字段类型必须是超链接': '链接字段类型必须是超链接，请检查字段配置',
    '字段类型不支持': '字段类型不支持，请检查字段配置',
    '请求过于频繁': '请求过于频繁，请稍后重试',
    '飞书服务异常': '飞书服务异常，请稍后重试',
    '网络连接异常': '网络连接异常，请检查网络',
    '字段不存在': '字段不存在，表结构可能已变更',
    'FieldNameNotFound': '字段不存在，表结构可能已变更'
  };

  for (const [key, message] of Object.entries(errorMappings)) {
    if (errorMessage.includes(key)) {
      return message;
    }
  }

  return '保存失败，请检查配置和网络连接';
}

/**
 * 连通性测试处理
 * @param {Object} config - 配置信息
 * @returns {Promise<Object>} - 测试结果
 */
async function handleConnectionTest(config) {
  try {
    const result = await globalThis.FeishuAPI.feishuAPI.testConnection(
      config.appId,
      config.appSecret,
      config.tableUrl
    );

    if (result.success) {
      // 缓存字段信息
      const classifiedFields = globalThis.FieldMapper.classifyFields(result.fields);
      await Storage.storage.saveFieldCache(
        result.appToken,
        result.tableId,
        result.fields,
        classifiedFields
      );

      return {
        success: true,
        message: result.message,
        fieldCount: result.fields.length,
        supportedFields: classifiedFields.allSupportedFields.length,
        unsupportedFields: classifiedFields.unsupportedFields.length
      };
    } else {
      return {
        success: false,
        message: result.message
      };
    }
  } catch (error) {
    console.error('连通性测试失败:', error);
    console.error('错误详情:', error.message);
    return {
      success: false,
      message: mapErrorToUserMessage(error.message),
      technicalError: error.message
    };
  }
}

/**
 * 获取字段信息处理
 * @param {string} tableUrl - 表格URL
 * @returns {Promise<Object>} - 字段信息
 */
async function handleGetFields(tableUrl) {
  try {
    const config = await Storage.storage.getConfig();

    if (!config.appId || !config.appSecret) {
      return {
        success: false,
        error: '请先完成飞书应用配置'
      };
    }

    const { app_token, table_id } = globalThis.FeishuAPI.feishuAPI.parseTableUrl(tableUrl);
    const tenantToken = await globalThis.FeishuAPI.feishuAPI.getTenantToken(config.appId, config.appSecret);

    const fieldData = await getFieldsWithCache(app_token, table_id, tenantToken);
    console.log('🔍 handleGetFields中fieldData:', fieldData);
    console.log('🔍 fieldData.classifiedFields类型:', typeof fieldData.classifiedFields);
    console.log('🔍 fieldData.classifiedFields内容:', fieldData.classifiedFields);

    return {
      success: true,
      fields: fieldData.classifiedFields
    };
  } catch (error) {
    return {
      success: false,
      error: mapErrorToUserMessage(error.message)
    };
  }
}

/**
 * 获取字段信息处理
 * @param {string} tableUrl - 表格URL
 * @returns {Promise<Object>} - 字段信息
 */
async function handleGetFields(tableUrl) {
  try {
    console.log('🔍 开始获取字段信息:', tableUrl);

    // 直接使用工作版本的方式
    const config = await storage.getConfig();

    if (!config.appId || !config.appSecret) {
      return {
        success: false,
        error: '请先完成飞书应用配置'
      };
    }

    const { app_token, table_id } = feishuAPI.parseTableUrl(tableUrl);
    const tenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

    const fieldData = await getFieldsWithCache(app_token, table_id, tenantToken);

    console.log('📊 获取到的fieldData:', fieldData);
    console.log('🔍 fieldData类型:', typeof fieldData);
    console.log('🔍 fieldData.classifiedFields:', fieldData.classifiedFields);
    console.log('🔍 classifiedFields类型:', typeof fieldData.classifiedFields);

    // 验证字段数据的完整性
    if (!fieldData || !fieldData.classifiedFields) {
      return {
        success: false,
        error: '字段数据异常，请刷新重试',
        technicalError: 'fieldData或classifiedFields为空'
      };
    }

    // 验证classifiedFields的结构
    const classifiedFields = fieldData.classifiedFields;
    const requiredProps = ['linkFields', 'textFields', 'singleFields', 'multiFields', 'allSupportedFields'];

    for (const prop of requiredProps) {
      if (!Array.isArray(classifiedFields[prop])) {
        console.log(`❌ 字段属性 ${prop} 不是数组:`, classifiedFields[prop]);
        return {
          success: false,
          error: '字段数据结构异常，请刷新重试',
          technicalError: `属性${prop}不是数组`
        };
      }
    }

    console.log('✅ 字段数据验证通过，返回数据');
    return {
      success: true,
      fields: classifiedFields
    };
  } catch (error) {
    console.error('handleGetFields错误:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 消息路由处理
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到消息:', request.type);

  switch (request.type) {
    case 'SAVE_RECORD':
      // 异步处理，保持消息通道开放
      saveUrlRecord(request, sendResponse);
      return true; // 保持消息通道开放

    case 'UPDATE_RECORD':
      // 🔥 新增：处理明确的更新操作
      updateExistingRecord(request, sendResponse);
      return true; // 保持消息通道开放

    case 'TEST_CONNECTION':
      handleConnectionTest(request.config).then(sendResponse);
      return true;

    case 'GET_FIELDS':
      handleGetFields(request.tableUrl).then(sendResponse);
      return true;

    case 'GET_CONFIG':
      storage.getConfig().then(config => {
        sendResponse({ success: true, config: config });
      });
      return true;

    case 'SAVE_CONFIG':
      storage.saveConfig(request.config).then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'CLEAR_CACHE':
      const { app_token, table_id } = feishuAPI.parseTableUrl(request.tableUrl);
      storage.clearAllCache(`${app_token}_${table_id}`).then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    default:
      sendResponse({ success: false, error: '未知的请求类型' });
  }
});

/**
 * Service Worker启动时的初始化
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('FeishuIndex Service Worker 已启动');
});

/**
 * 扩展安装时的处理
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('FeishuIndex 扩展已安装/更新:', details.reason);

  if (details.reason === 'install') {
    // 首次安装，可以打开配置页面
    chrome.runtime.openOptionsPage();
  }
});

console.log('FeishuIndex background.js 已加载');