    // 数据加载（测试用）
    // ========================================
    function normalizeIncomingCommentImage(imageBase64, imageMimeType) {
      if (!imageBase64) return '';
      const rawImage = String(imageBase64);
      if (/^data:/i.test(rawImage)) {
        return rawImage;
      }
      const mimeType = (imageMimeType && String(imageMimeType).trim()) || 'image/jpeg';
      return `data:${mimeType};base64,${rawImage}`;
    }

    function convertNativeCommentData(comment) {
      const sourceComment = comment || {};
      const rawNativeType = typeof sourceComment.type === 'string' ? sourceComment.type.trim() : '';
      const rawBaseTypes = new Set(['TextNote', 'HtmlNote', 'LinkNote', 'PaintNote', 'AudioNote']);
      const nativeDetailedType = typeof sourceComment.detailedType === 'string' && sourceComment.detailedType.trim()
        ? sourceComment.detailedType.trim()
        : (rawNativeType && !rawBaseTypes.has(rawNativeType) ? rawNativeType : '');
      const resolvedType = nativeDetailedType || detectDetailedType(sourceComment);
      const converted = {
        index: sourceComment.index,
        originalType: sourceComment.originalType,
        type: resolvedType || 'unknownComment',
        detailedType: resolvedType || 'unknownComment',
        text: sourceComment.text || null,
      };

      if (sourceComment.htmlText) {
        converted.htmlText = sourceComment.htmlText;
      }

      const normalizedImage = normalizeIncomingCommentImage(sourceComment.imageBase64, sourceComment.imageMimeType);
      if (normalizedImage) {
        converted.imageBase64 = normalizedImage;
        if (sourceComment.imageMimeType) {
          converted.imageMimeType = sourceComment.imageMimeType;
        }
      }

      if (sourceComment.mediaHash) {
        converted.mediaHash = String(sourceComment.mediaHash);
      }

      if (sourceComment.drawingHash) {
        converted.drawingHash = String(sourceComment.drawingHash);
      }

      if (sourceComment.drawingPreviewDataURI) {
        converted.drawingPreviewDataURI = String(sourceComment.drawingPreviewDataURI);
      }

      if (sourceComment.drawingPreviewError) {
        converted.drawingPreviewError = String(sourceComment.drawingPreviewError);
      }
      converted.drawingPreviewPending = sourceComment.drawingPreviewPending === true;

      if (sourceComment.linkedNoteTitle) {
        converted.linkedNoteTitle = sourceComment.linkedNoteTitle;
      }

      if (sourceComment.linkedNoteId) {
        converted.linkedNoteId = sourceComment.linkedNoteId;
      }

      if (sourceComment.linkedNoteUrl) {
        converted.linkedNoteUrl = sourceComment.linkedNoteUrl;
      }

      if (sourceComment.htmlMarkdownType) {
        converted.htmlMarkdownType = sourceComment.htmlMarkdownType;
      }

      if (sourceComment.htmlMarkdownContent) {
        converted.htmlMarkdownContent = sourceComment.htmlMarkdownContent;
      }

      if (sourceComment.markdown !== undefined) {
        converted.markdown = !!sourceComment.markdown;
      }

      if (Array.isArray(sourceComment.markdownLinks) && sourceComment.markdownLinks.length > 0) {
        converted.markdownLinks = sourceComment.markdownLinks.slice();
        converted.hasMarkdownLinks = true;
      }

      return converted;
    }

    function getCommentFingerprint(comment) {
      if (!comment) return '';
      const imageValue = comment.imageBase64 ? String(comment.imageBase64) : '';
      const drawingValue = comment.drawingPreviewDataURI ? String(comment.drawingPreviewDataURI) : '';
      const mediaIdentity = comment.mediaHash
        ? String(comment.mediaHash)
        : (imageValue ? `${imageValue.length}:${imageValue.slice(0, 32)}:${imageValue.slice(-24)}` : '');
      const drawingIdentity = comment.drawingHash
        ? String(comment.drawingHash)
        : (drawingValue ? `${drawingValue.length}:${drawingValue.slice(0, 40)}:${drawingValue.slice(-24)}` : '');
      const links = Array.isArray(comment.markdownLinks)
        ? comment.markdownLinks.map((link) => [
          link && link.displayText,
          link && link.url,
          link && link.noteId,
        ].join('\u001f')).join('\u001e')
        : '';
      const source = [
        comment.originalType || '',
        comment.type || '',
        comment.detailedType || '',
        comment.text || '',
        comment.htmlText || '',
        comment.linkedNoteId || '',
        comment.linkedNoteTitle || '',
        mediaIdentity,
        drawingIdentity,
        links,
      ].join('\u001d');

      let hash = 2166136261;
      for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return `${comment.type || 'comment'}:${(hash >>> 0).toString(16)}`;
    }

    function buildCommentFingerprintIndex(comments) {
      const index = new Map();
      (Array.isArray(comments) ? comments : []).forEach((comment) => {
        const fingerprint = getCommentFingerprint(comment);
        const normalizedIndex = normalizeCommentIndex(comment && comment.index);
        if (!fingerprint || Number.isNaN(normalizedIndex)) return;
        if (!index.has(fingerprint)) index.set(fingerprint, []);
        index.get(fingerprint).push(normalizedIndex);
      });
      return index;
    }

    function captureSelectedCommentFingerprints() {
      return Array.from(state.selectedIndices || []).map((index) => {
        const normalizedIndex = normalizeCommentIndex(index);
        const comment = !Number.isNaN(normalizedIndex) ? commentLookupByIndex.get(normalizedIndex) : null;
        return {
          index: normalizedIndex,
          fingerprint: getCommentFingerprint(comment),
        };
      }).filter((item) => item.fingerprint);
    }

    function captureExpandedCommentFingerprints() {
      const expanded = [];
      (state.comments || []).forEach((comment) => {
        const index = normalizeCommentIndex(comment && comment.index);
        const card = !Number.isNaN(index) ? commentCardNodeMap.get(index) : null;
        const preview = card && card.querySelector ? card.querySelector('.comment-preview') : null;
        const expandButton = card && card.querySelector ? card.querySelector('.expand-btn') : null;
        if (preview && expandButton && !preview.classList.contains('collapsed')) {
          expanded.push({ index, fingerprint: getCommentFingerprint(comment) });
        }
      });
      return expanded;
    }

    function captureCommentScrollAnchor() {
      if (!dom.commentsSection || !dom.commentsList) return null;
      const containerRect = dom.commentsSection.getBoundingClientRect();
      const comments = Array.isArray(state.comments) ? state.comments : [];
      for (let i = 0; i < comments.length; i++) {
        const comment = comments[i];
        const index = normalizeCommentIndex(comment && comment.index);
        const card = !Number.isNaN(index) ? commentCardNodeMap.get(index) : null;
        if (!card || !card.getBoundingClientRect) continue;
        const rect = card.getBoundingClientRect();
        if (rect.bottom >= containerRect.top + 1) {
          return {
            index,
            fingerprint: getCommentFingerprint(comment),
            offset: rect.top - containerRect.top,
            fallbackScrollTop: dom.commentsSection.scrollTop || 0,
          };
        }
      }
      return {
        index: NaN,
        fingerprint: '',
        offset: 0,
        fallbackScrollTop: dom.commentsSection.scrollTop || 0,
      };
    }

    function captureCommentViewState() {
      return {
        noteId: state.noteId ? String(state.noteId) : '',
        selected: captureSelectedCommentFingerprints(),
        expanded: captureExpandedCommentFingerprints(),
        scrollAnchor: captureCommentScrollAnchor(),
        currentFieldId: state.currentFieldId || null,
      };
    }

    function resolveSnapshotCommentIndex(item, fingerprintIndex) {
      if (!item || !item.fingerprint) return NaN;
      const sameIndexComment = commentLookupByIndex.get(item.index);
      if (sameIndexComment && getCommentFingerprint(sameIndexComment) === item.fingerprint) {
        return item.index;
      }
      const matches = fingerprintIndex.get(item.fingerprint) || [];
      return matches.length === 1 ? matches[0] : NaN;
    }

    function restoreSafeSelection(viewSnapshot) {
      replaceSelection([]);
      if (!viewSnapshot || !Array.isArray(viewSnapshot.selected)) return;
      const fingerprintIndex = buildCommentFingerprintIndex(state.comments);
      const restored = viewSnapshot.selected
        .map((item) => resolveSnapshotCommentIndex(item, fingerprintIndex))
        .filter((index) => !Number.isNaN(index));
      replaceSelection(restored);
    }

    function refreshCommentStateFromCurrentComments(viewSnapshot = null) {
      state.fields = parseFieldsFromComments();
      rebuildCommentLookup();
      rebuildFieldLookup();
      restoreSafeSelection(viewSnapshot);
      resetSelectionTracking();
    }

    function restoreCommentViewStateAfterRender() {
      if (pendingPreferredCommentIndex >= 0) {
        const preferredIndex = pendingPreferredCommentIndex;
        pendingPreferredCommentIndex = -1;
        const preferredCard = commentCardNodeMap.get(preferredIndex);
        if (preferredCard && dom.commentsSection) {
          const containerRect = dom.commentsSection.getBoundingClientRect();
          const cardRect = preferredCard.getBoundingClientRect();
          dom.commentsSection.scrollTop += cardRect.top - containerRect.top - 8;
          flashHtmlMDAnchorCard(preferredCard);
        }
        pendingCommentViewRestore = null;
        updateCurrentFieldFromScroll({ force: true });
        return;
      }
      const viewSnapshot = pendingCommentViewRestore;
      pendingCommentViewRestore = null;
      if (!viewSnapshot || viewSnapshot.noteId !== String(state.noteId || '')) return;

      const fingerprintIndex = buildCommentFingerprintIndex(state.comments);
      (viewSnapshot.expanded || []).forEach((item) => {
        const index = resolveSnapshotCommentIndex(item, fingerprintIndex);
        const card = !Number.isNaN(index) ? commentCardNodeMap.get(index) : null;
        const preview = card && card.querySelector ? card.querySelector('.comment-preview') : null;
        const expandButton = card && card.querySelector ? card.querySelector('.expand-btn') : null;
        if (preview && expandButton) {
          preview.classList.remove('collapsed');
          expandButton.textContent = '收起';
        }
      });

      const anchor = viewSnapshot.scrollAnchor;
      if (dom.commentsSection && anchor) {
        const index = resolveSnapshotCommentIndex(anchor, fingerprintIndex);
        const card = !Number.isNaN(index) ? commentCardNodeMap.get(index) : null;
        if (card && card.getBoundingClientRect) {
          const containerRect = dom.commentsSection.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          dom.commentsSection.scrollTop += (cardRect.top - containerRect.top) - anchor.offset;
        } else {
          dom.commentsSection.scrollTop = anchor.fallbackScrollTop || 0;
        }
      }

      if (viewSnapshot.currentFieldId && fieldLookupById.has(viewSnapshot.currentFieldId)) {
        state.currentFieldId = viewSnapshot.currentFieldId;
      }
      updateCurrentFieldFromScroll({ force: true });
    }

    function isCommentManagerInteractionBusy() {
      const modalIds = [
        'editLinkModal',
        'confirmModal',
        'mergeInlineModal',
        'mergeTextModal',
        'batchDeleteModal',
      ];
      const modalOpen = modalIds.some((key) => (
        dom[key] && dom[key].classList && dom[key].classList.contains('show')
      ));
      return state.moveMode === true
        || modalOpen
        || (state.pendingMutations && state.pendingMutations.size > 0);
    }

    function setDeferredCommentUpdateIndicator(visible) {
      state.hasDeferredUpdate = visible === true;
      if (!dom.refreshCurrentNoteBtn) return;
      dom.refreshCurrentNoteBtn.classList.toggle('has-update', state.hasDeferredUpdate);
      dom.refreshCurrentNoteBtn.textContent = state.hasDeferredUpdate ? '● 有更新' : '🔁 更新';
      dom.refreshCurrentNoteBtn.title = state.hasDeferredUpdate
        ? '卡片已有更新；完成或取消当前操作后将自动同步'
        : '同步当前选中卡片';
    }

    function isCommentStructureSensitive(comment) {
      if (!comment) return true;
      return comment.originalType === 'HtmlNote'
        || !!comment.htmlMarkdownType
        || /^<span\b/i.test(String(comment.text || '').replace(/^-\s+/, '').trim());
    }

    function buildCommentPatchPlan(previousComments, nextComments) {
      if (!Array.isArray(previousComments) || !Array.isArray(nextComments)) return null;
      if (previousComments.length !== nextComments.length) return null;

      const changed = [];
      for (let position = 0; position < nextComments.length; position += 1) {
        const previous = previousComments[position];
        const next = nextComments[position];
        const previousIndex = normalizeCommentIndex(previous && previous.index);
        const nextIndex = normalizeCommentIndex(next && next.index);
        if (Number.isNaN(previousIndex) || previousIndex !== nextIndex) return null;
        if (getCommentFingerprint(previous) === getCommentFingerprint(next)) continue;
        if (isCommentStructureSensitive(previous) || isCommentStructureSensitive(next)) return null;
        changed.push(next);
      }

      const maxPatchCount = Math.max(12, Math.min(64, Math.ceil(nextComments.length * 0.2)));
      if (changed.length > maxPatchCount) return null;
      return { changed };
    }

    function patchChangedCommentCards(patchPlan) {
      if (!patchPlan || !Array.isArray(patchPlan.changed)) return false;
      for (const comment of patchPlan.changed) {
        const index = normalizeCommentIndex(comment && comment.index);
        const oldCard = !Number.isNaN(index) ? commentCardNodeMap.get(index) : null;
        if (!oldCard || !oldCard.parentNode) return false;
        const nextCard = createCommentCard(comment);
        oldCard.parentNode.replaceChild(nextCard, oldCard);
        registerCommentCardNodes(comment, nextCard);
      }
      return true;
    }

    function applyLoadedCommentSnapshot(snapshot = {}, options = {}) {
      const {
        render = false,
        showLoadedHUD = false,
        hudMessage = '',
      } = options;

      const previousNoteId = state.noteId != null ? String(state.noteId) : '';
      const nextNoteId = snapshot.noteId != null ? String(snapshot.noteId) : '';
      const sameNote = !!previousNoteId && previousNoteId === nextNoteId;
      const viewSnapshot = sameNote ? captureCommentViewState() : null;
      const previousComments = Array.isArray(state.comments) ? state.comments : [];
      const nextComments = Array.isArray(snapshot.comments) ? snapshot.comments : [];
      const patchPlan = sameNote && state.hasNativeData
        ? buildCommentPatchPlan(previousComments, nextComments)
        : null;

      state.noteId = snapshot.noteId != null ? snapshot.noteId : null;
      state.noteTitle = snapshot.noteTitle != null ? snapshot.noteTitle : '';
      state.hasNativeData = snapshot.hasNativeData === true;
      state.loadStatus = 'ready';
      state.loadError = '';
      state.handwritingPendingCount = Number(snapshot.handwritingPendingCount || 0);
      state.comments = nextComments;
      state.revision = snapshot.revision != null ? String(snapshot.revision) : '';
      state.lastRequestId = Math.max(state.lastRequestId || 0, Number(snapshot.requestId || 0));

      if (!sameNote) {
        replaceSelection([]);
        htmlMDGroupCollapsedIds.clear();
        if (dom.commentsSection) dom.commentsSection.scrollTop = 0;
      }

      refreshCommentStateFromCurrentComments(viewSnapshot);
      pendingCommentViewRestore = viewSnapshot;

      let didPatch = false;
      if (render) {
        didPatch = patchPlan ? patchChangedCommentCards(patchPlan) : false;
        if (didPatch) {
          rebuildFieldHeaderPositions();
          renderFieldNavigator(state.fields);
          syncHtmlMDGroupCollapseVisibility();
          restoreCommentViewStateAfterRender();
        } else {
          renderComments();
        }
        updateUI();
      }

      if (showLoadedHUD) {
        safeHUD(hudMessage || `已加载 ${state.comments.length} 条评论`);
      }
      return {
        patched: didPatch,
        patchedCount: didPatch && patchPlan ? patchPlan.changed.length : 0,
      };
    }

    function applyDeferredCommentSnapshotIfReady() {
      if (!state.deferredSnapshot || isCommentManagerInteractionBusy()) return false;
      const deferred = state.deferredSnapshot;
      state.deferredSnapshot = null;
      setDeferredCommentUpdateIndicator(false);
      applyNativeCommentData(deferred, { allowDefer: false, skipRequestGuard: true });
      return true;
    }

    function notifyCommentInteractionSettled() {
      setTimeout(() => {
        applyDeferredCommentSnapshotIfReady();
      }, 0);
    }

    function applyNativeCommentData(data, options = {}) {
      const { allowDefer = true, skipRequestGuard = false } = options;
      if (!data || !Array.isArray(data.comments)) {
        state.loadStatus = 'error';
        state.loadError = '评论数据格式不完整';
        if (!state.hasNativeData && typeof renderEmptyCommentsState === 'function') renderEmptyCommentsState();
        safeHUD('数据格式错误');
        return { accepted: false, reason: 'invalid-data' };
      }

      const incomingNoteId = data.noteId != null ? String(data.noteId) : '';
      const currentNoteId = state.noteId != null ? String(state.noteId) : '';
      const sameNote = !!currentNoteId && currentNoteId === incomingNoteId;
      const incomingRequestId = Number(data.requestId || 0);
      if (!skipRequestGuard && incomingRequestId > 0 && incomingRequestId <= state.lastRequestId) {
        return {
          accepted: false,
          reason: 'stale-request',
          requestId: incomingRequestId,
          currentRequestId: state.lastRequestId,
        };
      }

      const incomingRevision = data.revision != null ? String(data.revision) : '';
      const preferredCommentIndex = Number(data.uiContext && data.uiContext.preferredCommentIndex);
      if (Number.isInteger(preferredCommentIndex) && preferredCommentIndex >= 0) {
        pendingPreferredCommentIndex = preferredCommentIndex;
      }
      if (sameNote && data.forceApply !== true && incomingRevision && incomingRevision === state.revision) {
        state.lastRequestId = Math.max(state.lastRequestId || 0, incomingRequestId);
        return {
          accepted: true,
          changed: false,
          requestId: incomingRequestId,
          revision: incomingRevision,
        };
      }

      if (allowDefer && sameNote && state.hasNativeData && isCommentManagerInteractionBusy()) {
        const deferredRequestId = Number(state.deferredSnapshot && state.deferredSnapshot.requestId || 0);
        if (!state.deferredSnapshot || incomingRequestId >= deferredRequestId) {
          state.deferredSnapshot = data;
        }
        state.lastRequestId = Math.max(state.lastRequestId || 0, incomingRequestId);
        if (!state.hasDeferredUpdate) {
          showToast('卡片有更新，将在当前操作结束后同步');
        }
        setDeferredCommentUpdateIndicator(true);
        return {
          accepted: true,
          deferred: true,
          requestId: incomingRequestId,
          revision: incomingRevision,
        };
      }

      const convertedComments = data.comments.map(convertNativeCommentData);
      const renderResult = applyLoadedCommentSnapshot({
        noteId: data.noteId,
        noteTitle: data.noteTitle,
        revision: incomingRevision,
        requestId: incomingRequestId,
        comments: convertedComments,
        hasNativeData: true,
      }, {
        render: true,
        showLoadedHUD: data.showLoadedFeedback === true,
      });
      setDeferredCommentUpdateIndicator(false);
      if (dom.refreshCurrentNoteBtn) {
        dom.refreshCurrentNoteBtn.classList.remove('is-refreshing');
        dom.refreshCurrentNoteBtn.disabled = false;
      }
      return {
        accepted: true,
        changed: true,
        requestId: incomingRequestId,
        revision: incomingRevision,
        commentCount: convertedComments.length,
        patched: renderResult && renderResult.patched === true,
        patchedCount: renderResult ? renderResult.patchedCount : 0,
      };
    }

    function loadTestData() {
      // 测试数据（仅包含文本、链接、HTML 评论）
      // 图片和手写评论需要通过 Native 传入，使用 loadDataFromNative() 加载
      applyLoadedCommentSnapshot({
        noteId: 'test-note-id',
        noteTitle: '测试卡片：群同态基本定理',
        comments: [
          {
            index: 0,
            type: 'textComment',
            text: '这是第一条文本评论，用于测试评论管理器的基本功能。这条评论包含了足够长的文本来测试预览和展开功能。'
          },
          {
            index: 1,
            type: 'linkComment',
            text: 'marginnote4app://note/demo-linked-note',
            linkedNoteTitle: '定义：群同态'
          },
          {
            index: 2,
            type: 'HtmlComment',
            text: '<h3>证明</h3><p>这是一个 HTML 格式的评论</p>',
            htmlText: '<h3>证明</h3><p>这是一个 HTML 格式的评论</p>'
          },
          {
            index: 3,
            type: 'textComment',
            text: '短评论'
          }
        ],
      });
    }

    // ========================================
    // Native 数据加载接口
    // ========================================

    /**
     * 从 Native 端加载真实的评论数据
     *
     * @param {Object} data - Native 端传入的数据对象
     * @param {string} data.noteId - 卡片 ID
     * @param {string} data.noteTitle - 卡片标题
     * @param {Array} data.comments - 评论数组，每个元素包含：
     *   - {number} index - 评论索引（从 0 开始）
     *   - {string} originalType - 原始评论类型（5种基础类型）：
     *       * "TextNote" - 文本评论
     *       * "HtmlNote" - HTML 评论
     *       * "LinkNote" - 合并摘录/链接评论
     *       * "PaintNote" - 绘图评论（包括图片和手写）
     *       * "AudioNote" - 音频评论
     *   - {string} [text] - 评论文本内容（TextNote, HtmlNote, LinkNote 时有效）
     *   - {string} [htmlText] - HTML 格式文本（HtmlNote 时有效）
     *   - {string} [imageBase64] - 图片 Base64 数据（PaintNote 时有效）
     *       格式：纯 Base64 字符串（不含 data:image/jpeg;base64, 前缀）
     *       Native 端使用：MNUtil.getMediaByHash(comment.paint).base64Encoding()
     *   - {string} [linkedNoteTitle] - 链接目标卡片标题（LinkNote 时有效）
     *
     * @example
     * // Native 端数据准备示例（main.js）
     * function prepareCommentData(note) {
     *   const comments = note.comments.map((comment, index) => {
     *     const data = { index, originalType: comment.type };
     *
     *     if (comment.type === "TextNote" || comment.type === "HtmlNote") {
     *       data.text = comment.text;
     *       if (comment.type === "HtmlNote") data.htmlText = comment.text;
     *     } else if (comment.type === "PaintNote" && comment.paint) {
     *       const imageData = MNUtil.getMediaByHash(comment.paint);
     *       data.imageBase64 = imageData.base64Encoding();
     *     } else if (comment.type === "LinkNote") {
     *       data.text = comment.text;
     *       const linkedNote = MNNote.new(comment.note);
     *       data.linkedNoteTitle = linkedNote ? linkedNote.noteTitle : "未知卡片";
     *     }
     *
     *     return data;
     *   });
     *
     *   return {
     *     noteId: note.noteId,
     *     noteTitle: note.noteTitle,
     *     comments: comments
     *   };
     * }
     */
    function loadDataFromNative(data) {
      return applyNativeCommentData(data);
    }

    function requestCurrentNoteRefresh() {
      try {
        if (!window.Bridge || typeof Bridge.refreshCurrentNote !== 'function') {
          showToast('更新通道未就绪');
          return;
        }

        const submitted = Bridge.refreshCurrentNote();
        if (!submitted) return;
        if (dom.refreshCurrentNoteBtn) {
          dom.refreshCurrentNoteBtn.classList.add('is-refreshing');
          dom.refreshCurrentNoteBtn.disabled = true;
          dom.refreshCurrentNoteBtn.textContent = '同步中…';
          setTimeout(() => {
            if (!dom.refreshCurrentNoteBtn || !dom.refreshCurrentNoteBtn.classList.contains('is-refreshing')) return;
            dom.refreshCurrentNoteBtn.classList.remove('is-refreshing');
            dom.refreshCurrentNoteBtn.disabled = false;
            setDeferredCommentUpdateIndicator(state.hasDeferredUpdate);
          }, 6000);
        }
        showToast('正在同步当前卡片...');
      } catch (error) {
        console.error('requestCurrentNoteRefresh 失败:', error);
        showToast('更新失败: ' + error.message);
      }
    }

    /**
     * 将原始评论类型转换为细分类型
     * 参考 mnsnipaste 的实现（简化版）
     *
     * @param {Object} comment - 包含 originalType 的评论对象
     * @returns {string} 细分后的评论类型
     */
    function detectTextNoteDetailedType(comment) {
      if (!comment.text || comment.text.trim() === '') {
        return 'blankTextComment';
      }

      let cleanText = comment.text;
      if (/^#\S/.test(cleanText.trim())) {
        return 'tagComment';
      }
      if (cleanText.startsWith('- ')) {
        cleanText = cleanText.substring(2);
      }
      if (cleanText.startsWith('<span')) {
        return 'markdownComment';
      }
      if (/^marginnote\d*(?:app)?:/i.test(cleanText.trim())) {
        return 'linkComment';
      }
      if (comment.hasMarkdownLinks || comment.markdownLinks || hasMarkdownLinks(comment.text)) {
        return 'markdownComment';
      }
      return 'textComment';
    }

    function detectPaintNoteDetailedType(comment) {
      return comment.imageBase64 ? 'imageComment' : 'blankImageComment';
    }

    function detectLinkNoteDetailedType(comment) {
      if (comment.imageBase64) {
        return 'mergedImageComment';
      }
      if (comment.markdown) {
        return 'mergedMarkdownComment';
      }
      if (comment.text) {
        return 'mergedTextComment';
      }
      return 'blankTextComment';
    }

    function detectDetailedType(comment) {
      const originalType = comment.originalType;

      switch (originalType) {
        case 'TextNote':
          return detectTextNoteDetailedType(comment);
        case 'PaintNote':
          return detectPaintNoteDetailedType(comment);
        case 'HtmlNote':
          return 'HtmlComment';
        case 'LinkNote':
          return detectLinkNoteDetailedType(comment);
        case 'AudioNote':
          return 'audioComment';
        default:
          return 'unknownComment';
      }
    }

    // ========================================
