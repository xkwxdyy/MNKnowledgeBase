'use strict';

const NATIVE_REQUEST_GAP_MS = 16;
const NATIVE_REQUEST_QUEUE_MAX = 240;
const nativeActionQueue = [];
const nativeLogQueue = [];
let nativeQueueFlushing = false;

function trimNativeQueueIfNeeded() {
  const total = nativeActionQueue.length + nativeLogQueue.length;
  if (total <= NATIVE_REQUEST_QUEUE_MAX) {
    return;
  }

  let overflow = total - NATIVE_REQUEST_QUEUE_MAX;
  while (overflow > 0) {
    if (nativeLogQueue.length > 0) {
      nativeLogQueue.shift();
    } else if (nativeActionQueue.length > 0) {
      nativeActionQueue.shift();
    } else {
      break;
    }
    overflow -= 1;
  }
}

function takeNextNativeRequest() {
  if (nativeActionQueue.length > 0) return nativeActionQueue.shift();
  if (nativeLogQueue.length > 0) return nativeLogQueue.shift();
  return null;
}

function flushNativeQueue() {
  const request = takeNextNativeRequest();
  if (!request) {
    nativeQueueFlushing = false;
    return;
  }

  try {
    const url = generateUrlScheme('mnknowledgebase', request.action, request.params || {});
    window.location.href = url;
  } catch (error) {
    console.warn('发送 Native 请求失败', error);
  }

  setTimeout(flushNativeQueue, NATIVE_REQUEST_GAP_MS);
}

function sendURLToNative(action, params = {}, options = {}) {
  const normalizedAction = String(action || '').trim();
  if (!normalizedAction) return false;

  const explicitPriority = options && options.priority === 'low'
    ? 'low'
    : (options && options.priority === 'high' ? 'high' : '');
  const priority = explicitPriority || (
    normalizedAction === 'htmlLog' || normalizedAction === 'htmllog' ? 'low' : 'high'
  );
  const request = {
    action: normalizedAction,
    params,
  };

  if (priority === 'low') {
    nativeLogQueue.push(request);
  } else {
    nativeActionQueue.push(request);
  }

  trimNativeQueueIfNeeded();

  if (!nativeQueueFlushing) {
    nativeQueueFlushing = true;
    setTimeout(flushNativeQueue, 0);
  }

  return true;
}

function setCardsForDataset(datasetKey, results, options = {}) {
  updateCards(results, { replace: options.replace !== false });
}

function postBridge(action, params = {}, options = {}) {
  try {
    if (
      options.forceURLScheme !== true
      && window.MNKBBridge
      && typeof window.MNKBBridge.postMessage === 'function'
    ) {
      const dispatched = window.MNKBBridge.postMessage(action, params);
      if (dispatched !== false) {
        return true;
      }
    }
  } catch (error) {
    console.warn('postMessage 调用失败', error);
  }

  try {
    return postToAddon(action, params, options);
  } catch (error) {
    console.warn('postToAddon 调用失败', error);
  }

  return false;
}

function postToAddon(action, params = {}, options = {}) {
  return sendURLToNative(action, params, options);
}

function generateUrlScheme(scheme, path, params) {
  let url = `${scheme}://${path || ''}`;
  const keys = Object.keys(params || {});
  if (keys.length > 0) {
    const query = keys
      .map((key) => {
        const value = params[key];
        const serialised = typeof value === 'object' ? JSON.stringify(value) : value;
        return `${encodeURIComponent(key)}=${encodeURIComponent(serialised)}`;
      })
      .join('&');
    url += query ? `?${query}` : '';
  }
  return url;
}

function showToast(message, duration = 1600, options = {}) {
  if (!dom.toast) return;
  const text = String(message || '');
  if (!text) return;

  const dedupeWindowMs = Number(options.dedupeWindowMs) || 0;
  const now = Date.now();
  if (dedupeWindowMs > 0 && text === lastToastMessage && (now - lastToastAt) < dedupeWindowMs) {
    return;
  }

  lastToastMessage = text;
  lastToastAt = now;
  dom.toast.textContent = text;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('show');
  }, duration);
}

function showMinorSuccessToast(message, duration = 800) {
  showToast(message, duration, { dedupeWindowMs: 1200 });
}

function setRefreshReloading(loading, options = {}) {
  state.isRefreshReloading = !!loading;
  if (state.refreshReloadingTimerId) {
    clearTimeout(state.refreshReloadingTimerId);
    state.refreshReloadingTimerId = null;
  }
  if (state.isRefreshReloading && Number(options.autoResetMs) > 0) {
    state.refreshReloadingTimerId = setTimeout(() => {
      if (!state.isRefreshReloading) return;
      state.pendingRefreshRequestId = null;
      setRefreshReloading(false);
      showToast('刷新请求超时，请再试一次', 2200);
    }, Number(options.autoResetMs));
  }
  if (!dom.refreshBtn) return;
  dom.refreshBtn.disabled = state.isRefreshReloading;
  dom.refreshBtn.textContent = '🔄';
  dom.refreshBtn.setAttribute('aria-busy', state.isRefreshReloading ? 'true' : 'false');
  dom.refreshBtn.setAttribute('aria-label', state.isRefreshReloading ? '正在刷新搜索列表' : '刷新搜索列表');
  dom.refreshBtn.title = state.isRefreshReloading ? '正在刷新搜索列表' : '刷新搜索列表';
}

function normalizeRefreshRequestId(requestId) {
  if (requestId === undefined || requestId === null) return '';
  return String(requestId).trim();
}

function createRefreshRequestId() {
  state.refreshRequestSeq = Number(state.refreshRequestSeq || 0) + 1;
  return `refresh-${Date.now()}-${state.refreshRequestSeq}`;
}

function beginRefreshReloading(requestId, options = {}) {
  state.pendingRefreshRequestId = normalizeRefreshRequestId(requestId);
  setRefreshReloading(true, options);
}

function completeRefreshReloading(payload = {}) {
  const pendingRequestId = normalizeRefreshRequestId(state.pendingRefreshRequestId);
  const incomingRequestId = normalizeRefreshRequestId(payload.requestId);

  if (pendingRequestId) {
    if (!incomingRequestId) {
      return false;
    }
    if (incomingRequestId !== pendingRequestId) {
      return false;
    }
  }

  state.pendingRefreshRequestId = null;
  setRefreshReloading(false);

  const message = (payload.message || '').toString().trim();
  if (message) {
    const duration = Number(payload.duration) > 0
      ? Number(payload.duration)
      : (payload.success === false ? 2200 : 1200);
    showToast(message, duration);
  }
  return true;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightTextWithTokens(text, tokens) {
  if (!text) return '';

  // 清理可能存在的旧占位符（防御性措施）
  text = text.replace(/__HL_\d+_\d+__/g, '');

  // 返回 HTML 转义后的纯文本，确保安全性
  // 注意：不再检测 HTML 标签，因为 <x, y> 等数学符号会被误判
  return escapeHtml(text);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
}

function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ========== 初始化 ==========

function init() {
  if (typeof window.mnkbStartupPerfMark === 'function') {
    window.mnkbStartupPerfMark('init(start)');
  }

  if (typeof debouncedInputHandler !== 'function') {
    debouncedInputHandler = debounce(handleSearchInputChange, 180);
  }
  if (typeof debouncedExclusionInputHandler !== 'function') {
    debouncedExclusionInputHandler = debounce(handleManualExclusionInputChange, 180);
  }

  loadMergeOptions();
  loadMoveOptions();
  loadTemplateOptions();
  loadSidebarOperationPreference();
  loadSidebarWidth();
  loadSearchSources();
  loadLocalSearchRoot();
  renderSearchSourceBar();
  rebuildCardLookup();
  rebuildFilteredCardLookup();
  rebuildAIRecommendationLookup();
  refreshClassificationOptions();
  renderPresetBar();
  renderTypeBar();
  renderNegativeBar();
  renderMergeOptions();
  renderMoveOptions();
  renderTemplateOptions();
  renderLastActionFeedback('merge');
  renderLastActionFeedback('move');
  renderLastActionFeedback('template');
  attachEventListeners();
  if (typeof loadSearchHistory === 'function') loadSearchHistory();
  if (typeof attachSearchHistoryListeners === 'function') attachSearchHistoryListeners();

  setupDelegation();
  registerBridge();
  loadToolbarStates(); // 加载工具栏折叠状态
  loadFilterPanelState(); // 根据视口自动折叠筛选面板
  setupResponsive();
  setupScrollBehavior();
  syncSidebarWorkflowState();

  if (typeof window.mnkbStartupPerfMark === 'function') {
    window.mnkbStartupPerfMark('init(done)');
  }
}

// 统一初始化函数：确保 DOM 完全加载后再初始化所有组件
function initAll() {
  if (typeof window.mnkbStartupPerfMark === 'function') {
    window.mnkbStartupPerfMark('initAll(start)');
  }
  if (typeof window.mnkbFlushStartupPerfMarks === 'function') {
    window.mnkbFlushStartupPerfMarks();
  }

  // 1. 主应用初始化
  init();

  // 2. 更新按钮显示状态
  applyAutoCloseModeFromNativeIfAny();
  updateAutoCloseModeButton();
  requestAutoCloseModeSyncIfNeeded();

  if (typeof window.mnkbStartupPerfMark === 'function') {
    window.mnkbStartupPerfMark('initAll(done)');
  }
  if (typeof window.mnkbFlushStartupPerfMarks === 'function') {
    window.mnkbFlushStartupPerfMarks();
  }
}

// 等待 DOM 就绪后统一初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

  
