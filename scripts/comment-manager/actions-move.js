    // 操作处理
    // ========================================
	    function handleAction(actionType) {
	      const indices = requireSelectedIndices(state.selectedIndices);

	      debugLog(`[HTML] handleAction ${actionType} -> indices=${indices || []}`);
      if (!indices) return;

	      switch (actionType) {
	        case 'move':
	          enterMoveMode(indices);
	          break;
	        case 'extract':
          confirmExtract(indices);
          break;
        case 'delete':
          confirmDelete(indices);
          break;
      }
    }

    // ========================================
    // 移动模式（可视化插入点）
    // ========================================
	    function enterMoveMode(indices) {
	      state.moveMode = true;

      // 将选中的评论卡片标记为移动模式
      const selectedIndexSet = new Set(indices);
      commentCardNodeMap.forEach((card, index) => {
        card.classList.toggle('move-mode', selectedIndexSet.has(index));
      });

      // 渲染插入点指示器
      renderInsertPoints();

	      // 隐藏主要操作按钮，显示取消按钮
	      setPrimaryActionButtonsDisabled(true);
	      uiSnapshot.actionButtonsDisabled = true;
	      dom.cancelMoveBtn.style.display = '';

	      showToast('请点击要移动到的位置');
	    }

	    function exitMoveMode() {
	      state.moveMode = false;

      // 移除所有插入点
      clearInsertPoints();

      // 移除移动模式样式
      commentCardNodeMap.forEach((card) => {
        card.classList.remove('move-mode');
      });

	      // 恢复按钮状态
	      dom.cancelMoveBtn.style.display = 'none';
	      updateUI();
	      notifyCommentInteractionSettled();
	    }

    function normalizeIndexCollection(indexCollection) {
      const rawList = Array.isArray(indexCollection)
        ? indexCollection
        : Array.from(indexCollection || []);

      return rawList
        .map((index) => normalizeCommentIndex(index))
        .filter((index) => !Number.isNaN(index));
    }

    function getUniqueSortedIndices(indexCollection, options = {}) {
      const { descending = false } = options;
      const normalized = normalizeIndexCollection(indexCollection);
      const unique = Array.from(new Set(normalized));
      unique.sort((left, right) => descending ? right - left : left - right);
      return unique;
    }

    function requireSelectedIndices(indexCollection, options = {}) {
      const {
        message = '请先选择评论',
        descending = false,
      } = options;
      const sorted = getUniqueSortedIndices(indexCollection, { descending });
      if (sorted.length === 0) {
        if (message) showToast(message);
        return null;
      }
      return sorted;
    }

    function requireNoteId(options = {}) {
      const { message = '错误：缺少卡片 ID' } = options;
      if (!state.noteId) {
        if (message) showToast(message);
        return null;
      }
      return state.noteId;
    }

	    function getSelectedContiguousBlock() {
	      const comments = Array.isArray(state.comments) ? state.comments : [];
	      const positions = [];
	      const indexArr = [];

	      for (let i = 0; i < comments.length; i++) {
	        const currentIndex = normalizeCommentIndex(comments[i] && comments[i].index);
	        if (Number.isNaN(currentIndex)) continue;
	        if (state.selectedIndices.has(currentIndex)) {
	          positions.push(i);
	          indexArr.push(currentIndex);
	        }
	      }

	      if (positions.length === 0) {
	        return null;
	      }

	      for (let i = 1; i < positions.length; i++) {
	        if (positions[i] !== positions[i - 1] + 1) {
	          return {
	            contiguous: false,
	            positions,
	            indices: indexArr,
	            startPos: positions[0],
	            endPos: positions[positions.length - 1],
	          };
	        }
	      }

	      return {
	        contiguous: true,
	        positions,
	        indices: indexArr,
	        startPos: positions[0],
	        endPos: positions[positions.length - 1],
	      };
	    }

	    function resolveContiguousMoveTarget(block, direction, steps) {
	      if (!block || !Array.isArray(state.comments) || state.comments.length === 0) {
	        return { targetIndex: NaN, moved: 0 };
	      }

	      const total = state.comments.length;
	      const distance = Math.max(1, parseInt(steps, 10) || 1);

	      if (direction === 'up') {
	        const nextStart = Math.max(0, block.startPos - distance);
	        const moved = block.startPos - nextStart;
	        if (moved <= 0) {
	          return { targetIndex: NaN, moved: 0 };
	        }
	        const targetComment = state.comments[nextStart];
	        const targetIndex = normalizeCommentIndex(targetComment && targetComment.index);
	        return { targetIndex, moved };
	      }

	      const nextEnd = Math.min(total - 1, block.endPos + distance);
	      const moved = nextEnd - block.endPos;
	      if (moved <= 0) {
	        return { targetIndex: NaN, moved: 0 };
	      }

	      const afterPos = nextEnd + 1;
	      if (afterPos < total) {
	        const targetComment = state.comments[afterPos];
	        const targetIndex = normalizeCommentIndex(targetComment && targetComment.index);
	        return { targetIndex, moved };
	      }

	      const lastComment = state.comments[total - 1];
	      const lastIndex = normalizeCommentIndex(lastComment && lastComment.index);
	      return {
	        targetIndex: Number.isNaN(lastIndex) ? total : lastIndex + 1,
	        moved,
	      };
	    }

	    function moveSelectionBySteps(direction, steps = 1) {
	      const noteId = requireNoteId();
	      if (!noteId) return false;

	      const block = getSelectedContiguousBlock();
	      if (!block || !block.indices || block.indices.length === 0) {
	        showToast('请先选择评论');
	        return false;
	      }

	      if (!block.contiguous) {
	        showToast('上/下微调仅支持连续选择，请先连续选中');
	        return false;
	      }

	      const moveDirection = direction === 'up' ? 'up' : 'down';
	      const resolved = resolveContiguousMoveTarget(block, moveDirection, steps);
	      if (resolved.moved <= 0 || Number.isNaN(resolved.targetIndex)) {
	        showToast(moveDirection === 'up' ? '已经在最顶部' : '已经在最底部');
	        return false;
	      }

	      if (state.moveMode) {
	        exitMoveMode();
	      }

	      const submitted = Bridge.moveComments(noteId, block.indices, resolved.targetIndex);
	      if (!submitted) return false;
	      const directionLabel = moveDirection === 'up' ? '上移' : '下移';
	      const stepLabel = resolved.moved > 1 ? `${resolved.moved} 位` : '一位';
	      showToast(`正在将 ${block.indices.length} 条评论${directionLabel}${stepLabel}...`);
	      clearSelection();
	      return true;
	    }

	    function resolveQuickMoveTargetIndex(commentIndex, direction) {
	      const comments = Array.isArray(state.comments) ? state.comments : [];
	      const position = getCommentPositionByIndex(commentIndex);

	      if (position < 0 || comments.length === 0) {
	        return { targetIndex: NaN, reason: 'missing' };
	      }

	      if (direction === 'up') {
	        if (position === 0) {
	          return { targetIndex: NaN, reason: 'top' };
	        }
	        const previousIndex = normalizeCommentIndex(comments[position - 1] && comments[position - 1].index);
	        return {
	          targetIndex: Number.isNaN(previousIndex) ? position - 1 : previousIndex,
	          reason: '',
	        };
	      }

	      if (position >= comments.length - 1) {
	        return { targetIndex: NaN, reason: 'bottom' };
	      }

	      const moveAfterNext = comments[position + 2];
	      if (moveAfterNext) {
	        const afterNextIndex = normalizeCommentIndex(moveAfterNext.index);
	        return {
	          targetIndex: Number.isNaN(afterNextIndex) ? position + 2 : afterNextIndex,
	          reason: '',
	        };
	      }

	      const lastComment = comments[comments.length - 1];
	      const lastIndex = normalizeCommentIndex(lastComment && lastComment.index);
	      return {
	        targetIndex: Number.isNaN(lastIndex) ? comments.length : lastIndex + 1,
	        reason: '',
	      };
	    }

	    function quickMoveSingleComment(commentIndex, direction) {
	      const normalizedIndex = normalizeCommentIndex(commentIndex);
	      if (Number.isNaN(normalizedIndex)) {
	        showToast('评论索引无效');
	        return;
	      }
	      const noteId = requireNoteId();
	      if (!noteId) return;

	      const moveDirection = direction === 'up' ? 'up' : 'down';
	      const target = resolveQuickMoveTargetIndex(normalizedIndex, moveDirection);
	      if (target.reason === 'top') {
	        showToast('已经在最顶部');
	        return;
	      }
	      if (target.reason === 'bottom') {
	        showToast('已经在最底部');
	        return;
	      }
	      if (target.reason === 'missing' || Number.isNaN(target.targetIndex)) {
	        showToast('未找到目标位置');
	        return;
	      }

	      if (state.moveMode) {
	        exitMoveMode();
	      }

	      const submitted = Bridge.moveComments(noteId, [normalizedIndex], target.targetIndex);
	      if (!submitted) return false;
	      showToast(`正在${moveDirection === 'up' ? '上移' : '下移'}评论 #${normalizedIndex}...`);
	      clearSelection();
	    }

    function quickMoveSingleCommentToEdge(commentIndex, direction) {
      const normalizedIndex = normalizeCommentIndex(commentIndex);
      if (Number.isNaN(normalizedIndex)) {
        showToast('评论索引无效');
        return false;
      }

      const noteId = requireNoteId();
      if (!noteId) return false;

      const position = getCommentPositionByIndex(normalizedIndex);
      if (position < 0) {
        showToast('未找到目标评论');
        return false;
      }

      const comments = Array.isArray(state.comments) ? state.comments : [];
      const moveDirection = direction === 'up' ? 'up' : 'down';
      if (moveDirection === 'up' && position === 0) {
        showToast('已经在最顶部');
        return false;
      }
      if (moveDirection === 'down' && position === comments.length - 1) {
        showToast('已经在最底部');
        return false;
      }

      if (state.moveMode) {
        exitMoveMode();
      }

      const targetIndex = moveDirection === 'up' ? 0 : getAppendTargetIndex();
      const submitted = Bridge.moveComments(noteId, [normalizedIndex], targetIndex);
      if (!submitted) return false;
      showToast(`正在${moveDirection === 'up' ? '置顶' : '置底'}评论 #${normalizedIndex}...`);
      clearSelection();
      return true;
    }

    function closeTopLayerOnEscape() {
      if (dom.confirmModal && dom.confirmModal.classList.contains('show')) {
        closeConfirmModal({ invokeCancel: true });
        return true;
      }
      if (dom.editLinkModal && dom.editLinkModal.classList.contains('show')) {
        closeEditLinkModal();
        return true;
      }
      if (dom.mergeInlineModal && dom.mergeInlineModal.classList.contains('show')) {
        closeInlineMergeModal();
        return true;
      }
      if (dom.mergeTextModal && dom.mergeTextModal.classList.contains('show')) {
        closeTextMergeModal();
        return true;
      }
      if (dom.batchDeleteModal && dom.batchDeleteModal.classList.contains('show')) {
        closeBatchDeleteModal();
        return true;
      }
      if (state.compactPanel && closeCompactToolsPanel()) {
        return true;
      }
      if (state.moveMode) {
        exitMoveMode();
        showToast('已取消移动');
        return true;
      }
      if (state.selectionMode === 'range' && dom.rangeSelectHint && dom.rangeSelectHint.classList.contains('show')) {
        cancelRangeSelect();
        showToast('已取消范围选择');
        return true;
      }
      return false;
    }

    function shouldIgnoreGlobalHotkeys(event) {
      if (!event) return true;
      if (dom.editLinkModal && dom.editLinkModal.classList.contains('show')) return true;
      if (dom.mergeInlineModal && dom.mergeInlineModal.classList.contains('show')) return true;
      if (dom.mergeTextModal && dom.mergeTextModal.classList.contains('show')) return true;
      if (dom.batchDeleteModal && dom.batchDeleteModal.classList.contains('show')) return true;
      if (dom.confirmModal && dom.confirmModal.classList.contains('show')) return true;

      const target = event.target;
      if (!target) return false;
      const tagName = String(target.tagName || '').toUpperCase();
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
      }
      if (target.isContentEditable) return true;
      return false;
    }

    function handleGlobalKeydown(event) {
      if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

      if (trapFocusInTopModal(event)) return;

      if (event.key === 'Escape') {
        if (closeTopLayerOnEscape()) {
          event.preventDefault();
        }
        return;
      }

      if (shouldIgnoreGlobalHotkeys(event)) return;

      const isAltMove = event.altKey && !event.metaKey && !event.ctrlKey;
      if (!isAltMove) return;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelectionBySteps('up', event.shiftKey ? 5 : 1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelectionBySteps('down', event.shiftKey ? 5 : 1);
      }
    }

	    function performMoveToIndex(targetIndex, options = {}) {
	      const { hint = '', exitMoveModeAfter = false } = options;
	      const sorted = requireSelectedIndices(state.selectedIndices);
	      if (!sorted) return false;
	      const noteId = requireNoteId();
	      if (!noteId) return false;

	      Bridge.logToNative && Bridge.logToNative(`[HTML] moveComments -> ${sorted} -> ${targetIndex}`);
	      const submitted = Bridge.moveComments(noteId, sorted, targetIndex);
	      if (!submitted) return false;
	      showToast(`正在移动 ${sorted.length} 条评论...${hint ? ' ' + hint : ''}`);

	      if (exitMoveModeAfter) {
	        exitMoveMode();
	      }
	      clearSelection();
	      return true;
	    }

	    function performMoveToField(fieldName, toBottom, options = {}) {
	      const { hint = '' } = options;
	      const sorted = requireSelectedIndices(state.selectedIndices);
	      if (!sorted) return false;
	      const noteId = requireNoteId();
	      if (!noteId) return false;

	      const submitted = Bridge.moveCommentsToField(noteId, sorted, fieldName, !!toBottom);
	      if (!submitted) return false;
	      showToast(`正在移动 ${sorted.length} 条评论...${hint ? ' ' + hint : ''}`);
	      clearSelection();
	      return true;
	    }

	    function movePresetTop() {
	      performMoveToIndex(0, { hint: '→ 置顶' });
	    }

    function movePresetBottom() {
      performMoveToIndex(getAppendTargetIndex(), { hint: '→ 置底' });
    }

    function movePresetExcerptBottom() {
      const fields = state.fields || parseFieldsFromComments();
      const firstHeaderField = fields.find(f => typeof f.index === 'number' && f.index >= 0);
      const targetIndex = firstHeaderField
        ? getCommentIndexAtPosition(firstHeaderField.index, { fallbackToAppend: true })
        : getAppendTargetIndex();
      performMoveToIndex(targetIndex, { hint: '→ 摘录区底部' });
    }

	    function movePresetProofBoundary(boundary) {
	      const toBottom = boundary === 'bottom';
	      const hint = toBottom ? '→ 证明区底部' : '→ 证明区顶部';
	      // 证明字段在不同类型卡片中会自动映射到「证明/原理/反例」（由 Native 端 resolveFieldName 处理）
	      performMoveToField('证明', toBottom, { hint });
	    }

	    function findFieldByName(name) {
	      const fields = state.fields || parseFieldsFromComments();
	      if (!name) return null;

	      const exact = fields.find(f => f && f.name === name);
	      if (exact) return exact;

	      const starts = fields.find(f => f && typeof f.name === 'string' && f.name.startsWith(name));
	      if (starts) return starts;

	      return fields.find(f => f && typeof f.name === 'string' && f.name.includes(name)) || null;
	    }

    function movePresetFieldBoundary(fieldName, boundary) {
      const field = findFieldByName(fieldName);
      if (!field) {
        showToast(`未找到「${fieldName}」字段`);
        return;
      }

      const topIndex = getCommentIndexAtPosition(field.startIndex, { fallbackToAppend: true });
      const bottomIndex = getCommentIndexAtPosition(
        Math.max(field.startIndex, field.endIndex + 1),
        { fallbackToAppend: true }
      );
      const targetIndex = boundary === 'bottom' ? bottomIndex : topIndex;
      const hint = boundary === 'bottom' ? `→ ${fieldName}底部` : `→ ${fieldName}顶部`;

      performMoveToIndex(targetIndex, { hint });
    }

    function clearInsertPoints() {
      insertPointNodes.forEach((point) => {
        if (point && point.parentNode) {
          point.remove();
        }
      });
      insertPointNodes = [];
    }

    function createInsertPointRegistrar(insertedTargets) {
      return function registerInsertPoint(targetIndex, fieldName, position) {
        const normalizedTargetIndex = normalizeCommentIndex(targetIndex);
        if (Number.isNaN(normalizedTargetIndex) || insertedTargets.has(normalizedTargetIndex)) {
          return null;
        }
        const insertPoint = createInsertPoint(normalizedTargetIndex, fieldName, position);
        insertedTargets.add(normalizedTargetIndex);
        return insertPoint;
      };
    }

    function appendInsertPointNode(parentNode, insertPoint) {
      if (!parentNode || !insertPoint) return false;
      parentNode.appendChild(insertPoint);
      return true;
    }

    function prependGlobalInsertPoints(fields, registerInsertPoint) {
      const commentsListEl = dom.commentsList;
      if (!commentsListEl) return;

      const topPoint = registerInsertPoint(0, '卡片顶部', '置顶');
      if (topPoint) {
        topPoint.classList.add('insert-point-global');
        commentsListEl.insertBefore(topPoint, commentsListEl.firstChild);
      }

      const firstHeaderField = fields.find((field) => typeof field.index === 'number' && field.index >= 0);
      if (!firstHeaderField) return;

      const targetFieldGroup = fieldGroupNodeMap.get(getFieldUID(firstHeaderField));
      if (!targetFieldGroup) return;

      const beforeFieldPoint = registerInsertPoint(
        getCommentIndexAtPosition(firstHeaderField.index, { fallbackToAppend: true }),
        firstHeaderField.name || '字段',
        '字段上方'
      );
      if (beforeFieldPoint) {
        beforeFieldPoint.classList.add('insert-point-global');
        commentsListEl.insertBefore(beforeFieldPoint, targetFieldGroup);
      }
    }

    function resolveFieldCommentsContainer(field) {
      const fieldId = getFieldUID(field);
      const fieldGroup = fieldGroupNodeMap.get(fieldId) || null;
      return fieldCommentsContainerMap.get(fieldId)
        || (fieldGroup ? fieldGroup.querySelector('.field-comments') : null)
        || null;
    }

    function insertMoveTargetBeforeCard(card, insertPoint) {
      if (!card || !card.parentNode || !insertPoint) return false;
      const commentsContainer = card.parentNode;
      if (
        commentsContainer.classList
        && commentsContainer.classList.contains('htmlmd-group-comments')
        && card === commentsContainer.firstElementChild
      ) {
        const groupNode = commentsContainer.closest('.htmlmd-group');
        if (groupNode && groupNode.parentNode) {
          groupNode.parentNode.insertBefore(insertPoint, groupNode);
          return true;
        }
      }
      card.parentNode.insertBefore(insertPoint, card);
      return true;
    }

    function appendMoveTargetToField(fieldCommentsContainer, insertPoint) {
      if (!fieldCommentsContainer || !insertPoint) return false;
      fieldCommentsContainer.appendChild(insertPoint);
      return true;
    }

    function appendFieldInsertPoints(field, fieldCommentsContainer, registerInsertPoint) {
      const fieldComments = Array.isArray(field && field.comments) ? field.comments : [];

      if (fieldComments.length === 0) {
        appendMoveTargetToField(
          fieldCommentsContainer,
          registerInsertPoint(
            getCommentIndexAtPosition(field.startIndex, { fallbackToAppend: true }),
            field.name,
            '空字段'
          )
        );
        return;
      }

      fieldComments.forEach((comment, idx) => {
        const card = commentCardNodeMap.get(comment.index);
        insertMoveTargetBeforeCard(
          card,
          registerInsertPoint(comment.index, field.name, idx === 0 ? '开始' : null)
        );
      });

      appendMoveTargetToField(
        fieldCommentsContainer,
        registerInsertPoint(
          getCommentIndexAtPosition(field.endIndex + 1, { fallbackToAppend: true }),
          field.name,
          '结束'
        )
      );
    }

    function renderInsertPoints() {
      clearInsertPoints();

      const fields = state.fields || parseFieldsFromComments();
      const insertedTargets = new Set();
      const registerInsertPoint = createInsertPointRegistrar(insertedTargets);

      prependGlobalInsertPoints(fields, registerInsertPoint);

      fields.forEach((field) => {
        const fieldCommentsContainer = resolveFieldCommentsContainer(field);
        if (!fieldCommentsContainer) return;
        appendFieldInsertPoints(field, fieldCommentsContainer, registerInsertPoint);
      });
    }

    function createInsertPoint(targetIndex, fieldName, position) {
      const insertPoint = document.createElement('div');
      insertPoint.className = 'insert-point show';
      insertPoint.dataset.targetIndex = targetIndex;

      const positionHint = position ? ` (${position})` : '';
      const fieldHint = fieldName !== '摘录' ? `「${fieldName}」区${positionHint}` : positionHint;

      insertPoint.innerHTML = `
        <div class="insert-line">━━━ 移到这里 ━━━</div>
        <div class="field-hint">${escapeHtml(fieldHint)}</div>
      `;

      insertPointNodes.push(insertPoint);
      return insertPoint;
    }

	    function handleInsertPointClick(targetIndex) {
	      performMoveToIndex(targetIndex, { exitMoveModeAfter: true });

	      // 注意：Native 端会在操作完成后自动调用 Bridge.loadCommentData() 刷新数据
	    }
