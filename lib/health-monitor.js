/**
 * FeishuIndex 健康监控系统
 * 专门用于Chrome扩展的健康检查、模块状态监控和依赖关系验证
 *
 * 功能特点：
 * 1. 模块加载状态监控
 * 2. 依赖关系检查
 * 3. 资源使用情况监控
 * 4. 服务连接状态检查
 * 5. 自动健康评分和报警
 */

import { logger } from './observability.js';
import { timeExecution } from './performance-monitor.js';
import { safeExecute } from './error-tracker.js';

/*************************************************************************
 * 🏥 健康监控核心类
 *************************************************************************/

class HealthMonitor {
  constructor(config = {}) {
    this.config = {
      checkInterval: config.checkInterval || 30000,     // 30秒检查一次
      enableAutoRecovery: config.enableAutoRecovery !== false,
      enableResourceMonitoring: config.enableResourceMonitoring !== false,
      healthThreshold: config.healthThreshold || 0.7,   // 健康阈值70%
      ...config
    };

    this.modules = new Map();
    this.dependencies = new Map();
    this.resources = new Map();
    this.services = new Map();
    this.healthScore = 1.0;
    this.lastCheckTime = null;
    this.isChecking = false;

    this.initializeModuleTracking();
    this.initializeResourceMonitoring();
    this.initializeServiceChecks();
    this.startPeriodicHealthCheck();
  }

  /**
   * 初始化模块追踪
   */
  initializeModuleTracking() {
    // 注册核心模块
    this.registerModule('storage', {
      required: true,
      checkFn: () => this.checkStorageModule(),
      recoveryFn: () => this.recoverStorageModule(),
      dependencies: []
    });

    this.registerModule('feishuAPI', {
      required: true,
      checkFn: () => this.checkFeishuAPIModule(),
      recoveryFn: () => this.recoverFeishuAPIModule(),
      dependencies: ['storage']
    });

    this.registerModule('FieldMapper', {
      required: true,
      checkFn: () => this.checkFieldMapperModule(),
      recoveryFn: () => this.recoverFieldMapperModule(),
      dependencies: ['storage', 'feishuAPI']
    });

    this.registerModule('popup', {
      required: false,
      checkFn: () => this.checkPopupModule(),
      recoveryFn: () => this.recoverPopupModule(),
      dependencies: []
    });

    this.registerModule('background', {
      required: true,
      checkFn: () => this.checkBackgroundModule(),
      recoveryFn: () => this.recoverBackgroundModule(),
      dependencies: ['storage', 'feishuAPI', 'FieldMapper']
    });
  }

  /**
   * 初始化资源监控
   */
  initializeResourceMonitoring() {
    if (!this.config.enableResourceMonitoring) return;

    // 监控存储使用情况
    this.resources.set('storage', {
      usage: 0,
      limit: 0,
      lastCheck: null,
      checkFn: () => this.checkStorageUsage()
    });

    // 监控内存使用情况
    this.resources.set('memory', {
      usage: 0,
      limit: 0,
      lastCheck: null,
      checkFn: () => this.checkMemoryUsage()
    });

    // 监控网络连接
    this.resources.set('network', {
      connected: true,
      latency: 0,
      lastCheck: null,
      checkFn: () => this.checkNetworkStatus()
    });
  }

  /**
   * 初始化服务检查
   */
  initializeServiceChecks() {
    // 飞书API服务
    this.services.set('feishuAPI', {
      url: 'https://open.feishu.cn',
      healthy: true,
      lastCheck: null,
      latency: 0,
      checkFn: () => this.checkFeishuAPIService()
    });

    // Chrome扩展服务
    this.services.set('chromeRuntime', {
      healthy: true,
      lastCheck: null,
      checkFn: () => this.checkChromeRuntimeService()
    });

    // 本地存储服务
    this.services.set('localStorage', {
      healthy: true,
      lastCheck: null,
      checkFn: () => this.checkLocalStorageService()
    });
  }

  /**
   * 注册模块
   */
  registerModule(name, config) {
    this.modules.set(name, {
      name,
      loaded: false,
      healthy: false,
      lastCheck: null,
      errorCount: 0,
      lastError: null,
      recoveryAttempts: 0,
      ...config
    });

    // 注册依赖关系
    if (config.dependencies && config.dependencies.length > 0) {
      this.dependencies.set(name, config.dependencies);
    }
  }

  /**
   * 更新模块状态
   */
  updateModuleStatus(name, status) {
    const module = this.modules.get(name);
    if (!module) {
      logger.warn('MODULE_NOT_FOUND', { name }, { category: 'health' });
      return false;
    }

    const previousStatus = { ...module };
    module.lastCheck = Date.now();

    if (status.loaded !== undefined) {
      module.loaded = status.loaded;
    }

    if (status.healthy !== undefined) {
      module.healthy = status.healthy;

      if (!status.healthy) {
        module.errorCount++;
        module.lastError = status.error;
      } else {
        module.errorCount = 0;
        module.lastError = null;
        module.recoveryAttempts = 0;
      }
    }

    // 记录状态变化
    if (previousStatus.healthy !== status.healthy) {
      logger.info('MODULE_STATUS_CHANGED', {
        name,
        previous: previousStatus.healthy,
        current: status.healthy,
        error: status.error
      }, { category: 'health' });
    }

    return true;
  }

  /**
   * 检查单个模块
   */
  async checkModule(name) {
    const module = this.modules.get(name);
    if (!module) return false;

    try {
      // 检查依赖
      if (!await this.checkDependencies(name)) {
        this.updateModuleStatus(name, {
          healthy: false,
          error: 'Dependencies not satisfied'
        });
        return false;
      }

      // 执行模块检查
      const isHealthy = await module.checkFn();

      this.updateModuleStatus(name, {
        loaded: true,
        healthy: isHealthy
      });

      return isHealthy;
    } catch (error) {
      this.updateModuleStatus(name, {
        loaded: false,
        healthy: false,
        error: error.message
      });

      logger.warn('MODULE_CHECK_FAILED', {
        name,
        error: error.message
      }, { category: 'health' });

      // 尝试自动恢复
      if (this.config.enableAutoRecovery && module.recoveryFn) {
        await this.attemptModuleRecovery(name);
      }

      return false;
    }
  }

  /**
   * 检查模块依赖
   */
  async checkDependencies(name) {
    const deps = this.dependencies.get(name);
    if (!deps || deps.length === 0) return true;

    for (const depName of deps) {
      const dep = this.modules.get(depName);
      if (!dep || !dep.healthy) {
        logger.warn('MODULE_DEPENDENCY_MISSING', {
          module: name,
          dependency: depName,
          dependencyStatus: dep ? 'unhealthy' : 'not_found'
        }, { category: 'health' });
        return false;
      }
    }

    return true;
  }

  /**
   * 尝试模块恢复
   */
  async attemptModuleRecovery(name) {
    const module = this.modules.get(name);
    if (!module || !module.recoveryFn || module.recoveryAttempts >= 3) {
      return false;
    }

    module.recoveryAttempts++;

    logger.info('MODULE_RECOVERY_ATTEMPT', {
      name,
      attempt: module.recoveryAttempts,
      maxAttempts: 3
    }, { category: 'health' });

    try {
      await module.recoveryFn();
      logger.info('MODULE_RECOVERY_SUCCESS', { name }, { category: 'health' });
      return true;
    } catch (error) {
      logger.warn('MODULE_RECOVERY_FAILED', {
        name,
        attempt: module.recoveryAttempts,
        error: error.message
      }, { category: 'health' });
      return false;
    }
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    if (this.isChecking) return this.lastHealthResult;

    this.isChecking = true;
    const checkStartTime = performance.now();

    try {
      logger.debug('HEALTH_CHECK_STARTED', {}, { category: 'health' });

      const results = {
        timestamp: new Date().toISOString(),
        overall: { healthy: true, score: 1.0, issues: [] },
        modules: {},
        resources: {},
        services: {},
        dependencies: {}
      };

      // 检查所有模块
      let totalModuleScore = 0;
      let moduleCount = 0;

      for (const [name] of this.modules) {
        const moduleResult = await this.checkModule(name);
        results.modules[name] = {
          healthy: moduleResult,
          ...this.modules.get(name)
        };

        if (this.modules.get(name).required) {
          totalModuleScore += moduleResult ? 1 : 0;
          moduleCount++;
        }
      }

      // 检查资源
      for (const [name, resource] of this.resources) {
        try {
          const resourceResult = await resource.checkFn();
          results.resources[name] = resourceResult;
        } catch (error) {
          results.resources[name] = { healthy: false, error: error.message };
        }
      }

      // 检查服务
      for (const [name, service] of this.services) {
        try {
          const serviceResult = await service.checkFn();
          results.services[name] = serviceResult;
        } catch (error) {
          results.services[name] = { healthy: false, error: error.message };
        }
      }

      // 检查依赖关系
      results.dependencies = this.checkAllDependencies();

      // 计算总体健康分数
      const moduleScore = moduleCount > 0 ? totalModuleScore / moduleCount : 1;
      const resourceScore = this.calculateResourceScore(results.resources);
      const serviceScore = this.calculateServiceScore(results.services);

      results.overall.score = (moduleScore * 0.5 + resourceScore * 0.3 + serviceScore * 0.2);
      results.overall.healthy = results.overall.score >= this.config.healthThreshold;

      // 收集问题
      if (!results.overall.healthy) {
        results.overall.issues = this.collectHealthIssues(results);
      }

      this.healthScore = results.overall.score;
      this.lastCheckTime = Date.now();
      this.lastHealthResult = results;

      const checkDuration = performance.now() - checkStartTime;
      logger.info('HEALTH_CHECK_COMPLETED', {
        score: results.overall.score,
        healthy: results.overall.healthy,
        duration: checkDuration,
        issues: results.overall.issues.length
      }, { category: 'health' });

      return results;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 检查所有依赖关系
   */
  checkAllDependencies() {
    const dependencyIssues = [];

    for (const [name, deps] of this.dependencies) {
      const module = this.modules.get(name);
      if (!module) continue;

      for (const depName of deps) {
        const dep = this.modules.get(depName);
        if (!dep || !dep.healthy) {
          dependencyIssues.push({
            module: name,
            dependency: depName,
            status: dep ? 'unhealthy' : 'missing'
          });
        }
      }
    }

    return {
      healthy: dependencyIssues.length === 0,
      issues: dependencyIssues
    };
  }

  /**
   * 计算资源健康分数
   */
  calculateResourceScore(resources) {
    let healthyResources = 0;
    const totalResources = Object.keys(resources).length;

    for (const resource of Object.values(resources)) {
      if (resource.healthy !== false) {
        healthyResources++;
      }
    }

    return totalResources > 0 ? healthyResources / totalResources : 1;
  }

  /**
   * 计算服务健康分数
   */
  calculateServiceScore(services) {
    let healthyServices = 0;
    const totalServices = Object.keys(services).length;

    for (const service of Object.values(services)) {
      if (service.healthy !== false) {
        healthyServices++;
      }
    }

    return totalServices > 0 ? healthyServices / totalServices : 1;
  }

  /**
   * 收集健康问题
   */
  collectHealthIssues(results) {
    const issues = [];

    // 模块问题
    for (const [name, module] of Object.entries(results.modules)) {
      if (!module.healthy) {
        issues.push({
          type: 'module',
          component: name,
          severity: this.modules.get(name).required ? 'high' : 'medium',
          message: module.lastError || 'Module unhealthy'
        });
      }
    }

    // 资源问题
    for (const [name, resource] of Object.entries(results.resources)) {
      if (!resource.healthy) {
        issues.push({
          type: 'resource',
          component: name,
          severity: 'medium',
          message: resource.error || 'Resource unavailable'
        });
      }
    }

    // 服务问题
    for (const [name, service] of Object.entries(results.services)) {
      if (!service.healthy) {
        issues.push({
          type: 'service',
          component: name,
          severity: 'high',
          message: service.error || 'Service unavailable'
        });
      }
    }

    // 依赖问题
    for (const depIssue of results.dependencies.issues) {
      issues.push({
        type: 'dependency',
        component: `${depIssue.module} -> ${depIssue.dependency}`,
        severity: 'high',
        message: `Dependency ${depIssue.dependency} not available for ${depIssue.module}`
      });
    }

    return issues;
  }

  /*************************************************************************
   * 🔧 具体检查函数实现
   *************************************************************************/

  async checkStorageModule() {
    return typeof globalThis.storage !== 'undefined' && globalThis.storage.getConfig;
  }

  async checkFeishuAPIModule() {
    return typeof globalThis.feishuAPI !== 'undefined' && globalThis.feishuAPI.getTenantToken;
  }

  async checkFieldMapperModule() {
    return typeof globalThis.FieldMapper !== 'undefined' && globalThis.FieldMapper.classifyFields;
  }

  async checkPopupModule() {
    // 检查popup环境
    return typeof window !== 'undefined' && window.location?.pathname?.includes('popup.html');
  }

  async checkBackgroundModule() {
    // 检查Service Worker环境
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  }

  async checkStorageUsage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const usage = await chrome.storage.local.getBytesInUse();
        return {
          healthy: true,
          usage: usage,
          estimated: true
        };
      }
      return { healthy: false, error: 'Chrome storage not available' };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkMemoryUsage() {
    try {
      if (performance && performance.memory) {
        const memory = performance.memory;
        const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

        return {
          healthy: usageRatio < 0.9,
          usage: memory.usedJSHeapSize,
          limit: memory.jsHeapSizeLimit,
          ratio: usageRatio
        };
      }
      return { healthy: true, usage: 0, available: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkNetworkStatus() {
    try {
      const startTime = performance.now();
      const response = await fetch('https://open.feishu.cn', {
        method: 'HEAD',
        cache: 'no-cache'
      });
      const latency = performance.now() - startTime;

      return {
        healthy: response.ok,
        connected: response.ok,
        latency: latency
      };
    } catch (error) {
      return {
        healthy: false,
        connected: false,
        error: error.message
      };
    }
  }

  async checkFeishuAPIService() {
    try {
      const startTime = performance.now();
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        cache: 'no-cache'
      });
      const latency = performance.now() - startTime;

      return {
        healthy: response.status !== 0,
        latency: latency,
        status: response.status
      };
    } catch (error) {
      return {
        healthy: false,
        latency: 0,
        error: error.message
      };
    }
  }

  async checkChromeRuntimeService() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const id = chrome.runtime.id;
        return {
          healthy: !!id,
          extensionId: id
        };
      }
      return { healthy: false, error: 'Chrome runtime not available' };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkLocalStorageService() {
    try {
      const testKey = 'feishuindex_health_check';
      const testValue = Date.now().toString();

      localStorage.setItem(testKey, testValue);
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);

      return {
        healthy: retrieved === testValue,
        available: true
      };
    } catch (error) {
      return {
        healthy: false,
        available: false,
        error: error.message
      };
    }
  }

  /*************************************************************************
   * 🔄 恢复函数实现
   *************************************************************************/

  async recoverStorageModule() {
    logger.info('RECOVERING_STORAGE_MODULE', {}, { category: 'health' });
    // 重新导入storage模块
    if (typeof importScripts === 'function') {
      importScripts('../lib/storage.js');
    }
  }

  async recoverFeishuAPIModule() {
    logger.info('RECOVERING_FEISHU_API_MODULE', {}, { category: 'health' });
    // 重新导入feishu-api模块
    if (typeof importScripts === 'function') {
      importScripts('../lib/feishu-api.js');
    }
  }

  async recoverFieldMapperModule() {
    logger.info('RECOVERING_FIELD_MAPPER_MODULE', {}, { category: 'health' });
    // 重新导入field-mapper模块
    if (typeof importScripts === 'function') {
      importScripts('../lib/field-mapper.js');
    }
  }

  async recoverPopupModule() {
    logger.info('RECOVERING_POPUP_MODULE', {}, { category: 'health' });
    // 重新加载popup页面
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  async recoverBackgroundModule() {
    logger.info('RECOVERING_BACKGROUND_MODULE', {}, { category: 'health' });
    // 重新加载Service Worker
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.reload();
    }
  }

  /*************************************************************************
   * 📊 监控和管理
   *************************************************************************/

  /**
   * 开始定期健康检查
   */
  startPeriodicHealthCheck() {
    setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.checkInterval);
  }

  /**
   * 获取健康状态摘要
   */
  getHealthSummary() {
    const summary = {
      overall: {
        score: this.healthScore,
        healthy: this.healthScore >= this.config.healthThreshold,
        lastCheck: this.lastCheckTime
      },
      modules: {},
      criticalIssues: []
    };

    for (const [name, module] of this.modules) {
      summary.modules[name] = {
        healthy: module.healthy,
        required: module.required,
        errorCount: module.errorCount,
        lastError: module.lastError
      };

      if (module.required && !module.healthy) {
        summary.criticalIssues.push({
          type: 'module',
          component: name,
          message: module.lastError || 'Required module is unhealthy'
        });
      }
    }

    return summary;
  }

  /**
   * 导出健康数据
   */
  exportHealthData() {
    return {
      timestamp: new Date().toISOString(),
      config: this.config,
      healthScore: this.healthScore,
      lastCheck: this.lastCheckTime,
      modules: Array.from(this.modules.entries()).map(([name, module]) => ({
        name,
        ...module
      })),
      dependencies: Array.from(this.dependencies.entries()),
      resources: Array.from(this.resources.entries()).map(([name, resource]) => ({
        name,
        ...resource
      })),
      services: Array.from(this.services.entries()).map(([name, service]) => ({
        name,
        ...service
      }))
    };
  }

  /**
   * 重置健康监控
   */
  reset() {
    this.modules.clear();
    this.dependencies.clear();
    this.resources.clear();
    this.services.clear();
    this.healthScore = 1.0;
    this.lastCheckTime = null;

    this.initializeModuleTracking();
    this.initializeResourceMonitoring();
    this.initializeServiceChecks();

    logger.info('HEALTH_MONITOR_RESET', {}, { category: 'health' });
  }
}

/*************************************************************************
 * 🎯 便捷函数
 *************************************************************************/

/**
 * 健康检查装饰器
 */
function healthCheck(moduleName) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const monitor = window.healthMonitor || globalThis.healthMonitor;
      if (monitor) {
        const isHealthy = await monitor.checkModule(moduleName);
        if (!isHealthy) {
          throw new Error(`Module ${moduleName} is not healthy`);
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/*************************************************************************
 * 🎯 全局实例初始化
 *************************************************************************/

// 创建全局健康监控实例
const globalHealthMonitor = new HealthMonitor({
  checkInterval: 30000,
  enableAutoRecovery: true,
  enableResourceMonitoring: true,
  healthThreshold: 0.7
});

// 在浏览器环境中暴露到全局
if (typeof window !== 'undefined') {
  window.healthMonitor = globalHealthMonitor;
  window.healthCheck = healthCheck;
}

// 导出
export {
  HealthMonitor,
  healthCheck,
  globalHealthMonitor
};

export default globalHealthMonitor;