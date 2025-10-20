# FeishuIndex 清洁的目录结构设计

## 当前问题
- 40个JavaScript文件，大量重复
- 关键文件存在多个版本
- 路径不一致导致维护困难

## 设计原则
1. **单一真实来源** - 每个模块只存在一份
2. **清晰的目录层次** - 功能明确分离
3. **与源代码结构一致** - 便于理解和维护

## 推荐结构

```
dist/                                    # 构建输出目录
├── manifest.json                       # 扩展配置
├── background.js                       # Service Worker（从 background/ 构建）
├── lib/                                # 共享库文件
│   ├── cache-key-manager.js
│   ├── storage.js
│   ├── token-manager.js
│   ├── field-mapper.js
│   ├── feishu-api.js
│   ├── data-validator.js
│   └── error-recovery.js
├── popup/                              # 弹窗相关
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/                            # 配置页面
│   ├── options.html
│   ├── options.js
│   └── options.css
└── icons/                              # 图标资源
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 构建规则
1. **源代码为权威** - 所有修改都在源代码目录进行
2. **自动复制** - 构建脚本负责将文件复制到正确位置
3. **路径一致性** - manifest.json 中的路径与实际文件结构匹配
4. **版本同步** - 确保所有文件都是最新版本

## 清理步骤
1. 删除 dist 目录中所有重复文件
2. 保留 lib/、popup/、options/、icons/ 子目录结构
3. 将根目录重复的文件移动到对应子目录
4. 更新 manifest.json 指向正确的文件路径
5. 建立构建脚本确保一致性