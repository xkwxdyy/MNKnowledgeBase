    // 选择操作
    // ========================================
    function toggleSelection(index) {
      if (state.selectedIndices.has(index)) {
        state.selectedIndices.delete(index);
      } else {
        state.selectedIndices.add(index);
      }

      updateUI();
    }

    function selectAll() {
      replaceSelection(getCommentIndicesFromComments(state.comments));
      updateUI();
    }

    // 选中/取消选中指定字段下的所有评论（切换模式）
    function selectFieldComments(field) {
      const fieldCommentIndices = getFieldCommentIndices(field);

      // 检查该字段下的评论是否全部已选中
      const allSelected = fieldCommentIndices.length > 0
        && fieldCommentIndices.every((index) => state.selectedIndices.has(index));

      if (allSelected) {
        // 如果全部已选中，则取消选中该字段的所有评论
        fieldCommentIndices.forEach((index) => state.selectedIndices.delete(index));
      } else {
        // 否则，选中该字段的所有评论（不清空其他字段的选择）
        fieldCommentIndices.forEach((index) => state.selectedIndices.add(index));
      }

      updateUI();
    }

    function getHtmlMDGroupCommentIndices(group) {
      return getCommentIndicesFromComments(group && group.comments);
    }

    function getHtmlMDGroupSelectionState(group) {
      const groupCommentIndices = getHtmlMDGroupCommentIndices(group);
      if (groupCommentIndices.length === 0) {
        return { selected: false, partial: false, count: 0, total: 0 };
      }

      const selectedCount = groupCommentIndices.filter((index) => state.selectedIndices.has(index)).length;
      return {
        selected: selectedCount === groupCommentIndices.length,
        partial: selectedCount > 0 && selectedCount < groupCommentIndices.length,
        count: selectedCount,
        total: groupCommentIndices.length,
      };
    }

    function selectHtmlMDGroupComments(group) {
      const groupCommentIndices = getHtmlMDGroupCommentIndices(group);
      if (groupCommentIndices.length === 0) {
        showToast('该分组下没有可选评论');
        return;
      }

      const selectionState = getHtmlMDGroupSelectionState(group);
      if (selectionState.selected) {
        groupCommentIndices.forEach((index) => state.selectedIndices.delete(index));
      } else {
        groupCommentIndices.forEach((index) => state.selectedIndices.add(index));
      }

      updateUI();
    }

    /**
     * 切换字段本身的选中状态（只针对字段标题）
     * @param {Object} field - 字段对象
     */
    function toggleFieldSelection(field) {
      // 摘录字段不可选中（field.index = -1）
      if (field.index < 0) {
        showToast('摘录字段无法单独选中');
        return;
      }

      // 切换选中状态
      if (state.selectedIndices.has(field.index)) {
        state.selectedIndices.delete(field.index);
      } else {
        state.selectedIndices.add(field.index);
      }

      updateUI();
    }

    function invertSelection() {
      const newSet = new Set();
      state.comments.forEach((c) => {
        if (!state.selectedIndices.has(c.index)) {
          newSet.add(c.index);
        }
      });
      state.selectedIndices = newSet;
      updateUI();
    }

    function clearSelection() {
      state.selectedIndices.clear();
      clearFieldHeaderClickTimer();
      updateUI();
    }

    // ========================================
    // 选择模式管理
    // ========================================
    function setSelectionMode(mode) {
      const nextMode = mode === 'range' ? 'range' : 'manual';

      if (state.selectionMode === nextMode) {
        setSelectionModeButtonActive(nextMode);
        if (nextMode === 'range' && !dom.rangeSelectHint.classList.contains('show')) {
          enterRangeSelectMode();
        }
        return;
      }

      // 切换选择模式前，清理上一个模式的状态
      if (state.selectionMode === 'range') {
        cancelRangeSelect();
      }

      state.selectionMode = nextMode;
      setSelectionModeButtonActive(nextMode);

      if (nextMode === 'range') {
        enterRangeSelectMode();
      }
    }

    // ========================================
    // 范围选择功能
    // ========================================
    function enterRangeSelectMode() {
      // 清空当前选择
      state.selectedIndices.clear();
      state.rangeSelectStart = null;
      clearFieldHeaderClickTimer();

      // 显示提示条
      dom.rangeSelectHint.classList.add('show');
      dom.rangeHintText.textContent = '请点击起始评论';

      // 更新UI
      updateUI();
    }

    function handleRangeSelect(index) {
      clearFieldHeaderClickTimer();
      if (state.rangeSelectStart === null) {
        // 第一次点击：设置起始点
        state.rangeSelectStart = index;
        dom.rangeHintText.textContent = `已选择起始 #${index}，请点击结束评论`;

        // 将起始点加入选择集，保证立即有选中视效（包括字段标题/评论卡片）。
        replaceSelection([index]);

        // 高亮起始卡片
        updateRangeSelection();
      } else {
        // 第二次点击：按可视顺序选中范围
        const rangeIndices = getCommentIndicesBetween(state.rangeSelectStart, index);
        if (rangeIndices.length === 0) {
          showToast('未能识别评论范围');
          return;
        }
        replaceSelection(rangeIndices);
        const firstSelected = rangeIndices[0];
        const lastSelected = rangeIndices[rangeIndices.length - 1];

        // 自动确认范围选择（不需要用户再点击确认按钮）
        showToast(`已选择 ${state.selectedIndices.size} 条评论（#${firstSelected} ~ #${lastSelected}）`);

        // 退出范围选择模式
        dom.rangeSelectHint.classList.remove('show');
        state.rangeSelectStart = null;

        // 清除范围选择样式
        clearRangeSelectionStyles();

        // 切回手动模式（但保持选择）
        state.selectionMode = 'manual';
        setSelectionModeButtonActive('manual');

        // 重要：更新UI以显示选中状态
        updateUI();
      }
    }

    // 在范围选择模式下处理字段标题点击。
    // 字段标题本质上对应一条 HtmlComment（field.index），
    // 当用户先选中字段再进入范围选择时，起始点可能来自字段。
    function handleRangeSelectField(field) {
      if (!field || typeof field.index !== 'number' || field.index < 0) {
        return;
      }
      handleRangeSelect(field.index);
    }

    function clearRangeSelectionStyles() {
      if (rangeStartStyledIndex !== null) {
        const startCard = commentCardNodeMap.get(rangeStartStyledIndex);
        if (startCard) {
          startCard.classList.remove('range-start');
        }
      }

      rangeStyledIndices.forEach((index) => {
        const card = commentCardNodeMap.get(index);
        if (card) {
          card.classList.remove('in-range');
        }
      });

      rangeStyledIndices = new Set();
      rangeStartStyledIndex = null;
    }

    function getRangeSelectionStartIndex() {
      return (typeof state.rangeSelectStart === 'number' && state.rangeSelectStart >= 0)
        ? state.rangeSelectStart
        : null;
    }

    function syncRangeStartVisual(nextStartIndex) {
      if (rangeStartStyledIndex === nextStartIndex) {
        return;
      }

      if (rangeStartStyledIndex !== null) {
        const prevStartCard = commentCardNodeMap.get(rangeStartStyledIndex);
        if (prevStartCard) {
          prevStartCard.classList.remove('range-start');
        }
      }

      if (nextStartIndex !== null) {
        const nextStartCard = commentCardNodeMap.get(nextStartIndex);
        if (nextStartCard) {
          nextStartCard.classList.add('range-start');
        }
      }

      rangeStartStyledIndex = nextStartIndex;
    }

    function buildRangeInSelectionSet(nextStartIndex) {
      const nextInRangeIndices = new Set();
      if (nextStartIndex !== null && state.selectedIndices && state.selectedIndices.size > 0) {
        state.selectedIndices.forEach((index) => {
          if (index !== nextStartIndex) {
            nextInRangeIndices.add(index);
          }
        });
      }
      return nextInRangeIndices;
    }

    function syncRangeInSelectionVisual(nextInRangeIndices) {
      rangeStyledIndices.forEach((index) => {
        if (!nextInRangeIndices.has(index)) {
          const card = commentCardNodeMap.get(index);
          if (card) {
            card.classList.remove('in-range');
          }
        }
      });

      nextInRangeIndices.forEach((index) => {
        if (!rangeStyledIndices.has(index)) {
          const card = commentCardNodeMap.get(index);
          if (card) {
            card.classList.add('in-range');
          }
        }
      });

      rangeStyledIndices = nextInRangeIndices;
    }

    function updateRangeSelectionStyles() {
      const nextStartIndex = getRangeSelectionStartIndex();
      syncRangeStartVisual(nextStartIndex);
      const nextInRangeIndices = buildRangeInSelectionSet(nextStartIndex);
      syncRangeInSelectionVisual(nextInRangeIndices);
    }

    function updateRangeSelection() {
      updateRangeSelectionStyles();
      updateUI();
    }

    function confirmRangeSelect() {
      if (state.selectedIndices.size === 0) {
        showToast('请先选择评论范围');
        return;
      }

      // 退出范围选择模式
      dom.rangeSelectHint.classList.remove('show');
      state.rangeSelectStart = null;

      // 清除范围选择样式
      clearRangeSelectionStyles();

      // 切回手动模式（但保持选择）
      state.selectionMode = 'manual';
      setSelectionModeButtonActive('manual');

      showToast(`已选择 ${state.selectedIndices.size} 条评论`);
    }

    function cancelRangeSelect() {
      // 清空选择
      state.selectedIndices.clear();
      state.rangeSelectStart = null;
      clearFieldHeaderClickTimer();

      // 隐藏提示条
      dom.rangeSelectHint.classList.remove('show');

      // 清除范围选择样式
      clearRangeSelectionStyles();

      // 更新UI
      updateUI();
    }

    // ========================================
    // 快捷选择功能
    // ========================================
    function selectLastN(n) {
      const totalComments = state.comments.length;
      if (totalComments === 0) {
        showToast('没有评论可选择');
        return;
      }

      // 给按钮一个视觉反馈
      const btnId = n === 1 ? 'last1Btn' : 'last2Btn';
      flashButton(btnId);

      const selected = replaceSelection(state.comments.slice(-n));

      updateUI();
      showToast(`已选择最后 ${selected.length} 条评论`);
    }

    function selectAutoNewContent() {
      // 给按钮一个视觉反馈
      flashButton('autoNewBtn');

      const noteId = requireNoteId({ message: '缺少卡片 ID' });
      if (!noteId) return;

      debugLog('[HTML] request auto new content');
      Bridge.requestAutoNewContent(noteId);
      showToast('正在检测新内容...');
    }

    // 按钮闪烁效果
    function flashButton(btnId) {
      const btn = document.getElementById(btnId);
      if (!btn) return;

      btn.classList.add('active');
      setTimeout(() => {
        btn.classList.remove('active');
      }, 300);
    }

    // ========================================
    // 更新 UI
    // ========================================
	    function updateUI() {
      const nextTitle = state.noteTitle || '';
      if (uiSnapshot.noteTitle !== nextTitle) {
        dom.noteTitle.textContent = nextTitle;
        uiSnapshot.noteTitle = nextTitle;
      }

      const totalCount = Array.isArray(state.comments) ? state.comments.length : 0;
      if (uiSnapshot.totalCount !== totalCount) {
        dom.totalCount.textContent = totalCount;
        uiSnapshot.totalCount = totalCount;
      }

      const selectedCount = state.selectedIndices ? state.selectedIndices.size : 0;
      if (uiSnapshot.selectedCount !== selectedCount) {
        dom.selectedCount.textContent = selectedCount;
        uiSnapshot.selectedCount = selectedCount;
      }

	      updateSelectionVisualsIncremental();

	      // 更新操作按钮状态（移动模式下始终禁用）
		      const shouldDisableActions = state.moveMode === true
          || state.isCommentsRendering === true
          || state.pendingMutations.size > 0
          || selectedCount === 0;
	      if (uiSnapshot.actionButtonsDisabled !== shouldDisableActions) {
	        setPrimaryActionButtonsDisabled(shouldDisableActions);
	        uiSnapshot.actionButtonsDisabled = shouldDisableActions;
	      }
      if (dom.batchDeleteBtn) {
        dom.batchDeleteBtn.disabled = state.isCommentsRendering === true
          || state.pendingMutations.size > 0
          || totalCount === 0;
      }
	    }

    // ========================================
