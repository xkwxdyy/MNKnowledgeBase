    const COMMENT_SCHEME = 'mnknowledgebase-comment';
    const COMMENT_PREVIEW_COLLAPSE_THRESHOLD = 100;
    const COMMENT_MEDIA_ERROR_ATTR = 'data-media-error-text';

    const NATIVE_REQUEST_GAP_MS = 16;
    const NATIVE_QUEUE_MAX_LENGTH = 240;
    const NATIVE_QUEUE_DEBUG_THROTTLE_MS = 120;
    const nativeActionQueue = [];
    const nativeLogQueue = [];
    let nativeQueueFlushing = false;
    let nativeQueueDebugLastEmitAt = 0;
    let nativeQueueDebugBadge = null;

    function detectNativeQueueDebugEnabled() {
      try {
        if (window.__MNKB_COMMENT_QUEUE_DEBUG__ === true) return true;
        if (typeof location !== 'undefined' && /(?:\?|&)debugQueue=1(?:&|$)/.test(location.search || '')) {
          return true;
        }
      } catch (error) {
        // ignore
      }
      return false;
    }

    let nativeQueueDebugEnabled = detectNativeQueueDebugEnabled();

    const nativeQueueStats = {
      enqueuedAction: 0,
      enqueuedLog: 0,
      sentAction: 0,
      sentLog: 0,
      droppedAction: 0,
      droppedLog: 0,
      lastSentAction: '',
      lastSentAt: 0,
    };

    function buildNativeQueueState(reason = '') {
      return {
        reason,
        actionQueueLength: nativeActionQueue.length,
        logQueueLength: nativeLogQueue.length,
        totalQueueLength: getNativeQueueLength(),
        flushing: nativeQueueFlushing,
        debugEnabled: nativeQueueDebugEnabled,
        stats: {
          enqueuedAction: nativeQueueStats.enqueuedAction,
          enqueuedLog: nativeQueueStats.enqueuedLog,
          sentAction: nativeQueueStats.sentAction,
          sentLog: nativeQueueStats.sentLog,
          droppedAction: nativeQueueStats.droppedAction,
          droppedLog: nativeQueueStats.droppedLog,
          lastSentAction: nativeQueueStats.lastSentAction,
          lastSentAt: nativeQueueStats.lastSentAt,
        },
      };
    }

    function ensureNativeQueueDebugBadge() {
      if (!nativeQueueDebugEnabled) {
        if (nativeQueueDebugBadge) {
          nativeQueueDebugBadge.style.display = 'none';
        }
        return null;
      }

      if (nativeQueueDebugBadge && document.body && document.body.contains(nativeQueueDebugBadge)) {
        nativeQueueDebugBadge.style.display = 'block';
        return nativeQueueDebugBadge;
      }

      if (!document || !document.body) return null;

      const badge = document.createElement('div');
      badge.id = 'nativeQueueDebugBadge';
      badge.style.position = 'fixed';
      badge.style.right = '10px';
      badge.style.bottom = '10px';
      badge.style.zIndex = '25000';
      badge.style.padding = '4px 8px';
      badge.style.borderRadius = '6px';
      badge.style.fontSize = '11px';
      badge.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      badge.style.background = 'rgba(17, 24, 39, 0.78)';
      badge.style.color = '#ffffff';
      badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
      badge.style.pointerEvents = 'none';
      badge.style.backdropFilter = 'blur(2px)';

      nativeQueueDebugBadge = badge;
      document.body.appendChild(badge);
      return nativeQueueDebugBadge;
    }

    function updateNativeQueueDebugBadge(reason = '') {
      const badge = ensureNativeQueueDebugBadge();
      if (!badge) return;

      const actionLen = nativeActionQueue.length;
      const logLen = nativeLogQueue.length;
      const total = actionLen + logLen;
      const flushFlag = nativeQueueFlushing ? ' ⚡' : '';
      const dropped = nativeQueueStats.droppedAction + nativeQueueStats.droppedLog;

      let text = `Q A:${actionLen} L:${logLen} T:${total}${flushFlag}`;
      if (dropped > 0) {
        text += ` D:${dropped}`;
      }
      if (reason) {
        text += ` | ${reason}`;
      }

      badge.textContent = text;
    }

    function emitNativeQueueState(reason = '', force = false) {
      if (!nativeQueueDebugEnabled) return;
      const now = Date.now();
      if (!force && now - nativeQueueDebugLastEmitAt < NATIVE_QUEUE_DEBUG_THROTTLE_MS) {
        return;
      }
      nativeQueueDebugLastEmitAt = now;
      window.__MNKB_COMMENT_QUEUE_STATE__ = buildNativeQueueState(reason);
      updateNativeQueueDebugBadge(reason);
    }

    window.__MNKBCommentSetQueueDebug = function(enabled) {
      nativeQueueDebugEnabled = !!enabled;
      window.__MNKB_COMMENT_QUEUE_DEBUG__ = nativeQueueDebugEnabled;
      emitNativeQueueState('toggle-debug', true);
      updateNativeQueueDebugBadge('toggle-debug');
      return window.__MNKB_COMMENT_QUEUE_STATE__ || buildNativeQueueState('toggle-debug');
    };

    window.__MNKBCommentGetQueueState = function(reason = 'manual-inspect') {
      const snapshot = buildNativeQueueState(reason);
      window.__MNKB_COMMENT_QUEUE_STATE__ = snapshot;
      return snapshot;
    };

    function getNativeQueueLength() {
      return nativeActionQueue.length + nativeLogQueue.length;
    }

    function trimNativeQueueIfNeeded() {
      while (getNativeQueueLength() > NATIVE_QUEUE_MAX_LENGTH) {
        if (nativeLogQueue.length > 0) {
          nativeLogQueue.shift();
          nativeQueueStats.droppedLog += 1;
        } else if (nativeActionQueue.length > 0) {
          nativeActionQueue.shift();
          nativeQueueStats.droppedAction += 1;
        } else {
          break;
        }
      }
      emitNativeQueueState('trim-queue');
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
        const url = generateUrlScheme(COMMENT_SCHEME, request.action, request.params || {});
        window.location.href = url;
        if (request.priority === 'low') {
          nativeQueueStats.sentLog += 1;
        } else {
          nativeQueueStats.sentAction += 1;
        }
        nativeQueueStats.lastSentAction = request.action || '';
        nativeQueueStats.lastSentAt = Date.now();
      } catch (error) {
        console.error('发送 Native 请求失败:', error);
      }

      emitNativeQueueState('flush-send');

      setTimeout(flushNativeQueue, NATIVE_REQUEST_GAP_MS);
    }

    function enqueueNativeRequest(action, params = {}, options = {}) {
      const priority = options && options.priority === 'low' ? 'low' : 'high';
      const request = { action, params, priority };

      if (priority === 'low') {
        nativeLogQueue.push(request);
        nativeQueueStats.enqueuedLog += 1;
      } else {
        nativeActionQueue.push(request);
        nativeQueueStats.enqueuedAction += 1;
      }

      trimNativeQueueIfNeeded();

      if (!nativeQueueFlushing) {
        nativeQueueFlushing = true;
        setTimeout(flushNativeQueue, 0);
      }

      emitNativeQueueState('enqueue');
    }

    // 发送 URL Scheme（统一走队列，避免 window.location.href 连续调用互相覆盖）
    function sendURLToNative(action, params = {}, options = {}) {
      enqueueNativeRequest(action, params, options);
    }

    /**
     * 定位到指定 noteId 的卡片
     * @param {string} noteId - 卡片 ID
     */
    function focusNoteById(noteId) {
      if (!noteId) {
        safeHUD('卡片 ID 无效');
        return;
      }
      // 使用已有的 focusCardInMindMap 动作
      sendURLToNative('focusCardInMindMap', { noteId: noteId });
    }

    function logToNativeDirect(message, level = 'INFO') {
      try {
        sendURLToNative('htmlLog', {
          message,
          source: 'commentManager',
          level,
        }, { priority: 'low' });
      } catch (error) {
        // 忽略日志发送失败
      }
    }

    function debugLog(message) {
      const text = String(message || '');
      const isError = /^\[HTML Error\]/i.test(text);
      if (!isError && window.__MNKB_COMMENT_DEBUG__ !== true) return;
      logToNativeDirect(text, isError ? 'ERROR' : 'INFO');
    }

    function formatLogPayload(value) {
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

    function mirrorConsoleToNative() {
      if (window.__MNKBCommentConsoleMirrored__) return;
      window.__MNKBCommentConsoleMirrored__ = true;

      const levels = ['warn', 'error'];
      if (window.__MNKB_COMMENT_MIRROR_LOG__ === true) {
        levels.unshift('log');
      }

      levels.forEach((level) => {
        if (!console || typeof console[level] !== 'function') return;
        const original = console[level].bind(console);
        console[level] = function(...args) {
          try {
            const payload = args.map(formatLogPayload).filter(Boolean).join(' ');
            if (payload) {
              const clipped = payload.length > 1000 ? `${payload.slice(0, 1000)}…` : payload;
              logToNativeDirect(
                `[HTML ${level.toUpperCase()}] ${clipped}`,
                level === 'error' ? 'ERROR' : (level === 'warn' ? 'WARN' : 'INFO'),
              );
            }
          } catch (error) {
            // ignore mirror error
          }
          return original(...args);
        };
      });
    }

    // 安全 HUD（MN 环境可用，否则降级为 toast）
    function safeHUD(message, duration = 1.5) {
      try {
        if (window.MNUtil && typeof MNUtil.showHUD === 'function') {
          MNUtil.showHUD(message, duration);
          return;
        }
      } catch (err) {
        // ignore
      }
      showToast(message, duration * 1000);
    }

    // ========================================
    // 全局状态管理
    // ========================================
    const state = {
      noteId: null,
      noteTitle: '',
      comments: [],
      fields: [],
      selectedIndices: new Set(),
      hasNativeData: false,
      loadStatus: 'loading',
      loadError: '',
      isCommentsRendering: false,
      revision: '',
      lastRequestId: 0,
      deferredSnapshot: null,
      hasDeferredUpdate: false,
      pendingMutations: new Map(),
      compactPanel: '',

      // 选择模式: 'manual' | 'range' | 'auto' | 'quick'
      selectionMode: 'manual',
      rangeSelectStart: null,   // 范围选择的起始索引

	      // 移动模式
	      moveMode: false,          // 是否处于移动模式
	      currentFieldId: null,     // 当前滚动所在字段（用于目录高亮）

      // 编辑链接状态
      editingLink: {
        commentIndex: null,
        linkIndex: null,
        originalDisplayText: '',
        originalUrl: ''
      }
    };

    const confirmDialogState = {
      onConfirm: null,
      onCancel: null,
    };

    // ========================================
    // DOM 元素引用
    // ========================================
	    const dom = {
	      noteTitle: document.getElementById('noteTitle'),
	      mainContent: document.querySelector('.main-content'),
	      totalCount: document.getElementById('totalCount'),
	      selectedCount: document.getElementById('selectedCount'),
	      currentField: document.getElementById('currentField'),
	      refreshCurrentNoteBtn: document.getElementById('refreshCurrentNoteBtn'),
	      commentsList: document.getElementById('commentsList'),
	      commentsSection: document.querySelector('.comments-section'),

      // 选择工具栏
      manualSelectBtn: document.getElementById('manualSelectBtn'),
      rangeSelectBtn: document.getElementById('rangeSelectBtn'),
      autoNewBtn: document.getElementById('autoNewBtn'),
      last1Btn: document.getElementById('last1Btn'),
      last2Btn: document.getElementById('last2Btn'),

      // 范围选择提示
      rangeSelectHint: document.getElementById('rangeSelectHint'),
      rangeHintText: document.getElementById('rangeHintText'),
      rangeConfirmBtn: document.getElementById('rangeConfirmBtn'),
      rangeCancelBtn: document.getElementById('rangeCancelBtn'),

      // 快捷操作（保留用于手动模式）
      selectAllBtn: document.getElementById('selectAllBtn'),
      invertBtn: document.getElementById('invertBtn'),
      clearBtn: document.getElementById('clearBtn'),

	      // 主要操作
	      moveBtn: document.getElementById('moveBtn'),
	      extractBtn: document.getElementById('extractBtn'),
	      deleteBtn: document.getElementById('deleteBtn'),

		      // 右侧功能栏
		      moveTopBtn: document.getElementById('moveTopBtn'),
		      moveBottomBtn: document.getElementById('moveBottomBtn'),
		      moveExcerptBottomBtn: document.getElementById('moveExcerptBottomBtn'),
		      moveProofTopBtn: document.getElementById('moveProofTopBtn'),
		      moveProofBottomBtn: document.getElementById('moveProofBottomBtn'),
		      moveUpBtn: document.getElementById('moveUpBtn'),
		      moveDownBtn: document.getElementById('moveDownBtn'),
		      customMoveBtn: document.getElementById('customMoveBtn'),
		      cancelMoveBtn: document.getElementById('cancelMoveBtn'),
		      fieldNavList: document.getElementById('fieldNavList'),
		      updateLinkBtn: document.getElementById('updateLinkBtn'),
		      convertLinksToInlineBtn: document.getElementById('convertLinksToInlineBtn'),
		      mergeInlineLinksBtn: document.getElementById('mergeInlineLinksBtn'),
		      mergeTextCommentsBtn: document.getElementById('mergeTextCommentsBtn'),
		      batchDeleteBtn: document.getElementById('batchDeleteBtn'),

	      closeBtn: document.getElementById('closeBtn'),
	      compactToolTabs: Array.from(document.querySelectorAll('[data-compact-panel]')),
	      compactPanelCloseButtons: Array.from(document.querySelectorAll('[data-close-compact-panel]')),
	      compactPanelBackdrop: document.getElementById('compactPanelBackdrop'),
	      selectionToolsPanel: document.getElementById('selectionToolsPanel'),
	      organizeToolsPanel: document.getElementById('organizeToolsPanel'),
	      compactPanelTitle: document.getElementById('compactPanelTitle'),
      toast: document.getElementById('toast'),

      // 手动合并行内链接
      mergeInlineModal: document.getElementById('mergeInlineModal'),
      mergeMaterialList: document.getElementById('mergeMaterialList'),
      mergeBuilderText: document.getElementById('mergeBuilderText'),
      mergeBuilderLink: document.getElementById('mergeBuilderLink'),
      mergeInsertTextBtn: document.getElementById('mergeInsertTextBtn'),
      mergeInsertInlineLinkBtn: document.getElementById('mergeInsertInlineLinkBtn'),
      mergeClearBuilderBtn: document.getElementById('mergeClearBuilderBtn'),
      mergeCookingText: document.getElementById('mergeCookingText'),
      mergeClearCookingBtn: document.getElementById('mergeClearCookingBtn'),
      mergeInlineCancelBtn: document.getElementById('mergeInlineCancelBtn'),
      mergeInlineConfirmBtn: document.getElementById('mergeInlineConfirmBtn'),

      // 合并文本评论
      mergeTextModal: document.getElementById('mergeTextModal'),
      textMergeMaterialList: document.getElementById('textMergeMaterialList'),
      textMergeSeparatorGroup: document.getElementById('textMergeSeparatorGroup'),
      textMergeCustomSeparator: document.getElementById('textMergeCustomSeparator'),
      textMergeLoadBtn: document.getElementById('textMergeLoadBtn'),
      textMergeRebuildBtn: document.getElementById('textMergeRebuildBtn'),
      textMergeClearBtn: document.getElementById('textMergeClearBtn'),
      textMergeCookingText: document.getElementById('textMergeCookingText'),
      mergeTextCancelBtn: document.getElementById('mergeTextCancelBtn'),
      mergeTextConfirmBtn: document.getElementById('mergeTextConfirmBtn'),

      // 批量删除
      batchDeleteModal: document.getElementById('batchDeleteModal'),
      batchDeleteTypeList: document.getElementById('batchDeleteTypeList'),
      batchDeleteSummary: document.getElementById('batchDeleteSummary'),
      batchDeleteCancelBtn: document.getElementById('batchDeleteCancelBtn'),
      batchDeleteConfirmBtn: document.getElementById('batchDeleteConfirmBtn'),

      // 链接编辑相关
      editLinkModal: document.getElementById('editLinkModal'),
      editLinkPreview: document.getElementById('editLinkPreview'),
      editDisplayText: document.getElementById('editDisplayText'),
      copyDisplayTextBtn: document.getElementById('copyDisplayTextBtn'),
      pasteDisplayTextBtn: document.getElementById('pasteDisplayTextBtn'),
      editLinkUrl: document.getElementById('editLinkUrl'),
      copyLinkUrlBtn: document.getElementById('copyLinkUrlBtn'),
      pasteLinkUrlBtn: document.getElementById('pasteLinkUrlBtn'),
      editReplacementMarkdown: document.getElementById('editReplacementMarkdown'),
      editReplacementMarkdownError: document.getElementById('editReplacementMarkdownError'),
      pasteReplacementMarkdownBtn: document.getElementById('pasteReplacementMarkdownBtn'),
      useSelectionBtn: document.getElementById('useSelectionBtn'),
      editLinkCancelBtn: document.getElementById('editLinkCancelBtn'),
      editLinkConfirmBtn: document.getElementById('editLinkConfirmBtn'),

      // 通用确认弹窗
      confirmModal: document.getElementById('confirmModal'),
      confirmModalTitle: document.getElementById('confirmModalTitle'),
      confirmModalMessage: document.getElementById('confirmModalMessage'),
      confirmModalCancelBtn: document.getElementById('confirmModalCancelBtn'),
      confirmModalConfirmBtn: document.getElementById('confirmModalConfirmBtn')
    };

    let commentCardNodeMap = new Map();
    let commentCheckboxNodeMap = new Map();
    let fieldHeaderNodeMap = new Map();
    let fieldHeaderByIndexMap = new Map();
    let fieldHeaderCheckboxByIndexMap = new Map();
    let fieldHeaderPositionList = [];
    let fieldHeaderPositionRefreshRaf = null;
    let fieldHeaderPositionVersion = 0;
    let lastFieldScrollAnchorTop = NaN;
    let lastFieldScrollVersion = -1;
    let commentLookupByIndex = new Map();
    let commentPositionByIndex = new Map();
    let fieldLookupById = new Map();
    let fieldNavButtonMap = new Map();
    let fieldNavCountNodeMap = new Map();
    let htmlMDAnchorNavButtonMap = new Map();
    let htmlMDGroupLookupById = new Map();
    let htmlMDGroupHeaderNodeMap = new Map();
    let htmlMDGroupCheckboxNodeMap = new Map();
    let htmlMDGroupCollapsedIds = new Set();
    let fieldNavStructureKey = '';
    let fieldNavCountSignature = '';
    let activeFieldNavButton = null;
    let activeHtmlMDAnchorButton = null;
    let fieldGroupNodeMap = new Map();
    let fieldCommentsContainerMap = new Map();
    let rangeStyledIndices = new Set();
    let rangeStartStyledIndex = null;
    let previousSelectedIndexSet = new Set();
    let insertPointNodes = [];
    let fieldHeaderClickTimer = null;
    let activeSelectionModeButton = null;
    let commentsRenderVersion = 0;
    let commentsRenderTaskRaf = 0;
    let pendingCommentViewRestore = null;
    let pendingPreferredCommentIndex = -1;

    const COMMENT_RENDER_CHUNK_THRESHOLD = 200;
    const COMMENT_RENDER_FRAME_BUDGET_MS = 7;
    const COMMENT_RENDER_MIN_BATCH_SIZE = 4;
    const COMMENT_RENDER_MAX_BATCH_SIZE = 80;

    const primaryActionButtons = [
      dom.moveBtn,
      dom.customMoveBtn,
      dom.moveTopBtn,
      dom.moveBottomBtn,
      dom.moveExcerptBottomBtn,
      dom.moveProofTopBtn,
      dom.moveProofBottomBtn,
      dom.moveUpBtn,
      dom.moveDownBtn,
      dom.extractBtn,
      dom.deleteBtn,
      dom.convertLinksToInlineBtn,
      dom.mergeInlineLinksBtn,
      dom.mergeTextCommentsBtn,
    ];

    const uiSnapshot = {
      noteTitle: null,
      totalCount: -1,
      selectedCount: -1,
      actionButtonsDisabled: null,
    };

    const managedModalFocusOrigins = new WeakMap();
    let managedFocusRevision = 0;

    function scheduleManagedFocus(target, options = {}) {
      const revision = managedFocusRevision;
      const activeElement = document.activeElement;
      if (!target || typeof target.focus !== 'function') return;
      setTimeout(() => {
        if (revision !== managedFocusRevision || document.activeElement !== activeElement
          || target.disabled || !document.documentElement.contains(target)
          || target.closest('[aria-hidden="true"]')) return;
        target.focus();
        if (options.selectText && typeof target.select === 'function') target.select();
      }, 0);
    }

    function getVisibleManagedModals() {
      return Array.from(document.querySelectorAll('.modal-overlay.show'));
    }

    function showManagedModal(modal, options = {}) {
      if (!modal) return false;
      const { initialFocus = null, selectText = false } = options;
      managedFocusRevision += 1;
      if (!modal.classList.contains('show')) {
        managedModalFocusOrigins.set(modal, document.activeElement || null);
      }
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      const focusTarget = initialFocus
        || modal.querySelector('[autofocus]')
        || modal.querySelector('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      scheduleManagedFocus(focusTarget, { selectText });
      return true;
    }

    function hideManagedModal(modal) {
      if (!modal || !modal.classList.contains('show')) return false;
      managedFocusRevision += 1;
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      const focusOrigin = managedModalFocusOrigins.get(modal);
      managedModalFocusOrigins.delete(modal);
      const focusOriginIsHidden = focusOrigin && focusOrigin.closest
        ? !!focusOrigin.closest('[aria-hidden="true"]')
        : false;
      const fallbackFocus = dom.compactToolTabs && dom.compactToolTabs[0];
      const focusTarget = focusOrigin
        && !focusOriginIsHidden
        && document.documentElement.contains(focusOrigin)
        ? focusOrigin
        : fallbackFocus;
      scheduleManagedFocus(focusTarget);
      return true;
    }

    function trapFocusInTopModal(event) {
      if (!event || event.key !== 'Tab') return false;
      const visibleModals = getVisibleManagedModals();
      const compactPanel = state.compactPanel === 'selection'
        ? dom.selectionToolsPanel
        : (state.compactPanel ? dom.organizeToolsPanel : null);
      const modal = visibleModals[visibleModals.length - 1] || compactPanel;
      if (!modal) return false;
      const focusable = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        return true;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return true;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
        return true;
      }
      if (!modal.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return true;
      }
      return false;
    }

    function setCompactPanelTitle(label = '整理与定位') {
      if (!dom.compactPanelTitle) return;
      const index = document.createElement('span');
      index.className = 'panel-index';
      index.textContent = '02';
      dom.compactPanelTitle.replaceChildren(index, document.createTextNode(label));
    }

    function closeCompactToolsPanel(options = {}) {
      managedFocusRevision += 1;
      const { restoreFocus = true } = options;
      const previousPanel = state.compactPanel;
      state.compactPanel = '';
      document.body.removeAttribute('data-compact-panel');
      if (dom.selectionToolsPanel) dom.selectionToolsPanel.classList.remove('compact-open');
      if (dom.organizeToolsPanel) dom.organizeToolsPanel.classList.remove('compact-open');
      const panelsAreInline = window.innerWidth >= 1000;
      [dom.selectionToolsPanel, dom.organizeToolsPanel].forEach((panel) => {
        if (!panel) return;
        panel.setAttribute('aria-hidden', panelsAreInline ? 'false' : 'true');
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
      });
      if (dom.mainContent) dom.mainContent.removeAttribute('aria-hidden');
      if (dom.compactPanelBackdrop) {
        dom.compactPanelBackdrop.classList.remove('show');
        dom.compactPanelBackdrop.setAttribute('aria-hidden', 'true');
      }
      dom.compactToolTabs.forEach((button) => {
        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
      });
      setCompactPanelTitle();
      if (restoreFocus && previousPanel) {
        const sourceButton = dom.compactToolTabs.find((button) => button.dataset.compactPanel === previousPanel);
        if (sourceButton && typeof sourceButton.focus === 'function') sourceButton.focus();
      }
      return !!previousPanel;
    }

    function openCompactToolsPanel(panel) {
      if (window.innerWidth >= 1000) {
        closeCompactToolsPanel({ restoreFocus: false });
        return false;
      }
      const normalizedPanel = panel === 'fields' ? 'fields' : (panel === 'organize' ? 'organize' : 'selection');
      if (state.compactPanel === normalizedPanel) {
        closeCompactToolsPanel();
        return false;
      }
      managedFocusRevision += 1;
      state.compactPanel = normalizedPanel;
      document.body.dataset.compactPanel = normalizedPanel;
      const useSelectionPanel = normalizedPanel === 'selection';
      if (dom.selectionToolsPanel) dom.selectionToolsPanel.classList.toggle('compact-open', useSelectionPanel);
      if (dom.organizeToolsPanel) dom.organizeToolsPanel.classList.toggle('compact-open', !useSelectionPanel);
      [dom.selectionToolsPanel, dom.organizeToolsPanel].forEach((panelNode) => {
        if (!panelNode) return;
        panelNode.removeAttribute('role');
        panelNode.removeAttribute('aria-modal');
      });
      if (dom.selectionToolsPanel) dom.selectionToolsPanel.setAttribute('aria-hidden', useSelectionPanel ? 'false' : 'true');
      if (dom.organizeToolsPanel) dom.organizeToolsPanel.setAttribute('aria-hidden', useSelectionPanel ? 'true' : 'false');
      const targetPanel = useSelectionPanel ? dom.selectionToolsPanel : dom.organizeToolsPanel;
      if (targetPanel) {
        targetPanel.setAttribute('role', 'dialog');
        targetPanel.setAttribute('aria-modal', 'true');
      }
      if (dom.mainContent) dom.mainContent.setAttribute('aria-hidden', 'true');
      if (dom.compactPanelBackdrop) {
        dom.compactPanelBackdrop.classList.add('show');
        dom.compactPanelBackdrop.setAttribute('aria-hidden', 'false');
      }
      setCompactPanelTitle(normalizedPanel === 'fields' ? '字段导航' : '整理评论');
      dom.compactToolTabs.forEach((button) => {
        const active = button.dataset.compactPanel === normalizedPanel;
        button.classList.toggle('active', active);
        button.setAttribute('aria-expanded', active ? 'true' : 'false');
      });
      const closeButton = targetPanel && targetPanel.querySelector('[data-close-compact-panel]');
      scheduleManagedFocus(closeButton);
      return true;
    }

    function handleCompactLayoutResize() {
      closeCompactToolsPanel({ restoreFocus: false });
    }

    function setPrimaryActionButtonsDisabled(disabled) {
      const nextDisabled = !!disabled;
      primaryActionButtons.forEach((button) => {
        if (button) {
          button.disabled = nextDisabled;
        }
      });
    }

    function setSelectionModeButtonActive(mode) {
      const nextMode = mode === 'range' ? 'range' : 'manual';
      const nextButton = nextMode === 'range' ? dom.rangeSelectBtn : dom.manualSelectBtn;

      if (activeSelectionModeButton === nextButton) {
        return;
      }

      if (activeSelectionModeButton) {
        activeSelectionModeButton.classList.remove('active');
      }

      if (nextButton) {
        nextButton.classList.add('active');
      }

      activeSelectionModeButton = nextButton;
    }

    // ========================================
