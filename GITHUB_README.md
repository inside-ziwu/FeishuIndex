# 🚀 FeishuIndex Chrome扩展

<div align="center">

![FeishuIndex Logo](icons/icon128.png)

**网页URL到飞书多维表格的智能桥梁**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

## ✨ 核心功能

- 🎯 **一键保存**: 任意网页URL快速保存到飞书多维表格
- 🔧 **动态适配**: 支持任意表结构，无需固定字段配置
- 🔄 **智能查重**: URL完全相等匹配，避免重复记录
- 🛡️ **错误自愈**: 字段结构变更时自动重建UI
- ⚡ **实时响应**: P95保存耗时 ≤ 2秒

## 🏗️ 技术架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   用户界面层     │    │   业务逻辑层     │    │   飞书API层     │
│                │    │                │    │                │
│ • popup.html    │───▶│ • background.js │───▶│ • open.feishu.cn│
│ • 动态表单(4种)  │    │ • 字段缓存      │    │ • tenant_token  │
│ • 标签选择器     │    │ • URL查重算法   │    │ • 记录CRUD      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📋 支持的字段类型

| 类型 | 用途 | 示例 |
|------|------|------|
| 🔗 **链接** | 必需字段，保存URL | "网址"、"链接" |
| 📝 **文本** | 可选，保存标题备注 | "标题"、"备注" |
| 🏷️ **单选** | 可选，标签分类 | "重要性"、"类型" |
| 🏷️ **多选** | 可选，多标签分类 | "标签"、"分类" |

## 🚀 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/your-username/FeishuIndex.git
cd FeishuIndex
```

### 2. 安装扩展
1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `dist/` 目录

### 3. 配置飞书应用
1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建应用并获取 App ID & Secret
3. 配置权限：`bitable:app` 和 `bitable:app_record`
4. 在扩展选项中填入配置信息

📖 **详细安装指南**: 查看 [INSTALL.md](INSTALL.md)

## 📊 性能指标

- ✅ **保存成功率**: ≥ 98%
- 🎯 **查重准确率**: ≥ 99%
- ⚡ **响应速度**: P95 ≤ 2秒
- 🔄 **并发支持**: 1秒内多次操作

## 📁 项目结构

```
FeishuIndex/
├── 📂 dist/              # 生产构建
├── 📂 background/        # Service Worker
├── 📂 popup/            # 用户界面
├── 📂 lib/              # 核心库
├── 📂 options/          # 配置页面
├── 📂 icons/            # 图标资源
├── 📄 manifest.json     # 扩展清单
└── 📄 INSTALL.md        # 详细安装说明
```

## 🔧 开发环境

### 技术栈
- **前端**: 原生 JavaScript + CSS3
- **扩展**: Manifest V3 + Service Worker
- **API**: 飞书开放平台 REST API
- **存储**: Chrome Storage API (加密)

### 本地开发
```bash
# 修改源码后重新构建
cp background/background.js dist/background/
cp popup/* dist/popup/
cp lib/* dist/lib/
cp options/* dist/options/

# 重新加载扩展
# chrome://extensions/ → 点击刷新按钮
```

## 🛡️ 安全特性

- 🔒 **数据加密**: 本地配置加密存储
- 🌐 **官方API**: 仅访问飞书官方接口
- 🚫 **隐私保护**: 不收集用户个人信息
- 🔍 **开源透明**: 代码完全开源可审计

## 📈 使用场景

- 📚 **研究资料收集**: 保存学术论文、技术文档链接
- 🛒 **产品比价**: 收集电商产品链接进行对比
- 📰 **内容创作**: 整理灵感来源和参考资料
- 🏢 **团队协作**: 共享有价值的工作资源链接

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📝 更新日志

### v1.0.0 (2024-10-20)
- ✨ 首次发布
- 🎯 核心功能实现
- 🛡️ 完整的错误处理机制
- 📊 性能监控和可观测性

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 📞 联系方式

- 🐛 **问题反馈**: [GitHub Issues](https://github.com/your-username/FeishuIndex/issues)
- 📧 **邮箱**: your-email@example.com
- 📖 **文档**: [完整技术方案](FeishuIndex完整技术方案.md)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个 Star！**

Made with ❤️ by [Your Name](https://github.com/your-username)

</div>