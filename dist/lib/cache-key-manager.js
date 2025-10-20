/**
 * 缓存键管理器
 * 统一管理所有缓存键的生成，确保一致性
 * 解决历史遗留的多格式缓存键问题
 */

/**
 * 缓存键管理类
 */
class CacheKeyManager {
  /**
   * 构建表格唯一标识符
   * @param {string} appToken - 应用token
   * @param {string} tableId - 表格ID
   * @returns {string} - 复合表格ID
   */
  static buildTableId(appToken, tableId) {
    return `${appToken}_${tableId}`;
  }

  /**
   * 解析表格唯一标识符
   * @param {string} tableId - 复合表格ID
   * @returns {Object} - { appToken, tableId }
   */
  static parseTableId(tableId) {
    const [appToken, originalTableId] = tableId.split('_');
    return { appToken, tableId: originalTableId };
  }

  /**
   * 获取字段缓存键
   * @param {string} tableId - 复合表格ID
   * @returns {string} - 字段缓存键
   */
  static getFieldCacheKey(tableId) {
    return `feishu_field_cache_${tableId}`;
  }

  /**
   * 获取字段时间戳缓存键
   * @param {string} tableId - 复合表格ID
   * @returns {string} - 时间戳缓存键
   */
  static getFieldTimestampKey(tableId) {
    return `feishu_field_cache_timestamp_${tableId}`;
  }

  /**
   * 获取选项缓存键
   * @param {string} tableId - 复合表格ID
   * @returns {string} - 选项缓存键
   */
  static getOptionsCacheKey(tableId) {
    return `feishu_options_cache_${tableId}`;
  }

  /**
   * 获取选项日期缓存键
   * @param {string} tableId - 复合表格ID
   * @returns {string} - 选项日期缓存键
   */
  static getOptionsDateKey(tableId) {
    return `feishu_options_cache_date_${tableId}`;
  }

  /**
   * 获取表格的所有相关缓存键
   * @param {string} tableId - 复合表格ID
   * @returns {Array<string>} - 所有缓存键数组
   */
  static getAllTableCacheKeys(tableId) {
    return [
      this.getFieldCacheKey(tableId),
      this.getFieldTimestampKey(tableId),
      this.getOptionsCacheKey(tableId),
      this.getOptionsDateKey(tableId)
    ];
  }

  /**
   * 识别历史格式的缓存键
   * @param {string} key - 缓存键
   * @returns {boolean} - 是否为历史格式
   */
  static isLegacyFormat(key) {
    // 旧格式：仅app_token
    if (key.startsWith('feishu_field_cache_') && !key.includes('_tbl')) {
      return true;
    }

    // 旧格式：仅table_id
    if (key.startsWith('feishu_field_cache_') && key.includes('_tbl') && !key.match(/_[^_]+_tbl/)) {
      return true;
    }

    // 旧格式时间戳
    if (key.startsWith('feishu_field_cache_timestamp_') && !key.match(/_[^_]+_tbl/)) {
      return true;
    }

    // 旧格式选项缓存
    if (key.startsWith('feishu_options_cache_') && !key.match(/_[^_]+_tbl/)) {
      return true;
    }

    // 旧格式选项日期
    if (key.startsWith('feishu_options_cache_date_') && !key.match(/_[^_]+_tbl/)) {
      return true;
    }

    return false;
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CacheKeyManager };
}

// 在Chrome扩展环境中使用
if (typeof window !== 'undefined') {
  window.CacheKeyManager = { CacheKeyManager };
}

// 在Service Worker环境中使用 - 确保总是可用
if (typeof globalThis !== 'undefined') {
  globalThis.CacheKeyManager = { CacheKeyManager };
}