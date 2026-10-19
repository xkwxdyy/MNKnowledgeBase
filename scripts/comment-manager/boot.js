    // 初始化
    // ========================================
    const MANAGED_COMMENT_AUTO_REFRESH_INTERVAL = 2500;
    let managedCommentAutoRefreshTimer = null;
    let managedCommentAutoRefreshEnabled = false;

    function startManagedCommentAutoRefresh() {
      if (!managedCommentAutoRefreshEnabled || managedCommentAutoRefreshTimer !== null || shouldLoadTestData()) return false;
      managedCommentAutoRefreshTimer = setInterval(() => {
        try {
          if (typeof applyDeferredCommentSnapshotIfReady === 'function'
            && applyDeferredCommentSnapshotIfReady()) return;
          if (!state.noteId || state.isCommentsRendering === true) return;
          if (!window.Bridge || typeof Bridge.refreshManagedCommentData !== 'function') return;
          Bridge.refreshManagedCommentData(state.noteId);
        } catch (error) {
          debugLog(`[HTML Error] managed comment auto refresh failed: ${error.message}`);
        }
      }, MANAGED_COMMENT_AUTO_REFRESH_INTERVAL);
      return true;
    }

    function stopManagedCommentAutoRefresh() {
      if (managedCommentAutoRefreshTimer === null) return false;
      clearInterval(managedCommentAutoRefreshTimer);
      managedCommentAutoRefreshTimer = null;
      return true;
    }

    function setManagedCommentAutoRefreshEnabled(enabled) {
      managedCommentAutoRefreshEnabled = enabled === true;
      if (!managedCommentAutoRefreshEnabled) {
        stopManagedCommentAutoRefresh();
        return false;
      }
      return startManagedCommentAutoRefresh();
    }

    window.setManagedCommentAutoRefreshEnabled = setManagedCommentAutoRefreshEnabled;

    function init() {
      mirrorConsoleToNative();

      // 绑定事件
      attachEventListeners();
      handleCompactLayoutResize();

      if (shouldLoadTestData()) {
        loadTestData();
      }

      // 渲染初始界面（等待 Native 数据时显示空状态）
      renderComments();
      setSelectionModeButtonActive(state.selectionMode);
      updateUI();

      // 全局错误上报，方便定位无响应问题
      window.onerror = function(message, source, lineno, colno, error) {
        const stack = error && error.stack ? `\nstack: ${error.stack}` : '';
        const errMsg = `[HTML Error] ${message} @ ${source}:${lineno}:${colno}${stack}`;
        console.error(errMsg, error);
        debugLog(errMsg);
        return false; // 不阻止默认行为
      };

      // Promise 未捕获错误
      window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason || {};
        const stack = reason && reason.stack ? `\nstack: ${reason.stack}` : '';
        const errMsg = `[HTML UnhandledRejection] ${reason.message || reason} ${stack}`;
        debugLog(errMsg);
      });
    }

    function shouldLoadTestData() {
      try {
        if (window.__MNKB_USE_TEST_DATA__ === true) return true;
        if (typeof location !== 'undefined' && /(?:\?|&)debugTestData=1(?:&|$)/.test(location.search || '')) {
          return true;
        }
      } catch (error) {
        // ignore
      }
      return false;
    }

    // ========================================

    // 启动
    // ========================================
    window.addEventListener('pagehide', () => {
      setManagedCommentAutoRefreshEnabled(false);
    });

    window.addEventListener('beforeunload', () => {
      setManagedCommentAutoRefreshEnabled(false);
    });

    document.addEventListener('DOMContentLoaded', init);
  
