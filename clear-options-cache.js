/**
 * 清理选项缓存脚本
 * 只清理单选/多选字段的选项缓存，保留字段列表缓存
 * 然后重新获取选项缓存
 */

// 模拟PopupManager实例调用
async function clearOptionsCache() {
  console.log('🔄 开始清理选项缓存...');

  try {
    // 1. 获取配置
    const configResponse = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (!configResponse.success) {
      throw new Error('获取配置失败');
    }

    console.log('✅ 配置获取成功');

    // 2. 只清理选项缓存，保留字段列表缓存
    await chrome.runtime.sendMessage({
      type: 'CLEAR_OPTIONS_CACHE',
      tableUrl: configResponse.config.tableUrl
    });

    console.log('✅ 选项缓存清理完成');

    // 3. 重新加载字段（会重新获取选项）
    const popupManager = new PopupManager();
    await popupManager.loadFields();

    console.log('✅ 字段和选项重新加载完成');
    console.log('🎉 选项缓存刷新成功！');

  } catch (error) {
    console.error('❌ 清理选项缓存失败:', error);
  }
}

// 如果在popup环境中，可以直接调用
if (typeof PopupManager !== 'undefined') {
  // 在popup控制台中执行
  const popup = PopupManager.instance;
  if (popup) {
    popup.refreshOptionsCache();
  }
} else {
  // 在background控制台中执行
  clearOptionsCache();
}

console.log('📝 使用说明：');
console.log('1. 在popup控制台执行：PopupManager.instance.refreshOptionsCache()');
console.log('2. 或者在background控制台执行这个脚本');
console.log('3. 这将只清理选项缓存，保留字段列表缓存，然后重新获取选项');