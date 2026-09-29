/**
 * FeishuIndex Service Worker
 * 核心业务逻辑层，负责：
 * - Token按需获取
 * - 字段缓存管理
 * - URL查重算法
 * - 记录创建/更新
 * - 错误自愈机制
 */

// 导入依赖模块 - 按依赖顺序加载
try {
  // 1. 基础工具模块
  importScripts('../lib/cache-key-manager.js');
  importScripts('../lib/storage.js');
  importScripts('../lib/token-manager.js');

  // 2. 业务逻辑模块（依赖基础模块）
  importScripts('../lib/field-mapper.js');
  importScripts('../lib/feishu-api.js');

  // 3. 验证关键依赖模块完整性
  const dependencyCheck = validateDependencies();
  if (!dependencyCheck.success) {
    console.error('❌ 依赖验证失败:', dependencyCheck.errors);
    throw new Error(`关键依赖缺失: ${dependencyCheck.errors.join(', ')}`);
  }

  console.log('✅ FeishuIndex v1.0.2 - 依赖模块加载成功（正确的依赖顺序）');

  // 启动时执行一次性历史缓存清理
  migrateLegacyCache();
} catch (error) {
  console.error('❌ FeishuIndex v1.0.2 - 依赖模块加载失败:', error);
}

// 启动日志
console.log('🚀 FeishuIndex v1.0.2 Service Worker 启动完成', {
  timestamp: new Date().toISOString(),
  userAgent: navigator.userAgent
});

/**
 * 验证关键依赖模块的完整性
 * @returns {Object} - 验证结果
 */
function validateDependencies() {
  const requiredModules = [
    {
      name: 'CacheKeyManager',
      path: 'globalThis.CacheKeyManager',
      requiredMethods: ['CacheKeyManager']
    },
    {
      name: 'Storage',
      path: 'globalThis.Storage',
      requiredMethods: ['StorageManager', 'storage']
    },
    {
      name: 'TokenManager',
      path: 'globalThis.TokenManager',
      requiredMethods: ['TokenManager']
    },
    {
      name: 'FieldMapper',
      path: 'globalThis.FieldMapper',
      requiredMethods: ['classifyFields', 'validateRequiredFields']
    },
    {
      name: 'FeishuAPI',
      path: 'globalThis.FeishuAPI',
      requiredMethods: ['FeishuAPIClient']
    }
  ];

  const errors = [];
  const warnings = [];

  requiredModules.forEach(module => {
    try {
      // 检查模块是否存在于 globalThis
      const pathParts = module.path.split('.');
      let obj = globalThis;

      for (const part of pathParts) {
        if (!obj[part]) {
          errors.push(`${module.name} 模块未找到`);
          return;
        }
        obj = obj[part];
      }

      // 检查必需的方法是否存在
      module.requiredMethods.forEach(method => {
        if (!obj[method]) {
          errors.push(`${module.name}.${method} 方法未找到`);
        }
      });

      // 检查是否可以实例化关键类
      if (module.name === 'TokenManager') {
        try {
          new globalThis.TokenManager.TokenManager();
        } catch (e) {
          errors.push(`${module.name} 实例化失败: ${e.message}`);
        }
      }

      if (module.name === 'Storage') {
        try {
          new globalThis.Storage.StorageManager();
        } catch (e) {
          errors.push(`${module.name} 实例化失败: ${e.message}`);
        }
      }

    } catch (error) {
      errors.push(`${module.name} 检查失败: ${error.message}`);
    }
  });

  return {
    success: errors.length === 0,
    errors,
    warnings,
    timestamp: new Date().toISOString()
  };
}

/**
 * 一次性清理历史格式缓存
 * 清理所有旧格式的缓存键，确保系统统一性
 */
async function migrateLegacyCache() {
  try {
    const allKeys = await chrome.storage.local.get(null);
    const keysToRemove = [];

    for (const key in allKeys) {
      if (globalThis.CacheKeyManager.CacheKeyManager.isLegacyFormat(key)) {
        keysToRemove.push(key);
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`🗑️ 缓存迁移完成，清理了 ${keysToRemove.length} 个历史格式缓存:`, keysToRemove);
    } else {
      console.log('✅ 无需清理历史缓存，系统已是统一格式');
    }
  } catch (error) {
    console.error('❌ 历史缓存清理失败:', error);
  }
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

    // 3. 直接从配置中获取appToken和tableId（不再解析）
    const { app_token, table_id } = { app_token: config.appToken, table_id: config.tableId };

    // 4. 获取Token
    const tenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

    // 5. 获取字段信息（带Token重试机制）
    let fieldData;
    try {
      const actualTableId = `${app_token}_${table_id}`;
      fieldData = await getFieldsWithCache(app_token, table_id, actualTableId, tenantToken);
    } catch (error) {
      if (error.code === 'TOKEN_EXPIRED') {
        console.log('🔄 Token失效，重新获取并重试...');

        // 清除Token缓存
        await globalThis.TokenManager.TokenManager.clearTokenCache();

        // 重新获取Token
        const newTenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

        // 重试获取字段信息
        fieldData = await getFieldsWithCache(app_token, table_id, actualTableId, newTenantToken);
      } else {
        throw error;
      }
    }

    // 6. 验证字段数据
    if (!fieldData || !fieldData.classifiedFields || !fieldData.classifiedFields.allSupportedFields) {
      return sendResponse({
        success: false,
        error: '当前表不支持的字段类型'
      });
    }

    // 7. 构建更新数据
    const updateData = FieldMapper.buildUpdateData(
      {}, // 传入空对象作为现有记录，表示更新所有非空字段
      request.userInput,
      fieldData.classifiedFields
    );

    // 8. 执行更新
    const result = await feishuAPI.updateRecord(
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
  // 提前声明变量，确保在catch块中可以访问
  let app_token, table_id, config;

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

    config = configResult.config;

    // 3. 直接从配置中获取appToken和tableId（不再解析）
    ({ app_token, table_id } = { app_token: config.appToken, table_id: config.tableId });

    // 4. 获取Token
    const tenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

    // 5. 获取字段信息（带缓存检查和Token重试）
    const actualTableId = globalThis.CacheKeyManager.CacheKeyManager.buildTableId(app_token, table_id);
    let fieldData;
    try {
      fieldData = await getFieldsWithCache(app_token, table_id, actualTableId, tenantToken);
    } catch (error) {
      if (error.code === 'TOKEN_EXPIRED') {
        console.log('🔄 Token失效，重新获取并重试...');

        // 清除Token缓存
        await globalThis.TokenManager.TokenManager.clearTokenCache();

        // 重新获取Token
        const newTenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

        // 重试获取字段信息
        fieldData = await getFieldsWithCache(app_token, table_id, actualTableId, newTenantToken);
      } else {
        throw error;
      }
    }

    // 6. 验证必需字段
    const validation = FieldMapper.validateRequiredFields(fieldData.classifiedFields);
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
      const defaultLinkField = FieldMapper.getDefaultLinkField(fieldData.classifiedFields.linkFields);
      duplicateRecord = await feishuAPI.checkUrlDuplication(
        app_token,
        table_id,
        defaultLinkField.name,
        request.userInput.url,
        tenantToken
      );
    }

    // 8. 构建字段数据
    const fieldsData = FieldMapper.buildFieldsData(fieldData.classifiedFields, request.userInput);

    // 9. 创建或更新记录
    let result;
    if (duplicateRecord) {
      // 覆盖更新
      const updateData = FieldMapper.buildUpdateData(
        duplicateRecord.fields,
        request.userInput,
        fieldData.classifiedFields
      );

      result = await feishuAPI.updateRecord(
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
      result = await feishuAPI.createRecord(
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
    // 支持嵌套错误信息，如 "更新记录失败: FieldNameNotFound"
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
 * @param {string} tableId - 实际表格ID（用于API调用）
 * @param {string} cacheKey - 缓存键（用于存储）
 * @param {string} tenantToken - 访问令牌
 * @returns {Promise<Object>} - 字段数据和分类结果
 */
async function getFieldsWithCache(appToken, tableId, cacheKey, tenantToken) {
  console.log('🔍 getFieldsWithCache 输入参数:', {
    appToken: appToken?.substring(0, 10) + '...',
    tableId: tableId?.substring(0, 10) + '...',
    cacheKey: cacheKey?.substring(0, 50) + '...',
    tenantToken: tenantToken ? '有效令牌' : '无效令牌',
    timestamp: new Date().toISOString()
  });

  try {
    // 断点1: 缓存检查
    console.log('🔄 断点1: 开始缓存检查');
    const shouldRefresh = await Storage.storage.shouldRefreshFieldCache(cacheKey);
    console.log('🔄 缓存检查结果:', {
      shouldRefresh,
      timestamp: new Date().toISOString()
    });

    if (!shouldRefresh) {
      console.log('🔄 断点2: 尝试从缓存获取数据');
      const cachedData = await Storage.storage.getFieldCache(cacheKey);

      console.log('📦 缓存数据检查:', {
        exists: !!cachedData,
        hasFields: !!(cachedData?.fields),
        hasClassified: !!(cachedData?.classifiedFields || cachedData?.classified),
        fieldsCount: cachedData?.fields?.length || 0,
        classifiedKeys: cachedData ? Object.keys(cachedData.classifiedFields || cachedData.classified || {}) : [],
        timestamp: new Date().toISOString()
      });

      if (cachedData) {
        console.log('✅ 使用缓存数据成功:', {
          fieldsCount: cachedData.fields?.length || 0,
          hasLinkFields: !!(cachedData.classifiedFields?.linkFields || cachedData.classified?.linkFields),
          hasTextFields: !!(cachedData.classifiedFields?.textFields || cachedData.classified?.textFields)
        });

        const result = {
          fields: cachedData.fields,
          classifiedFields: cachedData.classified || cachedData.classifiedFields
        };
        console.log('📤 缓存返回结果结构:', {
          hasFields: !!result.fields,
          hasClassifiedFields: !!result.classifiedFields,
          classifiedFieldsKeys: Object.keys(result.classifiedFields || {})
        });
        return result;
      }
    }

    // 断点3: API调用前验证
    console.log('🚀 断点3: 准备调用API获取字段...', {
      appTokenValid: !!appToken,
      tableIdValid: !!tableId,
      tenantTokenValid: !!tenantToken,
      timestamp: new Date().toISOString()
    });

    // 断点4: API调用
    console.log('🔄 断点4: 开始API调用');
    const fields = await feishuAPI.getTableFields(appToken, tableId, tenantToken);

    console.log('🔍 API获取到的原始字段:', {
      isArray: Array.isArray(fields),
      length: fields?.length || 0,
      sampleField: fields?.[0] || '无数据',
      timestamp: new Date().toISOString()
    });

    // 断点5: 字段分类
    console.log('🔄 断点5: 开始字段分类');
    const classifiedFields = FieldMapper.classifyFields(fields);

    console.log('🏷️ 字段分类结果:', {
      hasLinkFields: !!(classifiedFields?.linkFields?.length),
      hasTextFields: !!(classifiedFields?.textFields?.length),
      hasSingleFields: !!(classifiedFields?.singleFields?.length),
      hasMultiFields: !!(classifiedFields?.multiFields?.length),
      totalSupported: (classifiedFields?.allSupportedFields?.length || 0),
      timestamp: new Date().toISOString()
    });

    // 断点6: 缓存保存
    console.log('💾 断点6: 开始保存缓存');
    await Storage.storage.saveFieldCache(cacheKey, fields, classifiedFields);
    console.log('✅ 缓存保存完成:', {
      cacheKey: cacheKey?.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    });

    const result = {
      fields: fields,
      classifiedFields: classifiedFields
    };

    console.log('🎯 getFieldsWithCache 最终返回:', {
      hasFields: !!result.fields,
      hasClassifiedFields: !!result.classifiedFields,
      fieldsCount: result.fields?.length || 0,
      classifiedFieldsStructure: Object.keys(result.classifiedFields || {}),
      timestamp: new Date().toISOString()
    });

    return result;

  } catch (error) {
    console.error('💥 getFieldsWithCache 失败:', {
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorCode: error.code,
      errorStack: error.stack?.split('\n')?.[0], // 只显示第一行堆栈
      errorPhase: '需要根据前面的断点日志确定失败阶段',
      timestamp: new Date().toISOString()
    });

    // Token失效处理 - 重新抛出，让上层处理重试
    if (error.code === 'TOKEN_EXPIRED') {
      console.log('🔄 检测到Token失效，抛出特殊错误供上层重试');
      throw error;
    }

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

  // 特殊处理嵌套错误信息
  if (errorMessage.includes('更新记录失败:') || errorMessage.includes('创建记录失败:')) {
    return '记录保存失败，请检查字段配置或稍后重试';
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
    const result = await feishuAPI.testConnection(
      config.appId,
      config.appSecret,
      config.appToken,
      config.tableId
    );

    if (result.success) {
      // 缓存字段信息
      const classifiedFields = FieldMapper.classifyFields(result.fields);
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
 * @param {string} appToken - 表格Token
 * @param {string} tableId - 表格ID
 * @returns {Promise<Object>} - 字段信息
 */
async function handleGetFields(appToken, tableId) {
  try {
    console.log('🔍 开始获取字段信息:', { appToken, tableId });

    // 直接使用工作版本的方式
    const config = await Storage.storage.getConfig();

    if (!config.appId || !config.appSecret || !appToken || !tableId) {
      return {
        success: false,
        error: '请先完成飞书应用配置'
      };
    }

    // 直接使用传入的appToken和tableId（不再解析）
    const { app_token, table_id } = { app_token: appToken, table_id: tableId };

    // 使用统一的缓存键管理器构建复合tableId
    const actualTableId = globalThis.CacheKeyManager.CacheKeyManager.buildTableId(app_token, table_id);
    console.log('🔧 background.js构建的tableId:', actualTableId);

    const tenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

    const fieldData = await getFieldsWithCache(app_token, table_id, actualTableId, tenantToken);

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
      handleGetFields(request.appToken, request.tableId).then(sendResponse);
      return true;

    case 'GET_CONFIG':
      Storage.storage.getConfig().then(config => {
        sendResponse({ success: true, config: config });
      }).catch(error => {
        console.error('GET_CONFIG 错误:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'SAVE_CONFIG':
      Storage.storage.saveConfig(request.config).then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'CLEAR_CACHE':
      // 直接从消息中获取appToken和tableId（不再解析）
      const { app_token, table_id } = { app_token: request.appToken, table_id: request.tableId };

      // 使用新的彻底清理方法，一次性清理所有可能的缓存格式
      Storage.storage.clearAllPossibleCaches(app_token, table_id)
        .then(() => {
          console.log('🗑️ 彻底清理缓存完成');
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error('🚨 彻底清理缓存失败:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'CLEAR_OPTIONS_CACHE':
      // 只清理选项缓存，保留字段列表缓存
      // 直接从消息中获取appToken和tableId（不再解析）
      const { app_token: options_app_token, table_id: options_table_id } = { app_token: request.appToken, table_id: request.tableId };
      const optionsTableId = globalThis.CacheKeyManager.CacheKeyManager.buildTableId(options_app_token, options_table_id);
      Storage.storage.clearOptionsCache(optionsTableId).then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;

    case 'PARSE_TABLE_URL':
      // 统一的URL解析服务，消除重复实现
      try {
        const result = feishuAPI.parseTableUrl(request.tableUrl);
        sendResponse({ success: true, result: result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;

    case 'GET_CACHE_KEYS':
      // 统一的缓存键生成服务，确保options.js和background.js使用相同的键
      try {
        const actualTableId = globalThis.CacheKeyManager.CacheKeyManager.buildTableId(request.app_token, request.table_id);
        const fieldCacheKey = globalThis.CacheKeyManager.CacheKeyManager.getFieldCacheKey(actualTableId);
        const optionsCacheKey = globalThis.CacheKeyManager.CacheKeyManager.getOptionsCacheKey(actualTableId);

        sendResponse({
          success: true,
          result: {
            actualTableId,
            fieldCacheKey,
            optionsCacheKey
          }
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;

    case 'REFRESH_FIELDS_CACHE':
      // 强制刷新字段缓存处理器
      (async () => {
        try {
          // 1. 获取配置
          const config = await Storage.storage.getConfig();
          if (!config.appId || !config.appSecret || !config.appToken || !config.tableId) {
            return sendResponse({
              success: false,
              error: '配置不完整，无法刷新字段缓存'
            });
          }

          // 2. 直接从配置中获取appToken和tableId（不再解析）
          const { app_token, table_id } = { app_token: config.appToken, table_id: config.tableId };
          const actualTableId = globalThis.CacheKeyManager.CacheKeyManager.buildTableId(app_token, table_id);

          // 3. 清除现有缓存
          await Storage.storage.clearFieldCache(actualTableId);

          // 4. 重新获取Token（使用新的TokenManager）
          const tenantToken = await feishuAPI.getTenantToken(config.appId, config.appSecret);

          // 5. 重新获取字段并缓存
          const fields = await feishuAPI.getTableFields(app_token, table_id, tenantToken);
          const classifiedFields = FieldMapper.classifyFields(fields);
          await Storage.storage.saveFieldCache(actualTableId, fields, classifiedFields);

          sendResponse({
            success: true,
            message: '字段缓存刷新成功',
            fieldsCount: fields.length,
            classifiedFields: classifiedFields
          });

        } catch (error) {
          console.error('REFRESH_FIELDS_CACHE 失败:', error);
          sendResponse({
            success: false,
            error: `刷新字段缓存失败: ${error.message}`
          });
        }
      })();
      return true; // 保持消息通道开放以支持异步操作

    case 'CLEAR_TOKEN_CACHE':
      // 清理Token缓存处理器
      (async () => {
        try {
          const tokenManager = new globalThis.TokenManager.TokenManager();
          await tokenManager.clearTokenCache();
          console.log('🗑️ Token缓存清理完成');
          sendResponse({
            success: true,
            message: 'Token缓存清理成功'
          });
        } catch (error) {
          console.error('清理Token缓存失败:', error);
          sendResponse({
            success: false,
            error: `清理Token缓存失败: ${error.message}`
          });
        }
      })();
      return true;

    case 'GET_TOKEN_STATUS':
      // 获取Token状态处理器
      (async () => {
        try {
          const tokenManager = new globalThis.TokenManager.TokenManager();
          const status = await tokenManager.getTokenStatus();
          sendResponse({
            success: true,
            status: status
          });
        } catch (error) {
          console.error('获取Token状态失败:', error);
          sendResponse({
            success: false,
            error: `获取Token状态失败: ${error.message}`
          });
        }
      })();
      return true;

    case 'FORCE_REFRESH_TOKEN':
      // 强制刷新Token处理器
      (async () => {
        try {
          const config = await Storage.storage.getConfig();
          if (!config.appId || !config.appSecret) {
            return sendResponse({
              success: false,
              error: '配置不完整，无法刷新Token'
            });
          }

          const tokenManager = new globalThis.TokenManager.TokenManager();
          const newToken = await tokenManager.forceRefreshToken(config.appId, config.appSecret);

          console.log('✅ Token强制刷新成功');
          sendResponse({
            success: true,
            message: 'Token刷新成功',
            tokenPrefix: newToken.substring(0, 20) + '...'
          });
        } catch (error) {
          console.error('强制刷新Token失败:', error);
          sendResponse({
            success: false,
            error: `强制刷新Token失败: ${error.message}`
          });
        }
      })();
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

console.log('FeishuIndex v1.0.2 background.js 已加载');