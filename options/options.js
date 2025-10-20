/**
 * FeishuIndex 配置页面脚本
 * 负责配置管理、连通性测试、用户交互等功能
 */

class OptionsManager {
  constructor() {
    this.initElements();
    this.bindEvents();
    this.loadExistingConfig();
  }

  /**
   * 初始化DOM元素引用
   */
  initElements() {
    // 表单元素
    this.appIdInput = document.getElementById('appId');
    this.appSecretInput = document.getElementById('appSecret');
    this.tableUrlInput = document.getElementById('tableUrl');

    // 按钮
    this.saveConfigBtn = document.getElementById('saveConfig');
    this.testConnectionBtn = document.getElementById('testConnection');
    this.clearConfigBtn = document.getElementById('clearConfig');
    this.toggleSecretBtn = document.getElementById('toggleSecret');

    // 结果显示
    this.testResultSection = document.getElementById('testResult');
    this.testResultContent = document.getElementById('testResultContent');

    // 其他
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.messageContainer = document.getElementById('messageContainer');
  }

  /**
   * 绑定事件监听器
   */
  bindEvents() {
    // 输入框变化事件
    this.appIdInput.addEventListener('input', () => this.validateForm());
    this.appSecretInput.addEventListener('input', () => this.validateForm());
    this.tableUrlInput.addEventListener('input', () => this.validateForm());

    // 按钮点击事件
    this.saveConfigBtn.addEventListener('click', () => this.saveConfig());
    this.testConnectionBtn.addEventListener('click', () => this.testConnection());
    this.clearConfigBtn.addEventListener('click', () => this.clearConfig());
    this.toggleSecretBtn.addEventListener('click', () => this.toggleSecretVisibility());

    // 表单提交事件
    document.querySelectorAll('form').forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveConfig();
      });
    });
  }

  /**
   * 验证表单完整性
   */
  validateForm() {
    const appId = this.appIdInput.value.trim();
    const appSecret = this.appSecretInput.value.trim();
    const tableUrl = this.tableUrlInput.value.trim();

    const isValid = appId && appSecret && tableUrl && this.isValidUrl(tableUrl);

    this.saveConfigBtn.disabled = !isValid;
    this.testConnectionBtn.disabled = !isValid;

    return isValid;
  }

  /**
   * 验证URL格式
   */
  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('feishu.cn');
    } catch {
      return false;
    }
  }

  /**
   * 切换密钥可见性
   */
  toggleSecretVisibility() {
    const isPassword = this.appSecretInput.type === 'password';

    if (isPassword) {
      this.appSecretInput.type = 'text';
      this.toggleSecretBtn.textContent = '🙈 隐藏';
    } else {
      this.appSecretInput.type = 'password';
      this.toggleSecretBtn.textContent = '👁 显示';
    }
  }

  /**
   * 显示加载状态
   */
  showLoading(message = '处理中...') {
    this.loadingOverlay.querySelector('p').textContent = message;
    this.loadingOverlay.classList.remove('hidden');
  }

  /**
   * 隐藏加载状态
   */
  hideLoading() {
    this.loadingOverlay.classList.add('hidden');
  }

  /**
   * 显示消息提示
   */
  showMessage(message, type = 'info') {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = message;

    this.messageContainer.appendChild(messageEl);

    // 3秒后自动移除
    setTimeout(() => {
      messageEl.remove();
    }, 3000);
  }

  /**
   * 加载现有配置
   */
  async loadExistingConfig() {
    try {
      this.showLoading('加载配置中...');

      const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });

      if (response.success) {
        const config = response.config;

        if (config.appId) {
          this.appIdInput.value = config.appId;
        }
        if (config.appSecret) {
          this.appSecretInput.value = config.appSecret;
        }
        if (config.tableUrl) {
          this.tableUrlInput.value = config.tableUrl;
        }

        this.validateForm();
        this.showMessage('配置加载成功', 'success');
      } else {
        this.showMessage('加载配置失败', 'error');
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      this.showMessage('加载配置失败', 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * 保存配置
   */
  async saveConfig() {
    if (!this.validateForm()) {
      this.showMessage('请填写完整的配置信息', 'warning');
      return;
    }

    const config = {
      appId: this.appIdInput.value.trim(),
      appSecret: this.appSecretInput.value.trim(),
      tableUrl: this.tableUrlInput.value.trim()
    };

    try {
      this.showLoading('保存配置中...');

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_CONFIG',
        config: config
      });

      if (response.success) {
        this.showMessage('配置保存成功', 'success');

        // 保存后自动测试连接
        setTimeout(() => {
          this.testConnection();
        }, 1000);
      } else {
        this.showMessage(`保存配置失败: ${response.error}`, 'error');
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      this.showMessage('保存配置失败', 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.validateForm()) {
      this.showMessage('请先完成配置', 'warning');
      return;
    }

    const config = {
      appId: this.appIdInput.value.trim(),
      appSecret: this.appSecretInput.value.trim(),
      tableUrl: this.tableUrlInput.value.trim()
    };

    try {
      this.showLoading('测试连接中...');

      const response = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        config: config
      });

      this.displayTestResult(response);

    } catch (error) {
      console.error('测试连接失败:', error);
      this.displayTestResult({
        success: false,
        message: '测试连接失败，请检查网络连接'
      });
    } finally {
      this.hideLoading();
    }
  }

  /**
   * 显示测试结果
   */
  displayTestResult(result) {
    this.testResultSection.classList.remove('hidden');

    if (result.success) {
      this.testResultContent.innerHTML = `
        <div class="test-success">
          <h4>✅ 连接测试成功！</h4>
          <p><strong>状态:</strong> ${result.message}</p>
          <p><strong>字段总数:</strong> ${result.fieldCount || 0}</p>
          <p><strong>支持的字段:</strong> ${result.supportedFields || 0}</p>
          <p><strong>不支持的字段:</strong> ${result.unsupportedFields || 0}</p>
          ${result.unsupportedFields > 0 ?
            '<p><strong>提示:</strong> 不支持的字段类型将自动跳过，不影响正常使用</p>' :
            ''
          }
        </div>
      `;
      this.showMessage('连接测试成功', 'success');
    } else {
      this.testResultContent.innerHTML = `
        <div class="test-error">
          <h4>❌ 连接测试失败</h4>
          <p><strong>错误信息:</strong> ${result.message}</p>
          <div style="margin-top: 15px;">
            <h5>可能的解决方案:</h5>
            <ul style="margin-left: 20px; margin-top: 10px;">
              <li>检查App ID和App Secret是否正确</li>
              <li>确认应用已添加"多维表格"权限</li>
              <li>确认应用已被添加为表格协作者</li>
              <li>检查表格URL是否有效</li>
              <li>检查网络连接是否正常</li>
            </ul>
          </div>
        </div>
      `;
      this.showMessage('连接测试失败', 'error');
    }

    // 滚动到测试结果
    this.testResultSection.scrollIntoView({ behavior: 'smooth' });
  }

  /**
   * 清除配置
   */
  async clearConfig() {
    if (!confirm('确定要清除所有配置吗？此操作不可撤销。')) {
      return;
    }

    try {
      this.showLoading('清除配置中...');

      // 清除本地输入
      this.appIdInput.value = '';
      this.appSecretInput.value = '';
      this.tableUrlInput.value = '';

      // 清除存储的配置
      await chrome.storage.local.remove([
        'feishu_app_id',
        'feishu_app_secret',
        'feishu_table_url',
        'feishu_config_version'
      ]);

      // 隐藏测试结果
      this.testResultSection.classList.add('hidden');

      // 更新按钮状态
      this.validateForm();

      this.showMessage('配置已清除', 'success');

    } catch (error) {
      console.error('清除配置失败:', error);
      this.showMessage('清除配置失败', 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * 获取字段信息（用于调试）
   */
  async getFieldsInfo() {
    const tableUrl = this.tableUrlInput.value.trim();
    if (!tableUrl) {
      this.showMessage('请先填写表格URL', 'warning');
      return;
    }

    try {
      this.showLoading('获取字段信息中...');

      const response = await chrome.runtime.sendMessage({
        type: 'GET_FIELDS',
        tableUrl: tableUrl
      });

      if (response.success) {
        this.displayFieldsInfo(response.fields);
      } else {
        this.showMessage(`获取字段信息失败: ${response.error}`, 'error');
      }

    } catch (error) {
      console.error('获取字段信息失败:', error);
      this.showMessage('获取字段信息失败', 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * 显示字段信息（调试用）
   */
  displayFieldsInfo(fields) {
    console.log('字段信息:', fields);

    let html = '<h4>📋 字段信息</h4>';

    if (fields.linkFields.length > 0) {
      html += '<h5>🔗 链接字段（必需）</h5>';
      html += '<ul>';
      fields.linkFields.forEach(field => {
        html += `<li><strong>${field.name}</strong> (type: ${field.originalType})</li>`;
      });
      html += '</ul>';
    }

    if (fields.textFields.length > 0) {
      html += '<h5>📝 文本字段</h5>';
      html += '<ul>';
      fields.textFields.forEach(field => {
        html += `<li><strong>${field.name}</strong> (type: ${field.originalType})</li>`;
      });
      html += '</ul>';
    }

    if (fields.singleFields.length > 0) {
      html += '<h5>🎯 单选字段</h5>';
      html += '<ul>';
      fields.singleFields.forEach(field => {
        html += `<li><strong>${field.name}</strong> (type: ${field.originalType}) - 选项: ${field.options.join(', ')}</li>`;
      });
      html += '</ul>';
    }

    if (fields.multiFields.length > 0) {
      html += '<h5>☑️ 多选字段</h5>';
      html += '<ul>';
      fields.multiFields.forEach(field => {
        html += `<li><strong>${field.name}</strong> (type: ${field.originalType}) - 选项: ${field.options.join(', ')}</li>`;
      });
      html += '</ul>';
    }

    if (fields.unsupportedFields.length > 0) {
      html += '<h5>⚠️ 不支持的字段</h5>';
      html += '<ul>';
      fields.unsupportedFields.forEach(field => {
        html += `<li><strong>${field.name}</strong> (type: ${field.type}, ui_type: ${field.ui_type})</li>`;
      });
      html += '</ul>';
    }

    // 在测试结果区域显示
    this.testResultSection.classList.remove('hidden');
    this.testResultContent.innerHTML = `<div style="background: #e8f4fd; padding: 20px; border-radius: 8px;">${html}</div>`;
    this.testResultSection.scrollIntoView({ behavior: 'smooth' });
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});

// 监听来自background script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CONFIG_UPDATED') {
    // 配置已更新，可以在这里处理UI更新
    location.reload();
  }
});