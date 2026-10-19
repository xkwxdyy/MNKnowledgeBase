'use strict';

function handleBridgeSetSearchResults(results, options = {}) {
          const datasetKey = resolveBridgeDatasetKey(options);
          setCardsForDataset(datasetKey, results, options);
        }

        function handleBridgeAppendSearchResults(results, options = {}) {
          const datasetKey = resolveBridgeDatasetKey(options);
          setCardsForDataset(datasetKey, results, { replace: false });
        }

        function handleBridgeSetSearchQuery(query, options = {}) {
          const text = (query || '').toString().trim();
          if (!text) {
            return false;
          }
          state.userInput = text;
          syncSearchUsageRoundFromInput(text);
          if (dom.searchInput) {
            dom.searchInput.value = text;
          }
          scheduleSearch({ triggerNative: false });
          if (options.focus) {
            expandFiltersForSearchInput();
            focusSearchInput({ bypassSuppression: true, ensure: true });
          }
          return true;
        }

        function handleBridgeShowAIRecommendations(recommendations) {
          setAIRecommendations(recommendations);
          setAIRecommendLoading(false);
          ensureSidebarVisible({ openIfCompact: true });
          if (Array.isArray(state.aiRecommendations) && state.aiRecommendations.length) {
            showToast(`✅ 已生成 ${state.aiRecommendations.length} 条 AI 推荐`);
          } else {
            showToast('⚠️ 未生成推荐结果');
          }
        }

        function handleBridgeSetPresets(presets) {
          if (!presets) return;
          bumpSearchExecutionRevision('setPresets');
          state.config.presetGroups = normalizePresetConfig(presets);
          state.activePresets.clear();
          renderPresetBar();
          scheduleSearch({ triggerNative: false });
        }

        function handleBridgeSetNegativePresets(presets) {
          if (!Array.isArray(presets)) return;
          bumpSearchExecutionRevision('setNegativePresets');
          state.config.negativePresets = Array.from(new Set(presets.filter(Boolean)));
          state.activeNegativePresets.clear();
          renderNegativeBar();
          scheduleSearch({ triggerNative: false });
        }

        function normalizeBridgeTypeFilters(filters) {
          return filters
            .map((filter, index) => ({
              key: filter.key || filter.value || `preset-${index}`,
              label: filter.label || filter.name || filter.key || `类型 ${index + 1}`,
              types: Array.isArray(filter.types) ? filter.types.slice() : null,
            }))
            .filter(Boolean);
        }

        function handleBridgeSetTypeFilters(filters) {
          if (!Array.isArray(filters) || !filters.length) return;
          bumpSearchExecutionRevision('setTypeFilters');
          state.config.typeFilters = normalizeBridgeTypeFilters(filters);
          state.currentTypeKey = state.config.typeFilters[0]?.key || 'all';
          renderTypeBar();
          scheduleSearch({ triggerNative: false });
        }

        function handleBridgeUpdateConfig(config) {
          if (!config || typeof config !== 'object') return;
          bumpSearchExecutionRevision('updateConfig');
          if (config.typeColors) {
            state.config.typeColors = { ...state.config.typeColors, ...config.typeColors };
          }
          if (config.colorIndexPalette) {
            state.config.colorIndexPalette = { ...state.config.colorIndexPalette, ...config.colorIndexPalette };
          }
          scheduleSearch({ triggerNative: false });
        }

        function handleBridgeSwitchDataset(datasetKey) {
          if (typeof setActiveDataset === 'function') {
            setActiveDataset(datasetKey, { requestIfEmpty: true });
            return true;
          }
          console.warn('switchDataset 未实现，已忽略', datasetKey);
          return false;
        }

        function createMNKBApi() {
          return {
            setSearchResults: handleBridgeSetSearchResults,
            appendSearchResults: handleBridgeAppendSearchResults,
            setSearchQuery: handleBridgeSetSearchQuery,
            locateCardById(noteId, options = {}) {
              return locateCardById(noteId, options);
            },
            showAIRecommendations: handleBridgeShowAIRecommendations,
            clearAIRecommendations() {
              clearAIRecommendations();
            },
            setAIRecommendLoading,
            setAIRecommendations,
            setPresets: handleBridgeSetPresets,
            setNegativePresets: handleBridgeSetNegativePresets,
            setTypeFilters: handleBridgeSetTypeFilters,
            updateConfig: handleBridgeUpdateConfig,
            resetSelection() {
              clearSelection();
            },
            switchDataset: handleBridgeSwitchDataset,
            showToast,
            postMessage: postBridge,
          };
        }

        function flushPendingBridgePayloads(api) {
          try {
            if (window.__MNKB_pendingAIRecommendations !== null && typeof window.__MNKB_pendingAIRecommendations !== 'undefined') {
              api.showAIRecommendations(window.__MNKB_pendingAIRecommendations);
              window.__MNKB_pendingAIRecommendations = null;
            }
          } catch (e) {
            // ignore
          }

          try {
            if (window.__MNKB_pendingSearchIndexData && window.Bridge && typeof window.Bridge.loadSearchIndex === 'function') {
              const pending = window.__MNKB_pendingSearchIndexData;
              window.__MNKB_pendingSearchIndexData = null;
              window.Bridge.loadSearchIndex(pending);
            }
          } catch (e) {
            // ignore
          }

          try {
            if (Array.isArray(window.__MNKB_pendingSearchIndexPatches) && window.__MNKB_pendingSearchIndexPatches.length && window.Bridge && typeof window.Bridge.applySearchIndexPatch === 'function') {
              const pendingPatches = window.__MNKB_pendingSearchIndexPatches.slice();
              window.__MNKB_pendingSearchIndexPatches = [];
              pendingPatches.forEach((patch) => {
                window.Bridge.applySearchIndexPatch(patch);
              });
            }
          } catch (e) {
            // ignore
          }

          try {
            if (window.__MNKB_pendingSearchQuery && typeof window.__MNKB_pendingSearchQuery === 'object') {
              const pending = window.__MNKB_pendingSearchQuery;
              api.setSearchQuery(pending.query, pending.options || {});
              window.__MNKB_pendingSearchQuery = null;
            }
          } catch (e) {
            // ignore
          }
        }

        function ensureMNKBBridgeShim() {
          if (!window.MNKBBridge) {
            window.MNKBBridge = {};
          }
          if (typeof window.MNKBBridge.performSearch !== 'function') {
            window.MNKBBridge.performSearch = function () {
              return false;
            };
          }
          if (typeof window.MNKBBridge.postMessage !== 'function') {
            window.MNKBBridge.postMessage = function (action, params) {
              return postToAddon(action, params);
            };
          }
        }

        function registerBridge() {
          const api = createMNKBApi();
          window.MNKB = Object.assign({}, window.MNKB || {}, api);
          syncAIRecommendationVisibility();
          flushPendingBridgePayloads(api);
          ensureMNKBBridgeShim();
          if (window.Bridge && typeof window.Bridge.notifyReady === 'function') {
            window.Bridge.notifyReady();
          }
        }

/**
 * 设置卡片数据（兼容旧接口，忽略 datasetKey）
 * @param {string} datasetKey - 数据集键（已废弃，保留用于兼容性）
 * @param {Array} results - 卡片数组
 * @param {Object} options - 选项
 */
