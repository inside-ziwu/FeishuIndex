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

    // 立即强制设置popup尺寸，防止Chrome自动收缩
    this.forcePopupSize();

    this.initElements();
    this.bindEvents();
    this.init();
    this.setupGlobalClickHandler();
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
    this.errorText = document.getElementById('errorText');
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

    // 🔥 关键修复：保存按钮独立点击事件（因为按钮在表单外部）
    this.saveBtn.addEventListener('click', (e) => this.handleSubmit(e));

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
      // 字段加载完成，无需显示提示（避免信息过载）

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

    // 只有不支持字段时才显示错误提示
    if (this.fieldsData.unsupportedFields.length > 0) {
      this.updateErrorStatus(`${this.fieldsData.unsupportedFields.length}个字段不支持`);
    } else {
      this.updateErrorStatus('');
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
    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
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

    // 防止回车触发表单提交
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // 对于textarea，允许换行；对于input，阻止表单提交
        if (input.tagName === 'INPUT') {
          e.preventDefault();
        }
      }
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
   * 创建单选输入框 - 修复X按钮交互逻辑
   */
  createSingleSelectInput(field) {
    const container = document.createElement('div');
    container.className = 'custom-select-container';

    // 创建选择框显示区域
    const selectDisplay = document.createElement('div');
    selectDisplay.className = 'select-display';

    const selectValue = document.createElement('div');
    selectValue.className = 'select-value';
    selectValue.textContent = `请选择${field.name}...`;

    const selectArrow = document.createElement('div');
    selectArrow.className = 'select-arrow';
    selectArrow.innerHTML = '<i class="fas fa-chevron-down"></i>';

    // 创建独立的清除按钮
    const clearBtn = document.createElement('div');
    clearBtn.className = 'select-clear hidden';
    clearBtn.innerHTML = '<i class="fas fa-times"></i>';
    clearBtn.title = '清除选择';

    selectDisplay.appendChild(selectValue);
    selectDisplay.appendChild(selectArrow);
    selectDisplay.appendChild(clearBtn);

    // 创建下拉选项列表
    const dropdown = document.createElement('div');
    dropdown.className = 'select-dropdown hidden';

    // 添加现有选项
    const existingOptions = new Set(field.options || []);

    if (field.options && field.options.length > 0) {
      field.options.forEach(option => {
        const optionItem = this.createSelectOption(option, false, field.name, selectValue, clearBtn, selectArrow, dropdown);
        dropdown.appendChild(optionItem);
      });
    }

    // 添加新增选项项
    const addOptionItem = this.createSelectOption('+ 新增选项', true, field.name, selectValue, clearBtn, selectArrow, dropdown);
    dropdown.appendChild(addOptionItem);

    // 点击选择框展开/收起下拉（不包括清除按钮）
    selectDisplay.addEventListener('click', (e) => {
      e.stopPropagation();

      // 如果点击的是清除按钮，不处理展开/收起逻辑
      if (e.target === clearBtn || clearBtn.contains(e.target)) {
        return;
      }

      // 如果当前是展开状态，则收起
      if (!dropdown.classList.contains('hidden')) {
        this.closeDropdown(dropdown, selectArrow);
      } else {
        // 否则展开下拉
        this.openDropdown(dropdown, selectArrow);
      }
    });

    // 清除按钮点击事件 - 独立处理清除逻辑
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearSelection(field.name, selectValue, clearBtn, selectArrow);
    });

    container.appendChild(selectDisplay);
    container.appendChild(dropdown);

    // 将下拉框信息存储到容器上，供全局点击事件使用
    container.dropdownElement = dropdown;
    container.selectArrowElement = selectArrow;
    container.clearBtnElement = clearBtn;

    return container;
  }

  /**
   * 创建选择选项项
   */
  createSelectOption(text, isAddNew, fieldName, selectValue, clearBtn, selectArrow, dropdown) {
    const optionItem = document.createElement('div');
    optionItem.className = `select-option ${isAddNew ? 'add-new' : ''}`;

    if (isAddNew) {
      // 新增选项 - 点击后显示输入框
      optionItem.innerHTML = `
        <div class="add-option-content">
          <i class="fas fa-plus"></i>
          <span>新增选项</span>
        </div>
      `;

      optionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAddOptionInput(optionItem, fieldName, selectValue, clearBtn, selectArrow, dropdown);
      });
    } else {
      // 普通选项
      optionItem.textContent = text;
      optionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectOption(text, fieldName, selectValue, clearBtn, selectArrow, dropdown);
      });
    }

    return optionItem;
  }

  /**
   * 显示新增选项输入框
   */
  showAddOptionInput(optionItem, fieldName, selectValue, clearBtn, selectArrow, dropdown) {
    const inputContainer = document.createElement('div');
    inputContainer.className = 'new-option-input-container';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'new-option-input';
    input.placeholder = '输入新选项名称...';

    const addButton = document.createElement('button');
    addButton.className = 'new-option-add-btn';
    addButton.innerHTML = '<i class="fas fa-check"></i>';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'new-option-cancel-btn';
    cancelButton.innerHTML = '<i class="fas fa-times"></i>';

    inputContainer.appendChild(input);
    inputContainer.appendChild(addButton);
    inputContainer.appendChild(cancelButton);

    // 替换原选项项
    optionItem.replaceWith(inputContainer);
    input.focus();

    // 添加事件处理
    const addNewOption = () => {
      const value = input.value.trim();
      if (value) {
        this.addNewOption(value, fieldName, selectValue, clearBtn, selectArrow, dropdown);
      }
    };

    const cancelAdd = () => {
      inputContainer.replaceWith(optionItem);
    };

    addButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault(); // 🔥 关键修复：阻止表单提交
      addNewOption();
    });

    cancelButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault(); // 🔥 关键修复：阻止表单提交
      cancelAdd();
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault(); // 阻止表单提交
        addNewOption();
      } else if (e.key === 'Escape') {
        e.preventDefault(); // 阻止表单提交
        cancelAdd();
      }
    });
  }

  /**
   * 添加新选项
   */
  addNewOption(value, fieldName, selectValue, clearBtn, selectArrow, dropdown) {
    // 创建新选项并插入到"新增选项"之前
    const newOption = this.createSelectOption(value, false, fieldName, selectValue, clearBtn, selectArrow, dropdown);
    const addNewOption = dropdown.querySelector('.add-new');
    dropdown.insertBefore(newOption, addNewOption);

    // 选择新选项
    this.selectOption(value, fieldName, selectValue, clearBtn, selectArrow, dropdown);

    // 新增选项成功，无需显示提示（避免信息过载）
  }

  /**
   * 选择选项
   */
  selectOption(value, fieldName, selectValue, clearBtn, selectArrow, dropdown) {
    selectValue.textContent = value;
    this.userInput[fieldName] = value;

    // 显示清除按钮，隐藏箭头
    clearBtn.classList.remove('hidden');
    selectArrow.classList.add('hidden');

    // 收起下拉
    dropdown.classList.add('hidden');

    this.validateForm();
  }

  /**
   * 打开下拉
   */
  openDropdown(dropdown, selectArrow) {
    dropdown.classList.remove('hidden');
    selectArrow.innerHTML = '<i class="fas fa-chevron-up"></i>';
  }

  /**
   * 收起下拉
   */
  closeDropdown(dropdown, selectArrow) {
    dropdown.classList.add('hidden');
    selectArrow.innerHTML = '<i class="fas fa-chevron-down"></i>';
  }

  /**
   * 清除选择 - 新增方法
   */
  clearSelection(fieldName, selectValue, clearBtn, selectArrow) {
    // 恢复默认提示文本
    selectValue.textContent = `请选择${fieldName}...`;

    // 清除用户输入
    this.userInput[fieldName] = '';

    // 隐藏清除按钮，显示箭头
    clearBtn.classList.add('hidden');
    selectArrow.classList.remove('hidden');

    // 重置箭头图标
    selectArrow.innerHTML = '<i class="fas fa-chevron-down"></i>';

    this.validateForm();
  }

  /**
   * 设置全局点击处理器 - 用于收起所有下拉框
   */
  setupGlobalClickHandler() {
    // 只设置一次全局点击监听器
    document.addEventListener('click', (e) => {
      // 查找所有单选字段容器
      const selectContainers = document.querySelectorAll('.custom-select-container');

      selectContainers.forEach(container => {
        if (container.dropdownElement && container.selectArrowElement) {
          // 如果点击不在当前容器内，收起下拉框
          if (!container.contains(e.target)) {
            this.closeDropdown(container.dropdownElement, container.selectArrowElement);
          }
        }
      });
    });
  }

  /**
   * 强制设置popup尺寸为精确的320px宽度
   * 这是解决Chrome自动收缩popup尺寸问题的关键方法
   */
  forcePopupSize() {
    try {
      // 1. 设置html元素尺寸 - 这是Chrome计算popup尺寸的基础
      document.documentElement.style.width = '440px';
      document.documentElement.style.minWidth = '440px';
      document.documentElement.style.maxWidth = '440px';
      document.documentElement.style.display = 'block';
      document.documentElement.style.overflow = 'visible';

      // 2. 设置body元素尺寸 - 确保内容撑开popup
      document.body.style.width = '440px';
      document.body.style.minWidth = '440px';
      document.body.style.maxWidth = '440px';
      document.body.style.margin = '0';
      document.body.style.padding = '0'; // 🔥 关键修复：移除padding，让CSS控制布局
      document.body.style.boxSizing = 'border-box';
      document.body.style.position = 'relative';

      // 3. 设置app-container的精确尺寸 - 主要内容容器
      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        // app-container直接使用440px，内部padding处理间距
        appContainer.style.width = '440px';
        appContainer.style.minWidth = '440px';
        appContainer.style.maxWidth = '440px';
        appContainer.style.margin = '0';
        appContainer.style.boxSizing = 'border-box';
      }

      // 4. 创建一个不可见的强制宽度元素
      // 这是为了"欺骗"Chrome的自动尺寸计算算法
      if (!document.querySelector('.size-enforcer')) {
        const sizeEnforcer = document.createElement('div');
        sizeEnforcer.className = 'size-enforcer';
        sizeEnforcer.style.cssText = `
          position: absolute;
          width: 440px;  // 🔥 关键修复：修正为正确的440px
          height: 1px;
          visibility: hidden;
          pointer-events: none;
          z-index: -9999;
        `;
        document.body.appendChild(sizeEnforcer);
      }

      // 5. 延迟再次强制设置，确保在Chrome计算尺寸后生效
      // 使用非递归的方式，避免无限循环
      setTimeout(() => {
        this.reinforcePopupSize();
        // 调试信息：输出实际尺寸
        console.log('Popup尺寸强制设置完成:', {
          documentElement: document.documentElement.offsetWidth,
          body: document.body.offsetWidth,
          appContainer: appContainer ? appContainer.offsetWidth : 'not found',
          target: 440
        });
      }, 100);

    } catch (error) {
      console.warn('强制设置popup尺寸时出错:', error);
    }
  }

  /**
   * 强化popup尺寸设置 - 非递归版本
   */
  reinforcePopupSize() {
    try {
      // 再次确认关键元素的尺寸
      document.body.style.width = '440px';
      document.body.style.minWidth = '440px';

      const appContainer = document.querySelector('.app-container');
      if (appContainer) {
        appContainer.style.width = '440px'; // 直接使用440px
        appContainer.style.minWidth = '440px';
      }

      // 最后的强化措施
      setTimeout(() => {
        if (document.body.offsetWidth !== 440) {
          console.warn(`Popup实际宽度异常: ${document.body.offsetWidth}px，尝试强制修正`);
          document.body.style.width = '440px !important';
        }
      }, 50);

    } catch (error) {
      console.warn('强化popup尺寸时出错:', error);
    }
  }

  /**
   * 创建多选输入框
   */
  createMultiSelectInput(field) {
    const container = document.createElement('div');
    container.className = 'multi-select-container';

    // 标签展示区域（单行）
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tags-container';
    tagsContainer.dataset.fieldName = field.name;

    if (field.options && field.options.length > 0) {
      field.options.forEach(option => {
        // 创建可点击的标签
        const tag = document.createElement('div');
        tag.className = 'tag-item';
        tag.textContent = option;
        tag.dataset.value = option;
        tag.dataset.fieldName = field.name;

        // 标签点击事件 - 直接在原地切换状态
        tag.addEventListener('click', () => {
          this.toggleTagInline(field.name, option, tag);
        });

        tagsContainer.appendChild(tag);
      });
    }

    // 批量输入新选项
    const multiInput = document.createElement('input');
    multiInput.type = 'text';
    multiInput.className = 'field-input multi-input';
    multiInput.placeholder = `输入多个${field.name}，用逗号分隔`;

    multiInput.addEventListener('input', () => {
      this.processMultiSelectInput(field, multiInput.value);
    });

    // 防止回车触发表单提交
    multiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // 阻止表单提交
      }
    });

    container.appendChild(tagsContainer);
    container.appendChild(multiInput);

    return container;
  }

  /**
   * 内联切换标签选中状态
   * @param {string} fieldName - 字段名
   * @param {string} value - 标签值
   * @param {HTMLElement} tagElement - 标签元素
   */
  toggleTagInline(fieldName, value, tagElement) {
    // 获取或初始化选中值数组
    if (!this.userInput[fieldName]) {
      this.userInput[fieldName] = [];
    }

    const selectedValues = this.userInput[fieldName];
    const selectedIndex = selectedValues.indexOf(value);

    if (selectedIndex > -1) {
      // 取消选中
      selectedValues.splice(selectedIndex, 1);
      tagElement.classList.remove('selected');
    } else {
      // 选中
      selectedValues.push(value);
      tagElement.classList.add('selected');
    }

    console.log(`🏷️ 标签切换: ${fieldName} "${value}", 已选中: ${selectedValues.join(', ')}`);
    this.validateForm();
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
   * 处理多选输入（仅保存原始输入，提交时处理）
   */
  processMultiSelectInput(field, inputValue) {
    if (!inputValue.trim()) return;

    console.log(`📝 批量输入原始值: "${inputValue}"`);

    // 保存原始输入内容，用于提交时处理
    this.userInput[`${field.name}_rawInput`] = inputValue;

    console.log(`✅ 批量输入已保存: ${field.name}, 原始输入: "${inputValue}"`);
    this.validateForm();
  }

  /**
   * 处理多选字段提交（保留选中标签和原始输入）
   */
  processMultiSelectFieldsForSubmit() {
    const processedInput = { ...this.userInput };

    // 遍历所有字段，查找多选字段
    this.fieldsData.multiFields.forEach(field => {
      const rawInputKey = `${field.name}_rawInput`;

      if (processedInput[rawInputKey]) {
        // 有原始输入，需要解析
        const rawOptions = processedInput[rawInputKey]
          .split(/[,，]/)
          .map(option => option.trim())
          .filter(option => option.length > 0);

        // 获取当前已选中的标签
        const currentSelected = processedInput[field.name] || [];

        console.log(`🔄 多选字段提交: ${field.name}`);
        console.log(`  - 已选标签: [${currentSelected.join(', ')}]`);
        console.log(`  - 原始输入: [${rawOptions.join(', ')}]`);
        console.log(`  - 将同时传递给后端处理`);

        // 不删除 rawInput，让后端处理合并逻辑
        // processedInput[field.name] 保持原样（已选标签）
        // processedInput[rawInputKey] 保持原样（原始输入）
      }
    });

    return processedInput;
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

      // 处理多选字段的原始输入
      const processedInput = this.processMultiSelectFieldsForSubmit();

      // 发送保存请求（包含查重）
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_RECORD',
        userInput: processedInput
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
   * 获取字段类型的可读名称
   * @param {number} type - 字段类型数值
   * @returns {string} - 字段类型名称
   */
  getFieldTypeName(type) {
    const typeNames = {
      1: '文本',
      2: '数字',
      3: '单选',
      4: '多选',
      5: '日期',
      11: '地理位置',
      13: '电话',
      15: '链接',
      17: '人员',
      18: '附件',
      19: '复选框',
      20: '查找引用',
      21: '公式',
      22: '关联记录',
      23: '文件',
      1001: '创建时间',
      1002: '修改时间',
      1003: '邮箱',
      1004: '电话',
      1005: '日期时间',
      1006: '时间',
      1007: '进度',
      1008: '评分',
      1009: '货币',
      1010: '百分号',
      1011: '自动编号',
      1012: '条码',
      1013: '按钮',
      1014: '单向关联',
      1015: '双向关联',
      1016: '摘要',
      1017: '成员',
      1018: '部门',
      1019: '层级',
      1020: '群组',
      1021: '公式引用',
      1022: '查找引用-单向',
      1023: '查找引用-双向'
    };
    return typeNames[type] || `未知类型(${type})`;
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
   * 更新错误状态文本
   */
  updateErrorStatus(text) {
    this.errorText.textContent = text;
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
        // 通过消息传递获取URL解析结果，避免重复实现
        const parseResponse = await chrome.runtime.sendMessage({
          type: 'PARSE_TABLE_URL',
          tableUrl: config.tableUrl
        });

        if (!parseResponse.success) {
          throw new Error('URL解析失败: ' + parseResponse.error);
        }

        const { app_token, table_id } = parseResponse.result;

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
   * 刷新选项缓存（只清理单选/多选选项，保留字段列表）
   */
  async refreshOptionsCache() {
    try {
      // 只清除选项缓存，保留字段列表缓存
      const configResponse = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      if (configResponse.success) {
        const config = configResponse.config;

        await chrome.runtime.sendMessage({
          type: 'CLEAR_OPTIONS_CACHE',
          tableUrl: config.tableUrl
        });

        // 重新加载字段（这会重新获取选项）
        await this.loadFields();
        this.showMessage('选项缓存已刷新', 'success');
      }
    } catch (error) {
      console.error('刷新选项缓存失败:', error);
      this.showMessage('刷新选项失败，请重试', 'error');
    }
  }

  // parseTableUrl方法已移除，统一使用background.js的PARSE_TABLE_URL消息服务

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
  const popup = new PopupManager();

  // 确保popup尺寸的最后一次强化设置
  setTimeout(() => {
    if (popup && popup.forcePopupSize) {
      popup.forcePopupSize();
      console.log('🔧 DOM加载完成后的最终尺寸强化');
    }
  }, 200);

  // 添加全局清理方法
  window.clearFeishuOptionsCache = async function() {
    console.log('🔄 自动清理选项缓存...');
    try {
      if (popup) {
        await popup.refreshOptionsCache();
        console.log('✅ 选项缓存清理完成！');
      } else {
        console.error('❌ 未找到PopupManager实例');
      }
    } catch (error) {
      console.error('❌ 清理失败:', error);
    }
  };

  // 手动清理选项缓存功能（通过管理界面按钮触发）
  // 取消自动清理，改为手动控制
});

// 防止重复初始化的清理函数
window.addEventListener('beforeunload', () => {
  PopupManager.instance = null;
});