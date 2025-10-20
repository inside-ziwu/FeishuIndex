/**
 * FeishuIndex 消息总线
 * 解决Service Worker通信可靠性问题的核心组件
 */

/* -----------------------------------------------------------------------
 * 消息总线设计哲学 (Linus 好品味)
 * 1. 消息传递必须是可靠的，失败的传递应该有明确的错误信息
 * 2. 超时机制必须存在，防止无限等待
 * 3. 重试应该是智能的，不是盲目的
 * ----------------------------------------------------------------------- */

/**
 * 消息类型定义
 */
const MESSAGE_TYPES = Object.freeze({
  HEALTH_CHECK: 'HEALTH_CHECK',
  GET_CONFIG: 'GET_CONFIG',
  SAVE_CONFIG: 'SAVE_CONFIG',
  GET_FIELDS: 'GET_FIELDS',
  SAVE_RECORD: 'SAVE_RECORD',
  TEST_CONNECTION: 'TEST_CONNECTION',
  CLEAR_CACHE: 'CLEAR_CACHE',
  FIELDS_REFRESHED: 'FIELDS_REFRESHED'
});

/**
 * 消息优先级
 */
const PRIORITY = Object.freeze({
  HIGH: 1,    // 健康检查、错误恢复
  NORMAL: 2,  // 普通操作
  LOW: 3      // 后台任务
});

/**
 * 消息总线类
 */
class MessageBus {
  constructor(options = {}) {
    this.defaultTimeout = options.defaultTimeout || 10000; // 10秒默认超时
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.pendingRequests = new Map();
    this.requestQueue = [];
    this.isProcessing = false;
    this.logger = options.logger || null;

    // 消息监听器
    this.responseHandlers = new Map();
    this.setupMessageListener();
  }

  /**
   * 设置消息监听器
   */
  setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse);
        return true; // 保持消息通道开放
      });
    }
  }

  /**
   * 处理收到的消息
   */
  handleMessage(request, sender, sendResponse) {
    const messageId = request.id || this.generateMessageId();

    if (this.logger) {
      this.logger.debug('MESSAGE_RECEIVED', `收到消息: ${request.type}`, {
        messageId,
        type: request.type,
        hasId: !!request.id,
        sender: sender.id
      }, { category: 'message_bus' });
    }

    // 查找对应的响应处理器
    if (this.responseHandlers.has(messageId)) {
      const handler = this.responseHandlers.get(messageId);
      this.responseHandlers.delete(messageId);

      // 异步处理响应
      setTimeout(() => {
        handler(request, sender, sendResponse);
      }, 0);
    }
  }

  /**
   * 发送消息（带超时和重试）
   */
  async sendMessage(type, data = {}, options = {}) {
    const messageId = this.generateMessageId();
    const timeout = options.timeout || this.defaultTimeout;
    const retries = options.retries !== undefined ? options.retries : this.maxRetries;
    const priority = options.priority || PRIORITY.NORMAL;

    const message = {
      id: messageId,
      type,
      data,
      timestamp: Date.now(),
      priority
    };

    if (this.logger) {
      this.logger.debug('MESSAGE_SEND', `发送消息: ${type}`, {
        messageId,
        type,
        timeout,
        retries,
        priority,
        dataKeys: Object.keys(data)
      }, { category: 'message_bus' });
    }

    // 将请求加入队列
    const requestPromise = new Promise((resolve, reject) => {
      this.pendingRequests.set(messageId, {
        resolve,
        reject,
        message,
        attempts: 0,
        startTime: Date.now()
      });
    });

    // 处理队列
    this.processQueue();

    return requestPromise;
  }

  /**
   * 处理消息队列
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.pendingRequests.size > 0) {
        const [messageId, requestInfo] = this.pendingRequests.entries().next().value;

        try {
          await this.executeRequest(messageId, requestInfo);
        } catch (error) {
          // 错误已经在executeRequest中处理
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 执行单个请求
   */
  async executeRequest(messageId, requestInfo) {
    const { resolve, reject, message, attempts, startTime } = requestInfo;

    // 检查是否超时
    if (Date.now() - startTime > this.defaultTimeout) {
      this.pendingRequests.delete(messageId);
      reject(new Error(`消息超时: ${message.type}`));
      return;
    }

    try {
      // 注册响应处理器
      this.responseHandlers.set(message.id, (response, sender, sendResponse) => {
        this.handleResponse(messageId, response, resolve, reject);
      });

      // 发送消息
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        await chrome.runtime.sendMessage(message);
      } else {
        throw new Error('Chrome消息API不可用');
      }

    } catch (error) {
      requestInfo.attempts++;

      if (this.logger) {
        this.logger.warn('MESSAGE_SEND_FAILED', `消息发送失败，尝试重试: ${message.type}`, {
          messageId,
          type: message.type,
          attempt: requestInfo.attempts,
          error: error.message
        }, { category: 'message_bus' });
      }

      if (requestInfo.attempts >= this.maxRetries) {
        this.pendingRequests.delete(messageId);
        reject(new Error(`消息发送失败，已重试${this.maxRetries}次: ${error.message}`));
      } else {
        // 指数退避重试
        const delay = this.retryDelay * Math.pow(2, requestInfo.attempts - 1);
        setTimeout(() => {
          this.executeRequest(messageId, requestInfo);
        }, delay);
      }
    }
  }

  /**
   * 处理响应
   */
  handleResponse(messageId, response, resolve, reject) {
    if (this.pendingRequests.has(messageId)) {
      this.pendingRequests.delete(messageId);

      if (this.logger) {
        this.logger.debug('MESSAGE_RESPONSE', `收到响应: ${messageId}`, {
          messageId,
          success: response.success,
          hasError: !!response.error,
          responseTime: Date.now() - (response.timestamp || 0)
        }, { category: 'message_bus' });
      }

      if (response && response.success !== false) {
        resolve(response);
      } else {
        reject(new Error(response.error || '消息处理失败'));
      }
    }
  }

  /**
   * 注册消息处理器（用于Service Worker端）
   */
  registerHandler(type, handler) {
    if (!this.responseHandlers.has(type)) {
      this.responseHandlers.set(type, []);
    }
    this.responseHandlers.get(type).push(handler);
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const response = await this.sendMessage(MESSAGE_TYPES.HEALTH_CHECK, {}, {
        timeout: 5000,
        priority: PRIORITY.HIGH
      });
      return response.success;
    } catch (error) {
      return false;
    }
  }

  /**
   * 清理挂起的请求
   */
  clearPendingRequests() {
    const pendingCount = this.pendingRequests.size;

    if (pendingCount > 0) {
      if (this.logger) {
        this.logger.warn('CLEAR_PENDING_REQUESTS', `清理${pendingCount}个挂起请求`, {
          pendingCount
        }, { category: 'message_bus' });
      }

      for (const [messageId, requestInfo] of this.pendingRequests.entries()) {
        requestInfo.reject(new Error('请求被清理'));
      }

      this.pendingRequests.clear();
    }
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      pendingRequests: this.pendingRequests.size,
      isProcessing: this.isProcessing,
      responseHandlersCount: this.responseHandlers.size
    };
  }

  /**
   * 导出调试信息
   */
  exportDebugInfo() {
    return {
      stats: this.getStats(),
      pendingRequests: Array.from(this.pendingRequests.entries()).map(([id, info]) => ({
        id,
        type: info.message.type,
        attempts: info.attempts,
        waitingTime: Date.now() - info.startTime
      })),
      timestamp: Date.now()
    };
  }
}

/**
 * 消息总线单例
 */
let messageBusInstance = null;

function getMessageBus(options = {}) {
  if (!messageBusInstance) {
    messageBusInstance = new MessageBus(options);
  }
  return messageBusInstance;
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MessageBus, getMessageBus, MESSAGE_TYPES, PRIORITY };
} else {
  globalThis.FeishuIndexMessageBus = { MessageBus, getMessageBus, MESSAGE_TYPES, PRIORITY };
}