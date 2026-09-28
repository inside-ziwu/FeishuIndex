# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

FeishuIndex - Chrome扩展：网页URL到飞书多维表格的桥梁

这是一个基于Manifest V3的Chrome扩展，核心功能是将任意网页的URL快速保存到飞书多维表格。设计哲学是"透明性" - 用户感受不到两个异构系统间的复杂性。

**核心特点**：
- **动态字段适配**：支持任意表结构，基于type值自动识别4种字段类型
- **简化配置**：仅需3个配置项（App ID、App Secret、表格URL）
- **错误自愈**：字段结构变更时自动刷新缓存，重建UI
- **智能查重**：URL完全相等匹配，分页扫描带保护机制

## 技术文档参考

- **完整技术方案**: FeishuIndex完整技术方案.md - 包含20个技术模块的完整设计
- **产品需求**: PRD_v1.4.md - 核心功能需求和验收标准
- **设计讨论**: 技术方案设计讨论结果.md - 详细模块设计过程

## 核心架构

### 动态字段适配系统
```ascii
┌─────────────────────────────────────────────────────────┐
│                    用户界面层                              │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │    popup.html       │    │    options.html         │  │
│  │  • URL采集           │    │  • 3项配置              │ │
│  │  • 动态表单(4种类型)  │    │  • 连通性测试            │ │
│  │  • 标签选择器        │    │  • 状态显示              │ │
│  │  • 保存按钮          │    │                         │ │
│  └─────────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │ ↕️ (Chrome消息传递)
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    业务逻辑层 (SW)                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                background.js                        │ │
│  │  • Token按需获取                                     │ │
│  │  • 表字段缓存 (持久化+失效重建)                       │ │
│  │  • 选项缓存 (每日首次刷新)                             │ │
│  │  • URL查重算法 (分页扫描+200页/60s保护)              │ │
│  │  • 错误自愈机制 (FieldNameNotFound触发)               │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                           │ ↕️ (HTTPS API调用)
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     飞书API层                            │
│  • tenant_access_token鉴权                          │
│  • 字段查询 /records/search (查重)                   │
│  • 记录创建 /records (新记录)                        │
│  • 记录更新 /records/{id} (覆盖更新)                  │
└─────────────────────────────────────────────────────────┘
```

### 字段类型支持（基于type值）
- **链接类字段** (type: 15, ui_type: "Url")：必需字段，自动填入当前URL
- **文本类字段** (type: 1, ui_type: "Text")：可选，独立输入框
- **单选字段** (type: 3, ui_type: "SingleSelect")：可选，下拉+新增输入
- **多选字段** (type: 4, ui_type: "MultiSelect")：可选，多选+逗号分隔新增

## 核心数据流

### 保存流程
```
用户点击保存 → 验证输入 → 获取Token → 解析表格URL
     ↓
检查字段缓存 → (失效时) 重新获取字段 → 重建UI → 用户重新填写
     ↓ (有效时)
URL查重(分页扫描) → 命中重复？→ 用户确认覆盖 → 写入记录
```

### 错误自愈流程
```
FieldNameNotFound错误 → 清除字段缓存 → 重新获取 → 刷新UI → 清空输入
```

## 关键技术实现

### 1. 动态字段分类
```javascript
const FIELD_TYPES = {
  15: 'link',    // 链接类字段 - 必需
  1: 'text',     // 文本类字段 - 可选
  3: 'single',   // 单选字段 - 可选
  4: 'multi'     // 多选字段 - 可选
};
```

### 2. URL查重算法
```javascript
// 分页扫描，最多200页或60秒
async function checkUrlDuplication(url, linkField) {
  const conditions = [{
    field_name: linkField,  // 动态获取链接字段名
    operator: 'is',
    value: [url.trim()]     // 完全相等匹配
  }];

  // 分页扫描直到命中或达到限制
  return await paginateSearch(conditions);
}
```

### 3. 超链接字段格式
```javascript
// 飞书API要求的超链接格式
const hyperlinkField = {
  link: "https://example.com",      // 实际URL地址
  text: "https://example.com"       // 显示文本
};
```

### 4. 非空更新原则
```javascript
// 覆盖更新时只传递非空字段
const updateData = {};
if (userInfo.textField) updateData.textField = userInfo.textField;
if (userInfo.selectField) updateData.selectField = userInfo.selectField;
// 空值字段不传递，避免意外清空
```

## 缓存策略

### 表字段缓存
- **存储方式**：持久化存储，默认一直有效
- **失效条件**：FieldNameNotFound错误或配置变更
- **重建策略**：清除后重新获取字段列表，刷新UI

### 选项缓存
- **刷新频率**：每日首次使用时自动刷新
- **存储内容**：单选/多选字段的选项列表
- **分离管理**：与表字段缓存独立存储

## 错误处理

### 中性错误映射（适用于动态字段）
```javascript
const ERROR_MAPPING = {
  91402: "应用权限不足，请检查飞书开放平台配置",
  91403: "表格权限不足，请确认应用已添加到协作者",
  1254061: "链接字段类型必须是超链接",
  1254064: "字段类型不支持，请检查字段配置",
  429: "请求过于频繁，请稍后重试",
  500: "飞书服务异常，请稍后重试",
  network_error: "网络连接异常，请检查网络",
  field_write_failed: "字段值格式错误，请检查输入"
};
```

### 指数退避重试机制
- 第1次失败 → 等待0.5s → 重试
- 第2次失败 → 等待1s → 重试
- 第3次失败 → 等待2s → 重试
- 第4次失败 → 等待4s → 失败处理

## 性能优化

### 1. API调用控制
- **频率限制**：1秒内最多1次保存操作
- **查重保护**：最多200页或60秒，防止无限循环
- **并发控制**：避免重复API调用

### 2. Service Worker管理
- **长消息链路**：return true保持活跃
- **分段执行**：防止SW休眠中断长操作
- **后台保存**：页面切换时继续保存操作

## 开发环境设置

### 项目文件结构（规划）
```
feishuindex/
├── manifest.json           # MV3配置
├── popup/                 # 弹窗界面
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/               # 配置页面
│   ├── options.html
│   ├── options.js
│   └── options.css
├── background/            # Service Worker
│   └── background.js
├── lib/                   # 核心逻辑库
│   ├── feishu-api.js      # API封装
│   ├── storage.js         # 加密存储
│   └── field-mapper.js    # 字段映射逻辑
├── tests/                 # 测试文件
└── dist/                  # 构建输出
```

### 开发命令（待实现）
```bash
# 当前项目处于设计阶段，代码结构待实现
# 预期的开发命令：

# 开发模式（自动重新构建）
npm run dev

# 生产构建
npm run build

# 加载扩展到Chrome
# 1. 访问 chrome://extensions/
# 2. 开启"开发者模式"
# 3. 点击"加载已解压的扩展程序"
# 4. 选择 dist/ 目录
```

## 调试指南

### 1. 连通性测试实现要点
```javascript
// 在options页面实现一键测试
async function testConnection() {
  try {
    // 1. Token验证
    const token = await getTenantToken();

    // 2. URL解析验证
    const { app_token, table_id } = parseTableUrl(tableUrl);

    // 3. 权限和字段验证
    const fields = await getTableFields(app_token, table_id);

    return { status: 'success', message: '连接正常' };
  } catch (error) {
    return {
      status: 'error',
      message: ERROR_MAPPING[error.code] || error.message
    };
  }
}
```

### 2. 错误调试要点
- Chrome DevTools Console查看Service Worker日志
- 网络面板检查API调用状态
- 扩展页面右键"检查"查看后台脚本
- 存储面板检查Chrome storage数据

## 安全要求

### Manifest V3关键配置
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://open.feishu.cn/*",
    "https://*.feishu.cn/*"
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; connect-src 'self' https://open.feishu.cn https://*.feishu.cn"
  }
}
```

## 核心性能指标

- **保存成功率** ≥ 98%
- **重复识别准确率** ≥ 99% (URL完全相等匹配)
- **P95保存耗时** ≤ 2s (查重除外，最大60s保护)
- **标签可用率** ≥ 95% (新增后立即可用)

## 哲学思考

"好的桥梁让两个世界感觉像一个世界。"

这个扩展的本质是"异构系统间的无缝桥接"。用户不应该感受到Chrome扩展和飞书API之间的边界。

关键设计原则：
- **透明性**：隐藏API调用的复杂性
- **动态性**：适应任意表结构，不依赖固定字段
- **可靠性**：错误自愈机制确保系统稳定
- **简洁性**：3个配置项，避免过度工程化

每一次保存操作都是一次"状态转换"：从浏览器的上下文（URL+用户输入）到飞书的数据结构。这个转换应该是原子的、可恢复的、透明的。