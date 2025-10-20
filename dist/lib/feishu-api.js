/**
 * 飞书API封装模块
 * 负责与飞书开放平台的所有API交互
 * 重构版本：使用专业的TokenManager管理Token生命周期
 */

/**
 * 飞书API客户端类
 */
class FeishuAPIClient {
  constructor() {
    this.baseUrl = 'https://open.feishu.cn/open-apis';
    this.tokenManager = new globalThis.TokenManager.TokenManager();
  }

  /**
   * 获取tenant_access_token
   * 委托给TokenManager处理，确保可靠性和原子性
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @returns {Promise<string>} - 访问令牌
   */
  async getTenantToken(appId, appSecret) {
    console.log('🔑 FeishuAPIClient: 委托TokenManager获取Token', {
      appId: appId?.substring(0, 10) + '...',
      timestamp: new Date().toISOString()
    });

    try {
      const token = await this.tokenManager.getValidToken(appId, appSecret);

      console.log('✅ FeishuAPIClient: Token获取成功', {
        tokenPrefix: token.substring(0, 20) + '...'
      });

      return token;
    } catch (error) {
      console.error('❌ FeishuAPIClient: Token获取失败', {
        errorType: error.constructor.name,
        errorMessage: error.message
      });
      throw error;
    }
  }

  /**
   * 强制刷新Token（忽略缓存）
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @returns {Promise<string>} - 新的访问令牌
   */
  async forceRefreshToken(appId, appSecret) {
    console.log('🔄 FeishuAPIClient: 强制刷新Token');
    return await this.tokenManager.forceRefreshToken(appId, appSecret);
  }

  /**
   * 获取Token状态（用于调试）
   * @returns {Promise<Object>} - Token状态信息
   */
  async getTokenStatus() {
    return await this.tokenManager.getTokenStatus();
  }

  /**
   * 解析表格URL，提取app_token和table_id
   * @param {string} tableUrl - 飞书表格URL
   * @returns {Object} - 包含app_token和table_id的对象
   */
  parseTableUrl(tableUrl) {
    try {
      const url = new URL(tableUrl);
      const pathParts = url.pathname.split('/');

      // 查找base和app_token
      const baseIndex = pathParts.indexOf('base');
      if (baseIndex === -1 || baseIndex + 1 >= pathParts.length) {
        throw new Error('URL格式错误：找不到app_token');
      }

      const appToken = pathParts[baseIndex + 1];

      // 查找table_id（可能在hash或查询参数中）
      let tableId = null;

      // 优先从URL path中查找
      if (baseIndex + 2 < pathParts.length) {
        tableId = pathParts[baseIndex + 2];
      }

      // 如果path中没有，从hash中查找
      if (!tableId && url.hash) {
        const hashMatch = url.hash.match(/tbl[a-zA-Z0-9]+/);
        if (hashMatch) {
          tableId = hashMatch[0];
        }
      }

      // 如果还是没有，从查询参数中查找
      if (!tableId) {
        const urlParams = new URLSearchParams(url.search);
        tableId = urlParams.get('table') || urlParams.get('tbl');
      }

      if (!tableId) {
        throw new Error('URL格式错误：找不到table_id');
      }

      return {
        app_token: appToken,
        table_id: tableId
      };
    } catch (error) {
      throw new Error(`解析表格URL失败: ${error.message}`);
    }
  }

  /**
   * 获取表格字段列表
   * @param {string} appToken - 应用token
   * @param {string} tableId - 表格ID
   * @param {string} tenantToken - 访问令牌
   * @returns {Promise<Array>} - 字段列表
   */
  async getTableFields(appToken, tableId, tenantToken) {
    try {
      console.log('🚀 API调用开始 - 获取表格字段:', {
        url: `${this.baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        appToken: appToken?.substring(0, 10) + '...',
        tableId: tableId?.substring(0, 10) + '...',
        tenantToken: tenantToken ? tenantToken.substring(0, 20) + '...' : '无效令牌',
        method: 'GET'
      });

      const response = await fetch(
        `${this.baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        {
          headers: {
            'Authorization': `Bearer ${tenantToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('📡 字段API响应状态:', {
        status: response.status,
        statusText: response.statusText,
        headers: {
          contentType: response.headers.get('content-type'),
          contentLength: response.headers.get('content-length'),
          requestId: response.headers.get('x-request-id')
        },
        responseTime: new Date().toISOString()
      });

      // 检查Token失效 - 直接使用，失效了重新获取
      if (response.status === 401) {
        const tokenExpiredError = new Error('Token已过期，需要重新获取');
        tokenExpiredError.code = 'TOKEN_EXPIRED';
        throw tokenExpiredError;
      }

      const data = await response.json();

      console.log('📨 字段API完整响应:', {
        code: data.code,
        msg: data.msg,
        success: data.code === 0,
        hasData: !!data.data,
        dataExists: !!data.data?.items,
        itemsCount: data.data?.items?.length || 0,
        responseTime: new Date().toISOString()
      });

      // 详细的字段数据分析
      if (data.code === 0 && data.data?.items) {
        console.log('🔍 字段数据分析:', {
          totalCount: data.data.items.length,
          sampleFields: data.data.items.slice(0, 3).map(field => ({
            name: field.field_name,
            type: field.type,
            uiType: field.ui_type,
            isPrimary: field.is_primary
          })),
          fieldTypes: [...new Set(data.data.items.map(f => `${f.type}(${f.ui_type})`))].slice(0, 5)
        });
      }

      if (data.code === 0) {
        console.log('✅ 字段获取成功:', {
          fieldsCount: data.data?.items?.length || 0,
          sampleField: data.data?.items?.[0]?.field_name || '无字段数据'
        });
        return data.data.items || [];
      } else {
        console.error('❌ 字段获取失败:', {
          code: data.code,
          msg: data.msg,
          help: this._getFieldErrorHelp(data.code),
          timestamp: new Date().toISOString()
        });
        throw new Error(`获取字段列表失败: ${data.msg}`);
      }
    } catch (error) {
      console.error('💥 字段API调用彻底失败:', {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack?.split('\n')?.[0], // 只显示第一行堆栈
        timestamp: new Date().toISOString()
      });
      throw new Error(`API调用失败: ${error.message}`);
    }
  }

  /**
   * 获取字段错误码的帮助信息
   * @param {number} code - 错误码
   * @returns {string} - 帮助信息
   */
  _getFieldErrorHelp(code) {
    const errorHelp = {
      91402: '应用权限不足，请检查飞书开放平台的应用权限配置',
      91403: '表格权限不足，请确认应用已添加到表格协作者',
      10003: '参数错误，请检查app_token和table_id是否正确',
      401: '认证失败，tenant_token无效或已过期',
      403: '无权限访问该表格',
      404: '表格不存在或已被删除'
    };
    return errorHelp[code] || `未知错误码，请检查网络连接和权限配置`;
  }

  /**
   * URL查重 - 分页扫描
   * @param {string} appToken - 应用token
   * @param {string} tableId - 表格ID
   * @param {string} linkFieldName - 链接字段名称
   * @param {string} url - 要查重的URL
   * @param {string} tenantToken - 访问令牌
   * @returns {Promise<Object|null>} - 重复记录或null
   */
  async checkUrlDuplication(appToken, tableId, linkFieldName, url, tenantToken) {
    const trimmedUrl = url.trim();
    console.log('🔍 开始查重:', {
      appToken,
      tableId,
      linkFieldName,
      url: trimmedUrl
    });

    // 🔥 根据用户提供的格式，重新启用查重功能
    let pageToken = null;
    let pageCount = 0;
    const startTime = Date.now();
    const maxPages = 200;
    const maxTime = 60000; // 60秒

    try {
      while (pageCount < maxPages && (Date.now() - startTime) < maxTime) {
        // 🔥 关键修复：添加 conjunction 参数
        const requestBody = {
          filter: {
            conjunction: "and",
            conditions: [
              {
                field_name: linkFieldName,
                operator: 'is',
                value: [trimmedUrl]
              }
            ]
          },
          page_size: 500
        };

        if (pageToken) {
          requestBody.page_token = pageToken;
        }

        console.log('📤 查重请求体:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(
          `${this.baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tenantToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
          }
        );

        const data = await response.json();

        console.log('📨 查重响应:', {
          code: data.code,
          msg: data.msg,
          has_more: data.data?.has_more,
          items_count: data.data?.items?.length || 0
        });

        if (data.code === 0) {
          const records = data.data.items || [];

          // 检查是否找到重复记录
          if (records.length > 0) {
            console.log('✅ 找到重复记录:', records[0].record_id);
            return records[0]; // 返回第一个重复记录
          }

          // 检查是否还有更多页面
          if (!data.data.has_more) {
            break;
          }

          pageToken = data.data.page_token;
          pageCount++;
        } else {
          console.log('❌ 查重API响应错误:', {
            code: data.code,
            msg: data.msg,
            help: '可能的原因：1.字段名错误 2.字段类型不支持 3.请求格式错误'
          });
          throw new Error(`查重失败: ${data.msg} (code: ${data.code})`);
        }
      }

      return null; // 未找到重复记录
    } catch (error) {
      throw new Error(`URL查重失败: ${error.message}`);
    }

    /* 保留原始查重逻辑以备将来参考
    let pageToken = null;
    let pageCount = 0;
    const startTime = Date.now();
    const maxPages = 200;
    const maxTime = 60000; // 60秒

    try {
      while (pageCount < maxPages && (Date.now() - startTime) < maxTime) {
        // 尝试不同的查重方法
        const methods = [
          {
            name: '字符串精确匹配',
            body: {
              filter: {
                conditions: [{
                  field_name: linkFieldName,
                  operator: 'is',
                  value: [trimmedUrl]
                }]
              }
            }
          },
          {
            name: '包含匹配',
            body: {
              filter: {
                conditions: [{
                  field_name: linkFieldName,
                  operator: 'contains',
                  value: [trimmedUrl]
                }]
              }
            }
          },
          {
            name: '超链接对象格式',
            body: {
              filter: {
                conditions: [{
                  field_name: linkFieldName,
                  operator: 'is',
                  value: [{
                    link: trimmedUrl,
                    text: trimmedUrl
                  }]
                }]
              }
            }
          }
        ];

        // 尝试每种方法
        for (const method of methods) {
          console.log(`🔄 尝试查重方法: ${method.name}`);

          const requestBody = {
            ...method.body,
            page_size: 500
          };

          if (pageToken) {
            requestBody.page_token = pageToken;
          }

          console.log('📤 请求体:', JSON.stringify(requestBody, null, 2));

          const response = await fetch(
            `${this.baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tenantToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(requestBody)
            }
          );

          const data = await response.json();

          console.log('📨 响应:', {
            code: data.code,
            msg: data.msg,
            items_count: data.data?.items?.length || 0
          });

          if (data.code === 0) {
            // 成功，使用这个方法继续
            const records = data.data.items || [];

            if (records.length > 0) {
              console.log('✅ 找到重复记录');
              return records[0];
            }

            if (!data.data.has_more) {
              return null; // 没有更多记录
            }

            pageToken = data.data.page_token;
            pageCount++;
            break; // 使用这个方法继续翻页

          } else {
            console.log(`❌ 方法 ${method.name} 失败:`, data.msg);

            // 如果所有方法都失败了
            if (method === methods[methods.length - 1]) {
              throw new Error(`所有查重方法都失败: ${data.msg}`);
            }

            // 尝试下一个方法
            continue;
          }
        }
      }

      return null;
    } catch (error) {
      throw new Error(`URL查重失败: ${error.message}`);
    }
    */
  }

  /**
   * 创建新记录
   * @param {string} appToken - 应用token
   * @param {string} tableId - 表格ID
   * @param {Object} fields - 字段数据
   * @param {string} tenantToken - 访问令牌
   * @returns {Promise<Object>} - 创建结果
   */
  async createRecord(appToken, tableId, fields, tenantToken) {
    try {
      const response = await fetch(
        `${this.baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tenantToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields })
        }
      );

      const data = await response.json();

      if (data.code === 0) {
        return {
          success: true,
          record: data.data.record
        };
      } else {
        throw new Error(`创建记录失败: ${data.msg}`);
      }
    } catch (error) {
      throw new Error(`创建记录失败: ${error.message}`);
    }
  }

  /**
   * 更新记录
   * @param {string} appToken - 应用token
   * @param {string} tableId - 表格ID
   * @param {string} recordId - 记录ID
   * @param {Object} fields - 要更新的字段数据
   * @param {string} tenantToken - 访问令牌
   * @returns {Promise<Object>} - 更新结果
   */
  async updateRecord(appToken, tableId, recordId, fields, tenantToken) {
    try {
      const response = await fetch(
        `${this.baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${tenantToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields })
        }
      );

      const data = await response.json();

      if (data.code === 0) {
        return {
          success: true,
          record: data.data.record
        };
      } else {
        throw new Error(`更新记录失败: ${data.msg}`);
      }
    } catch (error) {
      throw new Error(`更新记录失败: ${error.message}`);
    }
  }

  /**
   * 连通性测试
   * @param {string} appId - 应用ID
   * @param {string} appSecret - 应用密钥
   * @param {string} tableUrl - 表格URL
   * @returns {Promise<Object>} - 测试结果
   */
  async testConnection(appId, appSecret, tableUrl) {
    try {
      // 1. 获取Token
      const tenantToken = await this.getTenantToken(appId, appSecret);

      // 2. 解析表格URL
      const { app_token, table_id } = this.parseTableUrl(tableUrl);

      // 3. 获取字段列表
      const fields = await this.getTableFields(app_token, table_id, tenantToken);

      return {
        success: true,
        message: '连接测试成功',
        appToken: app_token,
        tableId: table_id,
        fields: fields
      };
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

// 创建全局API客户端实例
const feishuAPI = new FeishuAPIClient();

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FeishuAPIClient, feishuAPI };
}

// 在Chrome扩展环境中使用
if (typeof window !== 'undefined') {
  window.FeishuAPI = { FeishuAPIClient, feishuAPI };
}

// 在Service Worker环境中使用 - 确保总是可用
if (typeof globalThis !== 'undefined') {
  globalThis.FeishuAPI = { FeishuAPIClient, feishuAPI };
}