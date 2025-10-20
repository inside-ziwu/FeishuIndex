/**
 * FeishuIndex 弹窗架构重构示例
 * 展示如何应用新架构组件解决现有问题
 */

/* -----------------------------------------------------------------------
 * 架构重构示例 - Linus 好品味实践
 * 1. 状态机管理所有状态转换，消除不一致状态
 * 2. 消息总线确保可靠的通信
 * 3. 数据验证器防止TypeError
 * 4. 错误恢复器提供统一的错误处理
 * ----------------------------------------------------------------------- */

// 导入架构组件
importScripts('../lib/state-machine.js');
importScripts('../lib/message-bus.js');
importScripts('../lib/data-validator.js');
importScripts('../lib/error-recovery.js');

/**
 * 重构后的弹窗管理器
 */
class RefactoredPopupManager {
  constructor() {
    // 初始化架构组件
    this.initializeComponents();

    // 基础属性
    this.currentUrl = '';
    this.currentTitle = '';
    this.fieldsData = null;
    this.userInput = {};

    // 初始化
    this.initialize();
  }

  /**
   * 初始化架构组件
   */
  initializeComponents() {
    // 获取日志器
    this.logger = globalThis.logger?.instance;

    // 初始化状态机
    this.stateMachine = new globalThis.FeishuIndexStateMachine.StateMachine(this.logger);

    // 初始化消息总线
    this.messageBus = new globalThis.FeishuIndexMessageBus.MessageBus({
      logger: this.logger
    });

    // 初始化数据验证器
    this.validator = new globalThis.FeishuIndexDataValidator.DataValidator(this.logger);

    // 初始化错误恢复管理器
    this.errorRecovery = new globalThis.FeishuIndexErrorRecovery.ErrorRecoveryManager({
      logger: this.logger
    });

    // 设置状态机事件监听器
    this.setupStateMachineListeners();
  }

  /**
   * 设置状态机监听器
   */
  setupStateMachineListeners() {
    // 状态变化时更新UI
    this.stateMachine.on(globalThis.FeishuIndexStateMachine.EVENTS.FIELDS_LOADED, (data) => {
      this.renderForm();
      this.showForm();
      this.updateStatus();
    });

    this.stateMachine.on(globalThis.FeishuIndexStateMachine.EVENTS.CONFIG_FAILED, (data) => {
      this.showError('config');
    });

    this.stateMachine.on(globalThis.FeishuIndexStateMachine.EVENTS.VALIDATION_FAILED, (data) => {
      this.showError('field', data.data.error);
    });

    this.stateMachine.on(globalThis.FeishuIndexStateMachine.EVENTS.RECOVERY_START, (data) => {
      this.setStatus('正在恢复...');
    });
  }

  /**
   * 初始化弹窗
   */
  async initialize() {
    try {
      this.stateMachine.transition(globalThis.FeishuIndexStateMachine.EVENTS.INIT);
      await this.getCurrentPageInfo();
      await this.loadConfiguration();
    } catch (error) {
      this.handleInitializationError(error);
    }
  }

  /**
   * 获取当前页面信息
   */
  async getCurrentPageInfo() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab) {
        this.currentUrl = tab.url;
        this.currentTitle = tab.title;
        this.updatePageInfoDisplay();
      }
    } catch (error) {
      throw new Error(`获取页面信息失败: ${error.message}`);
    }
  }

  /**
   * 加载配置（重构版 - 使用消息总线和状态机）
   */
  async loadConfiguration() {
    this.stateMachine.transition(globalThis.FeishuIndexStateMachine.EVENTS.CONFIG_LOADING);

    try {
      const response = await this.messageBus.sendMessage(
        globalThis.FeishuIndexMessageBus.MESSAGE_TYPES.GET_CONFIG,
        {},
        { timeout: 5000, priority: globalThis.FeishuIndexMessageBus.PRIORITY.HIGH }
      );

      if (!response.success) {
        throw new Error(response.error || '获取配置失败');
      }

      // 使用数据验证器验证配置
      const config = this.validator.validate(response.config, 'config');

      this.stateMachine.transition(
        globalThis.FeishuIndexStateMachine.EVENTS.CONFIG_LOADED,
        { config }
      );

      // 加载字段信息
      await this.loadFields(config);

    } catch (error) {
      this.stateMachine.transition(
        globalThis.FeishuIndexStateMachine.EVENTS.CONFIG_FAILED,
        { error: error.message }
      );

      // 触发错误恢复
      await this.handleError(error, { operation: 'loadConfiguration' });
    }
  }

  /**
   * 加载字段信息（重构版 - 彻底解决TypeError问题）
   */
  async loadFields(config) {
    this.stateMachine.transition(globalThis.FeishuIndexStateMachine.EVENTS.FIELDS_LOADING);

    try {
      const response = await this.messageBus.sendMessage(
        globalThis.FeishuIndexMessageBus.MESSAGE_TYPES.GET_FIELDS,
        { tableUrl: config.tableUrl },
        { timeout: 15000 }
      );

      if (!response.success) {
        throw new Error(response.error || '获取字段失败');
      }

      // 使用数据验证器验证字段数据（这是防止TypeError的关键）
      const validatedFields = this.validator.validateFieldsData(response.fields);

      // 创建防御性访问器
      this.fieldsAccessor = this.validator.createDefensiveAccessor(validatedFields);

      this.fieldsData = validatedFields;

      this.stateMachine.transition(
        globalThis.FeishuIndexStateMachine.EVENTS.FIELDS_LOADED,
        { fields: validatedFields }
      );

      // 初始化用户输入
      this.initializeUserInput();

    } catch (error) {
      this.stateMachine.transition(
        globalThis.FeishuIndexStateMachine.EVENTS.FIELDS_FAILED,
        { error: error.message }
      );

      // 触发错误恢复
      await this.handleError(error, { operation: 'loadFields' });
    }
  }

  /**
   * 渲染表单（重构版 - 使用防御性访问器）
   */
  renderForm() {
    // 使用防御性访问器，确保不会出现TypeError
    const allSupportedFields = this.fieldsAccessor.get('allSupportedFields', []);
    const fieldCount = this.fieldsAccessor.getArrayLength('allSupportedFields', 0);

    if (fieldCount === 0) {
      this.dynamicFields.innerHTML = '<div class="error-message">没有可用的字段</div>';
      return;
    }

    this.dynamicFields.innerHTML = '';

    // 安全地遍历字段
    allSupportedFields.forEach((field, index) => {
      if (field && typeof field === 'object' && field.name) {
        const fieldGroup = this.createFieldGroup(field, index);
        this.dynamicFields.appendChild(fieldGroup);
      }
    });

    // 显示不支持字段的信息
    const unsupportedFields = this.fieldsAccessor.get('unsupportedFields', []);
    const unsupportedCount = this.fieldsAccessor.getArrayLength('unsupportedFields', 0);

    if (unsupportedCount > 0) {
      const warningDiv = document.createElement('div');
      warningDiv.className = 'field-warning';
      warningDiv.innerHTML = `
        <div class="warning-text">
          ⚠️ 检测到 ${unsupportedCount} 个不支持的字段类型，将跳过处理
        </div>
      `;
      this.dynamicFields.appendChild(warningDiv);
    }
  }

  /**
   * 创建字段组（重构版 - 使用防御性访问）
   */
  createFieldGroup(field, index) {
    const group = document.createElement('div');
    group.className = 'field-group';
    group.dataset.fieldName = field.name || `field_${index}`;
    group.dataset.fieldType = field.type || 'unknown';

    // 创建标签
    const label = document.createElement('div');
    label.className = 'field-label';
    label.innerHTML = `
      <div class="field-name">
        ${field.name || '未知字段'}
        ${field.required ? '<span class="required-indicator">*</span>' : ''}
      </div>
      <div class="field-type ${field.type}">${this.getFieldTypeLabel(field.type)}</div>
    `;

    // 创建输入控件
    const inputContainer = document.createElement('div');
    inputContainer.className = 'field-input-container';

    const inputElement = this.createInputElement(field);
    inputContainer.appendChild(inputElement);

    group.appendChild(label);
    group.appendChild(inputContainer);

    return group;
  }

  /**
   * 创建输入元素（重构版 - 更好的错误处理）
   */
  createInputElement(field) {
    try {
      switch (field.type) {
        case 'link':
          return this.createUrlInput(field);
        case 'text':
          return this.createTextInput(field);
        case 'single':
          return this.createSingleSelectInput(field);
        case 'multi':
          return this.createMultiSelectInput(field);
        default:
          return this.createUnsupportedInput(field);
      }
    } catch (error) {
      // 创建错误显示元素
      const errorDiv = document.createElement('div');
      errorDiv.className = 'field-error';
      errorDiv.textContent = `创建输入控件失败: ${error.message}`;
      return errorDiv;
    }
  }

  /**
   * 创建URL输入框
   */
  createUrlInput(field) {
    const container = document.createElement('div');
    container.className = 'url-input-group';

    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'field-input url-input';
    input.name = field.name;
    input.placeholder = 'https://example.com';
    input.required = field.required || false;
    input.value = this.currentUrl;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-url-btn';
    copyBtn.textContent = '📋 复制';
    copyBtn.addEventListener('click', () => this.copyToClipboard(this.currentUrl));

    container.appendChild(input);
    container.appendChild(copyBtn);

    // 监听输入变化
    input.addEventListener('input', (e) => {
      this.userInput.url = e.target.value;
      this.validateForm();
    });

    return container;
  }

  /**
   * 创建文本输入框
   */
  createTextInput(field) {
    const input = document.createElement('textarea');
    input.className = 'field-input textarea';
    input.name = field.name;
    input.placeholder = `请输入${field.name}`;
    input.rows = 3;

    // 监听输入变化
    input.addEventListener('input', (e) => {
      this.userInput[field.name] = e.target.value;
      this.validateForm();
    });

    return input;
  }

  /**
   * 创建单选输入框
   */
  createSingleSelectInput(field) {
    const container = document.createElement('div');
    container.className = 'single-select-container';

    const select = document.createElement('select');
    select.className = 'field-input';
    select.name = field.name;

    // 添加空选项
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = `-- 请选择${field.name} --`;
    select.appendChild(emptyOption);

    // 添加现有选项
    if (field.options && Array.isArray(field.options)) {
      field.options.forEach(option => {
        if (option && typeof option === 'string') {
          const optionElement = document.createElement('option');
          optionElement.value = option;
          optionElement.textContent = option;
          select.appendChild(optionElement);
        }
      });
    }

    // 监听选择变化
    select.addEventListener('change', (e) => {
      this.userInput[field.name] = e.target.value;
      this.validateForm();
    });

    container.appendChild(select);
    return container;
  }

  /**
   * 创建多选输入框
   */
  createMultiSelectInput(field) {
    const container = document.createElement('div');
    container.className = 'multi-select-container';

    // 简化版本：只提供文本输入
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field-input multi-input';
    input.placeholder = `输入多个${field.name}，用逗号分隔`;

    input.addEventListener('blur', () => {
      const values = input.value.split(',').map(v => v.trim()).filter(v => v);
      this.userInput[field.name] = values;
      this.validateForm();
    });

    container.appendChild(input);
    return container;
  }

  /**
   * 创建不支持的输入控件
   */
  createUnsupportedInput(field) {
    const div = document.createElement('div');
    div.className = 'unsupported-field';
    div.textContent = `不支持的字段类型: ${field.type}`;
    return div;
  }

  /**
   * 初始化用户输入（重构版 - 使用防御性访问器）
   */
  initializeUserInput() {
    this.userInput = {
      url: this.currentUrl
    };

    // 安全地遍历字段
    const allSupportedFields = this.fieldsAccessor.get('allSupportedFields', []);

    allSupportedFields.forEach(field => {
      if (field && field.type && field.type !== 'link' && field.name) {
        this.userInput[field.name] = '';
      }
    });
  }

  /**
   * 验证表单（重构版 - 使用防御性访问器）
   */
  validateForm() {
    const linkFieldsCount = this.fieldsAccessor.getArrayLength('linkFields', 0);

    if (linkFieldsCount > 0) {
      const urlValue = this.userInput.url || '';
      const isValid = urlValue.trim() !== '' && this.isValidUrl(urlValue);

      this.saveBtn.disabled = !isValid;

      if (isValid) {
        this.setStatus('就绪');
      } else {
        this.setStatus('请输入有效的URL');
      }
    } else {
      this.saveBtn.disabled = true;
      this.setStatus('缺少必需字段');
    }
  }

  /**
   * 验证URL格式
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 处理表单提交（重构版 - 使用消息总线和状态机）
   */
  async handleSubmit(e) {
    e.preventDefault();

    if (!this.stateMachine.isReady()) {
      this.showMessage('系统未就绪，请稍后重试', 'warning');
      return;
    }

    if (!this.validateForm()) {
      this.showMessage('请检查输入内容', 'warning');
      return;
    }

    this.stateMachine.transition(globalThis.FeishuIndexStateMachine.EVENTS.SUBMIT);

    try {
      const response = await this.messageBus.sendMessage(
        globalThis.FeishuIndexMessageBus.MESSAGE_TYPES.SAVE_RECORD,
        { userInput: this.userInput },
        { timeout: 30000 }
      );

      if (response.success) {
        this.stateMachine.transition(
          globalThis.FeishuIndexStateMachine.EVENTS.SUBMIT_SUCCESS,
          { response }
        );

        if (response.action === 'update') {
          this.showConfirmDialog(response);
        } else {
          this.showMessage('记录保存成功', 'success');
          this.resetForm();
        }
      } else {
        this.stateMachine.transition(
          globalThis.FeishuIndexStateMachine.EVENTS.SUBMIT_FAILED,
          { error: response.error }
        );

        this.showMessage(response.error, 'error');

        // 检查是否需要刷新字段
        if (response.requiresFieldRefresh) {
          setTimeout(() => {
            this.loadConfiguration();
          }, 2000);
        }
      }
    } catch (error) {
      this.stateMachine.transition(
        globalThis.FeishuIndexStateMachine.EVENTS.SUBMIT_FAILED,
        { error: error.message }
      );

      await this.handleError(error, { operation: 'handleSubmit' });
    }
  }

  /**
   * 统一错误处理（重构版 - 使用错误恢复管理器）
   */
  async handleError(error, context = {}) {
    if (this.logger) {
      this.logger.error('POPUP_ERROR', `弹窗错误: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        context,
        currentState: this.stateMachine.getState()
      }, { category: 'popup_error' });
    }

    const recoveryContext = {
      ...context,
      retryFunction: context.retryFunction,
      clearFieldCache: async () => {
        await this.messageBus.sendMessage(
          globalThis.FeishuIndexMessageBus.MESSAGE_TYPES.CLEAR_CACHE,
          { tableUrl: this.currentConfig?.tableUrl }
        );
      },
      reloadConfig: () => this.loadConfiguration(),
      resetState: () => {
        this.stateMachine.reset();
        this.fieldsData = null;
        this.fieldsAccessor = null;
      },
      showMessage: (message, type) => this.showMessage(message, type),
      requestUserIntervention: async (error) => {
        this.showMessage(error.message, 'error');
        return { action: 'user_notified' };
      }
    };

    try {
      const recoveryResult = await this.errorRecovery.recover(error, recoveryContext);

      if (recoveryResult.success) {
        this.showMessage(`错误已自动修复 (${recoveryResult.strategy})`, 'success');

        // 根据恢复策略决定后续操作
        if (recoveryResult.strategy === 'clear_cache' || recoveryResult.strategy === 'reload_config') {
          await this.loadConfiguration();
        }
      } else {
        this.showMessage(`错误修复失败: ${recoveryResult.error}`, 'error');
        this.stateMachine.transition(
          globalThis.FeishuIndexStateMachine.EVENTS.RECOVERY_FAILED,
          { error: recoveryResult.error }
        );
      }
    } catch (recoveryError) {
      this.showMessage(`错误恢复过程失败: ${recoveryError.message}`, 'error');
      this.stateMachine.transition(
        globalThis.FeishuIndexStateMachine.EVENTS.RECOVERY_FAILED,
        { error: recoveryError.message }
      );
    }
  }

  /**
   * 其他辅助方法
   */
  updatePageInfoDisplay() {
    if (this.pageTitle) {
      this.pageTitle.textContent = this.truncateText(this.currentTitle, 50);
    }
    if (this.pageUrl) {
      this.pageUrl.textContent = this.truncateText(this.currentUrl, 60);
    }
  }

  updateStatus() {
    if (this.statusText && this.fieldsAccessor) {
      const supportedCount = this.fieldsAccessor.getArrayLength('allSupportedFields', 0);
      const unsupportedCount = this.fieldsAccessor.getArrayLength('unsupportedFields', 0);

      let statusText = `${supportedCount} 个字段`;
      if (unsupportedCount > 0) {
        statusText += ` (${unsupportedCount} 个不支持)`;
      }

      this.statusText.textContent = statusText;
    }
  }

  setStatus(text) {
    if (this.statusText) {
      this.statusText.textContent = text;
    }
  }

  showMessage(message, type = 'info') {
    // 实现消息显示逻辑
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  showError(type, message = '') {
    // 实现错误显示逻辑
    console.error(`ERROR (${type}): ${message}`);
  }

  showForm() {
    // 实现表单显示逻辑
    console.log('显示表单');
  }

  showConfirmDialog(response) {
    // 实现确认对话框逻辑
    console.log('显示确认对话框', response);
  }

  resetForm() {
    this.initializeUserInput();
    this.validateForm();
    this.setStatus('就绪');
  }

  getFieldTypeLabel(type) {
    const labels = {
      'link': '链接',
      'text': '文本',
      'single': '单选',
      'multi': '多选'
    };
    return labels[type] || type;
  }

  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showMessage('已复制到剪贴板', 'success');
    } catch (error) {
      this.showMessage('复制失败', 'error');
    }
  }

  /**
   * 处理初始化错误
   */
  handleInitializationError(error) {
    console.error('PopupManager 初始化失败:', error);
    this.showMessage(`初始化失败: ${error.message}`, 'error');

    // 显示基本错误页面
    document.body.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #f44336;">
        <h3>扩展初始化失败</h3>
        <p>错误信息: ${error.message}</p>
        <p>请尝试重新加载扩展或刷新页面</p>
        <button onclick="window.location.reload()" style="
          padding: 8px 16px;
          background: #2196F3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        ">刷新页面</button>
      </div>
    `;
  }

  /**
   * 导出调试信息
   */
  exportDebugInfo() {
    return {
      stateMachine: this.stateMachine.exportDebugInfo(),
      messageBus: this.messageBus.exportDebugInfo(),
      errorRecovery: this.errorRecovery.exportDebugInfo(),
      currentState: this.stateMachine.getState(),
      hasFieldsData: !!this.fieldsData,
      fieldsAccessorExists: !!this.fieldsAccessor,
      timestamp: Date.now()
    };
  }
}

// 使用重构后的管理器
window.addEventListener('DOMContentLoaded', () => {
  try {
    window.popupManager = new RefactoredPopupManager();
  } catch (error) {
    console.error('重构后的PopupManager创建失败:', error);
  }
});