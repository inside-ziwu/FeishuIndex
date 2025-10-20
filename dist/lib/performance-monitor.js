/**
 * FeishuIndex 性能监控系统
 * 专门用于Chrome扩展的性能监控和指标收集
 *
 * 功能特点：
 * 1. Service Worker性能监控
 * 2. 消息传递延迟追踪
 * 3. 模块加载时间分析
 * 4. 内存使用情况监控
 * 5. API调用性能统计
 * 6. 用户交互响应时间
 */

import { logger } from './observability.js';

/*************************************************************************
 * 🎯 性能监控核心类
 *************************************************************************/

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.timers = new Map();
    this.observers = new Set();
    this.thresholds = new Map();

    this.initializeDefaultThresholds();
    this.initializeObservers();
    this.startPeriodicReporting();
  }

  /**
   * 初始化默认阈值
   */
  initializeDefaultThresholds() {
    // Service Worker相关阈值
    this.thresholds.set('sw_message_response', 1000); // 1秒
    this.thresholds.set('sw_module_loading', 500);    // 500ms
    this.thresholds.set('sw_api_call', 5000);         // 5秒

    // 用户交互阈值
    this.thresholds.set('ui_response', 100);          // 100ms
    this.thresholds.set('form_validation', 50);       // 50ms
    this.thresholds.set('field_rendering', 200);      // 200ms

    // 数据操作阈值
    this.thresholds.set('cache_operation', 100);      // 100ms
    this.thresholds.set('data_validation', 50);       // 50ms
    this.thresholds.set('error_recovery', 1000);      // 1秒
  }

  /**
   * 初始化性能观察器
   */
  initializeObservers() {
    // Service Worker 消息传递监控
    this.setupMessageTimingObserver();

    // 内存使用监控
    this.setupMemoryObserver();

    // 网络请求监控
    this.setupNetworkObserver();
  }

  /**
   * 消息传递时间监控
   */
  setupMessageTimingObserver() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // 拦截sendMessage以添加性能监控
      const originalSendMessage = chrome.runtime.sendMessage;

      chrome.runtime.sendMessage = function(...args) {
        const startTime = performance.now();
        const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

        // 记录消息发送
        logger.debug('MESSAGE_SEND', {
          messageId,
          type: args[0]?.type || 'unknown',
          timestamp: startTime
        }, { category: 'performance' });

        const promise = new Promise((resolve, reject) => {
          originalSendMessage.call(chrome.runtime, ...args, (response) => {
            const endTime = performance.now();
            const duration = endTime - startTime;

            // 记录消息响应
            logger.debug('MESSAGE_RESPONSE', {
              messageId,
              type: args[0]?.type || 'unknown',
              duration,
              success: response && response.success !== false
            }, { category: 'performance' });

            // 检查性能阈值
            const threshold = window.performanceMonitor?.thresholds.get('sw_message_response') || 1000;
            if (duration > threshold) {
              logger.warn('PERF_MESSAGE_SLOW', {
                messageId,
                type: args[0]?.type || 'unknown',
                duration,
                threshold
              }, { category: 'performance_warning' });
            }

            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        });

        return promise;
      };
    }
  }

  /**
   * 内存使用监控
   */
  setupMemoryObserver() {
    if ('memory' in performance) {
      setInterval(() => {
        try {
          const memoryInfo = performance.memory;

          this.recordMetric('memory_usage', {
            used: memoryInfo.usedJSHeapSize,
            total: memoryInfo.totalJSHeapSize,
            limit: memoryInfo.jsHeapSizeLimit,
            usageRatio: memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit
          });

          // 内存使用率过高警告
          const usageRatio = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit;
          if (usageRatio > 0.8) {
            logger.warn('PERF_MEMORY_HIGH', {
              used: memoryInfo.usedJSHeapSize,
              limit: memoryInfo.jsHeapSizeLimit,
              usageRatio: (usageRatio * 100).toFixed(2) + '%'
            }, { category: 'performance_warning' });
          }
        } catch (error) {
          // 某些环境下可能不支持memory API
        }
      }, 30000); // 每30秒检查一次
    }
  }

  /**
   * 网络请求监控
   */
  setupNetworkObserver() {
    if ('PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'resource') {
              this.recordMetric('network_request', {
                url: entry.name,
                duration: entry.duration,
                size: entry.transferSize || 0,
                protocol: entry.nextHopProtocol || 'unknown'
              });

              // 慢请求检测
              if (entry.duration > 5000) { // 超过5秒
                logger.warn('PERF_NETWORK_SLOW', {
                  url: entry.name,
                  duration: entry.duration
                }, { category: 'performance_warning' });
              }
            }
          }
        });

        observer.observe({ entryTypes: ['resource'] });
        this.observers.add(observer);
      } catch (error) {
        logger.debug('PERF_NETWORK_OBSERVER_ERROR', { error: error.message });
      }
    }
  }

  /**
   * 开始计时
   */
  startTimer(name, metadata = {}) {
    const timerId = 'timer_' + name + '_' + Date.now();

    this.timers.set(timerId, {
      name,
      startTime: performance.now(),
      metadata,
      traceId: logger.startTrace(name, metadata)
    });

    logger.debug('TIMER_START', {
      timerId,
      name,
      metadata
    }, { category: 'performance' });

    return timerId;
  }

  /**
   * 结束计时
   */
  endTimer(timerId, result = {}, error = null) {
    const timer = this.timers.get(timerId);
    if (!timer) {
      logger.warn('TIMER_NOT_FOUND', { timerId }, { category: 'performance' });
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - timer.startTime;

    // 记录指标
    this.recordMetric(timer.name, {
      duration,
      success: !error,
      metadata: timer.metadata,
      result,
      error: error ? error.message : null
    });

    // 检查阈值
    this.checkThreshold(timer.name, duration);

    // 结束追踪
    logger.endTrace(timer.traceId, result, error);

    logger.debug('TIMER_END', {
      timerId,
      name: timer.name,
      duration,
      success: !error
    }, { category: 'performance' });

    this.timers.delete(timerId);

    return duration;
  }

  /**
   * 记录指标
   */
  recordMetric(name, data) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        count: 0,
        totalDuration: 0,
        successCount: 0,
        errorCount: 0,
        minDuration: Infinity,
        maxDuration: 0,
        samples: [],
        lastUpdated: Date.now()
      });
    }

    const metric = this.metrics.get(name);
    const duration = data.duration || 0;

    metric.count++;
    metric.totalDuration += duration;
    metric.lastUpdated = Date.now();

    if (data.success !== false) {
      metric.successCount++;
    } else {
      metric.errorCount++;
    }

    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.maxDuration = Math.max(metric.maxDuration, duration);

    // 保留最近100个样本
    metric.samples.push({
      timestamp: Date.now(),
      duration,
      success: data.success !== false,
      data
    });

    if (metric.samples.length > 100) {
      metric.samples.shift();
    }

    logger.debug('METRIC_RECORDED', {
      name,
      duration,
      success: data.success !== false,
      sampleCount: metric.samples.length
    }, { category: 'performance' });
  }

  /**
   * 检查性能阈值
   */
  checkThreshold(name, duration) {
    const threshold = this.thresholds.get(name);
    if (!threshold) return;

    if (duration > threshold) {
      logger.warn('PERF_THRESHOLD_EXCEEDED', {
        metricName: name,
        duration,
        threshold,
        ratio: (duration / threshold).toFixed(2)
      }, { category: 'performance_warning' });

      // 触发性能警告事件
      this.notifyPerformanceWarning(name, duration, threshold);
    }
  }

  /**
   * 通知性能警告
   */
  notifyPerformanceWarning(name, duration, threshold) {
    // 可以在这里添加自定义的警告处理逻辑
    // 例如发送到监控系统、显示用户提示等

    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('performanceWarning', {
        detail: { name, duration, threshold }
      }));
    }
  }

  /**
   * 获取性能统计
   */
  getMetrics() {
    const stats = {};

    for (const [name, metric] of this.metrics.entries()) {
      stats[name] = {
        count: metric.count,
        averageDuration: metric.count > 0 ? metric.totalDuration / metric.count : 0,
        successRate: metric.count > 0 ? metric.successCount / metric.count : 0,
        minDuration: metric.minDuration === Infinity ? 0 : metric.minDuration,
        maxDuration: metric.maxDuration,
        recentAverage: this.calculateRecentAverage(metric.samples),
        trend: this.calculateTrend(metric.samples),
        lastUpdated: metric.lastUpdated
      };
    }

    return stats;
  }

  /**
   * 计算最近的平均值
   */
  calculateRecentAverage(samples) {
    if (samples.length === 0) return 0;

    const recentSamples = samples.slice(-10);
    const total = recentSamples.reduce((sum, sample) => sum + sample.duration, 0);
    return total / recentSamples.length;
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
   * 获取活动计时器
   */
  getActiveTimers() {
    const active = [];
    const now = performance.now();

    for (const [timerId, timer] of this.timers.entries()) {
      active.push({
        timerId,
        name: timer.name,
        duration: now - timer.startTime,
        metadata: timer.metadata,
        traceId: timer.traceId
      });
    }

    return active;
  }

  /**
   * 开始定期报告
   */
  startPeriodicReporting() {
    setInterval(() => {
      const report = this.generatePerformanceReport();
      logger.info('PERFORMANCE_REPORT', report, { category: 'performance' });
    }, 60000); // 每分钟报告一次
  }

  /**
   * 生成性能报告
   */
  generatePerformanceReport() {
    const metrics = this.getMetrics();
    const activeTimers = this.getActiveTimers();

    // 找出性能最差的操作
    const worstPerformers = Object.entries(metrics)
      .filter(([name, metric]) => metric.count >= 5) // 至少5次操作
      .sort((a, b) => b[1].averageDuration - a[1].averageDuration)
      .slice(0, 5);

    // 找出错位率最高的操作
    const highestErrorRates = Object.entries(metrics)
      .filter(([name, metric]) => metric.count >= 5)
      .sort((a, b) => (1 - b[1].successRate) - (1 - a[1].successRate))
      .slice(0, 5);

    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalOperations: Object.values(metrics).reduce((sum, m) => sum + m.count, 0),
        overallSuccessRate: this.calculateOverallSuccessRate(metrics),
        activeTimers: activeTimers.length
      },
      worstPerformers: worstPerformers.map(([name, metric]) => ({
        name,
        averageDuration: metric.averageDuration,
        count: metric.count
      })),
      highestErrorRates: highestErrorRates.map(([name, metric]) => ({
        name,
        errorRate: (1 - metric.successRate) * 100,
        count: metric.count
      })),
      activeTimers: activeTimers.map(timer => ({
        name: timer.name,
        duration: timer.duration,
        metadata: timer.metadata
      }))
    };
  }

  /**
   * 计算总体成功率
   */
  calculateOverallSuccessRate(metrics) {
    let totalSuccess = 0;
    let totalCount = 0;

    for (const metric of Object.values(metrics)) {
      totalSuccess += metric.successCount;
      totalCount += metric.count;
    }

    return totalCount > 0 ? totalSuccess / totalCount : 0;
  }

  /**
   * 清理过期数据
   */
  cleanup() {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24小时前

    for (const [name, metric] of this.metrics.entries()) {
      metric.samples = metric.samples.filter(sample =>
        sample.timestamp > cutoffTime
      );

      // 如果没有样本了，重置统计数据
      if (metric.samples.length === 0) {
        metric.count = 0;
        metric.totalDuration = 0;
        metric.successCount = 0;
        metric.errorCount = 0;
        metric.minDuration = Infinity;
        metric.maxDuration = 0;
      }
    }

    logger.info('PERFORMANCE_CLEANUP', {
      metricsCount: this.metrics.size,
      activeTimers: this.timers.size
    }, { category: 'maintenance' });
  }

  /**
   * 重置所有指标
   */
  reset() {
    this.metrics.clear();
    this.timers.clear();
    logger.info('PERFORMANCE_RESET', {}, { category: 'maintenance' });
  }

  /**
   * 导出性能数据
   */
  exportData() {
    return {
      timestamp: new Date().toISOString(),
      metrics: this.getMetrics(),
      activeTimers: this.getActiveTimers(),
      thresholds: Object.fromEntries(this.thresholds),
      summary: this.generatePerformanceReport()
    };
  }
}

/*************************************************************************
 * 🎯 装饰器 - 用于监控函数性能
 *************************************************************************/

/**
 * 性能监控装饰器
 */
function performanceMonitor(metricName, options = {}) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const monitor = window.performanceMonitor || globalThis.performanceMonitor;
      if (!monitor) {
        return originalMethod.apply(this, args);
      }

      const timerId = monitor.startTimer(metricName, {
        className: target.constructor.name,
        methodName: propertyKey,
        argsCount: args.length
      });

      try {
        const result = await originalMethod.apply(this, args);
        monitor.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        monitor.endTimer(timerId, null, error);
        throw error;
      }
    };

    return descriptor;
  };
}

/*************************************************************************
 * 🎯 便捷函数
 *************************************************************************/

/**
 * 快速计时
 */
function timeExecution(name, fn, metadata = {}) {
  const monitor = window.performanceMonitor || globalThis.performanceMonitor;
  if (!monitor) {
    return fn();
  }

  const timerId = monitor.startTimer(name, metadata);

  try {
    const result = fn();

    if (result && typeof result.then === 'function') {
      // 异步函数
      return result
        .then(data => {
          monitor.endTimer(timerId, { success: true, data });
          return data;
        })
        .catch(error => {
          monitor.endTimer(timerId, null, error);
          throw error;
        });
    } else {
      // 同步函数
      monitor.endTimer(timerId, { success: true, result });
      return result;
    }
  } catch (error) {
    monitor.endTimer(timerId, null, error);
    throw error;
  }
}

/*************************************************************************
 * 🎯 全局实例初始化
 *************************************************************************/

// 创建全局性能监控实例
const globalPerformanceMonitor = new PerformanceMonitor();

// 在浏览器环境中暴露到全局
if (typeof window !== 'undefined') {
  window.performanceMonitor = globalPerformanceMonitor;
  window.timeExecution = timeExecution;
  window.performanceMonitor = globalPerformanceMonitor;
}

// 导出
export {
  PerformanceMonitor,
  performanceMonitor,
  timeExecution,
  globalPerformanceMonitor
};

export default globalPerformanceMonitor;