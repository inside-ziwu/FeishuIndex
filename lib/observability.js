/**
 * FeishuIndex 可观测性系统
 * 企业级监控、日志、性能追踪和错误分析系统
 *
 * 设计原则：
 * 1. 零侵入性 - 不影响业务逻辑性能
 * 2. 结构化数据 - 便于分析和查询
 * 3. 分层日志 - 支持不同环境的需求
 * 4. 调用链追踪 - 完整的请求生命周期跟踪
 * 5. 自适应监控 - 根据环境自动调整监控级别
 */

/*************************************************************************
 * 📊 核心日志记录器
 * 提供结构化日志记录，支持不同级别和多种输出方式
 *************************************************************************/

class ObservabilityLogger {
  constructor(config = {}) {
    this.config = {
      level: config.level || this.getLogLevel(),
      enableConsole: config.enableConsole !== false,
      enableStorage: config.enableStorage !== false,
      maxStorageSize: config.maxStorageSize || 1000, // 最多存储1000条日志
      enableTraceId: config.enableTraceId !== false,
      enablePerformance: config.enablePerformance !== false,
      ...config
    };

    this.logLevels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      FATAL: 4
    };

    this.sessionId = this.generateSessionId();
    this.traceMap = new Map(); // 调用链追踪
    this.performanceMetrics = new Map(); // 性能指标
    this.errorPatterns = new Map(); // 错误模式分析

    this.initStorage();
    this.initPerformanceObserver();
  }

  /**
   * 生成会话ID
   */
  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 获取日志级别
   */
  getLogLevel() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      // 生产环境
      return 'INFO';
    }
    // 开发环境
    return 'DEBUG';
  }

  /**
   * 初始化存储
   */
  async initStorage() {
    if (!this.config.enableStorage) return;

    try {
      // 清理过期日志
      await this.cleanupOldLogs();
    } catch (error) {
      console.warn('日志存储初始化失败:', error);
    }
  }

  /**
   * 初始化性能监控
   */
  initPerformanceObserver() {
    if (!this.config.enablePerformance) return;

    try {
      // 监控长任务
      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) { // 超过50ms的长任务
              this.warn('PERF_LONG_TASK', {
                name: entry.name,
                duration: entry.duration,
                startTime: entry.startTime,
                entryType: entry.entryType
              }, { category: 'performance' });
            }
          }
        });
        observer.observe({ entryTypes: ['longtask', 'measure', 'navigation'] });
      }
    } catch (error) {
      console.warn('性能监控初始化失败:', error);
    }
  }

  /**
   * 生成追踪ID
   */
  generateTraceId() {
    return 'trace_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * 开始追踪
   */
  startTrace(operationName, metadata = {}) {
    if (!this.config.enableTraceId) return null;

    const traceId = this.generateTraceId();
    const spanId = 'span_' + Math.random().toString(36).substr(2, 6);

    this.traceMap.set(traceId, {
      operationName,
      spanId,
      startTime: performance.now(),
      metadata,
      parentTraceId: metadata.parentTraceId || null
    });

    return traceId;
  }

  /**
   * 结束追踪
   */
  endTrace(traceId, result = {}, error = null) {
    if (!traceId || !this.config.enableTraceId) return;

    const trace = this.traceMap.get(traceId);
    if (!trace) return;

    const duration = performance.now() - trace.startTime;

    const traceData = {
      traceId,
      spanId: trace.spanId,
      operationName: trace.operationName,
      startTime: trace.startTime,
      duration,
      success: !error,
      result,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : null,
      metadata: trace.metadata
    };

    this.info('TRACE_COMPLETE', traceData, {
      category: 'trace',
      traceId,
      duration
    });

    this.traceMap.delete(traceId);

    // 记录性能指标
    this.recordPerformanceMetric(trace.operationName, duration, !error);
  }

  /**
   * 记录性能指标
   */
  recordPerformanceMetric(operation, duration, success) {
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, {
        count: 0,
        totalTime: 0,
        successCount: 0,
        errorCount: 0,
        maxTime: 0,
        minTime: Infinity,
        samples: []
      });
    }

    const metric = this.performanceMetrics.get(operation);
    metric.count++;
    metric.totalTime += duration;

    if (success) {
      metric.successCount++;
    } else {
      metric.errorCount++;
    }

    metric.maxTime = Math.max(metric.maxTime, duration);
    metric.minTime = Math.min(metric.minTime, duration);

    // 保留最近100个样本
    metric.samples.push({
      timestamp: Date.now(),
      duration,
      success
    });

    if (metric.samples.length > 100) {
      metric.samples.shift();
    }
  }

  /**
   * 核心日志记录方法
   */
  async writeLog(level, message, data = {}, context = {}) {
    const currentLevel = this.logLevels[this.config.level];
    const messageLevel = this.logLevels[level];

    if (messageLevel < currentLevel) return;

    const logEntry = {
      id: this.generateLogId(),
      timestamp: new Date().toISOString(),
      level,
      message,
      data: this.sanitizeData(data),
      context: {
        sessionId: this.sessionId,
        traceId: context.traceId || this.getCurrentTraceId(),
        category: context.category || 'general',
        userId: context.userId || 'anonymous',
        ...context
      },
      environment: this.getEnvironment(),
      browser: this.getBrowserInfo(),
      extension: {
        id: chrome?.runtime?.id,
        version: chrome?.runtime?.getManifest?.()?.version
      }
    };

    // 控制台输出
    if (this.config.enableConsole) {
      this.outputToConsole(level, message, logEntry);
    }

    // 存储到本地
    if (this.config.enableStorage) {
      await this.storeLog(logEntry);
    }

    // 错误模式分析
    if (level === 'ERROR' || level === 'FATAL') {
      this.analyzeErrorPattern(message, data, logEntry);
    }
  }

  /**
   * 生成日志ID
   */
  generateLogId() {
    return 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * 获取当前追踪ID
   */
  getCurrentTraceId() {
    // 简化实现，返回最新的追踪ID
    const traceIds = Array.from(this.traceMap.keys());
    return traceIds[traceIds.length - 1] || null;
  }

  /**
   * 清理敏感数据
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;

    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
    const sanitized = { ...data };

    const sanitizeValue = (value, key) => {
      if (typeof value === 'string' &&
          sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        return value.length > 10 ?
          value.substring(0, 3) + '***' + value.substring(value.length - 3) :
          '***';
      }
      return value;
    };

    for (const [key, value] of Object.entries(sanitized)) {
      sanitized[key] = sanitizeValue(value, key);
    }

    return sanitized;
  }

  /**
   * 控制台输出
   */
  outputToConsole(level, message, logEntry) {
    const style = this.getConsoleStyle(level);
    const prefix = `[${level}] [${logEntry.context.category}] ${message}`;

    switch (level) {
      case 'DEBUG':
        console.debug(`%c${prefix}`, style, logEntry);
        break;
      case 'INFO':
        console.info(`%c${prefix}`, style, logEntry);
        break;
      case 'WARN':
        console.warn(`%c${prefix}`, style, logEntry);
        break;
      case 'ERROR':
      case 'FATAL':
        console.error(`%c${prefix}`, style, logEntry);
        break;
    }
  }

  /**
   * 获取控制台样式
   */
  getConsoleStyle(level) {
    const styles = {
      DEBUG: 'color: #6B7280; font-weight: normal;',
      INFO: 'color: #059669; font-weight: normal;',
      WARN: 'color: #D97706; font-weight: bold;',
      ERROR: 'color: #DC2626; font-weight: bold;',
      FATAL: 'color: #991B1B; font-weight: bold; background: #FEE2E2; padding: 2px 4px; border-radius: 3px;'
    };
    return styles[level] || styles.INFO;
  }

  /**
   * 存储日志
   */
  async storeLog(logEntry) {
    try {
      const storageKey = 'feishuindex_logs';
      const result = await chrome.storage.local.get(storageKey);
      const logs = result[storageKey] || [];

      logs.push(logEntry);

      // 限制日志数量
      if (logs.length > this.config.maxStorageSize) {
        logs.splice(0, logs.length - this.config.maxStorageSize);
      }

      await chrome.storage.local.set({ [storageKey]: logs });
    } catch (error) {
      console.warn('日志存储失败:', error);
    }
  }

  /**
   * 分析错误模式
   */
  analyzeErrorPattern(message, data, logEntry) {
    const errorKey = this.extractErrorKey(message, data);

    if (!this.errorPatterns.has(errorKey)) {
      this.errorPatterns.set(errorKey, {
        message,
        count: 0,
        firstOccurrence: Date.now(),
        lastOccurrence: Date.now(),
        contexts: [],
        data: data
      });
    }

    const pattern = this.errorPatterns.get(errorKey);
    pattern.count++;
    pattern.lastOccurrence = Date.now();

    // 保留最近5个上下文
    pattern.contexts.push({
      timestamp: logEntry.timestamp,
      traceId: logEntry.context.traceId,
      sessionId: logEntry.context.sessionId,
      data: data
    });

    if (pattern.contexts.length > 5) {
      pattern.contexts.shift();
    }
  }

  /**
   * 提取错误键值
   */
  extractErrorKey(message, data) {
    // 简化实现，基于消息和数据生成键值
    const keyData = {
      message: message.replace(/\d+/g, 'N'), // 替换数字
      type: data.error?.name || 'unknown',
      location: data.location || 'unknown'
    };

    return JSON.stringify(keyData);
  }

  /**
   * 获取环境信息
   */
  getEnvironment() {
    return {
      development: !chrome?.runtime?.id,
      extension: chrome?.runtime?.id ? 'extension' : 'web',
      manifestVersion: chrome?.runtime?.getManifest?.()?.manifest_version || 3
    };
  }

  /**
   * 获取浏览器信息
   */
  getBrowserInfo() {
    if (typeof navigator === 'undefined') return {};

    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine
    };
  }

  /**
   * 清理过期日志
   */
  async cleanupOldLogs() {
    const storageKey = 'feishuindex_logs';
    const result = await chrome.storage.local.get(storageKey);
    const logs = result[storageKey] || [];

    // 保留最近的日志，删除超过1周的
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const filteredLogs = logs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return logTime > oneWeekAgo;
    });

    if (filteredLogs.length !== logs.length) {
      await chrome.storage.local.set({ [storageKey]: filteredLogs });
    }
  }

  /*************************************************************************
   * 📝 公共日志接口
   *************************************************************************/

  debug(message, data = {}, context = {}) {
    this.writeLog('DEBUG', message, data, context);
  }

  info(message, data = {}, context = {}) {
    this.writeLog('INFO', message, data, context);
  }

  warn(message, data = {}, context = {}) {
    this.writeLog('WARN', message, data, context);
  }

  error(message, data = {}, context = {}) {
    this.writeLog('ERROR', message, data, context);
  }

  fatal(message, data = {}, context = {}) {
    this.writeLog('FATAL', message, data, context);
  }

  /*************************************************************************
   * 📊 诊断和分析方法
   *************************************************************************/

  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    const stats = {};

    for (const [operation, metric] of this.performanceMetrics.entries()) {
      stats[operation] = {
        count: metric.count,
        averageTime: metric.totalTime / metric.count,
        successRate: metric.successCount / metric.count,
        maxTime: metric.maxTime,
        minTime: metric.minTime === Infinity ? 0 : metric.minTime,
        recentTrend: this.calculateTrend(metric.samples)
      };
    }

    return stats;
  }

  /**
   * 计算趋势
   */
  calculateTrend(samples) {
    if (samples.length < 10) return 'insufficient_data';

    const recent = samples.slice(-5);
    const older = samples.slice(-10, -5);

    const recentAvg = recent.reduce((sum, s) => sum + s.duration, 0) / recent.length;
    const olderAvg = older.reduce((sum, s) => sum + s.duration, 0) / older.length;

    const change = (recentAvg - olderAvg) / olderAvg;

    if (Math.abs(change) < 0.1) return 'stable';
    return change > 0 ? 'degrading' : 'improving';
  }

  /**
   * 获取错误模式
   */
  getErrorPatterns() {
    return Array.from(this.errorPatterns.entries()).map(([key, pattern]) => ({
      key,
      ...pattern,
      frequency: pattern.count / ((Date.now() - pattern.firstOccurrence) / (1000 * 60)) // 每分钟频率
    }));
  }

  /**
   * 导出诊断数据
   */
  async exportDiagnostics() {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      environment: this.getEnvironment(),
      browser: this.getBrowserInfo(),
      performance: this.getPerformanceStats(),
      errors: this.getErrorPatterns(),
      activeTraces: Array.from(this.traceMap.entries()).map(([id, trace]) => ({
        id,
        operationName: trace.operationName,
        duration: performance.now() - trace.startTime,
        metadata: trace.metadata
      })),
      storageUsage: await this.getStorageUsage()
    };

    return diagnostics;
  }

  /**
   * 获取存储使用情况
   */
  async getStorageUsage() {
    try {
      const result = await chrome.storage.local.get(null);
      const size = JSON.stringify(result).length;

      return {
        totalEntries: Object.keys(result).length,
        estimatedSizeBytes: size,
        estimatedSizeKB: Math.round(size / 1024),
        keys: Object.keys(result)
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * 清理所有数据
   */
  async clearAllData() {
    try {
      await chrome.storage.local.remove('feishuindex_logs');
      this.traceMap.clear();
      this.performanceMetrics.clear();
      this.errorPatterns.clear();
      this.info('DIAGNOSTICS_CLEARED', {}, { category: 'maintenance' });
    } catch (error) {
      this.error('DIAGNOSTICS_CLEAR_FAILED', { error: error.message }, { category: 'maintenance' });
    }
  }
}

/*************************************************************************
 * 🎯 单例模式 - 全局日志实例
 *************************************************************************/

// 创建全局实例
const globalLogger = new ObservabilityLogger({
  level: 'DEBUG', // 开发时使用DEBUG级别
  enableConsole: true,
  enableStorage: true,
  enableTraceId: true,
  enablePerformance: true
});

// 导出便捷接口
export const logger = {
  debug: (message, data, context) => globalLogger.debug(message, data, context),
  info: (message, data, context) => globalLogger.info(message, data, context),
  warn: (message, data, context) => globalLogger.warn(message, data, context),
  error: (message, data, context) => globalLogger.error(message, data, context),
  fatal: (message, data, context) => globalLogger.fatal(message, data, context),

  // 追踪方法
  startTrace: (operationName, metadata) => globalLogger.startTrace(operationName, metadata),
  endTrace: (traceId, result, error) => globalLogger.endTrace(traceId, result, error),

  // 诊断方法
  getPerformanceStats: () => globalLogger.getPerformanceStats(),
  getErrorPatterns: () => globalLogger.getErrorPatterns(),
  exportDiagnostics: () => globalLogger.exportDiagnostics(),
  clearAllData: () => globalLogger.clearAllData(),

  // 直接访问底层实例（用于高级功能）
  instance: globalLogger
};

// 在浏览器环境中暴露到全局（便于调试）
if (typeof window !== 'undefined') {
  window.FeishuIndexLogger = logger;
}

// 导出类（用于创建自定义实例）
export { ObservabilityLogger };