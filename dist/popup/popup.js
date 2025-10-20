/**
 * FeishuIndex 弹窗脚本
 * 负责动态表单渲染、用户交互、数据保存等核心功能
 */

class PopupManager {
  constructor() {
    // 防止重复初始化
    if (PopupManager.instance) {
      console.warn('PopupManager 已存在实例，跳过重复初始化');
      return PopupManager.instance;
    }
    PopupManager.instance = this;

    this.currentUrl = '';
    this.currentTitle = '';
    this.fieldsData = null;
    this.userInput = {};
    this.isSubmitting = false;
    this.isInitialized = false;

    this.initElements();
    this.bindEvents();
    this.init();
  }

  /**
   * 初始化DOM元素引用
   */
  initElements() {
    // 状态容器
    this.loadingState = document.getElementById('loadingState');
    this.configErrorState = document.getElementById('configErrorState');
    this.fieldErrorState = document.getElementById('fieldErrorState');
    this.formContent = document.getElementById('formContent');

    // 页面信息已在新设计中移除
    // this.pageTitle = document.getElementById('pageTitle');
    // this.pageUrl = document.getElementById('pageUrl');

    // 表单元素
    this.dynamicFields = document.getElementById('dynamicFields');
    this.saveForm = document.getElementById('saveForm');
    this.saveBtn = document.getElementById('saveBtn');
    // resetBtn 已在新设计中移除

    // 按钮
    this.openConfigBtn = document.getElementById('openConfigBtn');
    this.refreshFieldsBtn = document.getElementById('refreshFieldsBtn');
    this.openOptionsBtn = document.getElementById('openOptionsBtn');

    // 确认对话框
    this.confirmDialog = document.getElementById('confirmDialog');
    this.confirmUpdateBtn = document.getElementById('confirmUpdateBtn');
    this.cancelUpdateBtn = document.getElementById('cancelUpdateBtn');
    this.closeConfirmBtn = document.getElementById('closeConfirmBtn');

    // 消息容器
    this.messageContainer = document.getElementById('messageContainer');

    // 状态信息
    this.statusText = document.getElementById('statusText');
    // fieldCount 已在新设计中移除

    // 状态元素引用（现在只在底部显示）
    this.statusDot = document.querySelector('.status-dot');
  }

  /**
   * 绑定事件监听器
   */
  bindEvents() {
    // 表单事件
    this.saveForm.addEventListener('submit', (e) => this.handleSubmit(e));
    // resetBtn 已在新设计中移除

    // 按钮事件
    this.openConfigBtn.addEventListener('click', () => this.openConfig());
    this.refreshFieldsBtn.addEventListener('click', () => this.refreshFields());
    this.openOptionsBtn.addEventListener('click', () => this.openOptions());

    // 确认对话框事件
    this.confirmUpdateBtn.addEventListener('click', () => this.confirmUpdate());
    this.cancelUpdateBtn.addEventListener('click', () => this.closeConfirmDialog());
    this.closeConfirmBtn.addEventListener('click', () => this.closeConfirmDialog());

    // 对话框背景点击关闭
    this.confirmDialog.addEventListener('click', (e) => {
      if (e.target === this.confirmDialog) {
        this.closeConfirmDialog();
      }
    });

    // 监听来自background的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'FIELDS_REFRESHED') {
        this.loadFields();
      }
    });
  }

  /**
   * 初始化弹窗
   */
  async init() {
    // 防止重复初始化
    if (this.isInitialized) {
      console.log('PopupManager 已初始化，跳过重复执行');
      return;
    }

    try {
      this.isInitialized = true;
      console.log('🚀 PopupManager 开始初始化');

      // 获取当前页面信息
      await this.getCurrentPageInfo();

      // 加载配置和字段
      await this.loadFields();

      console.log('✅ PopupManager 初始化完成');

    } catch (error) {
      console.error('初始化失败:', error);
      this.showMessage('初始化失败', 'error');
      this.showError('config');
      this.isInitialized = false; // 重置状态，允许重试
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

        // 提取页面描述信息
        this.currentDescription = await this.extractPageDescription(tab.id);

        console.log(`📄 页面信息提取 - 标题: ${this.currentTitle}, 描述: ${this.currentDescription?.substring(0, 50)}...`);
      }
    } catch (error) {
      console.error('获取页面信息失败:', error);
      this.currentUrl = '';
      this.currentTitle = '未知页面';
      this.currentDescription = '';
    }
  }

  /**
   * 提取页面描述信息
   * @param {number} tabId - 标签页ID
   * @returns {Promise<string>} - 页面描述
   */
  async extractPageDescription(tabId) {
    try {
      // 在页面中执行脚本获取meta信息
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // 优先级：og:description > meta description > 第一个p标签内容
          const getMetaContent = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.getAttribute('content') : null;
          };

          // 1. 尝试获取og:description
          let description = getMetaContent('meta[property="og:description"]');

          // 2. 尝试获取meta name="description"
          if (!description) {
            description = getMetaContent('meta[name="description"]');
          }

          // 3. 尝试获取第一个有意义的p标签
          if (!description) {
            const paragraphs = document.querySelectorAll('p');
            for (let p of paragraphs) {
              const text = p.textContent?.trim();
              if (text && text.length > 20 && text.length < 200) {
                description = text;
                break;
              }
            }
          }

          return description || '';
        }
      });

      return results[0]?.result || '';
    } catch (error) {
      console.warn('提取页面描述失败:', error);
      return '';
    }
  }

  /**
   * 加载字段信息
   */
  async loadFields() {
    // 防止重复加载
    if (this.isLoadingFields) {
      console.log('⏳ 字段正在加载中，跳过重复请求');
      return;
    }

    try {
      this.isLoadingFields = true;
      this.showLoading();
      this.setStatus('加载字段中...');
      console.log('📋 开始加载字段信息');

      // 获取配置
      const configResponse = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });

      if (!configResponse.success) {
        throw new Error('获取配置失败');
      }

      const config = configResponse.config;

      // 检查配置完整性
      if (!config.appId || !config.appSecret || !config.tableUrl) {
        this.showError('config');
        return;
      }

      // 获取字段信息（增加重试机制）
      let fieldsResponse;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          fieldsResponse = await chrome.runtime.sendMessage({
            type: 'GET_FIELDS',
            tableUrl: config.tableUrl
          });
          break;
        } catch (error) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw error;
          }
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
        }
      }

      // 多层验证字段数据
      console.log('🔍 字段响应数据:', fieldsResponse);

      if (!fieldsResponse || !fieldsResponse.success) {
        console.log('❌ 字段响应无效:', fieldsResponse);
        throw new Error(fieldsResponse?.error || '获取字段失败');
      }

      console.log('🔍 传递给验证的字段数据:', fieldsResponse.fields);
      console.log('🔍 字段数据类型:', typeof fieldsResponse.fields);
      console.log('🔍 字段数据是否为null:', fieldsResponse.fields === null);
      console.log('🔍 字段数据是否为undefined:', fieldsResponse.fields === undefined);

      // 验证字段数据结构
      const fieldValidation = this.validateFieldsData(fieldsResponse.fields);
      if (!fieldValidation.valid) {
        console.log('❌ 字段数据验证失败:', fieldValidation);
        throw new Error(fieldValidation.error);
      }

      this.fieldsData = fieldValidation.data;

      // 验证必需字段（增强版防御性检查）
      if (!Array.isArray(this.fieldsData.linkFields) || this.fieldsData.linkFields.length === 0) {
        this.showError('field', '请先在表中新建链接列');
        return;
      }

      // 渲染表单
      this.renderForm();
      this.showForm();

      // 验证表单并更新状态
      this.validateForm();

      // 更新状态
      this.updateStatus();
      this.showMessage('字段加载完成', 'success');

    } catch (error) {
      console.error('加载字段失败:', error);
      this.showMessage(`加载字段失败: ${error.message}`, 'error');

      // 根据错误类型显示不同的错误状态
      if (error.message.includes('配置') || error.message.includes('权限')) {
        this.showError('config');
      } else {
        this.showError('field', error.message);
      }
    } finally {
      this.isLoadingFields = false;
      console.log('📋 字段加载完成，状态已重置');
    }
  }

  /**
   * 验证字段数据结构的完整性
   * @param {any} data - 待验证的数据
   * @returns {Object} - 验证结果
   */
  validateFieldsData(data) {
    // 基础空值检查
    if (!data || typeof data !== 'object') {
      return {
        valid: false,
        error: '字段数据为空或不是对象',
        data: null
      };
    }

    // 检查必需的属性
    const requiredProps = ['linkFields', 'textFields', 'singleFields', 'multiFields', 'allSupportedFields'];
    for (const prop of requiredProps) {
      if (!(prop in data)) {
        return {
          valid: false,
          error: `字段数据缺少必需属性: ${prop}`,
          data: null
        };
      }

      if (!Array.isArray(data[prop])) {
        return {
          valid: false,
          error: `字段属性 ${prop} 不是数组类型`,
          data: null
        };
      }
    }

    // 检查链接字段（必需字段）
    if (!Array.isArray(data.linkFields) || data.linkFields.length === 0) {
      return {
        valid: false,
        error: '没有找到链接字段，请先在表中新建链接列',
        data: null
      };
    }

    // 数据结构验证通过 - 返回原始数据
    return {
      valid: true,
      error: null,
      data: data // 重要：必须返回原始数据
    };
  }

  /**
   * 渲染动态表单
   */
  renderForm() {
    this.dynamicFields.innerHTML = '';

    // 防御性检查：确保字段数据存在
    if (!this.fieldsData || !this.fieldsData.allSupportedFields) {
      this.dynamicFields.innerHTML = '<div class="error-message">字段数据异常，请刷新重试</div>';
      return;
    }

    // 按原始顺序渲染字段
    this.fieldsData.allSupportedFields.forEach((field, index) => {
      const fieldGroup = this.createFieldGroup(field, index);
      this.dynamicFields.appendChild(fieldGroup);
    });

    // 显示不支持字段的信息
    if (this.fieldsData.unsupportedFields.length > 0) {
      const warningDiv = document.createElement('div');
      warningDiv.className = 'field-warning';
      warningDiv.innerHTML = `
        <div class="warning-text">
          ⚠️ 检测到 ${this.fieldsData.unsupportedFields.length} 个不支持的字段类型，将跳过处理
        </div>
      `;
      this.dynamicFields.appendChild(warningDiv);
    }

    // 初始化用户输入
    this.initializeUserInput();
  }

  /**
   * 创建字段组
   */
  createFieldGroup(field, index) {
    const group = document.createElement('div');
    group.className = 'field-group';
    group.dataset.fieldName = field.name;
    group.dataset.fieldType = field.type;

    // 创建标签
    const label = document.createElement('div');
    label.className = 'field-label';
    label.innerHTML = `
      <div class="field-name">
        ${field.name}
        ${field.required ? '<span class="required-indicator">*</span>' : ''}
      </div>
    `;

    // 创建输入控件
    const inputContainer = document.createElement('div');
    inputContainer.className = 'field-input-container';

    const inputElement = this.createInputElement(field, index);
    inputContainer.appendChild(inputElement);

    group.appendChild(label);
    group.appendChild(inputContainer);

    return group;
  }

  /**
   * 创建输入元素
   */
  createInputElement(field, index) {
    switch (field.type) {
      case 'link':
        return this.createUrlInput(field);
      case 'text':
        return this.createTextInput(field, index);
      case 'single':
        return this.createSingleSelectInput(field);
      case 'multi':
        return this.createMultiSelectInput(field);
      default:
        return document.createElement('div');
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
    input.required = field.required;
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
  createTextInput(field, fieldIndex) {
    // 找出当前字段在所有文本字段中的顺序
    const textFieldsBeforeCurrent = this.fieldsData.allSupportedFields
      .slice(0, fieldIndex)
      .filter(f => f.type === 'text');

    const isFirstTextField = textFieldsBeforeCurrent.length === 0;

    // 调试信息
    console.log(`🔍 创建文本字段: ${field.name}, 字段索引: ${fieldIndex}, 前面文本字段数: ${textFieldsBeforeCurrent.length}, 是否为第一个文本: ${isFirstTextField}`);

    let input;

    if (isFirstTextField) {
      // 第一个文本字段使用单行输入框
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'field-input text-input';
      input.placeholder = `请输入${field.name}`;

      // 默认填充页面信息（标题优先，有描述时组合）
      const defaultValue = this.getDefaultPageValue();
      if (defaultValue) {
        input.value = defaultValue;
        this.userInput[field.name] = defaultValue;
        console.log(`✅ 第一个文本字段 "${field.name}" 已填充默认值: ${defaultValue.substring(0, 50)}...`);
      }
    } else {
      // 其他文本字段使用多行文本框
      input = document.createElement('textarea');
      input.className = 'field-input textarea';
      input.placeholder = `请输入${field.name}`;
      input.rows = 3;
    }

    // 监听输入变化
    input.addEventListener('input', (e) => {
      this.userInput[field.name] = e.target.value;
      this.validateForm();
    });

    return input;
  }

  /**
   * 获取默认页面值
   * @returns {string} - 默认填充的页面信息
   */
  getDefaultPageValue() {
    // 优先使用标题，如果有描述则组合
    if (this.currentTitle) {
      if (this.currentDescription && this.currentDescription !== this.currentTitle) {
        // 标题和描述都存在且不同时，组合显示
        return `${this.currentTitle} - ${this.currentDescription}`;
      } else {
        // 只有标题或描述与标题相同时，只显示标题
        return this.currentTitle;
      }
    } else if (this.currentDescription) {
      // 没有标题但有描述时，使用描述
      return this.currentDescription;
    }

    return '';
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
    if (field.options && field.options.length > 0) {
      field.options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        select.appendChild(optionElement);
      });
    }

    // 添加输入新选项的功能
    const inputGroup = document.createElement('div');
    inputGroup.className = 'new-option-input';
    inputGroup.style.display = 'none';

    const newOptionInput = document.createElement('input');
    newOptionInput.type = 'text';
    newOptionInput.className = 'field-input';
    newOptionInput.placeholder = `输入新的${field.name}`;

    const addOptionBtn = document.createElement('button');
    addOptionBtn.type = 'button';
    addOptionBtn.className = 'btn btn-secondary';
    addOptionBtn.textContent = '添加';
    addOptionBtn.style.marginTop = '8px';

    // 切换到输入新选项模式
    const toggleNewOption = document.createElement('button');
    toggleNewOption.type = 'button';
    toggleNewOption.className = 'toggle-new-option';
    toggleNewOption.textContent = '+ 新增选项';
    toggleNewOption.style.cssText = 'margin-top: 8px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa; cursor: pointer; font-size: 0.8em;';

    toggleNewOption.addEventListener('click', () => {
      inputGroup.style.display = inputGroup.style.display === 'none' ? 'block' : 'none';
      if (inputGroup.style.display === 'block') {
        newOptionInput.focus();
      }
    });

    // 添加新选项
    addOptionBtn.addEventListener('click', () => {
      const newOption = newOptionInput.value.trim();
      if (newOption) {
        // 检查是否已存在
        const existingOption = Array.from(select.options).find(option => option.value === newOption);
        if (!existingOption) {
          const newOptionElement = document.createElement('option');
          newOptionElement.value = newOption;
          newOptionElement.textContent = newOption;
          select.appendChild(newOptionElement);
        }

        select.value = newOption;
        this.userInput[field.name] = newOption;
        newOptionInput.value = '';
        inputGroup.style.display = 'none';
        this.validateForm();
      }
    });

    // 监听选择变化
    select.addEventListener('change', (e) => {
      this.userInput[field.name] = e.target.value;
      this.validateForm();
    });

    container.appendChild(select);
    container.appendChild(toggleNewOption);

    inputGroup.appendChild(newOptionInput);
    inputGroup.appendChild(addOptionBtn);
    container.appendChild(inputGroup);

    return container;
  }

  /**
   * 创建多选输入框
   */
  createMultiSelectInput(field) {
    const container = document.createElement('div');
    container.className = 'multi-select-container';

    // 复选框组
    const checkboxGroup = document.createElement('div');
    checkboxGroup.className = 'checkbox-group';

    if (field.options && field.options.length > 0) {
      field.options.forEach(option => {
        const item = document.createElement('div');
        item.className = 'checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `checkbox_${field.name}_${option}`;
        checkbox.value = option;

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = option;

        item.appendChild(checkbox);
        item.appendChild(label);
        checkboxGroup.appendChild(item);

        // 监听选择变化
        checkbox.addEventListener('change', () => {
          this.updateMultiSelectValue(field);
          this.validateForm();
        });
      });
    }

    // 批量输入新选项
    const multiInput = document.createElement('input');
    multiInput.type = 'text';
    multiInput.className = 'field-input multi-input';
    multiInput.placeholder = `输入多个${field.name}，用逗号分隔`;

    multiInput.addEventListener('blur', () => {
      this.processMultiSelectInput(field, multiInput.value);
      multiInput.value = '';
    });

    multiInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.processMultiSelectInput(field, multiInput.value);
        multiInput.value = '';
      }
    });

    container.appendChild(checkboxGroup);
    container.appendChild(multiInput);

    return container;
  }

  /**
   * 更新多选字段的值
   */
  updateMultiSelectValue(field) {
    const checkboxes = this.dynamicFields.querySelectorAll(
      `input[type="checkbox"][id^="checkbox_${field.name}_"]`
    );

    const selectedValues = Array.from(checkboxes)
      .filter(checkbox => checkbox.checked)
      .map(checkbox => checkbox.value);

    this.userInput[field.name] = selectedValues;
  }

  /**
   * 处理多选输入
   */
  processMultiSelectInput(field, inputValue) {
    if (!inputValue.trim()) return;

    const newOptions = inputValue
      .split(',')
      .map(option => option.trim())
      .filter(option => option.length > 0);

    if (newOptions.length === 0) return;

    // 获取当前的复选框组
    const checkboxGroup = this.dynamicFields.querySelector(
      `input[type="checkbox"][id^="checkbox_${field.name}_"]`
    )?.parentElement.parentElement;

    if (!checkboxGroup) return;

    newOptions.forEach(newOption => {
      // 检查是否已存在
      const existingCheckbox = checkboxGroup.querySelector(
        `input[value="${newOption}"]`
      );

      if (!existingCheckbox) {
        // 创建新的复选框
        const item = document.createElement('div');
        item.className = 'checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `checkbox_${field.name}_${newOption}`;
        checkbox.value = newOption;
        checkbox.checked = true;

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = newOption;

        item.appendChild(checkbox);
        item.appendChild(label);
        checkboxGroup.appendChild(item);

        // 监听变化
        checkbox.addEventListener('change', () => {
          this.updateMultiSelectValue(field);
          this.validateForm();
        });
      } else {
        // 已存在的复选框，选中它
        existingCheckbox.checked = true;
      }
    });

    // 更新字段值
    this.updateMultiSelectValue(field);
    this.validateForm();
  }

  /**
   * 初始化用户输入
   */
  initializeUserInput() {
    this.userInput = {
      url: this.currentUrl
    };

    // 为其他字段设置默认值
    this.fieldsData.allSupportedFields.forEach(field => {
      if (field.type !== 'link') {
        this.userInput[field.name] = '';
      }
    });
  }

  /**
   * 验证表单
   * @returns {boolean} - 验证是否通过
   */
  validateForm() {
    const linkFields = this.fieldsData?.linkFields || [];

    if (linkFields.length > 0) {
      const defaultLinkField = linkFields[0];
      const urlValue = this.userInput.url || '';

      const isValid = urlValue.trim() !== '' && this.isValidUrl(urlValue);
      this.saveBtn.disabled = !isValid;

      if (isValid) {
        this.setStatus('就绪');
      } else {
        this.setStatus('请输入有效的URL');
      }

      return isValid; // 🔥 关键修复：返回验证结果
    } else {
      this.saveBtn.disabled = true;
      this.setStatus('缺少必需字段');
      return false; // 🔥 关键修复：返回验证失败
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
   * 处理表单提交
   */
  async handleSubmit(e) {
    e.preventDefault();

    if (this.isSubmitting) return;

    // 验证表单
    if (!this.validateForm()) {
      this.showMessage('请检查输入内容', 'warning');
      return;
    }

    this.isSubmitting = true;
    this.setSubmittingState(true);

    try {
      this.setStatus('查重中...');

      // 发送保存请求（包含查重）
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_RECORD',
        userInput: this.userInput
      });

      if (response.success) {
        if (response.action === 'update') {
          // 需要用户确认覆盖
          this.showConfirmDialog(response);
        } else {
          // 创建成功
          this.showMessage('记录保存成功', 'success');
          this.setStatus('保存成功');
          // resetForm() 已在新设计中移除
        }
      } else {
        // 保存失败
        this.showMessage(response.error, 'error');
        this.setStatus('保存失败');

        // 检查是否需要刷新字段
        if (response.requiresFieldRefresh) {
          setTimeout(() => {
            this.loadFields();
          }, 2000);
        }
      }
    } catch (error) {
      console.error('保存失败:', error);
      this.showMessage('保存失败，请重试', 'error');
      this.setStatus('保存失败');
    } finally {
      this.isSubmitting = false;
      this.setSubmittingState(false);
    }
  }

  /**
   * 显示确认对话框
   */
  showConfirmDialog(response) {
    const duplicateInfo = document.getElementById('duplicateInfo');
    const updatePreview = document.getElementById('updatePreview');

    // 🔥 关键修复：保存要更新的记录ID
    this.pendingUpdateRecordId = response.duplicateRecord.record_id;

    // 显示重复记录信息
    duplicateInfo.innerHTML = `
      <p><strong>已存在记录:</strong></p>
      <p>URL: ${this.truncateText(this.userInput.url, 50)}</p>
      <p>记录ID: ${response.duplicateRecord.record_id}</p>
    `;

    // 显示将要更新的字段
    const updateFields = [];
    Object.keys(this.userInput).forEach(fieldName => {
      if (fieldName !== 'url' && this.userInput[fieldName]) {
        updateFields.push(`<li>${fieldName}: ${this.truncateText(String(this.userInput[fieldName]), 30)}</li>`);
      }
    });

    if (updateFields.length > 0) {
      updatePreview.innerHTML = `<ul>${updateFields.join('')}</ul>`;
    } else {
      updatePreview.innerHTML = '<p>只有URL字段将被更新</p>';
    }

    // 显示对话框
    this.confirmDialog.classList.remove('hidden');
  }

  /**
   * 确认覆盖更新
   */
  async confirmUpdate() {
    this.closeConfirmDialog();
    this.setSubmittingState(true);
    this.setStatus('覆盖更新中...');

    try {
      // 🔥 关键修复：明确指定为更新操作，而不是跳过查重
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_RECORD',  // 使用不同的消息类型
        userInput: this.userInput,
        recordId: this.pendingUpdateRecordId  // 传递要更新的记录ID
      });

      if (response.success) {
        this.showMessage('记录更新成功', 'success');
        this.setStatus('更新成功');
        // resetForm() 已在新设计中移除
      } else {
        this.showMessage(response.error, 'error');
        this.setStatus('更新失败');
      }
    } catch (error) {
      console.error('更新失败:', error);
      this.showMessage('更新失败，请重试', 'error');
      this.setStatus('更新失败');
    } finally {
      this.setSubmittingState(false);
    }
  }

  /**
   * 关闭确认对话框
   */
  closeConfirmDialog() {
    this.confirmDialog.classList.add('hidden');
  }

  /**
   * 重置表单 - 已在新设计中移除
   */
  /*
  resetForm() {
    this.initializeUserInput();

    // 重置输入框
    this.dynamicFields.querySelectorAll('input, textarea, select').forEach(element => {
      if (element.type === 'checkbox') {
        element.checked = false;
      } else if (element.type === 'url') {
        element.value = this.currentUrl;
      } else {
        element.value = '';
      }
    });

    this.validateForm();
    this.setStatus('就绪');
  }
  */

  /**
   * 设置提交状态
   */
  setSubmittingState(submitting) {
    const btnText = this.saveBtn.querySelector('.btn-text');
    const btnLoading = this.saveBtn.querySelector('.btn-loading');

    if (submitting) {
      btnText.classList.add('hidden');
      btnLoading.classList.remove('hidden');
      this.saveBtn.disabled = true;
    } else {
      btnText.classList.remove('hidden');
      btnLoading.classList.add('hidden');
      this.validateForm();
    }
  }

  /**
   * 显示加载状态
   */
  showLoading() {
    this.hideAllStates();
    this.loadingState.classList.remove('hidden');
  }

  /**
   * 显示表单
   */
  showForm() {
    this.hideAllStates();
    this.formContent.classList.remove('hidden');
  }

  /**
   * 显示错误状态
   */
  showError(type, message = '') {
    this.hideAllStates();

    if (type === 'config') {
      this.configErrorState.classList.remove('hidden');
    } else if (type === 'field') {
      this.fieldErrorState.classList.remove('hidden');
      if (message) {
        document.getElementById('fieldErrorMessage').textContent = message;
      }
    }
  }

  /**
   * 隐藏所有状态
   */
  hideAllStates() {
    this.loadingState.classList.add('hidden');
    this.configErrorState.classList.add('hidden');
    this.fieldErrorState.classList.add('hidden');
    this.formContent.classList.add('hidden');
  }

  /**
   * 设置状态文本
   */
  setStatus(text) {
    this.statusText.textContent = text;
  }

  /**
   * 更新状态信息
   */
  updateStatus() {
    if (this.fieldsData) {
      const supportedCount = this.fieldsData.allSupportedFields.length;
      const unsupportedCount = this.fieldsData.unsupportedFields.length;

      let statusText = `${supportedCount} 个字段`;
      if (unsupportedCount > 0) {
        statusText += ` (${unsupportedCount} 个不支持)`;
      }

      // fieldCount 已在新设计中移除，不再显示字段计数
    }
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
   * 复制到剪贴板
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showMessage('已复制到剪贴板', 'success');
    } catch (error) {
      console.error('复制失败:', error);
      this.showMessage('复制失败', 'error');
    }
  }

  /**
   * 打开配置页面
   */
  openConfig() {
    chrome.runtime.openOptionsPage();
  }

  /**
   * 打开选项页面
   */
  openOptions() {
    chrome.runtime.openOptionsPage();
  }

  /**
   * 刷新字段
   */
  async refreshFields() {
    try {
      // 清除缓存
      const configResponse = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      if (configResponse.success) {
        const config = configResponse.config;
        const { app_token, table_id } = this.parseTableUrl(config.tableUrl);

        await chrome.runtime.sendMessage({
          type: 'CLEAR_CACHE',
          tableUrl: config.tableUrl
        });
      }

      // 重新加载字段
      await this.loadFields();
      this.showMessage('字段已刷新', 'success');
    } catch (error) {
      console.error('刷新字段失败:', error);
      this.showMessage('刷新字段失败', 'error');
    }
  }

  /**
   * 解析表格URL（简化版本）
   */
  parseTableUrl(tableUrl) {
    // 这里简化处理，实际应该与background.js中的逻辑一致
    const url = new URL(tableUrl);
    const pathParts = url.pathname.split('/');
    const baseIndex = pathParts.indexOf('base');

    if (baseIndex !== -1 && baseIndex + 1 < pathParts.length) {
      return {
        app_token: pathParts[baseIndex + 1],
        table_id: pathParts[baseIndex + 2] || 'tbl...'
      };
    }

    throw new Error('无法解析表格URL');
  }

  /**
   * 获取字段类型标签 - 已移除，不再显示字段类型
   */
  /*
  getFieldTypeLabel(type) {
    const labels = {
      'link': '链接',
      'text': '文本',
      'single': '单选',
      'multi': '多选'
    };
    return labels[type] || type;
  }
  */

  /**
   * 截断文本
   */
  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}

// 页面加载完成后初始化（确保单例模式）
document.addEventListener('DOMContentLoaded', () => {
  console.log('🌟 DOM 加载完成，开始初始化 PopupManager');
  new PopupManager();
});

// 防止重复初始化的清理函数
window.addEventListener('beforeunload', () => {
  PopupManager.instance = null;
});