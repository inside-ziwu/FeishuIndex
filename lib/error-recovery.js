/**
 * FeishuIndex 错误恢复架构
 * 统一的错误处理和恢复策略
 */

/* -----------------------------------------------------------------------
 * 错误恢复设计哲学 (Linus 好品味)
 * 1. 错误恢复应该是自动的，但需要明确的手动干预选项
 * 2. 恢复策略应该根据错误类型进行分类
 * 3. 系统应该能够从任何错误状态恢复到已知良好状态
 * ----------------------------------------------------------------------- */

/**
 * 错误类型分类
 */
const ERROR_TYPES = Object.freeze({
  NETWORK: 'network',
  AUTHENTICATION: 'authentication',
  VALIDATION: 'validation',
  CONFIGURATION: 'configuration',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  RATE_LIMIT: 'rate_limit',
  UNKNOWN: 'unknown'
});

/**
 * 恢复策略
 */
const RECOVERY_STRATEGIES = Object.freeze({
  RETRY: 'retry',
  CLEAR_CACHE: 'clear_cache',
  RELOAD_CONFIG: 'reload_config',
  RESET_STATE: 'reset_state',
  USER_INTERVENTION: 'user_intervention',
  ESCALATE: 'escalate'
});

/**
 * 错误恢复管理器
 */
class ErrorRecoveryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.logger = options.logger || null;
    this.recoveryHistory = [];
    this.activeRecoveries = new Map();
  }

  /**
   * 分类错误类型
   */
  classifyError(error) {
    const message = error.message || '';
    const code = error.code || '';

    // 网络错误
    if (message.includes('网络') || message.includes('network') ||
        message.includes('连接') || code === 'NETWORK_ERROR') {
      return ERROR_TYPES.NETWORK;
    }

    // 认证错误
    if (message.includes('权限') || message.includes('认证') ||
        message.includes('auth') || code === 'AUTH_ERROR') {
      return ERROR_TYPES.AUTHENTICATION;
    }

    // 验证错误
    if (message.includes('验证') || message.includes('validation') ||
        message.includes('undefined') || code === 'VALIDATION_ERROR') {
      return ERROR_TYPES.VALIDATION;
    }

    // 配置错误
    if (message.includes('配置') || message.includes('config') ||
        message.includes('缺少') || code === 'CONFIG_ERROR') {
      return ERROR_TYPES.CONFIGURATION;
    }

    // 服务不可用
    if (message.includes('服务') || message.includes('service') ||
        message.includes('服务器') || code === 'SERVICE_ERROR') {
      return ERROR_TYPES.SERVICE_UNAVAILABLE;
    }

    // 频率限制
    if (message.includes('频繁') || message.includes('rate') ||
        code === 'RATE_LIMIT') {
      return ERROR_TYPES.RATE_LIMIT;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * 获取恢复策略
   */
  getRecoveryStrategy(errorType, error, context = {}) {
    const strategies = {
      [ERROR_TYPES.NETWORK]: [
        RECOVERY_STRATEGIES.RETRY,
        RECOVERY_STRATEGIES.CLEAR_CACHE
      ],
      [ERROR_TYPES.AUTHENTICATION]: [
        RECOVERY_STRATEGIES.RELOAD_CONFIG,
        RECOVERY_STRATEGIES.CLEAR_CACHE,
        RECOVERY_STRATEGIES.USER_INTERVENTION
      ],
      [ERROR_TYPES.VALIDATION]: [
        RECOVERY_STRATEGIES.CLEAR_CACHE,
        RECOVERY_STRATEGIES.RELOAD_CONFIG
      ],
      [ERROR_TYPES.CONFIGURATION]: [
        RECOVERY_STRATEGIES.USER_INTERVENTION
      ],
      [ERROR_TYPES.SERVICE_UNAVAILABLE]: [
        RECOVERY_STRATEGIES.RETRY,
        RECOVERY_STRATEGIES.ESCALATE
      ],
      [ERROR_TYPES.RATE_LIMIT]: [
        RECOVERY_STRATEGIES.RETRY
      ],
      [ERROR_TYPES.UNKNOWN]: [
        RECOVERY_STRATEGIES.CLEAR_CACHE,
        RECOVERY_STRATEGIES.RESET_STATE
      ]
    };

    return strategies[errorType] || [RECOVERY_STRATEGIES.ESCALATE];
  }

  /**
   * 执行恢复操作
   */
  async recover(error, context = {}) {
    const errorType = this.classifyError(error);
    const strategies = this.getRecoveryStrategy(errorType, error, context);
    const recoveryId = this.generateRecoveryId();

    if (this.logger) {
      this.logger.info('ERROR_RECOVERY_START', `开始错误恢复: ${errorType}`, {
        recoveryId,
        errorType,
        errorMessage: error.message,
        strategies,
        context
      }, { category: 'error_recovery' });
    }

    const recoveryRecord = {
      id: recoveryId,
      errorType,
      errorMessage: error.message,
      strategies,
      startTime: Date.now(),
      attempts: 0,
      context
    };

    this.activeRecoveries.set(recoveryId, recoveryRecord);

    try {
      for (const strategy of strategies) {
        recoveryRecord.attempts++;
        recoveryRecord.currentStrategy = strategy;

        const result = await this.executeRecoveryStrategy(strategy, error, context, recoveryRecord);

        if (result.success) {
          recoveryRecord.endTime = Date.now();
          recoveryRecord.success = true;
          recoveryRecord.finalStrategy = strategy;

          this.recoveryHistory.push(recoveryRecord);
          this.activeRecoveries.delete(recoveryId);

          if (this.logger) {
            this.logger.info('ERROR_RECOVERY_SUCCESS', `错误恢复成功: ${strategy}`, {
              recoveryId,
              strategy,
              attempts: recoveryRecord.attempts,
              duration: recoveryRecord.endTime - recoveryRecord.startTime
            }, { category: 'error_recovery' });
          }

          return {
            success: true,
            strategy,
            attempts: recoveryRecord.attempts,
            recoveryId
          };
        }
      }

      // 所有策略都失败
      recoveryRecord.endTime = Date.now();
      recoveryRecord.success = false;
      this.recoveryHistory.push(recoveryRecord);
      this.activeRecoveries.delete(recoveryId);

      if (this.logger) {
        this.logger.error('ERROR_RECOVERY_FAILED', `所有恢复策略都失败`, {
          recoveryId,
          attempts: recoveryRecord.attempts,
          duration: recoveryRecord.endTime - recoveryRecord.startTime
        }, { category: 'error_recovery' });
      }

      return {
        success: false,
        error: '所有恢复策略都失败',
        attempts: recoveryRecord.attempts,
        recoveryId
      };

    } catch (recoveryError) {
      recoveryRecord.endTime = Date.now();
      recoveryRecord.success = false;
      recoveryRecord.recoveryError = recoveryError.message;
      this.recoveryHistory.push(recoveryRecord);
      this.activeRecoveries.delete(recoveryId);

      if (this.logger) {
        this.logger.error('ERROR_RECOVERY_EXCEPTION', `恢复过程中发生异常`, {
          recoveryId,
          originalError: error.message,
          recoveryError: recoveryError.message
        }, { category: 'error_recovery' });
      }

      return {
        success: false,
        error: `恢复过程异常: ${recoveryError.message}`,
        attempts: recoveryRecord.attempts,
        recoveryId
      };
    }
  }

  /**
   * 执行具体的恢复策略
   */
  async executeRecoveryStrategy(strategy, error, context, recoveryRecord) {
    switch (strategy) {
      case RECOVERY_STRATEGIES.RETRY:
        return await this.executeRetryStrategy(error, context, recoveryRecord);

      case RECOVERY_STRATEGIES.CLEAR_CACHE:
        return await this.executeClearCacheStrategy(context, recoveryRecord);

      case RECOVERY_STRATEGIES.RELOAD_CONFIG:
        return await this.executeReloadConfigStrategy(context, recoveryRecord);

      case RECOVERY_STRATEGIES.RESET_STATE:
        return await this.executeResetStateStrategy(context, recoveryRecord);

      case RECOVERY_STRATEGIES.USER_INTERVENTION:
        return await this.executeUserInterventionStrategy(error, context, recoveryRecord);

      case RECOVERY_STRATEGIES.ESCALATE:
        return await this.executeEscalateStrategy(error, context, recoveryRecord);

      default:
        return { success: false, error: `未知恢复策略: ${strategy}` };
    }
  }

  /**
   * 重试策略
   */
  async executeRetryStrategy(error, context, recoveryRecord) {
    const delay = this.calculateRetryDelay(recoveryRecord.attempts);

    if (this.logger) {
      this.logger.debug('RETRY_DELAY', `等待 ${delay}ms 后重试`, {
        recoveryId: recoveryRecord.id,
        attempt: recoveryRecord.attempts,
        delay
      }, { category: 'error_recovery' });
    }

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (context.retryFunction && typeof context.retryFunction === 'function') {
        const result = await context.retryFunction();
        return { success: true, result };
      } else {
        return { success: false, error: '没有提供重试函数' };
      }
    } catch (retryError) {
      return { success: false, error: retryError.message };
    }
  }

  /**
   * 清除缓存策略
   */
  async executeClearCacheStrategy(context, recoveryRecord) {
    try {
      // 清除各种缓存
      if (context.clearFieldCache && typeof context.clearFieldCache === 'function') {
        await context.clearFieldCache();
      }

      if (context.clearOptionsCache && typeof context.clearOptionsCache === 'function') {
        await context.clearOptionsCache();
      }

      if (context.clearAllCache && typeof context.clearAllCache === 'function') {
        await context.clearAllCache();
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 重新加载配置策略
   */
  async executeReloadConfigStrategy(context, recoveryRecord) {
    try {
      if (context.reloadConfig && typeof context.reloadConfig === 'function') {
        await context.reloadConfig();
        return { success: true };
      } else {
        return { success: false, error: '没有提供重新加载配置函数' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 重置状态策略
   */
  async executeResetStateStrategy(context, recoveryRecord) {
    try {
      if (context.resetState && typeof context.resetState === 'function') {
        await context.resetState();
        return { success: true };
      } else {
        return { success: false, error: '没有提供重置状态函数' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 用户干预策略
   */
  async executeUserInterventionStrategy(error, context, recoveryRecord) {
    try {
      if (context.requestUserIntervention && typeof context.requestUserIntervention === 'function') {
        const result = await context.requestUserIntervention(error);
        return { success: true, result };
      } else {
        // 默认的用户干预：显示错误信息和建议操作
        const message = this.generateUserInterventionMessage(error, context);
        if (context.showMessage && typeof context.showMessage === 'function') {
          context.showMessage(message, 'error');
        }
        return { success: false, error: '需要用户干预' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 升级策略
   */
  async executeEscalateStrategy(error, context, recoveryRecord) {
    try {
      if (context.escalate && typeof context.escalate === 'function') {
        const result = await context.escalate(error);
        return { success: true, result };
      } else {
        // 默认升级：记录详细错误信息
        if (this.logger) {
          this.logger.error('ERROR_ESCALATED', '错误已升级处理', {
            recoveryId: recoveryRecord.id,
            originalError: error.message,
            stack: error.stack,
            context
          }, { category: 'error_escalation' });
        }
        return { success: false, error: '错误已升级，需要手动处理' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 计算重试延迟（指数退避）
   */
  calculateRetryDelay(attempt) {
    const delay = this.baseDelay * Math.pow(2, attempt - 1);
    return Math.min(delay, this.maxDelay);
  }

  /**
   * 生成恢复ID
   */
  generateRecoveryId() {
    return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成用户干预消息
   */
  generateUserInterventionMessage(error, context) {
    const errorType = this.classifyError(error);
    const messages = {
      [ERROR_TYPES.AUTHENTICATION]: '认证失败，请检查飞书应用配置是否正确',
      [ERROR_TYPES.CONFIGURATION]: '配置不完整，请前往设置页面完成配置',
      [ERROR_TYPES.VALIDATION]: '数据验证失败，请检查输入内容',
      [ERROR_TYPES.SERVICE_UNAVAILABLE]: '飞书服务暂时不可用，请稍后重试',
      [ERROR_TYPES.RATE_LIMIT]: '请求过于频繁，请稍后重试',
      [ERROR_TYPES.NETWORK]: '网络连接异常，请检查网络设置',
      [ERROR_TYPES.UNKNOWN]: '发生未知错误，请尝试重新加载页面'
    };

    return messages[errorType] || '发生错误，请重试';
  }

  /**
   * 获取恢复历史
   */
  getRecoveryHistory(limit = 50) {
    return this.recoveryHistory.slice(-limit);
  }

  /**
   * 获取活跃恢复
   */
  getActiveRecoveries() {
    return Array.from(this.activeRecoveries.values());
  }

  /**
   * 清理恢复历史
   */
  cleanupHistory(maxAge = 24 * 60 * 60 * 1000) { // 24小时
    const cutoff = Date.now() - maxAge;
    this.recoveryHistory = this.recoveryHistory.filter(record => record.startTime > cutoff);
  }

  /**
   * 导出调试信息
   */
  exportDebugInfo() {
    return {
      activeRecoveries: this.getActiveRecoveries(),
      recentHistory: this.getRecoveryHistory(20),
      stats: {
        totalRecoveries: this.recoveryHistory.length,
        successfulRecoveries: this.recoveryHistory.filter(r => r.success).length,
        failedRecoveries: this.recoveryHistory.filter(r => !r.success).length,
        averageAttempts: this.recoveryHistory.length > 0
          ? this.recoveryHistory.reduce((sum, r) => sum + r.attempts, 0) / this.recoveryHistory.length
          : 0
      },
      timestamp: Date.now()
    };
  }
}

/**
 * 全局错误恢复管理器
 */
let recoveryManagerInstance = null;

function getErrorRecoveryManager(options = {}) {
  if (!recoveryManagerInstance) {
    recoveryManagerInstance = new ErrorRecoveryManager(options);
  }
  return recoveryManagerInstance;
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ErrorRecoveryManager,
    getErrorRecoveryManager,
    ERROR_TYPES,
    RECOVERY_STRATEGIES
  };
} else {
  globalThis.FeishuIndexErrorRecovery = {
    ErrorRecoveryManager,
    getErrorRecoveryManager,
    ERROR_TYPES,
    RECOVERY_STRATEGIES
  };
}