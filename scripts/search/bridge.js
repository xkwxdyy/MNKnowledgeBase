    function formatNativeLogArg(value) {
      if (value instanceof Error) {
        const message = value.message || String(value);
        const stack = value.stack ? ` | ${value.stack.split('\n')[0]}` : '';
        return `${message}${stack}`;
      }
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (value == null) return '';
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }

    const nativeHtmlLogQueue = [];
    let nativeHtmlLogTimer = null;

    function flushNativeHtmlLogQueue() {
      if (nativeHtmlLogTimer !== null) return;

      nativeHtmlLogTimer = setTimeout(() => {
        nativeHtmlLogTimer = null;

        if (!nativeHtmlLogQueue.length) {
          return;
        }

        const payload = nativeHtmlLogQueue.shift();
        try {
          const encodedMessage = encodeURIComponent(payload.message);
          const encodedSource = encodeURIComponent(payload.source);
          const encodedLevel = encodeURIComponent(payload.level);
          window.location.href = `mnknowledgebase://htmlLog?message=${encodedMessage}&source=${encodedSource}&level=${encodedLevel}`;
        } catch (error) {
          // ignore
        }

        if (nativeHtmlLogQueue.length) {
          flushNativeHtmlLogQueue();
        }
      }, 0);
    }

    function emitHtmlLogToNative(message) {
      try {
        if (!message) return false;
        const text = String(message);
        let source = 'htmlWebView';
        let level = 'INFO';
        if (/^\[HTML ERROR\]/i.test(text)) level = 'ERROR';
        else if (/^\[HTML WARN\]/i.test(text)) level = 'WARN';
        else if (/^\[HTML INFO\]/i.test(text) && (
          window.__MNKB_BRIDGE_DEBUG__ === true || window.__MNKB_SEARCH_DEBUG__ === true
        )) source = 'searchDebug';
        else if (/^\[MNKB Startup\]/i.test(text)) source = 'startupPerf';
        else if (/^\[MNKB Search\]/i.test(text)) source = 'searchDebug';
        else if (/^\[MNKB Perf\]/i.test(text)) source = 'searchPerf';
        const payload = { message: text, source, level };

        if (typeof sendURLToNative === 'function') {
          return sendURLToNative('htmlLog', payload, { priority: 'low' });
        }

        if (typeof postToAddon === 'function') {
          return postToAddon('htmlLog', payload, { priority: 'low' });
        }

        nativeHtmlLogQueue.push(payload);
        if (nativeHtmlLogQueue.length > 80) {
          nativeHtmlLogQueue.splice(0, nativeHtmlLogQueue.length - 80);
        }
        flushNativeHtmlLogQueue();
        return true;
      } catch (error) {
        return false;
      }
    }

    function isBridgeInfoLogEnabled() {
      return window.__MNKB_BRIDGE_DEBUG__ === true
        || window.__MNKB_SEARCH_DEBUG__ === true
        || window.__MNKB_STARTUP_PERF_LOG__ === true;
    }

    function bridgeNativeLog(level, message, detail) {
      const normalizedLevel = String(level || 'info').toUpperCase();
      if (normalizedLevel === 'INFO' && !isBridgeInfoLogEnabled()) {
        return false;
      }
      const detailText = formatNativeLogArg(detail);
      const suffix = detailText ? ` | ${detailText}` : '';
      const payload = `[HTML ${normalizedLevel}] ${message}${suffix}`;
      const clippedPayload = payload.length > 1200 ? `${payload.slice(0, 1200)}…` : payload;
      return emitHtmlLogToNative(clippedPayload);
    }

    function getStartupPerfNow() {
      if (window.performance && typeof window.performance.now === 'function') {
        return window.performance.now();
      }
      return Date.now();
    }

    function isStartupPerfLogEnabled() {
      return window.__MNKB_STARTUP_PERF_LOG__ === true;
    }

    function formatStartupPerfDetail(detail) {
      if (!detail) return '';
      if (typeof detail === 'string') return detail;
      return formatNativeLogArg(detail);
    }

    function createStartupPerfEvent(stage, detail) {
      const now = getStartupPerfNow();
      const t0 = Number.isFinite(window.__MNKB_STARTUP_PERF_T0__)
        ? window.__MNKB_STARTUP_PERF_T0__
        : now;
      const last = Number.isFinite(window.__MNKB_STARTUP_PERF_LAST__)
        ? window.__MNKB_STARTUP_PERF_LAST__
        : t0;
      window.__MNKB_STARTUP_PERF_LAST__ = now;

      const elapsed = Math.max(0, now - t0).toFixed(1);
      const lap = Math.max(0, now - last).toFixed(1);
      const detailText = formatStartupPerfDetail(detail);
      const suffix = detailText ? ` | ${detailText}` : '';
      const message = `[MNKB Startup][html] +${elapsed}ms (+${lap}ms) ${stage}${suffix}`;
      return message.length > 1200 ? `${message.slice(0, 1200)}…` : message;
    }

    function flushStartupPerfMarks() {
      if (!isStartupPerfLogEnabled()) return false;
      if (typeof sendURLToNative !== 'function') return false;

      const queue = window.__MNKB_STARTUP_PERF_EVENTS__ || [];
      while (queue.length > 0) {
        emitHtmlLogToNative(queue.shift());
      }
      window.__MNKB_STARTUP_PERF_EVENTS__ = queue;
      return true;
    }

    function startupPerfMark(stage, detail) {
      if (!isStartupPerfLogEnabled()) return;

      const message = createStartupPerfEvent(stage, detail);
      if (!Array.isArray(window.__MNKB_STARTUP_PERF_EVENTS__)) {
        window.__MNKB_STARTUP_PERF_EVENTS__ = [];
      }
      window.__MNKB_STARTUP_PERF_EVENTS__.push(message);
      if (window.__MNKB_STARTUP_PERF_EVENTS__.length > 80) {
        window.__MNKB_STARTUP_PERF_EVENTS__.splice(0, window.__MNKB_STARTUP_PERF_EVENTS__.length - 80);
      }

      try {
        if (console && typeof console.log === 'function') {
          console.log(message);
        }
      } catch (error) {
        // ignore
      }

      flushStartupPerfMarks();
    }

    window.mnkbStartupPerfMark = startupPerfMark;
    window.mnkbFlushStartupPerfMarks = flushStartupPerfMarks;
    startupPerfMark('bridge.js loaded');

    function mirrorConsoleToNative() {
      if (window.__MNKBSearchConsoleMirrored__) return;
      window.__MNKBSearchConsoleMirrored__ = true;

      const levels = ['warn', 'error'];
      if (window.__MNKB_SEARCH_MIRROR_LOG__ === true) {
        levels.unshift('log');
      }

      levels.forEach((level) => {
        if (!console || typeof console[level] !== 'function') return;

        const original = console[level].bind(console);
        console[level] = function(...args) {
          try {
            const payload = args.map(formatNativeLogArg).filter(Boolean).join(' ');
            if (payload) {
              const clipped = payload.length > 1000 ? `${payload.slice(0, 1000)}…` : payload;
              emitHtmlLogToNative(`[HTML ${level.toUpperCase()}] ${clipped}`);
            }
          } catch (error) {
            // ignore mirror error
          }
          return original(...args);
        };
      });
    }

    mirrorConsoleToNative();

    // ========================================
    // Bridge 对象 - Native ↔ JS 通信接口
    // ========================================
    window.Bridge = {
      /**
       * 加载搜索索引数据 (Native → JS)
       * @param {Object} indexData - 索引数据对象
       * @param {Array} indexData.cards - 卡片数组
       */
      loadSearchIndex: function(indexData, options = {}) {
        const expectedCount = Array.isArray(indexData && indexData.cards) ? indexData.cards.length : 0;
        startupPerfMark('Bridge.loadSearchIndex(start)', `cards=${expectedCount}`);
        bridgeNativeLog('info', 'Bridge.loadSearchIndex', `cards=${expectedCount}`);

        if (!window.state) {
          window.__MNKB_pendingSearchIndexData = indexData || null;
          startupPerfMark('Bridge.loadSearchIndex(pending)', 'state not ready');
          return;
        }

        if (typeof window.bumpSearchExecutionRevision === 'function') {
          window.bumpSearchExecutionRevision('bridge.loadSearchIndex');
        }

        // 🆕 保存索引模式信息和完整 metadata
        if (indexData.metadata) {
          state.metadata = indexData.metadata; // 保存完整 metadata（包含 updateTime, totalCards 等）
          state.indexMode = indexData.metadata.mode; // "full", "light", 或 "legacy"
          bridgeNativeLog('info', '当前索引模式', state.indexMode || '-');
          bridgeNativeLog('info', '索引更新时间', state.metadata.updateTime || '-');
          // 更新界面显示
          if (typeof updateIndexModeBadge === 'function') {
            updateIndexModeBadge();
          }
        }

        // 加载排除词组配置
        if (indexData.exclusionGroups) {
          state.exclusionGroups = indexData.exclusionGroups;
          bridgeNativeLog('info', '已加载排除词组配置', `${state.exclusionGroups.length}个`);
        }

        if (indexData.synonymGroups) {
          state.config.synonymGroups = indexData.synonymGroups;
          bridgeNativeLog('info', '已加载同义词组配置', `${state.config.synonymGroups.length}个`);
        }

        // 使用 MNKB API 或直接调用 setCardsForDataset
        if (window.MNKB && typeof window.MNKB.setSearchResults === 'function') {
          window.MNKB.setSearchResults(indexData.cards || []);
        } else if (typeof setCardsForDataset === 'function') {
          setCardsForDataset('knowledge', indexData.cards || []);
        } else {
          bridgeNativeLog('error', '无法加载数据：setCardsForDataset 和 MNKB.setSearchResults 都未定义');
        }
        startupPerfMark('Bridge.loadSearchIndex(after setCards)', `stateCards=${Array.isArray(state.cards) ? state.cards.length : 0}`);

        try {
          state.hasRealData = true;
          if (typeof completeRefreshReloading === 'function') {
            completeRefreshReloading({
              requestId: options && options.refreshRequestId,
            });
          }
          if (window.__MNKB_pendingLocateId) {
            const pendingId = window.__MNKB_pendingLocateId;
            window.__MNKB_pendingLocateId = null;
            if (window.MNKB && typeof window.MNKB.locateCardById === 'function') {
              window.MNKB.locateCardById(pendingId);
            }
          }
        } catch (error) {
          bridgeNativeLog('warn', 'pending locate 处理失败', error);
        }
        startupPerfMark('Bridge.loadSearchIndex(done)', `stateCards=${Array.isArray(state.cards) ? state.cards.length : 0}`);

        const pendingLS = window.__MNKB_pendingLocalSearch;
        if (pendingLS && pendingLS.rootId && typeof activateLocalSearch === 'function') {
          window.__MNKB_pendingLocalSearch = null;
          activateLocalSearch(pendingLS.rootId, pendingLS.rootTitle || '');
        }

        if (state.localSearchRootId && state.localSearchDescendantIds && state.localSearchDescendantIds.size === 0 && window.Bridge && typeof window.Bridge.requestDescendantCardIds === 'function') {
          state.localSearchLoading = true;
          renderLocalSearchBanner();
          window.Bridge.requestDescendantCardIds(state.localSearchRootId);
        } else if (state.localSearchRootId) {
          renderLocalSearchBanner();
        }
      },

      /**
       * 应用索引差量补丁 (Native → JS)
       * @param {Object} patchData
       * @param {Array} patchData.upserts - 需要新增/更新的卡片
       * @param {Array<string>} patchData.removedIds - 需要删除的卡片 ID
       * @param {Object} patchData.metadata - 最新 metadata
       */
      applySearchIndexPatch: function(patchData, options = {}) {
        try {
          if (!window.state) {
            if (!Array.isArray(window.__MNKB_pendingSearchIndexPatches)) {
              window.__MNKB_pendingSearchIndexPatches = [];
            }
            window.__MNKB_pendingSearchIndexPatches.push(patchData || {});
            return false;
          }

          bridgeNativeLog('info', 'Bridge.applySearchIndexPatch', patchData && patchData.metadata ? patchData.metadata : 'no-metadata');
          if (typeof window.bumpSearchExecutionRevision === 'function') {
            window.bumpSearchExecutionRevision('bridge.applySearchIndexPatch');
          }

          if (typeof applyCardsPatch === 'function') {
            const patched = applyCardsPatch(patchData);
            if (patched !== false && typeof completeRefreshReloading === 'function') {
              completeRefreshReloading({
                requestId: options && options.refreshRequestId,
              });
            }
            return patched;
          }

          bridgeNativeLog('error', 'applyCardsPatch 未定义，无法应用补丁');
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'applySearchIndexPatch 失败', error);
          return false;
        }
      },

      /**
       * 刷新所有数据 (JS → Native)
       * 直接请求 Native 刷新当前搜索数据，避免重开页面打断前端状态机
       */
      refreshAllData: function(options = {}) {
        bridgeNativeLog('info', '[Bridge] refreshAllData 被调用 - 请求 Native 刷新当前数据');

        try {
          const params = {};
          if (options && options.requestId) {
            params.requestId = String(options.requestId);
          }

          if (typeof postToAddon === 'function') {
            return postToAddon('refreshAllData', params);
          }

          if (typeof postBridge === 'function') {
            return postBridge('refreshAllData', params, { forceURLScheme: true });
          }

          const query = params.requestId
            ? `?requestId=${encodeURIComponent(params.requestId)}`
            : '';
          window.location.href = `mnknowledgebase://refreshAllData${query}`;
          return true;
        } catch (error) {
          bridgeNativeLog('warn', 'refreshAllData 派发失败', error);
          return false;
        }
      },

      /**
       * 请求 Native 读取 MarginNote 当前选中的卡片 (JS → Native)
       * 只读取当前上下文，不修改卡片或搜索索引。
       */
      requestLocateCurrentMNSelectedCard: function() {
        bridgeNativeLog('info', '[Bridge] requestLocateCurrentMNSelectedCard 被调用');
        try {
          if (typeof postToAddon === 'function') {
            return postToAddon('locateCurrentMNSelectedCard', {});
          }
          if (typeof postBridge === 'function') {
            return postBridge('locateCurrentMNSelectedCard', {}, { forceURLScheme: true });
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'requestLocateCurrentMNSelectedCard 派发失败', error);
          return false;
        }
      },

      /**
       * 请求 Native 获取指定根卡片的子孙卡片 ID 列表 (JS -> Native)
       * @param {string} rootId - 根卡片的 noteId
       */
      requestDescendantCardIds: function(rootId, options = {}) {
        bridgeNativeLog('info', '[Bridge] requestDescendantCardIds', `rootId=${rootId}`);
        try {
          const id = String(rootId || '').trim();
          if (!id) return false;
          const requestId = String(options.requestId || `local-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          if (state.localSearchRootId === id) {
            state.localSearchRequestId = requestId;
          }
          const params = {
            id,
            requestId,
            usageTier: options.usageTier || '',
            usageRoundId: options.usageRoundId || '',
            indexSource: options.indexSource || '',
          };
          if (typeof postToAddon === 'function') {
            return postToAddon('getDescendantCardIds', params);
          }
          if (typeof postBridge === 'function') {
            return postBridge('getDescendantCardIds', params, { forceURLScheme: true });
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'requestDescendantCardIds 派发失败', error);
          return false;
        }
      },

      /**
       * 更新搜索结果 (Native → JS)
       * @param {Array} results - 搜索结果数组
       */
      updateResults: function(results) {
        try {
          const normalizedResults = Array.isArray(results) ? results.filter(Boolean) : [];
          bridgeNativeLog('info', 'Bridge.updateResults', `count=${normalizedResults.length}`);

          if (window.state) {
            state.filteredCards = normalizedResults.slice();
            if (typeof rebuildFilteredCardLookup === 'function') {
              rebuildFilteredCardLookup(state.filteredCards);
            }
            if (typeof resetPaginationState === 'function' && typeof renderResults === 'function') {
              renderResults(resetPaginationState(state.filteredCards));
            } else if (typeof renderResults === 'function') {
              renderResults(state.filteredCards);
            }
            if (typeof updateSearchCount === 'function') {
              updateSearchCount(normalizedResults.length);
            }
            if (typeof updateLoadMoreButton === 'function') {
              updateLoadMoreButton();
            }
            return true;
          }

          bridgeNativeLog('warn', 'state 未初始化，忽略 updateResults，避免污染全量搜索范围');
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'updateResults 失败', error);
          return false;
        }
      },

      /**
       * 设置搜索文本 (Native → JS)
       * @param {string} query - 搜索文本
       * @param {Object} options - 选项
       */
      setSearchQuery: function(query, options = {}) {
        try {
          window.__MNKB_pendingSearchQuery = {
            query,
            options: options || {},
          };

          if (window.MNKB && typeof window.MNKB.setSearchQuery === 'function') {
            return window.MNKB.setSearchQuery(query, options);
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'setSearchQuery 失败', error);
          return false;
        }
      },

      /**
       * 直接定位卡片 (Native → JS)
       * @param {string} noteId - 卡片 ID
       * @param {Object} options - 选项
       */
      locateCardById: function(noteId, options = {}) {
        try {
          window.__MNKB_pendingLocateId = noteId;
          if (window.MNKB && typeof window.MNKB.locateCardById === 'function') {
            return window.MNKB.locateCardById(noteId, options);
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'locateCardById 失败', error);
          return false;
        }
      },

      /**
       * 展示 AI 推荐卡片 (Native → JS)
       * @param {Array<string|Object>} recommendations - 推荐列表（支持 id 数组或对象数组）
       */
      showAIRecommendations: function(recommendations) {
        try {
          // 先缓存，避免 WebView 尚未完成初始化时丢失结果
          window.__MNKB_pendingAIRecommendations = recommendations;

          // 统一走 MNKB API（避免 IIFE 作用域导致函数不可见）
          if (window.MNKB && typeof window.MNKB.showAIRecommendations === 'function') {
            window.MNKB.showAIRecommendations(recommendations);
            window.__MNKB_pendingAIRecommendations = null;
            return true;
          }

          // 兜底：尽量不抛错
          if (typeof window.setAIRecommendLoading === 'function') {
            window.setAIRecommendLoading(false);
          }
          if (typeof window.setAIRecommendations === 'function') {
            window.setAIRecommendations(recommendations);
          } else if (window.state) {
            let list = recommendations;
            let debug = null;
            if (list && typeof list === 'object' && !Array.isArray(list)) {
              debug = list.debug || null;
              list = list.recommendations;
            }
            window.state.aiRecommendations = Array.isArray(list) ? list : [];
            window.state.aiRecommendDebug = (debug && typeof debug === 'object') ? debug : null;
          }
          return true;
        } catch (error) {
          bridgeNativeLog('warn', 'showAIRecommendations 失败', error);
          // 不提示“前端失败”，交给后续初始化完成后自动 flush
          try {
            window.__MNKB_pendingAIRecommendations = recommendations;
          } catch (e) {
            // ignore
          }
          return true;
        }
      },

      requestAICardSearchModels: function(options = {}) {
        try {
          if (typeof postToAddon === 'function') {
            return postToAddon('aiSearchGetModels', {
              refresh: options.refresh === true,
              requestId: String(options.requestId || '').trim(),
            });
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'AI 搜索模型列表请求失败', error);
          return false;
        }
      },

      setAICardSearchModel: function(selection = {}) {
        try {
          const source = String(selection.source || '').trim();
          const model = String(selection.model || '').trim();
          if (!source || !model || typeof postToAddon !== 'function') return false;
          return postToAddon('aiSearchSetModel', {
            source,
            model,
            requestId: String(selection.requestId || '').trim(),
          });
        } catch (error) {
          bridgeNativeLog('warn', 'AI 搜索模型设置失败', error);
          return false;
        }
      },

      requestAICardSearchRerank: function(options = {}) {
        try {
          const requestId = String(options.requestId || '').trim();
          const source = String(options.source || '').trim();
          const model = String(options.model || '').trim();
          if (!requestId || !source || !model || typeof postToAddon !== 'function') return false;
          return postToAddon('aiSearchRerank', { requestId, source, model });
        } catch (error) {
          bridgeNativeLog('warn', 'AI 搜索精排请求失败', error);
          return false;
        }
      },

      cancelAICardSearchRerank: function(options = {}) {
        try {
          const requestId = String(options.requestId || '').trim();
          if (!requestId || typeof postToAddon !== 'function') return false;
          return postToAddon('aiSearchCancelRerank', { requestId });
        } catch (error) {
          bridgeNativeLog('warn', 'AI 搜索取消请求失败', error);
          return false;
        }
      },

      setAICardSearchModelOptions: function(payload = {}) {
        try {
          if (typeof window.handleAICardSearchModelOptions === 'function') {
            return window.handleAICardSearchModelOptions(payload);
          }
          window.__MNKB_pendingAICardSearchModelOptions = payload;
          return true;
        } catch (error) {
          bridgeNativeLog('warn', 'AI 搜索模型列表回写失败', error);
          return false;
        }
      },

      completeAICardSearchRerank: function(payload = {}) {
        try {
          if (typeof window.completeAICardSearchRerank === 'function') {
            return window.completeAICardSearchRerank(payload);
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'AI 搜索精排结果回写失败', error);
          return false;
        }
      },

      /**
       * 通知初始化完成 (JS → Native)
       */
      notifyReady: function() {
        bridgeNativeLog('info', 'Bridge.notifyReady 被调用');
        try {
          if (typeof postToAddon === 'function') {
            return postToAddon('ready', {});
          }
          window.location.href = 'mnknowledgebase://ready';
          return true;
        } catch (error) {
          bridgeNativeLog('warn', 'notifyReady 失败', error);
          return false;
        }
      },

      notifyRefreshResult: function(payload = {}) {
        try {
          if (typeof completeRefreshReloading === 'function') {
            return completeRefreshReloading(payload || {});
          }
          if (typeof setRefreshReloading === 'function') {
            setRefreshReloading(false);
            return true;
          }
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'notifyRefreshResult 失败', error);
          return false;
        }
      },

      notifyLocateCurrentMNSelectedCard: function(payload = {}) {
        try {
          const normalizedPayload = payload && typeof payload === 'object'
            ? payload
            : { message: String(payload || '') };
          window.__MNKB_pendingLocateCurrentMNSelectedCardResult = normalizedPayload;
          if (typeof handleLocateMNSelectionResult === 'function') {
            const result = handleLocateMNSelectionResult(normalizedPayload);
            window.__MNKB_pendingLocateCurrentMNSelectedCardResult = null;
            return result;
          }
          return true;
        } catch (error) {
          bridgeNativeLog('warn', 'notifyLocateCurrentMNSelectedCard 失败', error);
          return false;
        }
      },

      /**
       * 接收 Native 返回的子孙卡片 ID 列表 (Native -> JS)
       * @param {Object} payload
       * @param {string} payload.rootId - 根卡片 ID
       * @param {Array<string>} payload.descendantIds - 子孙卡片 ID 数组
       * @param {string} [payload.error] - 错误信息（如有）
       */
      setDescendantCardIds: function(payload = {}) {
        try {
          bridgeNativeLog('info', 'Bridge.setDescendantCardIds', `rootId=${payload.rootId} count=${Array.isArray(payload.descendantIds) ? payload.descendantIds.length : 0}`);
          if (typeof handleSetDescendantCardIds === 'function') {
            return handleSetDescendantCardIds(payload);
          }
          bridgeNativeLog('warn', 'handleSetDescendantCardIds 未定义');
          return false;
        } catch (error) {
          bridgeNativeLog('warn', 'setDescendantCardIds 失败', error);
          return false;
        }
      },

      /**
       * 发送日志到 Native 端 (JS → Native)
       * @param {string} message - 日志消息
       */
      logToNative: function(message) {
        if (!emitHtmlLogToNative(message)) {
          bridgeNativeLog('error', 'logToNative 失败', message);
        }
      },

      /**
       * 输出日志到原生层 (JS → Native)
       * @param {string} message - 日志消息
       */
      log: function(message) {
        try {
          this.logToNative('[HTML] ' + message);
        } catch (error) {
          bridgeNativeLog('warn', 'Bridge.log 输出失败', error);
        }
      },



    };

    // 全局函数：格式化时间戳为易读格式
    window.formatUpdateTime = function(timestamp) {
      if (!timestamp) return '';

      // 兼容秒级和毫秒级时间戳
      const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
      const date = new Date(ms);

      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');

      return `${month}-${day} ${hour}:${minute}`;
    };

    // 全局函数：更新索引模式徽章
    window.updateIndexModeBadge = function() {
      const badge = document.getElementById('indexModeBadge');
      if (!badge) return;

      // 清除所有模式样式
      badge.classList.remove('index-mode-badge--full', 'index-mode-badge--light', 'index-mode-badge--legacy');

      if (!window.state || !window.state.indexMode) {
        badge.textContent = '';
        return;
      }

      // 获取更新时间
      const updateTimeStr = window.state.metadata?.updateTime
        ? ` (${formatUpdateTime(window.state.metadata.updateTime)})`
        : '';

      // 根据索引模式设置显示
      if (window.state.indexMode === 'full') {
        badge.textContent = `🔍 全量索引${updateTimeStr}`;
        badge.classList.add('index-mode-badge--full');
      } else if (window.state.indexMode === 'light') {
        badge.textContent = `🔍 轻量索引${updateTimeStr}`;
        badge.classList.add('index-mode-badge--light');
      } else if (window.state.indexMode === 'legacy') {
        badge.textContent = `🔍 旧版索引${updateTimeStr}`;
        badge.classList.add('index-mode-badge--legacy');
      }
    };
