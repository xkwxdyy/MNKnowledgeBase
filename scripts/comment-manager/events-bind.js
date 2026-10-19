    // 事件监听
    // ========================================
    function addClickHandler(node, handler) {
      if (!node) return;
      node.addEventListener('click', handler);
    }

    const DELETE_BUTTON_LONG_PRESS_DURATION = 500;
    const DELETE_BUTTON_LONG_PRESS_MOVE_TOLERANCE = 10;

    function extractDeleteButtonPointerPoint(event) {
      if (!event) return null;
      const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
      if (touch) {
        return { x: touch.clientX, y: touch.clientY };
      }
      if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        return { x: event.clientX, y: event.clientY };
      }
      return null;
    }

    function createDeleteButtonGestureState() {
      return {
        pressTimer: null,
        pointerId: null,
        startPoint: null,
      };
    }

    function suppressDeleteButtonPressDefaults(node, event) {
      if (!event) return;
      if (event.cancelable !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      if (node && node.setPointerCapture && typeof event.pointerId === 'number') {
        try {
          node.setPointerCapture(event.pointerId);
        } catch (_) {
          // Some WebViews throw if capture is already released.
        }
      }
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function releaseDeleteButtonPressCapture(node, event) {
      if (!event) return;
      if (event.cancelable !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      if (node && node.releasePointerCapture && typeof event.pointerId === 'number') {
        try {
          node.releasePointerCapture(event.pointerId);
        } catch (_) {
          // Pointer capture may already be released after cancel/leave.
        }
      }
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function resetDeleteButtonPressState(gestureState) {
      if (gestureState.pressTimer !== null) {
        clearTimeout(gestureState.pressTimer);
        gestureState.pressTimer = null;
      }
      gestureState.pointerId = null;
      gestureState.startPoint = null;
    }

    function startDeleteButtonPress(gestureState, node, event) {
      suppressDeleteButtonPressDefaults(node, event);
      resetDeleteButtonPressState(gestureState);
      gestureState.startPoint = extractDeleteButtonPointerPoint(event);
      gestureState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      gestureState.pressTimer = setTimeout(() => {
        handleNormalDelete();
        resetDeleteButtonPressState(gestureState);
      }, DELETE_BUTTON_LONG_PRESS_DURATION);
    }

    function endDeleteButtonPress(gestureState, node, event) {
      releaseDeleteButtonPressCapture(node, event);
      if (gestureState.pressTimer !== null) {
        clearTimeout(gestureState.pressTimer);
        gestureState.pressTimer = null;
        handleBidirectionalDelete();
      }
      gestureState.pointerId = null;
      gestureState.startPoint = null;
    }

    function moveDeleteButtonPress(gestureState, event) {
      if (gestureState.pressTimer === null || !gestureState.startPoint) return;
      suppressDeleteButtonPressDefaults(null, event);
      if (typeof event.pointerId === 'number' && gestureState.pointerId !== null && event.pointerId !== gestureState.pointerId) return;
      const point = extractDeleteButtonPointerPoint(event);
      if (!point) return;
      if (Math.hypot(point.x - gestureState.startPoint.x, point.y - gestureState.startPoint.y) > DELETE_BUTTON_LONG_PRESS_MOVE_TOLERANCE) {
        resetDeleteButtonPressState(gestureState);
      }
    }

    function bindDeleteButtonPointerGestures(node, gestureState) {
      node.addEventListener('pointerdown', (event) => startDeleteButtonPress(gestureState, node, event));
      node.addEventListener('pointerup', (event) => endDeleteButtonPress(gestureState, node, event));
      node.addEventListener('pointercancel', () => resetDeleteButtonPressState(gestureState));
      node.addEventListener('pointermove', (event) => moveDeleteButtonPress(gestureState, event));
      node.addEventListener('contextmenu', (event) => suppressDeleteButtonPressDefaults(node, event));
      node.addEventListener('selectstart', (event) => suppressDeleteButtonPressDefaults(node, event));
      node.addEventListener('dragstart', (event) => suppressDeleteButtonPressDefaults(node, event));
    }

    function bindDeleteButtonFallbackGestures(node, gestureState) {
      node.addEventListener('mousedown', (event) => startDeleteButtonPress(gestureState, node, event));
      node.addEventListener('mouseup', (event) => endDeleteButtonPress(gestureState, node, event));
      node.addEventListener('mouseleave', () => resetDeleteButtonPressState(gestureState));
      node.addEventListener('touchstart', (event) => startDeleteButtonPress(gestureState, node, event), { passive: false });
      node.addEventListener('touchend', (event) => endDeleteButtonPress(gestureState, node, event), { passive: false });
      node.addEventListener('touchcancel', () => resetDeleteButtonPressState(gestureState), { passive: true });
      node.addEventListener('touchmove', (event) => moveDeleteButtonPress(gestureState, event), { passive: false });
      node.addEventListener('contextmenu', (event) => suppressDeleteButtonPressDefaults(node, event));
      node.addEventListener('selectstart', (event) => suppressDeleteButtonPressDefaults(node, event));
      node.addEventListener('dragstart', (event) => suppressDeleteButtonPressDefaults(node, event));
    }

    function attachDeleteButtonGestureHandlers() {
      if (!dom.deleteBtn) return;
      const gestureState = createDeleteButtonGestureState();
      if (window.PointerEvent) {
        bindDeleteButtonPointerGestures(dom.deleteBtn, gestureState);
        return;
      }
      bindDeleteButtonFallbackGestures(dom.deleteBtn, gestureState);
    }

    function getCommentManagerClickBindings() {
      return [
        [dom.manualSelectBtn, () => setSelectionMode('manual')],
        [dom.rangeSelectBtn, () => setSelectionMode('range')],
        [dom.autoNewBtn, selectAutoNewContent],
        [dom.last1Btn, () => selectLastN(1)],
        [dom.last2Btn, () => selectLastN(2)],
        [dom.rangeConfirmBtn, confirmRangeSelect],
        [dom.rangeCancelBtn, cancelRangeSelect],
        [dom.selectAllBtn, selectAll],
        [dom.invertBtn, invertSelection],
        [dom.clearBtn, clearSelection],
        [dom.refreshCurrentNoteBtn, requestCurrentNoteRefresh],
        [dom.moveBtn, () => handleAction('move')],
        [dom.extractBtn, () => handleAction('extract')],
        [dom.moveTopBtn, movePresetTop],
        [dom.moveBottomBtn, movePresetBottom],
        [dom.moveExcerptBottomBtn, movePresetExcerptBottom],
        [dom.moveProofTopBtn, () => movePresetProofBoundary('top')],
        [dom.moveProofBottomBtn, () => movePresetProofBoundary('bottom')],
        [dom.moveUpBtn, () => moveSelectionBySteps('up', 1)],
        [dom.moveDownBtn, () => moveSelectionBySteps('down', 1)],
        [dom.customMoveBtn, () => handleAction('move')],
        [dom.closeBtn, closeWindow],
        [dom.copyDisplayTextBtn, () => copyEditLinkFieldValue('displayText')],
        [dom.pasteDisplayTextBtn, () => pasteClipboardToEditLinkField('displayText')],
        [dom.useSelectionBtn, applyCurrentSelectionToEditDisplayText],
        [dom.copyLinkUrlBtn, () => copyEditLinkFieldValue('url')],
        [dom.pasteLinkUrlBtn, () => pasteClipboardToEditLinkField('url')],
        [dom.pasteReplacementMarkdownBtn, () => pasteClipboardToEditLinkField('replacementMarkdown')],
        [dom.editLinkCancelBtn, closeEditLinkModal],
        [dom.editLinkConfirmBtn, confirmEditLink],
        [dom.updateLinkBtn, handleUpdateLink],
        [dom.convertLinksToInlineBtn, convertSelectedLinksToInline],
        [dom.mergeInlineLinksBtn, openInlineMergeModal],
        [dom.mergeTextCommentsBtn, openTextMergeModal],
        [dom.batchDeleteBtn, openBatchDeleteModal],
        [dom.mergeInsertTextBtn, insertMergeBuilderText],
        [dom.mergeInsertInlineLinkBtn, insertMergeBuilderInlineLink],
        [dom.mergeClearBuilderBtn, clearMergeBuilder],
        [dom.mergeClearCookingBtn, clearMergeCookingText],
        [dom.mergeInlineCancelBtn, closeInlineMergeModal],
        [dom.mergeInlineConfirmBtn, confirmInlineMerge],
        [dom.textMergeLoadBtn, loadTextMergeMaterialsInOrder],
        [dom.textMergeRebuildBtn, rebuildTextMergeCookingText],
        [dom.textMergeClearBtn, clearTextMergeCookingText],
        [dom.mergeTextCancelBtn, closeTextMergeModal],
        [dom.mergeTextConfirmBtn, confirmTextMerge],
        [dom.batchDeleteCancelBtn, closeBatchDeleteModal],
        [dom.batchDeleteConfirmBtn, confirmBatchDelete],
        [dom.confirmModalCancelBtn, () => closeConfirmModal({ invokeCancel: true })],
        [dom.confirmModalConfirmBtn, handleConfirmModalConfirm],
      ];
    }

    function bindCommentManagerClickActions() {
      getCommentManagerClickBindings().forEach(([node, handler]) => addClickHandler(node, handler));
      addClickHandler(dom.cancelMoveBtn, () => {
        if (state.moveMode) {
          exitMoveMode();
          showToast('已取消移动');
        }
      });
      dom.compactToolTabs.forEach((button) => {
        addClickHandler(button, () => openCompactToolsPanel(button.dataset.compactPanel));
      });
      dom.compactPanelCloseButtons.forEach((button) => {
        addClickHandler(button, () => closeCompactToolsPanel());
      });
      addClickHandler(dom.compactPanelBackdrop, () => closeCompactToolsPanel());

      [dom.selectionToolsPanel, dom.organizeToolsPanel].forEach((panel) => {
        if (!panel) return;
        panel.addEventListener('click', (event) => {
          const actionButton = event.target && event.target.closest ? event.target.closest('.tool-btn') : null;
          if (!actionButton || actionButton.disabled) return;
          setTimeout(() => closeCompactToolsPanel({ restoreFocus: false }), 0);
        });
      });
    }

    function bindCommentManagerModalClosers() {
      if (dom.editLinkModal) {
        dom.editLinkModal.addEventListener('click', (event) => {
          if (event.target === dom.editLinkModal) closeEditLinkModal();
        });
      }
      if (dom.confirmModal) {
        dom.confirmModal.addEventListener('click', (event) => {
          if (event.target === dom.confirmModal) closeConfirmModal({ invokeCancel: true });
        });
      }
      if (dom.mergeInlineModal) {
        dom.mergeInlineModal.addEventListener('click', (event) => {
          if (event.target === dom.mergeInlineModal) closeInlineMergeModal();
        });
      }
      if (dom.mergeTextModal) {
        dom.mergeTextModal.addEventListener('click', (event) => {
          if (event.target === dom.mergeTextModal) closeTextMergeModal();
        });
      }
      if (dom.batchDeleteModal) {
        dom.batchDeleteModal.addEventListener('click', (event) => {
          if (event.target === dom.batchDeleteModal) closeBatchDeleteModal();
        });
      }
    }

    function bindCommentManagerEditInputs() {
      if (dom.editDisplayText) {
        dom.editDisplayText.addEventListener('keydown', handleEditLinkKeydown);
        dom.editDisplayText.addEventListener('input', updateEditLinkModalState);
      }
      if (dom.editLinkUrl) {
        dom.editLinkUrl.addEventListener('keydown', handleEditLinkKeydown);
        dom.editLinkUrl.addEventListener('input', updateEditLinkModalState);
      }
      if (dom.editReplacementMarkdown) {
        dom.editReplacementMarkdown.addEventListener('keydown', handleEditLinkKeydown);
        dom.editReplacementMarkdown.addEventListener('input', updateEditLinkModalState);
      }
      if (dom.mergeCookingText) {
        dom.mergeCookingText.addEventListener('input', updateMergeConfirmState);
      }
      if (dom.textMergeCookingText) {
        dom.textMergeCookingText.addEventListener('input', updateTextMergeConfirmState);
      }
      if (dom.textMergeCustomSeparator) {
        dom.textMergeCustomSeparator.addEventListener('input', handleTextMergeCustomSeparatorInput);
      }
      if (dom.batchDeleteTypeList) {
        dom.batchDeleteTypeList.addEventListener('change', updateBatchDeleteModalState);
      }
    }

    function bindCommentManagerListListeners() {
      if (dom.commentsSection) {
        dom.commentsSection.addEventListener('scroll', handleCommentsScroll);
      }
      if (dom.commentsList) {
        dom.commentsList.addEventListener('click', handleCommentsListClick);
        dom.commentsList.addEventListener('dblclick', handleCommentsListDoubleClick);
        dom.commentsList.addEventListener('change', handleCommentsListChange);
        dom.commentsList.addEventListener('load', handleCommentMediaLoad, true);
        dom.commentsList.addEventListener('error', handleCommentMediaError, true);
        dom.commentsList.addEventListener('contextmenu', cancelFieldHeaderContextMenu);
        dom.commentsList.addEventListener('contextmenu', cancelHtmlMDGroupContextMenu);
        dom.commentsList.addEventListener('contextmenu', cancelQuickMoveContextMenu);
        dom.commentsList.addEventListener('contextmenu', cancelLinkLocateContextMenu);
        dom.commentsList.addEventListener('selectstart', cancelFieldHeaderContextMenu);
        dom.commentsList.addEventListener('dragstart', cancelFieldHeaderContextMenu);
        dom.commentsList.addEventListener('selectstart', cancelHtmlMDGroupContextMenu);
        dom.commentsList.addEventListener('dragstart', cancelHtmlMDGroupContextMenu);
        dom.commentsList.addEventListener('selectstart', cancelPressControlSelection);
        dom.commentsList.addEventListener('dragstart', cancelPressControlSelection);
        if (window.PointerEvent) {
          dom.commentsList.addEventListener('pointerdown', startFieldHeaderLongPress);
          dom.commentsList.addEventListener('pointerdown', startHtmlMDGroupLongPress);
          dom.commentsList.addEventListener('pointerdown', startQuickMoveLongPress);
          dom.commentsList.addEventListener('pointerdown', startLinkLocateLongPress);
          dom.commentsList.addEventListener('pointermove', moveFieldHeaderLongPress);
          dom.commentsList.addEventListener('pointermove', moveHtmlMDGroupLongPress);
          dom.commentsList.addEventListener('pointermove', moveQuickMoveLongPress);
          dom.commentsList.addEventListener('pointermove', moveLinkLocateLongPress);
          dom.commentsList.addEventListener('pointerup', endFieldHeaderLongPress);
          dom.commentsList.addEventListener('pointerup', endHtmlMDGroupLongPress);
          dom.commentsList.addEventListener('pointerup', endQuickMoveLongPress);
          dom.commentsList.addEventListener('pointerup', endLinkLocateLongPress);
          dom.commentsList.addEventListener('pointercancel', () => {
            resetFieldHeaderLongPressState();
            resetHtmlMDGroupLongPressState();
            resetQuickMoveLongPress();
            resetLinkLocateLongPress();
          });
        } else {
          dom.commentsList.addEventListener('mousedown', startFieldHeaderLongPress);
          dom.commentsList.addEventListener('mousedown', startHtmlMDGroupLongPress);
          dom.commentsList.addEventListener('mousedown', startQuickMoveLongPress);
          dom.commentsList.addEventListener('mousedown', startLinkLocateLongPress);
          dom.commentsList.addEventListener('mousemove', moveFieldHeaderLongPress);
          dom.commentsList.addEventListener('mousemove', moveHtmlMDGroupLongPress);
          dom.commentsList.addEventListener('mousemove', moveQuickMoveLongPress);
          dom.commentsList.addEventListener('mousemove', moveLinkLocateLongPress);
          dom.commentsList.addEventListener('mouseup', endFieldHeaderLongPress);
          dom.commentsList.addEventListener('mouseup', endHtmlMDGroupLongPress);
          dom.commentsList.addEventListener('mouseup', endQuickMoveLongPress);
          dom.commentsList.addEventListener('mouseup', endLinkLocateLongPress);
          dom.commentsList.addEventListener('mouseleave', () => {
            resetFieldHeaderLongPressState();
            resetHtmlMDGroupLongPressState();
            resetQuickMoveLongPress();
            resetLinkLocateLongPress();
          });
          dom.commentsList.addEventListener('touchstart', startFieldHeaderLongPress, { passive: true });
          dom.commentsList.addEventListener('touchstart', startHtmlMDGroupLongPress, { passive: true });
          dom.commentsList.addEventListener('touchstart', startQuickMoveLongPress, { passive: false });
          dom.commentsList.addEventListener('touchstart', startLinkLocateLongPress, { passive: false });
          dom.commentsList.addEventListener('touchmove', moveFieldHeaderLongPress, { passive: true });
          dom.commentsList.addEventListener('touchmove', moveHtmlMDGroupLongPress, { passive: true });
          dom.commentsList.addEventListener('touchmove', moveQuickMoveLongPress, { passive: false });
          dom.commentsList.addEventListener('touchmove', moveLinkLocateLongPress, { passive: false });
          dom.commentsList.addEventListener('touchend', endFieldHeaderLongPress, { passive: true });
          dom.commentsList.addEventListener('touchend', endHtmlMDGroupLongPress, { passive: true });
          dom.commentsList.addEventListener('touchend', endQuickMoveLongPress, { passive: false });
          dom.commentsList.addEventListener('touchend', endLinkLocateLongPress, { passive: false });
          dom.commentsList.addEventListener('touchcancel', () => {
            resetFieldHeaderLongPressState();
            resetHtmlMDGroupLongPressState();
            resetQuickMoveLongPress();
            resetLinkLocateLongPress();
          }, { passive: true });
        }
      }
      if (dom.fieldNavList) {
        dom.fieldNavList.addEventListener('click', handleFieldNavClick);
      }
      if (dom.mergeMaterialList) {
        dom.mergeMaterialList.addEventListener('click', handleMergeMaterialClick);
        dom.mergeMaterialList.addEventListener('dblclick', handleMergeMaterialDoubleClick);
        dom.mergeMaterialList.addEventListener('contextmenu', cancelMergeMaterialPressDefault);
        dom.mergeMaterialList.addEventListener('selectstart', cancelMergeMaterialPressDefault);
        dom.mergeMaterialList.addEventListener('dragstart', cancelMergeMaterialPressDefault);
        if (window.PointerEvent) {
          dom.mergeMaterialList.addEventListener('pointerdown', startMergeMaterialLongPress);
          dom.mergeMaterialList.addEventListener('pointerup', endMergeMaterialLongPress);
          dom.mergeMaterialList.addEventListener('pointercancel', endMergeMaterialLongPress);
        } else {
          dom.mergeMaterialList.addEventListener('mousedown', startMergeMaterialLongPress);
          dom.mergeMaterialList.addEventListener('mouseup', endMergeMaterialLongPress);
          dom.mergeMaterialList.addEventListener('mouseleave', endMergeMaterialLongPress);
          dom.mergeMaterialList.addEventListener('touchstart', startMergeMaterialLongPress, { passive: false });
          dom.mergeMaterialList.addEventListener('touchend', endMergeMaterialLongPress, { passive: false });
          dom.mergeMaterialList.addEventListener('touchcancel', endMergeMaterialLongPress, { passive: true });
        }
      }
      if (dom.textMergeMaterialList) {
        dom.textMergeMaterialList.addEventListener('click', handleTextMergeMaterialClick);
      }
      if (dom.textMergeSeparatorGroup) {
        dom.textMergeSeparatorGroup.addEventListener('click', handleTextMergeSeparatorClick);
      }
    }

    function bindCommentManagerWindowListeners() {
      window.addEventListener('resize', scheduleFieldHeaderPositionRefresh, { passive: true });
      window.addEventListener('resize', handleCompactLayoutResize, { passive: true });
      window.addEventListener('keydown', handleGlobalKeydown);
    }

    function attachEventListeners() {
      bindCommentManagerClickActions();
      attachDeleteButtonGestureHandlers();
      bindCommentManagerModalClosers();
      bindCommentManagerEditInputs();
      bindCommentManagerListListeners();
      bindCommentManagerWindowListeners();
    }
