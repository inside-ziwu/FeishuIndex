/**
 * Chrome扩展存储管理模块
 * 负责配置、缓存、状态等数据的持久化存储
 * 包含字段缓存、选项缓存、用户配置管理
 */

/**
 * 存储键名常量
 */
const STORAGE_KEYS = {
  // 用户配置
  APP_ID: 'feishu_app_id',
  APP_SECRET: 'feishu_app_secret',
  TABLE_URL: 'feishu_table_url',

  // 字段缓存
  FIELD_CACHE: 'feishu_field_cache',
  FIELD_CACHE_TIMESTAMP: 'feishu_field_cache_timestamp',

  // 选项缓存
  OPTIONS_CACHE: 'feishu_options_cache',
  OPTIONS_CACHE_DATE: 'feishu_options_cache_date',

  // 其他状态
  LAST_SAVE_TIME: 'feishu_last_save_time',
  CONFIG_VERSION: 'feishu_config_version'
};

/**
 * 存储管理类
 */
class StorageManager {
  /**
   * 保存用户配置
   * @param {Object} config - 配置对象
   * @param {string} config.appId - 应用ID
   * @param {string} config.appSecret - 应用密钥
   * @param {string} config.tableUrl - 表格URL
   * @returns {Promise<void>}
   */
  async saveConfig(config) {
    try {
      const data = {};

      if (config.appId) {
        data[STORAGE_KEYS.APP_ID] = config.appId;
      }
      if (config.appSecret) {
        data[STORAGE_KEYS.APP_SECRET] = config.appSecret;
      }
      if (config.tableUrl) {
        data[STORAGE_KEYS.TABLE_URL] = config.tableUrl;
      }

      data[STORAGE_KEYS.CONFIG_VERSION] = '1.0.0';

      await chrome.storage.local.set(data);
    } catch (error) {
      throw new Error(`保存配置失败: ${error.message}`);
    }
  }

  /**
   * 获取用户配置
   * @returns {Promise<Object>} - 配置对象
   */
  async getConfig() {
    try {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.APP_ID,
        STORAGE_KEYS.APP_SECRET,
        STORAGE_KEYS.TABLE_URL,
        STORAGE_KEYS.CONFIG_VERSION
      ]);

      return {
        appId: result[STORAGE_KEYS.APP_ID] || '',
        appSecret: result[STORAGE_KEYS.APP_SECRET] || '',
        tableUrl: result[STORAGE_KEYS.TABLE_URL] || '',
        version: result[STORAGE_KEYS.CONFIG_VERSION] || ''
      };
    } catch (error) {
      throw new Error(`获取配置失败: ${error.message}`);
    }
  }

  /**
   * 验证配置完整性
   * @returns {Promise<Object>} - 验证结果
   */
  async validateConfig() {
    try {
      const config = await this.getConfig();

      const hasAppId = config.appId && config.appId.trim() !== '';
      const hasAppSecret = config.appSecret && config.appSecret.trim() !== '';
      const hasTableUrl = config.tableUrl && config.tableUrl.trim() !== '';

      return {
        valid: hasAppId && hasAppSecret && hasTableUrl,
        missing: {
          appId: !hasAppId,
          appSecret: !hasAppSecret,
          tableUrl: !hasTableUrl
        },
        config: config
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * 保存字段缓存
   * @param {string} tableId - 表格ID
   * @param {Array} fields - 字段列表
   * @param {Object} classifiedFields - 分类后的字段结构
   * @returns {Promise<void>}
   */
  async saveFieldCache(tableId, fields, classifiedFields) {
    try {
      const cacheKey = `${STORAGE_KEYS.FIELD_CACHE}_${tableId}`;
      const timestampKey = `${STORAGE_KEYS.FIELD_CACHE_TIMESTAMP}_${tableId}`;

      await chrome.storage.local.set({
        [cacheKey]: {
          fields: fields,
          classified: classifiedFields,
          timestamp: Date.now()
        },
        [timestampKey]: Date.now()
      });
    } catch (error) {
      throw new Error(`保存字段缓存失败: ${error.message}`);
    }
  }

  /**
   * 获取字段缓存
   * @param {string} tableId - 表格ID
   * @returns {Promise<Object|null>} - 缓存数据或null
   */
  async getFieldCache(tableId) {
    try {
      const cacheKey = `${STORAGE_KEYS.FIELD_CACHE}_${tableId}`;
      const result = await chrome.storage.local.get(cacheKey);

      const cache = result[cacheKey];
      if (!cache) {
        return null;
      }

      return cache;
    } catch (error) {
      throw new Error(`获取字段缓存失败: ${error.message}`);
    }
  }

  /**
   * 清除字段缓存
   * @param {string} tableId - 表格ID
   * @returns {Promise<void>}
   */
  async clearFieldCache(tableId) {
    try {
      const cacheKey = `${STORAGE_KEYS.FIELD_CACHE}_${tableId}`;
      const timestampKey = `${STORAGE_KEYS.FIELD_CACHE_TIMESTAMP}_${tableId}`;

      await chrome.storage.local.remove([cacheKey, timestampKey]);
    } catch (error) {
      throw new Error(`清除字段缓存失败: ${error.message}`);
    }
  }

  /**
   * 检查字段缓存是否需要刷新
   * @param {string} tableId - 表格ID
   * @returns {Promise<boolean>} - 是否需要刷新
   */
  async shouldRefreshFieldCache(tableId) {
    try {
      const cache = await this.getFieldCache(tableId);

      if (!cache) {
        return true; // 没有缓存，需要刷新
      }

      // 字段缓存默认持久化，只有在显式清除或错误时才刷新
      return false;
    } catch (error) {
      return true; // 出错时强制刷新
    }
  }

  /**
   * 保存选项缓存（单选/多选字段的选项列表）
   * @param {string} tableId - 表格ID
   * @param {Object} optionsData - 选项数据
   * @returns {Promise<void>}
   */
  async saveOptionsCache(tableId, optionsData) {
    try {
      const cacheKey = `${STORAGE_KEYS.OPTIONS_CACHE}_${tableId}`;
      const dateKey = `${STORAGE_KEYS.OPTIONS_CACHE_DATE}_${tableId}`;

      const today = new Date().toDateString();

      await chrome.storage.local.set({
        [cacheKey]: optionsData,
        [dateKey]: today
      });
    } catch (error) {
      throw new Error(`保存选项缓存失败: ${error.message}`);
    }
  }

  /**
   * 获取选项缓存
   * @param {string} tableId - 表格ID
   * @returns {Promise<Object|null>} - 选项缓存或null
   */
  async getOptionsCache(tableId) {
    try {
      const cacheKey = `${STORAGE_KEYS.OPTIONS_CACHE}_${tableId}`;
      const dateKey = `${STORAGE_KEYS.OPTIONS_CACHE_DATE}_${tableId}`;

      const result = await chrome.storage.local.get([cacheKey, dateKey]);

      const cache = result[cacheKey];
      const cacheDate = result[dateKey];

      if (!cache || !cacheDate) {
        return null;
      }

      const today = new Date().toDateString();

      // 检查是否是今天的数据
      if (cacheDate !== today) {
        // 不是今天的数据，需要刷新
        await this.clearOptionsCache(tableId);
        return null;
      }

      return cache;
    } catch (error) {
      throw new Error(`获取选项缓存失败: ${error.message}`);
    }
  }

  /**
   * 清除选项缓存
   * @param {string} tableId - 表格ID
   * @returns {Promise<void>}
   */
  async clearOptionsCache(tableId) {
    try {
      const cacheKey = `${STORAGE_KEYS.OPTIONS_CACHE}_${tableId}`;
      const dateKey = `${STORAGE_KEYS.OPTIONS_CACHE_DATE}_${tableId}`;

      await chrome.storage.local.remove([cacheKey, dateKey]);
    } catch (error) {
      throw new Error(`清除选项缓存失败: ${error.message}`);
    }
  }

  /**
   * 记录最后保存时间（用于频率控制）
   * @returns {Promise<void>}
   */
  async recordLastSaveTime() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_SAVE_TIME]: Date.now()
      });
    } catch (error) {
      console.error('记录保存时间失败:', error);
    }
  }

  /**
   * 检查是否可以进行保存操作（1秒频率限制）
   * @returns {Promise<boolean>} - 是否可以保存
   */
  async canSave() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_SAVE_TIME);
      const lastSaveTime = result[STORAGE_KEYS.LAST_SAVE_TIME] || 0;
      const now = Date.now();

      return (now - lastSaveTime) >= 1000; // 1秒间隔
    } catch (error) {
      console.error('检查保存权限失败:', error);
      return true; // 出错时允许保存
    }
  }

  /**
   * 清除所有缓存
   * @param {string} tableId - 表格ID
   * @returns {Promise<void>}
   */
  async clearAllCache(tableId) {
    try {
      await this.clearFieldCache(tableId);
      await this.clearOptionsCache(tableId);
    } catch (error) {
      throw new Error(`清除缓存失败: ${error.message}`);
    }
  }

  /**
   * 获取存储使用情况
   * @returns {Promise<Object>} - 存储信息
   */
  async getStorageInfo() {
    try {
      const result = await chrome.storage.local.getBytesInUse();
      return {
        bytesUsed: result,
        bytesQuota: chrome.storage.local.QUOTA_BYTES
      };
    } catch (error) {
      throw new Error(`获取存储信息失败: ${error.message}`);
    }
  }
}

// 创建全局存储管理实例
const storage = new StorageManager();

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageManager, storage, STORAGE_KEYS };
}

// 在Chrome扩展环境中使用
if (typeof window !== 'undefined') {
  window.Storage = { StorageManager, storage, STORAGE_KEYS };
}

// 在Service Worker环境中使用
if (typeof globalThis !== 'undefined' && !globalThis.Storage) {
  globalThis.Storage = { StorageManager, storage, STORAGE_KEYS };
}