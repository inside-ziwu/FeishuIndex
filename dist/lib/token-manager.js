/**
 * 飞书Token管理器
 * 解决Service Worker环境下的Token持久化和原子性刷新问题
 *
 * 设计原则：
 * 1. 持久化存储 - 使用Chrome storage而非内存
 * 2. 原子性操作 - 防止并发Token请求
 * 3. 健壮性验证 - 多层验证确保Token有效性
 * 4. 自动恢复 - Token失效时自动重新获取
 */

/**
 * Token管理器类
 */
class TokenManager {
  constructor() {
    this.baseUrl = 'https://open.feishu.cn/open-apis';
    this.refreshingPromise = null; // 原子性刷新锁
    this.tokenKey = 'feishu_tenant_token'; // 持久化存储键
  }

  /**
   * 获取有效的tenant_access_token
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @returns {Promise<string>} - 有效的访问令牌
   */
  async getValidToken(appId, appSecret) {
    console.log('🔑 TokenManager: 开始获取有效Token', {
      appId: appId?.substring(0, 10) + '...',
      timestamp: new Date().toISOString()
    });

    try {
      // 1. 尝试从持久化存储获取有效Token
      const cachedToken = await this.getCachedToken();
      if (cachedToken && this.isTokenValid(cachedToken)) {
        console.log('✅ TokenManager: 使用缓存的有效Token', {
          tokenPrefix: cachedToken.token.substring(0, 20) + '...',
          expireTime: new Date(cachedToken.expireTime).toISOString(),
          remainingTime: Math.floor((cachedToken.expireTime - Date.now()) / 1000) + '秒'
        });
        return cachedToken.token;
      }

      // 2. Token无效或不存在，执行原子性刷新
      console.log('🔄 TokenManager: 需要刷新Token');
      return await this.atomicTokenRefresh(appId, appSecret);

    } catch (error) {
      console.error('💥 TokenManager: 获取Token失败', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        timestamp: new Date().toISOString()
      });

      // 清理可能损坏的Token缓存
      await this.clearTokenCache();
      throw new Error(`Token获取失败: ${error.message}`);
    }
  }

  /**
   * 从持久化存储获取缓存的Token
   * @returns {Promise<Object|null>} - Token对象或null
   */
  async getCachedToken() {
    try {
      const result = await chrome.storage.local.get(this.tokenKey);
      const tokenData = result[this.tokenKey];

      console.log('📦 TokenManager: 缓存Token检查', {
        hasToken: !!tokenData,
        hasTokenString: !!(tokenData?.token),
        hasExpireTime: !!(tokenData?.expireTime),
        expireTime: tokenData?.expireTime ? new Date(tokenData.expireTime).toISOString() : '无',
        timestamp: new Date().toISOString()
      });

      return tokenData || null;
    } catch (error) {
      console.error('❌ TokenManager: 读取缓存失败', error);
      return null;
    }
  }

  /**
   * 验证Token是否有效
   * @param {Object} tokenData - Token数据对象
   * @returns {boolean} - 是否有效
   */
  isTokenValid(tokenData) {
    if (!tokenData || !tokenData.token || !tokenData.expireTime) {
      console.log('❌ TokenManager: Token数据不完整');
      return false;
    }

    // 检查Token格式 - 简化验证，只检查基本长度
    if (tokenData.token.length < 10) {
      console.log('❌ TokenManager: Token长度异常');
      return false;
    }

    const now = Date.now();
    const expireTime = tokenData.expireTime;
    const remainingTime = expireTime - now;

    // 提前5分钟刷新以确保安全边际
    const safetyMargin = 5 * 60 * 1000; // 5分钟
    const isValid = remainingTime > safetyMargin;

    console.log('🔍 TokenManager: Token有效性验证', {
      tokenPrefix: tokenData.token.substring(0, 20) + '...',
      expireTime: new Date(expireTime).toISOString(),
      currentTime: new Date(now).toISOString(),
      remainingTime: Math.floor(remainingTime / 1000) + '秒',
      safetyMargin: Math.floor(safetyMargin / 1000) + '秒',
      isValid: isValid
    });

    return isValid;
  }

  /**
   * 原子性Token刷新
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @returns {Promise<string>} - 新的访问令牌
   */
  async atomicTokenRefresh(appId, appSecret) {
    // 如果已有刷新请求在进行，等待其完成
    if (this.refreshingPromise) {
      console.log('⏳ TokenManager: 等待进行中的Token刷新');
      return this.refreshingPromise;
    }

    // 创建新的刷新Promise
    this.refreshingPromise = this.performTokenRefresh(appId, appSecret);

    try {
      const newToken = await this.refreshingPromise;
      console.log('✅ TokenManager: Token刷新成功');
      return newToken;
    } finally {
      // 无论成功失败，都要清除刷新锁
      this.refreshingPromise = null;
    }
  }

  /**
   * 执行Token刷新的实际操作
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @returns {Promise<string>} - 新的访问令牌
   */
  async performTokenRefresh(appId, appSecret) {
    console.log('🚀 TokenManager: 开始Token刷新请求');

    try {
      const tokenUrl = `${this.baseUrl}/auth/v3/tenant_access_token/internal`;

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret
        })
      });

      console.log('📡 TokenManager: Token响应状态', {
        status: response.status,
        statusText: response.statusText
      });

      const data = await response.json();

      console.log('📨 TokenManager: Token响应数据', {
        code: data.code,
        msg: data.msg,
        hasToken: !!data.tenant_access_token,
        expire: data.expire,
        success: data.code === 0
      });

      if (data.code !== 0) {
        throw new Error(`Token获取失败: ${data.msg} (code: ${data.code})`);
      }

      if (!data.tenant_access_token) {
        throw new Error('Token获取失败: 响应中没有token');
      }

      // 计算过期时间（服务器返回的秒数转换为毫秒时间戳）
      const now = Date.now();
      const expireTime = now + (data.expire - 300) * 1000; // 提前5分钟过期

      const tokenData = {
        token: data.tenant_access_token,
        expireTime: expireTime,
        createdAt: now,
        serverExpireSeconds: data.expire
      };

      // 持久化存储新Token
      await this.saveToken(tokenData);

      console.log('💾 TokenManager: Token保存成功', {
        tokenPrefix: data.tenant_access_token.substring(0, 20) + '...',
        expireTime: new Date(expireTime).toISOString(),
        lifetime: Math.floor((expireTime - now) / 1000) + '秒'
      });

      return data.tenant_access_token;

    } catch (error) {
      console.error('💥 TokenManager: Token刷新失败', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
      throw error;
    }
  }

  /**
   * 保存Token到持久化存储
   * @param {Object} tokenData - Token数据
   */
  async saveToken(tokenData) {
    try {
      await chrome.storage.local.set({
        [this.tokenKey]: tokenData
      });
      console.log('💾 TokenManager: Token持久化保存完成');
    } catch (error) {
      console.error('❌ TokenManager: Token保存失败', error);
      throw new Error(`Token保存失败: ${error.message}`);
    }
  }

  /**
   * 清除Token缓存
   */
  async clearTokenCache() {
    try {
      await chrome.storage.local.remove(this.tokenKey);
      console.log('🗑️ TokenManager: Token缓存已清除');
    } catch (error) {
      console.error('❌ TokenManager: 清除缓存失败', error);
    }
  }

  /**
   * 强制刷新Token（忽略缓存）
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @returns {Promise<string>} - 新的访问令牌
   */
  async forceRefreshToken(appId, appSecret) {
    console.log('🔄 TokenManager: 强制刷新Token');
    await this.clearTokenCache();
    return await this.atomicTokenRefresh(appId, appSecret);
  }

  /**
   * 获取Token状态信息（用于调试）
   * @returns {Promise<Object>} - Token状态信息
   */
  async getTokenStatus() {
    try {
      const tokenData = await this.getCachedToken();

      if (!tokenData) {
        return {
          hasToken: false,
          isValid: false,
          message: '无Token缓存'
        };
      }

      const isValid = this.isTokenValid(tokenData);
      const remainingTime = Math.max(0, tokenData.expireTime - Date.now());

      return {
        hasToken: true,
        isValid: isValid,
        tokenPrefix: tokenData.token.substring(0, 20) + '...',
        expireTime: new Date(tokenData.expireTime).toISOString(),
        remainingTime: Math.floor(remainingTime / 1000) + '秒',
        createdAt: new Date(tokenData.createdAt).toISOString(),
        age: Math.floor((Date.now() - tokenData.createdAt) / 1000) + '秒'
      };
    } catch (error) {
      return {
        hasToken: false,
        isValid: false,
        error: error.message
      };
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TokenManager };
}

// 在Chrome扩展环境中使用
if (typeof window !== 'undefined') {
  window.TokenManager = { TokenManager };
}

// 在Service Worker环境中使用 - 确保总是可用
if (typeof globalThis !== 'undefined') {
  globalThis.TokenManager = { TokenManager };
}

console.log('🔧 TokenManager 模块已加载');