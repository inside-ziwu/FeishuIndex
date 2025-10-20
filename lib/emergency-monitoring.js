/* ========================================================================
 * 紧急监控系统 - 针对关键用户Linus Torvalds的实时监控
 * 检测并响应TypeError等关键错误
 * ======================================================================== */

class EmergencyMonitoring {
  constructor(logger) {
    this.logger = logger;
    this.errorCounts = new Map();
    this.lastErrorTime = new Map();
    this.criticalThresholds = {
      typeErrorCount: 1,        // TypeError出现1次即告警
      networkErrorCount: 3,     // 网络错误出现3次告警
      timeWindowMs: 60000       // 1分钟时间窗口
    };
  }

  /**
   * 检查是否为关键错误（影响Linus Torvalds的P0级错误）
   */
  isCriticalError(error) {
    const errorString = String(error);
    const criticalPatterns = [
      /Cannot read properties of undefined \(reading 'length'\)/,
      /Cannot read propert[yi]es of undefined/,
      /TypeError/,
      /fieldsResponse\.fields/,
      /linkFields.*length/
    ];

    return criticalPatterns.some(pattern => pattern.test(errorString));
  }

  /**
   * 记录错误并触发告警
   */
  recordError(error, context = {}) {
    const errorType = this.classifyError(error);
    const timestamp = Date.now();
    const errorKey = `${errorType}_${context.operation || 'unknown'}`;

    // 更新错误计数
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
    this.lastErrorTime.set(errorKey, timestamp);

    // 关键错误立即告警
    if (this.isCriticalError(error)) {
      this.triggerCriticalAlert(error, context, errorType);
      return true;
    }

    // 检查是否超过阈值
    if (this.shouldTriggerAlert(errorKey, timestamp)) {
      this.triggerAlert(error, context, errorType);
      return true;
    }

    return false;
  }

  /**
   * 错误分类
   */
  classifyError(error) {
    const errorString = String(error);

    if (errorString.includes('Cannot read properties of undefined')) {
      return 'TypeError_Undefined';
    } else if (errorString.includes('network') || errorString.includes('fetch')) {
      return 'NetworkError';
    } else if (errorString.includes('field') || errorString.includes('Field')) {
      return 'FieldError';
    } else if (errorString.includes('auth') || errorString.includes('token')) {
      return 'AuthError';
    } else {
      return 'UnknownError';
    }
  }

  /**
   * 检查是否应该触发告警
   */
  shouldTriggerAlert(errorKey, timestamp) {
    const count = this.errorCounts.get(errorKey) || 0;
    const lastTime = this.lastErrorTime.get(errorKey) || 0;
    const timeWindow = this.criticalThresholds.timeWindowMs;

    // 时间窗口内的错误计数
    if (timestamp - lastTime < timeWindow) {
      return count >= this.criticalThresholds.networkErrorCount;
    }

    // 超过时间窗口，重置计数
    this.errorCounts.set(errorKey, 1);
    return false;
  }

  /**
   * 触发关键告警（P0级）
   */
  triggerCriticalAlert(error, context, errorType) {
    const alert = {
      severity: 'CRITICAL',
      level: 'P0',
      timestamp: Date.now(),
      error: String(error),
      errorType,
      context,
      user: 'Linus Torvalds', // 关键用户标识
      immediateAction: 'IMMEDIATE_ATTENTION_REQUIRED'
    };

    this.logger?.error('CRITICAL_ERROR_ALERT', 'P0级错误：关键用户功能受阻', alert);

    // 在实际环境中，这里会触发：
    // 1. Slack/Teams告警
    // 2. PagerDuty紧急通知
    // 3. 邮件通知
    // 4. 状态页面更新

    console.error('🚨 P0 CRITICAL ALERT 🚨', alert);
  }

  /**
   * 触发普通告警
   */
  triggerAlert(error, context, errorType) {
    const alert = {
      severity: 'WARNING',
      level: 'P2',
      timestamp: Date.now(),
      error: String(error),
      errorType,
      context
    };

    this.logger?.warn('ERROR_ALERT', '检测到错误模式', alert);
    console.warn('⚠️ ERROR ALERT', alert);
  }

  /**
   * 重置错误计数
   */
  resetCounters() {
    this.errorCounts.clear();
    this.lastErrorTime.clear();
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const stats = {};
    for (const [key, count] of this.errorCounts.entries()) {
      const lastTime = this.lastErrorTime.get(key) || 0;
      stats[key] = {
        count,
        lastOccurrence: lastTime,
        timeSinceLast: Date.now() - lastTime
      };
    }
    return stats;
  }
}

// 导出供popup.js使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmergencyMonitoring;
} else if (typeof window !== 'undefined') {
  window.EmergencyMonitoring = EmergencyMonitoring;
}