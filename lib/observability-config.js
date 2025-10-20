/**
 * FeishuIndex 可观测性系统配置
 * 统一管理所有监控、日志、性能和错误追踪的配置参数
 */

/*************************************************************************
 * ⚙️ 可观测性系统配置
 *************************************************************************/

export const OBSERVABILITY_CONFIG = {
  // 日志系统配置
  logging: {
    level: 'DEBUG', // DEBUG, INFO, WARN, ERROR, FATAL
    enableConsole: true,
    enableStorage: true,
    maxStorageSize: 1000,
    enableTraceId: true,
    enablePerformance: true,
    retentionDays: 7
  },

  // 性能监控配置
  performance: {
    enableAutoCapture: true,
    enableStackTrace: true,
    maxErrorsPerSession: 100,
    enableContextCapture: true,
    enableRecoverySuggestion: true,

    // 性能阈值设置 (毫秒)
    thresholds: {
      sw_message_response: 1000,    // Service Worker消息响应
      sw_module_loading: 500,       // 模块加载时间
      sw_api_call: 5000,            // API调用时间
      ui_response: 100,             // UI响应时间
      form_validation: 50,          // 表单验证时间
      field_rendering: 200,         // 字段渲染时间
      cache_operation: 100,         // 缓存操作时间
      data_validation: 50,          // 数据验证时间
      error_recovery: 1000          // 错误恢复时间
    },

    // 监控间隔设置
    intervals: {
      performance_report: 60000,    // 性能报告间隔 (1分钟)
      memory_check: 30000,          // 内存检查间隔 (30秒)
      health_check: 30000,          // 健康检查间隔 (30秒)
      cleanup: 3600000              // 数据清理间隔 (1小时)
    }
  },

  // 错误追踪配置
  errorTracking: {
    enableAutoCapture: true,
    enableStackTrace: true,
    maxErrorsPerSession: 200,
    enableContextCapture: true,
    enableRecoverySuggestion: true,

    // 错误分类规则
    errorTypes: {
      TypeError: {
        severity: 'critical',
        autoRecovery: true,
        maxRetries: 3
      },
      NetworkError: {
        severity: 'high',
        autoRecovery: true,
        maxRetries: 5
      },
      ServiceWorkerError: {
        severity: 'critical',
        autoRecovery: false,
        maxRetries: 1
      }
    },

    // 错误恢复策略
    recoveryStrategies: {
      TypeError: 'retry_with_fallback',
      NetworkError: 'exponential_backoff',
      ServiceWorkerError: 'reload_extension'
    }
  },

  // 健康监控配置
  healthMonitoring: {
    checkInterval: 30000,           // 健康检查间隔 (30秒)
    enableAutoRecovery: true,
    enableResourceMonitoring: true,
    healthThreshold: 0.7,           // 健康阈值 (70%)

    // 模块依赖关系
    moduleDependencies: {
      'storage': [],
      'feishuAPI': ['storage'],
      'FieldMapper': ['storage', 'feishuAPI'],
      'background': ['storage', 'feishuAPI', 'FieldMapper'],
      'popup': []
    },

    // 必需模块
    requiredModules: ['storage', 'feishuAPI', 'FieldMapper', 'background']
  },

  // 调试工具配置
  debugTools: {
    enableDebugPanel: true,
    enableKeyboardShortcuts: true,
    enableConsoleCommands: true,
    maxSnapshots: 10,
    maxCommandHistory: 50,

    // 键盘快捷键
    shortcuts: {
      toggleDebugPanel: 'Ctrl+Shift+D',
      exportDiagnostics: 'Ctrl+Shift+E',
      resetAllData: 'Ctrl+Shift+R'
    }
  },

  // Chrome扩展特定配置
  chromeExtension: {
    // Service Worker配置
    serviceWorker: {
      enableMessageInterception: true,
      enablePerformanceMonitoring: true,
      maxConcurrentMessages: 10,
      messageTimeout: 10000
    },

    // 存储配置
    storage: {
      enableUsageMonitoring: true,
      warningThreshold: 0.8,         // 80%存储使用率警告
      criticalThreshold: 0.95,       // 95%存储使用率严重警告
      autoCleanup: true,
      retentionDays: 30
    },

    // 权限检查
    permissions: {
      required: ['storage', 'activeTab'],
      optional: ['contextMenus'],
      checkInterval: 60000           // 权限检查间隔
    }
  }
};

/*************************************************************************
 * 🎯 环境特定配置
 *************************************************************************/

export const ENVIRONMENT_CONFIG = {
  development: {
    ...OBSERVABILITY_CONFIG,
    logging: {
      ...OBSERVABILITY_CONFIG.logging,
      level: 'DEBUG',
      enableConsole: true
    },
    debugTools: {
      ...OBSERVABILITY_CONFIG.debugTools,
      enableDebugPanel: true,
      enableKeyboardShortcuts: true
    }
  },

  production: {
    ...OBSERVABILITY_CONFIG,
    logging: {
      ...OBSERVABILITY_CONFIG.logging,
      level: 'INFO',
      enableConsole: false
    },
    debugTools: {
      ...OBSERVABILITY_CONFIG.debugTools,
      enableDebugPanel: false,
      enableKeyboardShortcuts: false
    }
  },

  testing: {
    ...OBSERVABILITY_CONFIG,
    logging: {
      ...OBSERVABILITY_CONFIG.logging,
      level: 'DEBUG',
      enableConsole: true,
      enableStorage: false
    },
    performance: {
      ...OBSERVABILITY_CONFIG.performance,
      thresholds: {
        ...OBSERVABILITY_CONFIG.performance.thresholds,
        sw_message_response: 500,
        ui_response: 50
      }
    }
  }
};

/*************************************************************************
 * 🔧 配置工具函数
 *************************************************************************/

/**
 * 获取当前环境配置
 */
export function getCurrentConfig() {
  // 检测环境
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    // Chrome扩展环境
    if (chrome.runtime.getManifest().name.includes('Dev')) {
      return ENVIRONMENT_CONFIG.development;
    }
    return ENVIRONMENT_CONFIG.production;
  } else if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    // 本地开发环境
    return ENVIRONMENT_CONFIG.development;
  } else if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    // 测试环境
    return ENVIRONMENT_CONFIG.testing;
  } else {
    // 默认生产环境
    return ENVIRONMENT_CONFIG.production;
  }
}

/**
 * 合并用户自定义配置
 */
export function mergeConfig(baseConfig, userConfig) {
  const merged = { ...baseConfig };

  for (const [key, value] of Object.entries(userConfig)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      merged[key] = mergeConfig(merged[key] || {}, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * 验证配置有效性
 */
export function validateConfig(config) {
  const errors = [];

  // 验证日志级别
  const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
  if (!validLevels.includes(config.logging?.level)) {
    errors.push(`无效的日志级别: ${config.logging?.level}`);
  }

  // 验证阈值
  if (config.performance?.thresholds) {
    for (const [name, threshold] of Object.entries(config.performance.thresholds)) {
      if (typeof threshold !== 'number' || threshold < 0) {
        errors.push(`无效的性能阈值 ${name}: ${threshold}`);
      }
    }
  }

  // 验证健康阈值
  const healthThreshold = config.healthMonitoring?.healthThreshold;
  if (typeof healthThreshold !== 'number' || healthThreshold < 0 || healthThreshold > 1) {
    errors.push(`无效的健康阈值: ${healthThreshold}，应在0-1之间`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 获取配置摘要
 */
export function getConfigSummary(config) {
  return {
    environment: config === ENVIRONMENT_CONFIG.development ? 'development' :
                 config === ENVIRONMENT_CONFIG.production ? 'production' : 'testing',
    loggingLevel: config.logging?.level,
    consoleEnabled: config.logging?.enableConsole,
    storageEnabled: config.logging?.enableStorage,
    performanceMonitoring: config.performance?.enableAutoCapture,
    errorTracking: config.errorTracking?.enableAutoCapture,
    healthMonitoring: config.healthMonitoring?.enableAutoRecovery,
    debugTools: config.debugTools?.enableDebugPanel
  };
}

// 导出默认配置
export default OBSERVABILITY_CONFIG;