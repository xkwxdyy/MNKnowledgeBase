    // URL Scheme 生成工具函数
    // ========================================

    /**
     * 生成 MarginNote URL Scheme
     * @param {string} scheme - URL scheme (e.g., 'mnknowledgebase-comment')
     * @param {string} path - URL path (e.g., 'moveCommentsToField')
     * @param {Object} params - Query parameters
     * @returns {string} 完整的 URL Scheme
     */
    function generateUrlScheme(scheme, path, params) {
      let url = `${scheme}://${path || ''}`;
      const keys = Object.keys(params || {});
      if (keys.length > 0) {
        const query = keys.map((key) => {
          const value = params[key];
          const serialised = typeof value === 'object' ? JSON.stringify(value) : value;
          return `${encodeURIComponent(key)}=${encodeURIComponent(serialised)}`;
        }).join('&');
        url += query ? `?${query}` : '';
      }
      return url;
    }

    // ========================================
    // Bridge 对象 - Native 与 JavaScript 通信桥梁
    // ========================================

    function normalizeIndexArrayForNative(indexArr) {
      if (!Array.isArray(indexArr)) return [];
      return indexArr
        .map((index) => parseInt(index, 10))
        .filter((index) => !Number.isNaN(index));
    }

    function parseIncomingIndexArray(indexArr) {
      return normalizeIndexArrayForNative(Array.isArray(indexArr) ? indexArr : []);
    }

    function buildNoteIdPayload(noteId, extraParams = {}) {
      return {
        id: noteId,
        ...extraParams,
      };
    }

    function buildNativeIndexPayload(noteId, indexArr, extraParams = {}) {
      return buildNoteIdPayload(noteId, {
        indexArr: JSON.stringify(normalizeIndexArrayForNative(indexArr)),
        ...extraParams,
      });
    }

    const COMMENT_MUTATION_ACTION_NAMES = new Set([
      'moveCommentsToField',
      'moveComments',
      'deleteComments',
      'deleteBidirectionalLinks',
      'extractComments',
      'updateCommentLink',
      'replacePlaceholderLink',
      'convertLinkCommentsToInlineLinks',
      'editMarkdownLink',
      'mergeInlineLinkComments',
      'mergeTextComments',
    ]);
    let commentMutationSequence = 0;

    function cloneCommentMutationValue(value) {
      if (Array.isArray(value)) return value.map((item) => cloneCommentMutationValue(item));
      if (value && typeof value === 'object') {
        const result = {};
        Object.keys(value).forEach((key) => {
          const item = value[key];
          if (typeof item !== 'function' && !(item && item.nodeType)) {
            result[key] = cloneCommentMutationValue(item);
          }
        });
        return result;
      }
      return value;
    }

    function captureCommentMutationDraft() {
      if (dom.editLinkModal && dom.editLinkModal.classList.contains('show')) {
        return {
          type: 'edit-link',
          editingLink: { ...state.editingLink },
          displayText: dom.editDisplayText ? dom.editDisplayText.value : '',
          url: dom.editLinkUrl ? dom.editLinkUrl.value : '',
          replacementMarkdown: dom.editReplacementMarkdown ? dom.editReplacementMarkdown.value : '',
        };
      }
      if (dom.mergeInlineModal && dom.mergeInlineModal.classList.contains('show')) {
        return {
          type: 'merge-inline',
          indices: mergeInlineState.indices.slice(),
          materials: cloneCommentMutationValue(mergeInlineState.materials),
          builderText: dom.mergeBuilderText ? dom.mergeBuilderText.value : '',
          builderLink: dom.mergeBuilderLink ? dom.mergeBuilderLink.value : '',
          cookingText: dom.mergeCookingText ? dom.mergeCookingText.value : '',
        };
      }
      if (dom.mergeTextModal && dom.mergeTextModal.classList.contains('show')) {
        return {
          type: 'merge-text',
          indices: textMergeState.indices.slice(),
          materials: cloneCommentMutationValue(textMergeState.materials),
          separatorKind: textMergeState.separatorKind,
          customSeparator: dom.textMergeCustomSeparator ? dom.textMergeCustomSeparator.value : '',
          cookingText: dom.textMergeCookingText ? dom.textMergeCookingText.value : '',
        };
      }
      if (dom.batchDeleteModal && dom.batchDeleteModal.classList.contains('show')) {
        return {
          type: 'batch-delete',
          selectedKeys: getBatchDeleteSelectedKeys(),
        };
      }
      return null;
    }

    function restoreCommentMutationDraft(draft) {
      if (!draft) return;
      if (draft.type === 'edit-link') {
        state.editingLink = { ...draft.editingLink };
        if (dom.editDisplayText) dom.editDisplayText.value = draft.displayText || '';
        if (dom.editLinkUrl) dom.editLinkUrl.value = draft.url || '';
        if (dom.editReplacementMarkdown) {
          dom.editReplacementMarkdown.value = draft.replacementMarkdown || '';
        }
        const initialFocus = draft.replacementMarkdown
          ? dom.editReplacementMarkdown
          : dom.editDisplayText;
        showManagedModal(dom.editLinkModal, { initialFocus });
        updateEditLinkModalState();
        return;
      }
      if (draft.type === 'merge-inline') {
        mergeInlineState.indices = draft.indices.slice();
        mergeInlineState.materials = cloneCommentMutationValue(draft.materials);
        renderMergeMaterialList();
        if (dom.mergeBuilderText) dom.mergeBuilderText.value = draft.builderText || '';
        if (dom.mergeBuilderLink) dom.mergeBuilderLink.value = draft.builderLink || '';
        if (dom.mergeCookingText) dom.mergeCookingText.value = draft.cookingText || '';
        showManagedModal(dom.mergeInlineModal, { initialFocus: dom.mergeCookingText });
        updateMergeConfirmState();
        return;
      }
      if (draft.type === 'merge-text') {
        textMergeState.indices = draft.indices.slice();
        textMergeState.materials = cloneCommentMutationValue(draft.materials);
        textMergeState.separatorKind = draft.separatorKind || 'space';
        renderTextMergeMaterialList();
        setTextMergeSeparator(textMergeState.separatorKind);
        if (dom.textMergeCustomSeparator) dom.textMergeCustomSeparator.value = draft.customSeparator || '';
        if (dom.textMergeCookingText) dom.textMergeCookingText.value = draft.cookingText || '';
        showManagedModal(dom.mergeTextModal, { initialFocus: dom.textMergeCookingText });
        updateTextMergeConfirmState();
        return;
      }
      if (draft.type === 'batch-delete') {
        const selectedKeys = new Set(draft.selectedKeys || []);
        getBatchDeleteCheckboxes().forEach((checkbox) => {
          checkbox.checked = selectedKeys.has(checkbox.value);
        });
        updateBatchDeleteModalState();
        showManagedModal(dom.batchDeleteModal, { initialFocus: getBatchDeleteCheckboxes()[0] || null });
      }
    }

    function setCommentMutationPendingUI() {
      const pending = state.pendingMutations.size > 0;
      document.documentElement.classList.toggle('comment-mutation-pending', pending);
      updateUI();
    }

    function beginCommentMutation(action, params) {
      if (state.pendingMutations.size > 0) {
        showToast('上一项操作仍在执行，请稍候');
        return null;
      }
      const requestId = `cm-${Date.now()}-${++commentMutationSequence}`;
      const record = {
        action,
        requestId,
        viewSnapshot: captureCommentViewState(),
        draft: captureCommentMutationDraft(),
      };
      state.pendingMutations.set(requestId, record);
      setCommentMutationPendingUI();
      return {
        requestId,
        params: {
          ...params,
          requestId,
          baseRevision: state.revision || '',
        },
      };
    }

    function completeCommentMutation(result = {}) {
      const requestId = result.requestId != null ? String(result.requestId) : '';
      const record = requestId ? state.pendingMutations.get(requestId) : null;
      if (!record) {
        return { accepted: false, reason: 'unknown-mutation', requestId };
      }

      state.pendingMutations.delete(requestId);
      setCommentMutationPendingUI();
      if (result.success === true) {
        applyDeferredCommentSnapshotIfReady();
        notifyCommentInteractionSettled();
        return { accepted: true, success: true, requestId };
      }

      restoreSafeSelection(record.viewSnapshot);
      applyDeferredCommentSnapshotIfReady();
      restoreCommentMutationDraft(record.draft);
      updateUI();
      const message = result.stale === true
        ? '卡片已在别处更新，本次操作未执行；请核对后重试'
        : (result.message || '操作失败，已恢复操作现场');
      showToast(message, 3200);
      notifyCommentInteractionSettled();
      return {
        accepted: true,
        success: false,
        stale: result.stale === true,
        requestId,
      };
    }

    function bridgeInvoke(action, params = {}, options = {}) {
      const { errorPrefix = '操作', silent = false } = options;
      let mutationRequest = null;
      try {
        if (COMMENT_MUTATION_ACTION_NAMES.has(action)) {
          mutationRequest = beginCommentMutation(action, params);
          if (!mutationRequest) return false;
          postToNative(action, mutationRequest.params);
        } else {
          postToNative(action, params);
        }
        return true;
      } catch (error) {
        if (mutationRequest) {
          state.pendingMutations.delete(mutationRequest.requestId);
          setCommentMutationPendingUI();
        }
        console.error(`Bridge.${action} 失败:`, error);
        if (!silent) {
          showToast(`${errorPrefix}失败: ${error.message}`);
        }
        return false;
      }
    }

    function bridgeInvokeWithIndices(action, noteId, indexArr, extraParams = {}, errorPrefix = '操作') {
      return bridgeInvoke(action, buildNativeIndexPayload(noteId, indexArr, extraParams), {
        errorPrefix,
      });
    }

    function createIndexedBridgeMethod(action, errorPrefix, extraParamsBuilder = null) {
      return function(noteId, indexArr, ...restArgs) {
        const extraParams = typeof extraParamsBuilder === 'function'
          ? (extraParamsBuilder(...restArgs) || {})
          : {};
        return bridgeInvokeWithIndices(action, noteId, indexArr, extraParams, errorPrefix);
      };
    }

    function createPayloadBridgeMethod(action, errorPrefix, payloadBuilder, options = {}) {
      const { silent = false } = options;
      return function(...args) {
        const payload = typeof payloadBuilder === 'function'
          ? (payloadBuilder(...args) || {})
          : {};
        return bridgeInvoke(action, payload, {
          errorPrefix,
          silent,
        });
      };
    }

    function bridgeLogToNative(message) {
      try {
        const text = String(message || '');
        const isError = /(?:\berror\b|失败|错误|异常|出错)/i.test(text);
        if (!isError && window.__MNKB_COMMENT_DEBUG__ !== true) return;
        sendURLToNative('htmlLog', {
          message: text,
          source: 'commentManager',
          level: isError ? 'ERROR' : 'INFO',
        }, { priority: 'low' });
      } catch (error) {
        console.error('Bridge.logToNative 失败:', error);
      }
    }

    /**
     * Bridge 对象提供 Native 调用 JavaScript 的接口
     *
     * 调用方式（Native 端）：
     * const script = `window.Bridge.loadCommentData(${JSON.stringify(data)})`
     * await this.runJavaScript(script)
     */
    const bridgeApi = {
      loadCommentData(data) {
        try {
          return loadDataFromNative(data);
        } catch (error) {
          console.error('Bridge.loadCommentData 失败:', error);
          bridgeLogToNative('Bridge.loadCommentData 失败: ' + error.message);
          state.loadStatus = 'error';
          state.loadError = error.message || '评论数据加载失败';
          if (typeof renderEmptyCommentsState === 'function') renderEmptyCommentsState();
          return { accepted: false, reason: 'load-error', error: error.message };
        }
      },

      completeAction(result) {
        try {
          return completeCommentMutation(result || {});
        } catch (error) {
          console.error('Bridge.completeAction 失败:', error);
          bridgeLogToNative('Bridge.completeAction 失败: ' + error.message);
          return { accepted: false, reason: 'complete-error', error: error.message };
        }
      },

      requestCloseCommentManager(source) {
        return requestCommentManagerClose(source || 'native');
      },

      closeCommentManager: createPayloadBridgeMethod('closeCommentManager', '关闭评论管理器', (source) => ({
        source: source || 'html',
      })),

      moveCommentsToField: createIndexedBridgeMethod('moveCommentsToField', '移动', (fieldName, toBottom) => ({
        fieldName,
        toBottom: !!toBottom,
      })),

      moveComments: createIndexedBridgeMethod('moveComments', '移动', (targetIndex) => ({
        targetIndex,
      })),

      deleteComments: createIndexedBridgeMethod('deleteComments', '删除'),
      deleteBidirectionalLinks: createIndexedBridgeMethod('deleteBidirectionalLinks', '双向删除'),
      extractComments: createIndexedBridgeMethod('extractComments', '提取'),
      updateCommentLink: createIndexedBridgeMethod('updateCommentLink', '更新', (linkIndex) => {
        if (linkIndex === undefined || linkIndex === null || linkIndex === '') return {};
        return { linkIndex: parseInt(linkIndex, 10) };
      }),
      replacePlaceholderLink: createIndexedBridgeMethod('replacePlaceholderLink', '占位替换', (linkIndex) => {
        if (linkIndex === undefined || linkIndex === null || linkIndex === '') return {};
        return { linkIndex: parseInt(linkIndex, 10) };
      }),
      convertLinkCommentsToInlineLinks: createIndexedBridgeMethod('convertLinkCommentsToInlineLinks', '转换'),

      requestAutoNewContent: createPayloadBridgeMethod('autoNewContent', '自动新内容请求', (noteId) => (
        buildNoteIdPayload(noteId)
      )),

      refreshCurrentNote: createPayloadBridgeMethod('refreshCurrentNote', '更新当前卡片', () => ({})),
      refreshManagedCommentData: createPayloadBridgeMethod('refreshManagedCommentData', '同步当前管理卡片', (noteId) => (
        buildNoteIdPayload(noteId)
      ), { silent: true }),

      openProofStructureWorkbench: createPayloadBridgeMethod('openProofStructureWorkbench', '打开证明结构图', (
        noteId,
        fieldName,
      ) => buildNoteIdPayload(noteId, { fieldName })),

      setManagedCommentAutoRefreshEnabled(enabled) {
        if (typeof window.setManagedCommentAutoRefreshEnabled !== 'function') return false;
        return window.setManagedCommentAutoRefreshEnabled(enabled === true);
      },

      logToNative(message) {
        bridgeLogToNative(message);
      },

      pinTextCommentToPinner: createPayloadBridgeMethod('pinTextCommentToPinner', 'Pin', (noteId, options = {}) => (
        buildNoteIdPayload(noteId, {
          commentIndex: options.commentIndex,
          section: options.section || 'focus',
          position: options.position || 'top',
          afterPin: options.afterPin || 'openEditor',
        })
      )),

      editMarkdownLink: createPayloadBridgeMethod('editMarkdownLink', '编辑', (
        noteId,
        commentIndex,
        linkIndex,
        newDisplayText,
        newUrl,
        replacementMarkdown,
        targetSnapshot,
      ) => buildNoteIdPayload(noteId, {
        commentIndex,
        linkIndex,
        newDisplayText,
        newUrl,
        replacementMarkdown,
        targetSnapshot,
      })),

      mergeInlineLinkComments: createPayloadBridgeMethod('mergeInlineLinkComments', '合并', (
        noteId,
        indexArr,
        text,
      ) => buildNativeIndexPayload(noteId, indexArr, {
        text,
        markdown: true,
      })),

      mergeTextComments: createPayloadBridgeMethod('mergeTextComments', '合并文本', (
        noteId,
        indexArr,
        text,
      ) => buildNativeIndexPayload(noteId, indexArr, {
        text,
        markdown: true,
      })),

      requestClipboardText: createPayloadBridgeMethod('requestClipboardText', '读取剪贴板', (targetField) => ({
        targetField,
      })),

      copyText(text) {
        const success = bridgeInvoke('copyText', { text }, { silent: true });
        if (!success) {
          throw new Error('调用 Native 复制失败');
        }
      },

      receiveClipboardText(text, targetField) {
        try {
          return receiveClipboardTextForEditLink(text, targetField);
        } catch (error) {
          console.error('Bridge.receiveClipboardText 失败:', error);
          showToast('读取剪贴板失败: ' + error.message);
          return false;
        }
      },

      applyAutoNewSelection(indexArr) {
        try {
          const indices = parseIncomingIndexArray(indexArr);
          debugLog(`[HTML] applyAutoNewSelection -> ${indices}`);

          replaceSelection(indices);
          updateUI();

          showToast(indices.length === 0 ? '未检测到新内容' : `已选中 ${indices.length} 条新内容`);
        } catch (error) {
          debugLog(`[HTML Error] applyAutoNewSelection 失败: ${error.message}`);
          showToast('自动选择失败');
        }
      },
    };

    window.Bridge = bridgeApi;

    // 页面加载时发送就绪信号
    window.addEventListener('load', () => {
      bridgeInvoke('ready', {}, { silent: true });
    });

    // 统一的 Native 调用帮助函数（参考知识库搜索页）
    function postToNative(action, params = {}) {
      debugLog(`[HTML] postToNative ${action} -> ${formatLogPayload(params)}`);
      sendURLToNative(action, params, { priority: 'high' });
    }

    // ========================================
