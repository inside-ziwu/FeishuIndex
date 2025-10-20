#!/bin/bash
# FeishuIndex 构建脚本
# 将源代码复制到dist目录，保持单一真实来源

echo "🚀 开始构建 FeishuIndex..."

# 创建dist目录
mkdir -p dist/lib dist/popup dist/options dist/icons

# 复制manifest
cp manifest.json dist/

# 复制background到子目录（保持manifest路径结构）
mkdir -p dist/background
cp background/background.js dist/background/

# 复制库文件
cp lib/*.js dist/lib/

# 复制UI文件
cp popup/*.* dist/popup/
cp options/*.* dist/options/
cp icons/*.* dist/icons/

# 确保执行权限
chmod +x build.sh

echo "✅ 构建完成！"
echo "📁 dist目录结构："
ls -la dist/