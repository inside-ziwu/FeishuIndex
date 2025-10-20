# FeishuIndex 可观测性系统使用指南

## 📋 概述

FeishuIndex 可观测性系统是一个企业级的监控、日志、性能追踪和错误分析解决方案，专门为Chrome扩展设计，帮助你快速诊断和解决TypeError等复杂问题。

## 🎯 核心功能

### 1. 多层日志系统
- **5个日志级别**: DEBUG, INFO, WARN, ERROR, FATAL
- **结构化日志**: 支持JSON格式和上下文信息
- **调用链追踪**: 完整的请求生命周期跟踪
- **持久化存储**: 本地缓存，支持离线查看

### 2. 性能监控
- **实时指标**: API响应时间、模块加载时间、UI渲染时间
- **阈值监控**: 自动检测性能异常
- **趋势分析**: 性能趋势识别和预警
- **资源监控**: 内存使用、存储占用情况

### 3. 错误追踪
- **自动捕获**: TypeError、NetworkError、ServiceWorker错误
- **错误分类**: 智能错误类型识别和聚类
- **恢复建议**: 基于错误模式的自动恢复建议
- **调用栈分析**: 完整的错误上下文信息

### 4. 健康监控
- **模块状态**: 实时监控所有模块的健康状况
- **依赖检查**: 自动验证模块依赖关系
- **自动恢复**: 模块故障时的自动恢复机制
- **系统评分**: 整体健康度量化评估

### 5. 调试工具
- **交互式面板**: Ctrl+Shift+D 打开调试界面
- **实时监控**: 状态、错误、性能的实时查看
- **命令行工具**: 丰富的调试命令支持
- **数据导出**: 一键导出完整诊断信息

## 🚀 快速开始

### 1. 系统初始化

可观测性系统会在扩展加载时自动初始化：

```javascript
// background.js - 自动加载
importScripts('../lib/observability.js');
importScripts('../lib/performance-monitor.js');
importScripts('../lib/error-tracker.js');
importScripts('../lib/health-monitor.js');

// 全局实例自动可用
const logger = globalThis.logger;
const errorTracker = globalThis.errorTracker;
const performanceMonitor = globalThis.performanceMonitor;
const healthMonitor = globalThis.healthMonitor;
```

### 2. 基础使用

#### 记录日志
```javascript
// 记录不同级别的日志
logger.debug('DEBUG_MESSAGE', '调试信息', { userId: 123 });
logger.info('INFO_MESSAGE', '普通信息', { action: 'save' });
logger.warn('WARN_MESSAGE', '警告信息', { warning: 'deprecated' });
logger.error('ERROR_MESSAGE', '错误信息', { error: 'validation_failed' });

// 带分类的日志
logger.info('OPERATION_START', '开始操作', {}, { category: 'user_action' });
```

#### 性能监控
```javascript
// 开始计时
const timerId = performanceMonitor.startTimer('api_call', { endpoint: '/save' });

// 执行操作
const result = await feishuAPI.saveRecord(data);

// 结束计时
performanceMonitor.endTimer(timerId, { success: true, recordId: result.id });
```

#### 错误捕获
```javascript
try {
  // 你的代码
  await riskyOperation();
} catch (error) {
  // 自动捕获错误并提供恢复建议
  errorTracker.captureError(error, {
    type: 'api_error',
    operation: 'save_record',
    userId: currentUserId
  });
}
```

## 🛠️ 调试工具使用

### 1. 调试面板

**快捷键**: `Ctrl+Shift+D`

调试面板包含4个标签页：

#### Console标签
- 查看最近的日志信息
- 支持不同级别的日志过滤
- 实时更新日志内容

#### Status标签
- 系统健康状态概览
- 模块加载状态检查
- 关键问题快速定位

#### Errors标签
- 最近错误列表
- 错误恢复建议
- 错误模式分析

#### Performance标签
- 性能指标图表
- 响应时间统计
- 性能趋势分析

### 2. 命令行工具

在调试面板的命令行中输入以下命令：

```bash
# 基础状态命令
status              # 查看系统状态摘要
health              # 执行完整健康检查
modules             # 查看所有模块状态
errors              # 查看错误统计
performance         # 查看性能指标

# 数据管理命令
snapshot            # 创建状态快照
export              # 导出诊断数据
clear logs          # 清理日志数据
reset               # 重置所有监控数据

# 监控命令
watch "config.appId"     # 监视表达式
unwatch "config.appId"   # 停止监视
trace "saveOperation"    # 开始操作追踪

# 测试命令
test basic          # 运行基础测试
ping service        # 测试服务连接
simulate error      # 模拟错误场景

# 诊断命令
diagnose TypeError  # 诊断特定问题
investigate storage # 调查组件状态
repair storage      # 尝试修复组件

# 帮助命令
help                # 查看所有命令
help status         # 查看特定命令帮助
history             # 查看命令历史
```

### 3. 快捷键

- `Ctrl+Shift+D`: 切换调试面板
- `Ctrl+Shift+E`: 导出诊断数据
- `Ctrl+Shift+R`: 重置所有监控数据

## 🔍 诊断TypeError问题

针对你遇到的 `TypeError: Cannot read properties of undefined (reading 'length')` 问题，系统提供了专门的支持：

### 1. 自动诊断

系统会自动捕获并分析TypeError错误：

```javascript
// 错误信息包含详细上下文
{
  name: "TypeError",
  message: "Cannot read properties of undefined (reading 'length')",
  recoverySuggestion: {
    suggestion: "数组或对象未正确初始化",
    recovery: "检查数据源是否正确返回，添加空值检查",
    codeExample: "if (data && Array.isArray(data)) { /* 安全操作 */ }"
  },
  context: {
    source: "popup.js loadFields",
    fieldType: "undefined",
    fieldKeys: null,
    responseStructure: { ... }
  }
}
```

### 2. 防御性验证

系统在关键字段加载时使用5层验证：

```javascript
const fieldValidation = this.validateFieldsDataWithDefensiveCheck(fieldsResponse.fields);

// 验证包含：
// 1. 基础类型检查
// 2. 必需属性检查
// 3. 数组类型检查
// 4. 链接字段检查
// 5. 深度结构验证
```

### 3. 错误恢复

针对TypeError的自动恢复策略：

```javascript
// 数据相关错误：清理缓存并重试
if (error.message.includes('undefined') || error.message.includes('null')) {
  setTimeout(async () => {
    await this.safeSendMessage('CLEAR_CACHE', 'error_recovery');
    this.loadFields();
  }, 1000 * this.recoveryAttempts);
}
```

### 4. 状态追踪

系统会记录完整的状态历史：

```javascript
// 状态快照包含：
{
  name: "loadFields_start",
  timestamp: 1699999999999,
  url: "https://example.com",
  hasFieldsData: false,
  recoveryAttempts: 0,
  // ... 更多状态信息
}
```

## 📊 性能优化建议

### 1. 日志级别优化

生产环境建议使用INFO级别：

```javascript
// 生产环境配置
const config = {
  logging: {
    level: 'INFO',        // 减少日志量
    enableConsole: false, // 关闭控制台输出
    enableStorage: true   // 保留存储
  }
};
```

### 2. 性能阈值调整

根据实际需求调整性能阈值：

```javascript
// 严格的性能要求
const performanceConfig = {
  thresholds: {
    ui_response: 50,      // UI响应时间<50ms
    form_validation: 25,  // 表单验证<25ms
    field_rendering: 100  // 字段渲染<100ms
  }
};
```

### 3. 存储优化

定期清理监控数据：

```javascript
// 自动清理配置
const storageConfig = {
  retentionDays: 7,      // 保留7天数据
  autoCleanup: true,     // 自动清理
  maxStorageSize: 1000   // 最大1000条记录
};
```

## 🔧 高级配置

### 1. 自定义配置

创建自定义配置文件：

```javascript
// custom-observability-config.js
import { OBSERVABILITY_CONFIG, mergeConfig } from './lib/observability-config.js';

export const customConfig = mergeConfig(OBSERVABILITY_CONFIG, {
  logging: {
    level: 'DEBUG',
    enableConsole: true
  },
  performance: {
    thresholds: {
      sw_message_response: 500  // 更严格的响应时间要求
    }
  }
});
```

### 2. 模块注册

注册自定义模块监控：

```javascript
// 注册自定义模块
healthMonitor.registerModule('customModule', {
  required: true,
  checkFn: () => checkCustomModuleHealth(),
  recoveryFn: () => recoverCustomModule(),
  dependencies: ['storage']
});
```

### 3. 自定义恢复策略

添加错误恢复策略：

```javascript
// 添加自定义恢复策略
errorTracker.recoveryStrategies.set('CustomError', {
  patterns: [/custom_error_pattern/],
  strategies: [{
    condition: /specific_error/,
    suggestion: '自定义错误处理',
    recovery: '执行自定义恢复逻辑',
    codeExample: 'customRecoveryFunction()'
  }]
});
```

## 📈 监控最佳实践

### 1. 日志记录原则

- **结构化日志**: 使用JSON格式，便于分析
- **上下文信息**: 包含足够的上下文用于调试
- **分类标签**: 使用category进行日志分类
- **性能考虑**: 避免在高频操作中记录DEBUG日志

### 2. 错误处理原则

- **早期捕获**: 在错误发生点立即捕获
- **完整上下文**: 记录错误发生时的完整上下文
- **恢复尝试**: 为可恢复错误提供自动恢复机制
- **用户友好**: 向用户显示友好的错误信息

### 3. 性能监控原则

- **关键路径**: 监控关键用户路径的性能
- **阈值设置**: 根据用户期望设置合理的性能阈值
- **趋势分析**: 关注性能变化趋势，及时发现问题
- **资源平衡**: 在监控精度和性能开销之间找到平衡

## 🆘 故障排除

### 1. 常见问题

#### Q: 调试面板无法打开
A: 检查是否在popup页面中，确保可观测性模块已正确加载

#### Q: 日志数据过大
A: 调整日志级别为INFO或WARN，定期清理历史数据

#### Q: 性能监控影响性能
A: 调整监控频率，关闭不必要的监控项

#### Q: 错误恢复不工作
A: 检查恢复策略配置，确保模块支持自动恢复

### 2. 获取帮助

- **导出诊断数据**: 使用 `Ctrl+Shift+E` 导出完整诊断信息
- **查看错误日志**: 在调试面板的Errors标签中查看详细错误信息
- **检查系统状态**: 使用 `health` 命令检查系统整体健康状况

## 📚 更多资源

- **API文档**: 查看各个模块的详细API文档
- **配置参考**: 完整的配置选项参考
- **最佳实践**: 更多可观测性最佳实践案例
- **社区支持**: 在项目仓库提交问题和建议

---

通过这个强大的可观测性系统，你可以快速定位和解决TypeError等各种复杂问题，提升Chrome扩展的稳定性和用户体验。