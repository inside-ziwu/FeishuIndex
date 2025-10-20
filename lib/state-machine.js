/**
 * FeishuIndex 状态机
 * 解决数据流脆弱性问题的核心架构组件
 */

/* -----------------------------------------------------------------------
 * 状态机设计哲学 (Linus 好品味)
 * 1. 状态转换必须是确定性的
 * 2. 不可能状态的组合应该被编译时排除
 * 3. 状态机本身就是最好的防御
 * ----------------------------------------------------------------------- */

/**
 * 状态定义 - 使用常量确保类型安全
 */
const STATES = Object.freeze({
  INITIALIZING: 'initializing',
  LOADING_CONFIG: 'loading_config',
  LOADING_FIELDS: 'loading_fields',
  VALIDATING_FIELDS: 'validating_fields',
  READY: 'ready',
  SUBMITTING: 'submitting',
  ERROR: 'error',
  RECOVERING: 'recovering'
});

const EVENTS = Object.freeze({
  INIT: 'init',
  CONFIG_LOADED: 'config_loaded',
  CONFIG_FAILED: 'config_failed',
  FIELDS_LOADING: 'fields_loading',
  FIELDS_LOADED: 'fields_loaded',
  FIELDS_FAILED: 'fields_failed',
  VALIDATION_FAILED: 'validation_failed',
  SUBMIT: 'submit',
  SUBMIT_SUCCESS: 'submit_success',
  SUBMIT_FAILED: 'submit_failed',
  RECOVERY_START: 'recovery_start',
  RECOVERY_SUCCESS: 'recovery_success',
  RECOVERY_FAILED: 'recovery_failed',
  RESET: 'reset'
});

/**
 * 状态转换表 - 声明式设计，避免隐式逻辑
 */
const TRANSITIONS = Object.freeze({
  [STATES.INITIALIZING]: {
    [EVENTS.INIT]: STATES.LOADING_CONFIG
  },
  [STATES.LOADING_CONFIG]: {
    [EVENTS.CONFIG_LOADED]: STATES.LOADING_FIELDS,
    [EVENTS.CONFIG_FAILED]: STATES.ERROR,
    [EVENTS.RESET]: STATES.INITIALIZING
  },
  [STATES.LOADING_FIELDS]: {
    [EVENTS.FIELDS_LOADING]: STATES.VALIDATING_FIELDS,
    [EVENTS.FIELDS_FAILED]: STATES.RECOVERING
  },
  [STATES.VALIDATING_FIELDS]: {
    [EVENTS.FIELDS_LOADED]: STATES.READY,
    [EVENTS.VALIDATION_FAILED]: STATES.RECOVERING,
    [EVENTS.FIELDS_FAILED]: STATES.RECOVERING
  },
  [STATES.READY]: {
    [EVENTS.SUBMIT]: STATES.SUBMITTING,
    [EVENTS.FIELDS_LOADING]: STATES.LOADING_FIELDS,
    [EVENTS.RESET]: STATES.INITIALIZING
  },
  [STATES.SUBMITTING]: {
    [EVENTS.SUBMIT_SUCCESS]: STATES.READY,
    [EVENTS.SUBMIT_FAILED]: STATES.ERROR
  },
  [STATES.ERROR]: {
    [EVENTS.RECOVERY_START]: STATES.RECOVERING,
    [EVENTS.RESET]: STATES.INITIALIZING
  },
  [STATES.RECOVERING]: {
    [EVENTS.RECOVERY_SUCCESS]: STATES.LOADING_CONFIG,
    [EVENTS.RECOVERY_FAILED]: STATES.ERROR,
    [EVENTS.RESET]: STATES.INITIALIZING
  }
});

/**
 * 状态机类 - 简洁但功能完整
 */
class StateMachine {
  constructor(logger = null) {
    this.currentState = STATES.INITIALIZING;
    this.stateHistory = [];
    this.eventListeners = new Map();
    this.logger = logger;

    // 初始化事件监听器
    Object.values(EVENTS).forEach(event => {
      this.eventListeners.set(event, []);
    });

    this.logStateChange('INITIAL', '状态机初始化');
  }

  /**
   * 获取当前状态
   */
  getState() {
    return this.currentState;
  }

  /**
   * 检查是否可以转换到指定事件
   */
  canTransition(event) {
    return this.currentState in TRANSITIONS &&
           event in TRANSITIONS[this.currentState];
  }

  /**
   * 执行状态转换
   */
  transition(event, data = {}) {
    if (!this.canTransition(event)) {
      const error = `无效的状态转换: ${this.currentState} -> ${event}`;
      this.logStateChange('INVALID_TRANSITION', error);
      throw new Error(error);
    }

    const oldState = this.currentState;
    const newState = TRANSITIONS[this.currentState][event];

    // 记录状态历史
    this.stateHistory.push({
      from: oldState,
      to: newState,
      event,
      data,
      timestamp: Date.now()
    });

    // 保持历史记录在合理范围内
    if (this.stateHistory.length > 20) {
      this.stateHistory.shift();
    }

    this.currentState = newState;
    this.logStateChange(event, `${oldState} -> ${newState}`, data);

    // 触发事件监听器
    this.emit(event, { state: newState, from: oldState, data });

    return newState;
  }

  /**
   * 添加事件监听器
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      throw new Error(`未知事件: ${event}`);
    }

    this.eventListeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  /**
   * 移除事件监听器
   */
  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`状态机事件监听器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 获取状态历史
   */
  getStateHistory() {
    return [...this.stateHistory];
  }

  /**
   * 重置状态机
   */
  reset() {
    this.transition(EVENTS.RESET);
  }

  /**
   * 检查是否处于错误状态
   */
  isError() {
    return this.currentState === STATES.ERROR;
  }

  /**
   * 检查是否就绪
   */
  isReady() {
    return this.currentState === STATES.READY;
  }

  /**
   * 检查是否正在处理
   */
  isProcessing() {
    return [STATES.LOADING_CONFIG, STATES.LOADING_FIELDS,
            STATES.VALIDATING_FIELDS, STATES.SUBMITTING,
            STATES.RECOVERING].includes(this.currentState);
  }

  /**
   * 获取状态描述
   */
  getStateDescription() {
    const descriptions = {
      [STATES.INITIALIZING]: '正在初始化...',
      [STATES.LOADING_CONFIG]: '正在加载配置...',
      [STATES.LOADING_FIELDS]: '正在加载字段信息...',
      [STATES.VALIDATING_FIELDS]: '正在验证字段数据...',
      [STATES.READY]: '就绪',
      [STATES.SUBMITTING]: '正在保存...',
      [STATES.ERROR]: '发生错误',
      [STATES.RECOVERING]: '正在恢复...'
    };
    return descriptions[this.currentState] || '未知状态';
  }

  /**
   * 记录状态变化
   */
  logStateChange(event, message, data = {}) {
    if (this.logger) {
      this.logger.debug('STATE_MACHINE', message, {
        event,
        currentState: this.currentState,
        stateHistoryLength: this.stateHistory.length,
        ...data
      }, { category: 'state_machine' });
    }
  }

  /**
   * 导出调试信息
   */
  exportDebugInfo() {
    return {
      currentState: this.currentState,
      stateHistory: this.stateHistory,
      eventListenerCounts: Object.fromEntries(
        Array.from(this.eventListeners.entries()).map(([event, listeners]) => [event, listeners.length])
      ),
      timestamp: Date.now()
    };
  }
}

// 导出常量和类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StateMachine, STATES, EVENTS, TRANSITIONS };
} else {
  globalThis.FeishuIndexStateMachine = { StateMachine, STATES, EVENTS, TRANSITIONS };
}