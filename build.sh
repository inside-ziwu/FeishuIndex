#!/bin/bash
# FeishuIndex 构建脚本
# 将源代码复制到dist目录，保持单一真实来源

set -e  # 遇到错误立即退出

echo "🚀 开始构建 FeishuIndex..."

# 清理旧的构建产物
echo "🧹 清理旧的构建产物..."
rm -rf dist/
echo "✅ 清理完成"

# 创建dist目录结构
echo "📁 创建目录结构..."
mkdir -p dist/lib dist/popup dist/options dist/icons dist/background

# 复制核心配置文件
echo "📋 复制配置文件..."
cp manifest.json dist/
echo "  ✓ manifest.json"

# 复制后台脚本
echo "🚀 复制后台脚本..."
cp background/background.js dist/background/
echo "  ✓ background.js"

# 复制库文件
echo "🔧 复制核心库文件..."
for file in lib/*.js; do
    cp "$file" dist/lib/
    echo "  ✓ $(basename "$file")"
done

# 复制UI文件
echo "🎨 复制界面文件..."
cp popup/*.* dist/popup/
echo "  ✓ popup files"
cp options/*.* dist/options/
echo "  ✓ options files"
cp icons/*.* dist/icons/
echo "  ✓ icons files"

# 确保执行权限
echo "🔐 设置执行权限..."
chmod +x build.sh

# 显示构建结果
echo ""
echo "🎉 构建完成！"
echo "📁 dist目录结构："
tree dist/ 2>/dev/null || find dist/ -type f | sort

# 显示构建统计
echo ""
echo "📊 构建统计："
echo "  总文件数: $(find dist/ -type f | wc -l | tr -d ' ')"
echo "  总大小: $(du -sh dist/ | cut -f1)"
echo ""