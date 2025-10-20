/**
 * FeishuIndex 错误追踪系统
 * 专门针对Chrome扩展的错误分析、调用链追踪和根因分析
 *
 * 功能特点：
 * 1. 错误自动捕获和分类
 * 2. 调用链完整追踪
 * 3. 错误模式识别和聚类
 * 4. 错误恢复建议
 * 5. 错误热力图分析
 */

import { logger } from './observability.js';
import { timeExecution } from './performance-monitor.js';

/*************************************************************************
 * 🔍 错误追踪核心类
 *************************************************************************/

class ErrorTracker {
  constructor(config = {}) {
    this.config = {
      enableAutoCapture: config.enableAutoCapture !== false,
      enableStackTrace: config.enableStackTrace !== false,
      maxErrorsPerSession: config.maxErrorsPerSession || 100,
      enableContextCapture: config.enableContextCapture !== false,
      enableRecoverySuggestion: config.enableRecoverySuggestion !== false,
      ...config
    };

    this.errors = [];
    this.errorPatterns = new Map();
    this.callStacks = new Map();
    this.recoveryStrategies = new Map();
    this.sessionId = this.generateSessionId();

    this.initializeErrorCapture();
    this.initializeRecoveryStrategies();
  }

  /**
   * 生成会话ID
   */
  generateSessionId() {
    return 'error_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 初始化错误捕获
   */
  initializeErrorCapture() {
    if (!this.config.enableAutoCapture) return;

    // 全局错误处理
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.captureError(event.error || new Error(event.message), {
          type: 'javascript',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          source: 'window.onerror'
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.captureError(event.reason, {
          type: 'promise_rejection',
          source: 'unhandledrejection'
        });
      });

      // Chrome扩展特定错误处理
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onSuspend?.addListener(() => {
          this.info('EXTENSION_SUSPENDING', '扩展即将挂起，保存错误数据');
        });

        // 监控扩展连接错误
        if (chrome.runtime.onConnect) {
          chrome.runtime.onConnect.addListener((port) => {
            port.onDisconnect.addListener(() => {
              if (chrome.runtime.lastError) {
                this.captureError(chrome.runtime.lastError, {
                  type: 'extension_connection',
                  portName: port.name,
                  source: 'chrome.runtime.onDisconnect'
                });
              }
            });
          });
        }
      }
    }
  }

  /**
   * 初始化恢复策略
   */
  initializeRecoveryStrategies() {
    // TypeError 恢复策略
    this.recoveryStrategies.set('TypeError', {
      patterns: [
        /Cannot read properties of undefined/,
        /Cannot read property.*of undefined/,
        /.*is not a function/,
        /.*is not defined/
      ],
      strategies: [
        {
          condition: /Cannot read properties of undefined.*reading 'length'/,
          suggestion: '数组或对象未正确初始化',
          recovery: '检查数据源是否正确返回，添加空值检查',
          codeExample: 'if (data && Array.isArray(data)) { /* 安全操作 */ }'
        },
        {
          condition: /Cannot read properties of undefined.*reading 'fields'/,
          suggestion: '字段数据结构异常',
          recovery: '验证API响应数据完整性，重新获取字段信息',
          codeExample: 'if (!response.fields) { await refreshFields(); }'
        }
      ]
    });

    // 网络错误恢复策略
    this.recoveryStrategies.set('NetworkError', {
      patterns: [
        /Network error/,
        /Failed to fetch/,
        /net::ERR_/
      ],
      strategies: [
        {
          condition: /ERR_INTERNET_DISCONNECTED/,
          suggestion: '网络连接断开',
          recovery: '检查网络连接，实现重试机制',
          codeExample: 'retryWithBackoff(operation, { maxRetries: 3 })'
        },
        {
          condition: /ERR_CONNECTION_TIMED_OUT/,
          suggestion: '请求超时',
          recovery: '增加超时时间，优化请求大小',
          codeExample: 'fetch(url, { timeout: 10000 })'
        }
      ]
    });

    // Service Worker 错误恢复策略
    this.recoveryStrategies.set('ServiceWorkerError', {
      patterns: [
        /Extension context invalidated/,
        /Message channel closed/,
        /Receiving end does not exist/
      ],
      strategies: [
        {
          condition: /Extension context invalidated/,
          suggestion: '扩展上下文失效',
          recovery: '重新加载扩展或刷新页面',
          codeExample: 'chrome.runtime.reload()'
        }
      ]
    });
  }

  /**
   * 捕获错误
   */
  captureError(error, context = {}) {
    try {
      const errorData = this.normalizeError(error, context);
      const errorId = this.generateErrorId(errorData);

      // 检查错误数量限制
      if (this.errors.length >= this.config.maxErrorsPerSession) {
        this.errors.shift(); // 移除最旧的错误
      }

      // 添加到错误列表
      this.errors.push({
        id: errorId,
        ...errorData,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId
      });

      // 分析错误模式
      this.analyzeErrorPattern(errorData);

      // 记录日志
      this.logError(errorData);

      // 生成恢复建议
      if (this.config.enableRecoverySuggestion) {
        this.generateRecoverySuggestion(errorData);
      }

      return errorId;
    } catch (e) {
      // 防止错误处理本身出错
      console.error('Error in error tracker:', e);
      return null;
    }
  }

  /**
   * 标准化错误对象
   */
  normalizeError(error, context) {
    let normalizedError = {
      name: 'UnknownError',
      message: 'Unknown error occurred',
      stack: null,
      type: context.type || 'javascript',
      source: context.source || 'unknown',
      severity: this.calculateSeverity(error, context)
    };

    if (error instanceof Error) {
      normalizedError = {
        ...normalizedError,
        name: error.name,
        message: error.message,
        stack: this.config.enableStackTrace ? error.stack : null
      };
    } else if (typeof error === 'string') {
      normalizedError = {
        ...normalizedError,
        name: 'StringError',
        message: error
      };
    } else if (typeof error === 'object' && error !== null) {
      normalizedError = {
        ...normalizedError,
        name: error.name || error.constructor?.name || 'ObjectError',
        message: error.message || JSON.stringify(error),
        details: this.extractErrorDetails(error)
      };
    }

    // 添加上下文信息
    if (this.config.enableContextCapture) {
      normalizedError.context = this.captureContext(context);
    }

    return normalizedError;
  }

  /**
   * 提取错误详情
   */
  extractErrorDetails(error) {
    const details = {};

    // Chrome扩展相关错误码
    if (error.code) {
      details.code = error.code;
    }

    // HTTP状态码
    if (error.status || error.statusCode) {
      details.httpStatus = error.status || error.statusCode;
    }

    // API响应错误
    if (error.response) {
      details.apiResponse = {
        status: error.response.status,
        statusText: error.response.statusText,
        url: error.response.config?.url || error.response.url
      };
    }

    // 飞书API特定错误
    if (error.error_code) {
      details.feishuErrorCode = error.error_code;
      details.feishuErrorType = error.error?.type || 'unknown';
    }

    return details;
  }

  /**
   * 捕获上下文信息
   */
  captureContext(context) {
    const capturedContext = { ...context };

    // 捕获用户代理信息
    if (typeof navigator !== 'undefined') {
      capturedContext.userAgent = navigator.userAgent;
      capturedContext.url = window.location?.href;
      capturedContext.timestamp = Date.now();
    }

    // 捕获扩展信息
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      capturedContext.extensionId = chrome.runtime.id;
      capturedContext.extensionVersion = chrome.runtime.getManifest()?.version;
    }

    // 捕获调用栈信息
    if (this.config.enableStackTrace && context.captureCallStack !== false) {
      capturedContext.callStack = this.captureCallStack();
    }

    // 捕获状态信息
    if (context.captureState) {
      capturedContext.state = this.captureState();
    }

    return capturedContext;
  }

  /**
   * 捕获调用栈
   */
  captureCallStack() {
    try {
      const stack = new Error().stack;
      return stack ? stack.split('\n').slice(2) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 捕获状态信息
   */
  captureState() {
    const state = {};

    // 存储使用情况
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        state.storageQuota = 'available'; // 简化实现
      }
    } catch (error) {
      state.storageQuota = 'error';
    }

    // 内存使用情况
    try {
      if (performance && performance.memory) {
        state.memory = {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize
        };
      }
    } catch (error) {
      state.memory = 'unavailable';
    }

    return state;
  }

  /**
   * 生成错误ID
   */
  generateErrorId(errorData) {
    const key = `${errorData.name}_${errorData.message}_${errorData.type}`;
    const hash = this.simpleHash(key);
    return `error_${hash}_${Date.now()}`;
  }

  /**
   * 简单哈希函数
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 计算错误严重程度
   */
  calculateSeverity(error, context) {
    // 致命错误
    if (error.name === 'TypeError' && error.message.includes('Cannot read properties')) {
      return 'critical';
    }

    // 网络错误
    if (error.name === 'NetworkError' || error.message.includes('fetch')) {
      return 'high';
    }

    // Service Worker错误
    if (context.type === 'extension_context_invalidated') {
      return 'critical';
    }

    // 用户操作错误
    if (context.type === 'user_input') {
      return 'low';
    }

    // 默认中等严重程度
    return 'medium';
  }

  /**
   * 分析错误模式
   */
  analyzeErrorPattern(errorData) {
    const patternKey = this.extractPatternKey(errorData);

    if (!this.errorPatterns.has(patternKey)) {
      this.errorPatterns.set(patternKey, {
        key: patternKey,
        name: errorData.name,
        messagePattern: errorData.message,
        firstOccurrence: Date.now(),
        lastOccurrence: Date.now(),
        count: 0,
        contexts: [],
        severity: errorData.severity
      });
    }

    const pattern = this.errorPatterns.get(patternKey);
    pattern.count++;
    pattern.lastOccurrence = Date.now();

    // 保留最近的上下文
    pattern.contexts.push({
      timestamp: Date.now(),
      context: errorData.context,
      source: errorData.source
    });

    if (pattern.contexts.length > 10) {
      pattern.contexts.shift();
    }

    // 更新严重程度
    if (this.compareSeverity(errorData.severity, pattern.severity) > 0) {
      pattern.severity = errorData.severity;
    }
  }

  /**
   * 提取模式键值
   */
  extractPatternKey(errorData) {
    // 标准化错误消息（移除动态部分）
    const normalizedMessage = errorData.message
      .replace(/\d+/g, 'N')           // 替换数字
      .replace(/['"][^'"]*['"]/g, "'X'") // 替换字符串
      .replace(/\b[0-9a-f]{8,}\b/gi, 'HASH'); // 替换哈希值

    return `${errorData.name}:${normalizedMessage}`;
  }

  /**
   * 比较严重程度
   */
  compareSeverity(severity1, severity2) {
    const levels = { low: 1, medium: 2, high: 3, critical: 4 };
    return levels[severity1] - levels[severity2];
  }

  /**
   * 记录错误日志
   */
  logError(errorData) {
    const logLevel = errorData.severity === 'critical' ? 'fatal' : 'error';

    logger[logLevel]('ERROR_CAPTURED', {
      errorId: errorData.id,
      name: errorData.name,
      message: errorData.message,
      type: errorData.type,
      source: errorData.source,
      severity: errorData.severity,
      details: errorData.details
    }, {
      category: 'error',
      errorId: errorData.id,
      severity: errorData.severity
    });
  }

  /**
   * 生成恢复建议
   */
  generateRecoverySuggestion(errorData) {
    const strategies = this.recoveryStrategies.get(errorData.name);
    if (!strategies) return;

    let suggestion = null;

    for (const strategy of strategies.strategies) {
      if (strategy.condition.test(errorData.message)) {
        suggestion = strategy;
        break;
      }
    }

    if (suggestion) {
      logger.warn('ERROR_RECOVERY_SUGGESTION', {
        errorId: errorData.id,
        errorName: errorData.name,
        suggestion: suggestion.suggestion,
        recovery: suggestion.recovery,
        codeExample: suggestion.codeExample
      }, {
        category: 'error_recovery',
        errorId: errorData.id
      });

      // 添加到错误数据
      errorData.recoverySuggestion = suggestion;
    }
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const total = this.errors.length;
    const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
    const byType = {};
    const recentErrors = this.errors.filter(error =>
      Date.now() - new Date(error.timestamp).getTime() < 3600000 // 最近1小时
    );

    this.errors.forEach(error => {
      bySeverity[error.severity]++;
      byType[error.type] = (byType[error.type] || 0) + 1;
    });

    return {
      total,
      bySeverity,
      byType,
      recentCount: recentErrors.length,
      patternCount: this.errorPatterns.size,
      sessionId: this.sessionId
    };
  }

  /**
   * 获取错误热力图
   */
  getErrorHeatmap() {
    const heatmap = {};

    // 按时间段统计错误
    const timeSlots = {};
    this.errors.forEach(error => {
      const hour = new Date(error.timestamp).getHours();
      timeSlots[hour] = (timeSlots[hour] || 0) + 1;
    });

    heatmap.byHour = timeSlots;

    // 按错误类型统计
    heatmap.byType = {};
    this.errors.forEach(error => {
      heatmap.byType[error.name] = (heatmap.byType[error.name] || 0) + 1;
    });

    // 按来源统计
    heatmap.bySource = {};
    this.errors.forEach(error => {
      heatmap.bySource[error.source] = (heatmap.bySource[error.source] || 0) + 1;
    });

    return heatmap;
  }

  /**
   * 获取错误模式
   */
  getErrorPatterns(limit = 20) {
    return Array.from(this.errorPatterns.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(pattern => ({
        ...pattern,
        frequency: pattern.count / ((Date.now() - pattern.firstOccurrence) / 60000), // 每分钟频率
        timeSpan: pattern.lastOccurrence - pattern.firstOccurrence
      }));
  }

  /**
   * 查找错误
   */
  findErrors(filters = {}) {
    let filtered = [...this.errors];

    if (filters.severity) {
      filtered = filtered.filter(error => error.severity === filters.severity);
    }

    if (filters.type) {
      filtered = filtered.filter(error => error.type === filters.type);
    }

    if (filters.source) {
      filtered = filtered.filter(error => error.source === filters.source);
    }

    if (filters.since) {
      const since = new Date(filters.since);
      filtered = filtered.filter(error => new Date(error.timestamp) >= since);
    }

    return filtered;
  }

  /**
   * 导出错误数据
   */
  exportErrors() {
    return {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      config: this.config,
      stats: this.getErrorStats(),
      patterns: this.getErrorPatterns(),
      heatmap: this.getErrorHeatmap(),
      errors: this.errors.map(error => ({
        ...error,
        // 移除可能包含敏感信息的上下文
        context: error.context ? {
          userAgent: error.context.userAgent,
          extensionVersion: error.context.extensionVersion,
          timestamp: error.context.timestamp
        } : null
      }))
    };
  }

  /**
   * 清理错误数据
   */
  cleanup() {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24小时前

    this.errors = this.errors.filter(error =>
      new Date(error.timestamp).getTime() > cutoffTime
    );

    // 清理错误模式
    for (const [key, pattern] of this.errorPatterns.entries()) {
      if (pattern.lastOccurrence < cutoffTime) {
        this.errorPatterns.delete(key);
      }
    }

    logger.info('ERROR_TRACKER_CLEANUP', {
      remainingErrors: this.errors.length,
      remainingPatterns: this.errorPatterns.size
    }, { category: 'maintenance' });
  }

  /**
   * 重置所有数据
   */
  reset() {
    this.errors = [];
    this.errorPatterns.clear();
    this.callStacks.clear();
    this.sessionId = this.generateSessionId();

    logger.info('ERROR_TRACKER_RESET', {
      newSessionId: this.sessionId
    }, { category: 'maintenance' });
  }
}

/*************************************************************************
 * 🎯 便捷函数和装饰器
 *************************************************************************/

/**
 * 错误边界装饰器
 */
function errorBoundary(errorType = 'UnknownError', context = {}) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const tracker = window.errorTracker || globalThis.errorTracker;
      if (!tracker) {
        return originalMethod.apply(this, args);
      }

      try {
        const result = await originalMethod.apply(this, args);
        return result;
      } catch (error) {
        tracker.captureError(error, {
          type: errorType,
          className: target.constructor.name,
          methodName: propertyKey,
          args: args.length,
          ...context
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 安全执行函数
 */
function safeExecute(fn, errorType = 'SafeExecuteError', context = {}) {
  const tracker = window.errorTracker || globalThis.errorTracker;

  try {
    const result = fn();

    if (result && typeof result.then === 'function') {
      return result.catch(error => {
        if (tracker) {
          tracker.captureError(error, { type: errorType, ...context });
        }
        throw error;
      });
    }

    return result;
  } catch (error) {
    if (tracker) {
      tracker.captureError(error, { type: errorType, ...context });
    }
    throw error;
  }
}

/*************************************************************************
 * 🎯 全局实例初始化
 *************************************************************************/

// 创建全局错误追踪实例
const globalErrorTracker = new ErrorTracker({
  enableAutoCapture: true,
  enableStackTrace: true,
  enableContextCapture: true,
  enableRecoverySuggestion: true,
  maxErrorsPerSession: 200
});

// 在浏览器环境中暴露到全局
if (typeof window !== 'undefined') {
  window.errorTracker = globalErrorTracker;
  window.errorBoundary = errorBoundary;
  window.safeExecute = safeExecute;
}

// 导出
export {
  ErrorTracker,
  errorBoundary,
  safeExecute,
  globalErrorTracker
};

export default globalErrorTracker;