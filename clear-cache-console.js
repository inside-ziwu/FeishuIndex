/**
 * Chrome扩展控制台缓存清理脚本
 * 在Chrome开发者工具控制台中运行
 */

console.log('🔄 开始清理选项缓存...');

// 方法1：直接调用popup实例方法
if (typeof PopupManager !== 'undefined' && PopupManager.instance) {
  console.log('✅ 找到PopupManager实例，使用方法1');
  PopupManager.instance.refreshOptionsCache();
}
// 方法2：通过消息传递调用background
else if (typeof chrome !== 'undefined' && chrome.runtime) {
  console.log('✅ 找到chrome.runtime，使用方法2');

  chrome.runtime.sendMessage({ type: 'GET_CONFIG' })
    .then(configResponse => {
      if (!configResponse.success) {
        throw new Error('获取配置失败');
      }

      console.log('✅ 配置获取成功，开始清理选项缓存...');

      return chrome.runtime.sendMessage({
        type: 'CLEAR_OPTIONS_CACHE',
        tableUrl: configResponse.config.tableUrl
      });
    })
    .then(() => {
      console.log('✅ 选项缓存清理完成！');
      console.log('🎉 请刷新扩展popup以重新获取选项');
    })
    .catch(error => {
      console.error('❌ 清理失败:', error);
    });
}
// 方法3：手动清理storage
else if (typeof chrome !== 'undefined' && chrome.storage) {
  console.log('✅ 找到chrome.storage，使用方法3');

  // 直接清理选项缓存
  chrome.storage.local.get(null, (items) => {
    const keysToRemove = Object.keys(items).filter(key =>
      key.startsWith('feishu_options_cache_')
    );

    console.log(`🗑️ 找到${keysToRemove.length}个选项缓存键:`, keysToRemove);

    chrome.storage.local.remove(keysToRemove, () => {
      console.log('✅ 选项缓存清理完成！');
      console.log('🎉 请刷新扩展popup以重新获取选项');
    });
  });
}
else {
  console.log('❌ 未找到Chrome扩展API环境');
  console.log('📝 请在以下环境中运行：');
  console.log('1. 扩展popup的右键 → 检查 → 控制台');
  console.log('2. 扩展background的右键 → 检查 → 控制台');
  console.log('3. 或者直接在popup控制台执行：');
  console.log('   PopupManager.instance.refreshOptionsCache()');
}

console.log('📝 手动清理方法：');
console.log('如果上述方法都不行，请打开popup控制台，执行：');
console.log('PopupManager.instance.refreshOptionsCache()');