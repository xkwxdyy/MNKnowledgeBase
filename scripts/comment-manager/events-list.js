    function clearFieldHeaderClickTimer() {
	      if (fieldHeaderClickTimer) {
	        clearTimeout(fieldHeaderClickTimer);
	        fieldHeaderClickTimer = null;
	      }
	    }

    const FIELD_HEADER_LONG_PRESS_DURATION = 520;

// Pencil/stylus contacts get a wider hold window; finger and mouse retain the original timing.
function getLongPressDelay(event, baseMs) {
  const pointerType = String(event?.pointerType || '').toLowerCase();
  const touch = (event?.touches && event.touches[0]) || (event?.changedTouches && event.changedTouches[0]);
  const touchType = String(touch?.touchType || '').toLowerCase();
  return (pointerType === 'pen' || pointerType === 'stylus' || touchType === 'stylus')
    ? Math.min(Number(baseMs) + 220, 760)
    : Number(baseMs);
}
    const FIELD_HEADER_LONG_PRESS_MOVE_TOLERANCE = 10;
    const fieldHeaderLongPressState = {
      timer: null,
      pointerId: null,
      header: null,
      startPoint: null,
      handled: false,
    };
    const htmlMDGroupLongPressState = {
      timer: null,
      pointerId: null,
      header: null,
      startPoint: null,
      handled: false,
    };

    function extractFieldHeaderPointerPoint(event) {
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

    function resetFieldHeaderLongPressState(options = {}) {
      const { preserveHandled = false } = options;
      if (fieldHeaderLongPressState.timer !== null) {
        clearTimeout(fieldHeaderLongPressState.timer);
        fieldHeaderLongPressState.timer = null;
      }
      if (!preserveHandled) {
        fieldHeaderLongPressState.handled = false;
      }
      fieldHeaderLongPressState.pointerId = null;
      fieldHeaderLongPressState.header = null;
      fieldHeaderLongPressState.startPoint = null;
    }

    function resetHtmlMDGroupLongPressState(options = {}) {
      const { preserveHandled = false } = options;
      if (htmlMDGroupLongPressState.timer !== null) {
        clearTimeout(htmlMDGroupLongPressState.timer);
        htmlMDGroupLongPressState.timer = null;
      }
      if (!preserveHandled) {
        htmlMDGroupLongPressState.handled = false;
      }
      htmlMDGroupLongPressState.pointerId = null;
      htmlMDGroupLongPressState.header = null;
      htmlMDGroupLongPressState.startPoint = null;
    }

    function resolveLongPressFieldHeader(target) {
      if (!target || !dom.commentsList) return null;
      const fieldHeader = target.closest('.field-header');
      if (!fieldHeader || !dom.commentsList.contains(fieldHeader)) return null;
      if (target.closest('.field-checkbox, .proof-structure-open-btn')) return null;
      return fieldHeader;
    }

    function resolveLongPressHtmlMDGroupHeader(target) {
      if (!target || !dom.commentsList) return null;
      const groupHeader = target.closest('.htmlmd-group-header');
      if (!groupHeader || !dom.commentsList.contains(groupHeader)) return null;
      if (target.closest('.htmlmd-group-checkbox')) return null;
      return groupHeader;
    }

    function getHtmlMDGroupByHeaderElement(header) {
      if (!header) return null;
      const groupId = header.dataset.groupId;
      if (!groupId) return null;
      return (htmlMDGroupLookupById && htmlMDGroupLookupById.get(groupId)) || null;
    }

    function triggerFieldHeaderLongPress(fieldHeader) {
      const field = getFieldByHeaderElement(fieldHeader);
      if (!field || typeof field.index !== 'number' || field.index < 0) {
        resetFieldHeaderLongPressState();
        return;
      }

      clearFieldHeaderClickTimer();
      fieldHeaderLongPressState.timer = null;
      fieldHeaderLongPressState.handled = true;
      selectFieldComments(field);
      fieldHeader.classList.add('long-press-active');
      setTimeout(() => {
        fieldHeader.classList.remove('long-press-active');
      }, 240);
    }

    function triggerHtmlMDGroupLongPress(groupHeader) {
      const group = getHtmlMDGroupByHeaderElement(groupHeader);
      if (!group) {
        resetHtmlMDGroupLongPressState();
        return;
      }

      clearFieldHeaderClickTimer();
      htmlMDGroupLongPressState.timer = null;
      htmlMDGroupLongPressState.handled = true;
      selectHtmlMDGroupComments(group);
      groupHeader.classList.add('long-press-active');
      setTimeout(() => {
        groupHeader.classList.remove('long-press-active');
      }, 240);
    }

    function startFieldHeaderLongPress(event) {
      const fieldHeader = resolveLongPressFieldHeader(event && event.target);
      if (!fieldHeader) return;

      resetFieldHeaderLongPressState();
      fieldHeaderLongPressState.header = fieldHeader;
      fieldHeaderLongPressState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      fieldHeaderLongPressState.startPoint = extractFieldHeaderPointerPoint(event);
      fieldHeaderLongPressState.timer = setTimeout(() => {
        triggerFieldHeaderLongPress(fieldHeader);
      }, getLongPressDelay(event, FIELD_HEADER_LONG_PRESS_DURATION));
    }

    function startHtmlMDGroupLongPress(event) {
      const groupHeader = resolveLongPressHtmlMDGroupHeader(event && event.target);
      if (!groupHeader) return;

      resetHtmlMDGroupLongPressState();
      htmlMDGroupLongPressState.header = groupHeader;
      htmlMDGroupLongPressState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      htmlMDGroupLongPressState.startPoint = extractFieldHeaderPointerPoint(event);
      htmlMDGroupLongPressState.timer = setTimeout(() => {
        triggerHtmlMDGroupLongPress(groupHeader);
      }, getLongPressDelay(event, FIELD_HEADER_LONG_PRESS_DURATION));
    }

    function moveFieldHeaderLongPress(event) {
      if (fieldHeaderLongPressState.timer === null || !fieldHeaderLongPressState.startPoint) return;
      if (
        typeof event.pointerId === 'number'
        && fieldHeaderLongPressState.pointerId !== null
        && event.pointerId !== fieldHeaderLongPressState.pointerId
      ) {
        return;
      }

      const point = extractFieldHeaderPointerPoint(event);
      if (!point) return;
      if (
        Math.hypot(
          point.x - fieldHeaderLongPressState.startPoint.x,
          point.y - fieldHeaderLongPressState.startPoint.y
        ) > FIELD_HEADER_LONG_PRESS_MOVE_TOLERANCE
      ) {
        resetFieldHeaderLongPressState();
      }
    }

    function moveHtmlMDGroupLongPress(event) {
      if (htmlMDGroupLongPressState.timer === null || !htmlMDGroupLongPressState.startPoint) return;
      if (
        typeof event.pointerId === 'number'
        && htmlMDGroupLongPressState.pointerId !== null
        && event.pointerId !== htmlMDGroupLongPressState.pointerId
      ) {
        return;
      }

      const point = extractFieldHeaderPointerPoint(event);
      if (!point) return;
      if (
        Math.hypot(
          point.x - htmlMDGroupLongPressState.startPoint.x,
          point.y - htmlMDGroupLongPressState.startPoint.y
        ) > FIELD_HEADER_LONG_PRESS_MOVE_TOLERANCE
      ) {
        resetHtmlMDGroupLongPressState();
      }
    }

    function endFieldHeaderLongPress() {
      if (fieldHeaderLongPressState.handled) {
        return;
      }
      resetFieldHeaderLongPressState();
    }

    function endHtmlMDGroupLongPress() {
      if (htmlMDGroupLongPressState.handled) {
        return;
      }
      resetHtmlMDGroupLongPressState();
    }

    function cancelFieldHeaderContextMenu(event) {
      const fieldHeader = resolveLongPressFieldHeader(event && event.target);
      if (!fieldHeader) return;
      stopDelegatedEvent(event);
    }

    function cancelHtmlMDGroupContextMenu(event) {
      const groupHeader = resolveLongPressHtmlMDGroupHeader(event && event.target);
      if (!groupHeader) return;
      stopDelegatedEvent(event);
    }

	    function getFieldByHeaderElement(header) {
	      if (!header) return null;
	      const fieldId = header.dataset.fieldId;
	      if (!fieldId) return null;
	      if (fieldLookupById && fieldLookupById.has(fieldId)) {
	        return fieldLookupById.get(fieldId);
	      }
	      return (state.fields || []).find((field) => (field.uid || getFieldUID(field)) === fieldId) || null;
	    }

	    function parseCommentIndexFromCard(card) {
	      if (!card) return NaN;
	      const value = parseInt(card.dataset.index, 10);
	      return Number.isNaN(value) ? NaN : value;
	    }

    function safeDecodeURIComponent(value) {
      if (typeof value !== 'string') return '';
      try {
        return decodeURIComponent(value);
      } catch (error) {
        return value;
      }
    }

    const QUICK_MOVE_LONG_PRESS_DURATION = 520;
    const QUICK_MOVE_LONG_PRESS_MOVE_TOLERANCE = 10;
    const quickMoveLongPressState = {
      timer: null,
      pointerId: null,
      startPoint: null,
      button: null,
      consumeClick: false,
      consumeResetTimer: null,
    };

    const LINK_LOCATE_LONG_PRESS_DURATION = 520;
    const LINK_LOCATE_LONG_PRESS_MOVE_TOLERANCE = 10;
    const linkLocateLongPressState = {
      timer: null,
      pointerId: null,
      startPoint: null,
      button: null,
      consumeClick: false,
      consumeButton: null,
      consumeResetTimer: null,
    };

    function extractPointerPoint(event) {
      if (!event) return null;
      const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
      if (touch) return { x: touch.clientX, y: touch.clientY };
      if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        return { x: event.clientX, y: event.clientY };
      }
      return null;
    }

    function suppressControlPressDefaults(event) {
      if (!event) return;
      if (event.cancelable !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      const target = event.target && event.target.closest
        ? event.target.closest('.quick-move-btn, .link-locate-btn')
        : null;
      if (target && target.setPointerCapture && typeof event.pointerId === 'number') {
        try {
          target.setPointerCapture(event.pointerId);
        } catch (_) {
          // Some WebViews throw if capture is already released.
        }
      }
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function releaseControlPressCapture(event) {
      if (!event) return;
      if (event.cancelable !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      const target = event.target && event.target.closest
        ? event.target.closest('.quick-move-btn, .link-locate-btn')
        : null;
      if (target && target.releasePointerCapture && typeof event.pointerId === 'number') {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch (_) {
          // Pointer capture may already be released after cancel/leave.
        }
      }
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function resetQuickMoveLongPress(options = {}) {
      const { keepConsumeClick = false } = options;
      if (quickMoveLongPressState.timer !== null) {
        clearTimeout(quickMoveLongPressState.timer);
        quickMoveLongPressState.timer = null;
      }
      if (quickMoveLongPressState.button) {
        quickMoveLongPressState.button.classList.remove('long-press-active');
      }
      quickMoveLongPressState.pointerId = null;
      quickMoveLongPressState.startPoint = null;
      quickMoveLongPressState.button = null;
      if (!keepConsumeClick) {
        quickMoveLongPressState.consumeClick = false;
        if (quickMoveLongPressState.consumeResetTimer !== null) {
          clearTimeout(quickMoveLongPressState.consumeResetTimer);
          quickMoveLongPressState.consumeResetTimer = null;
        }
      }
    }

    function scheduleQuickMoveConsumeReset() {
      if (quickMoveLongPressState.consumeResetTimer !== null) {
        clearTimeout(quickMoveLongPressState.consumeResetTimer);
      }
      quickMoveLongPressState.consumeResetTimer = setTimeout(() => {
        quickMoveLongPressState.consumeClick = false;
        quickMoveLongPressState.consumeResetTimer = null;
      }, 700);
    }

    function resolveQuickMoveButton(target) {
      const button = target && target.closest ? target.closest('.quick-move-btn') : null;
      if (!button || !dom.commentsList || !dom.commentsList.contains(button)) return null;
      return button;
    }

    function startQuickMoveLongPress(event) {
      const button = resolveQuickMoveButton(event && event.target);
      if (!button || button.disabled) return;

      suppressControlPressDefaults(event);
      resetQuickMoveLongPress();
      quickMoveLongPressState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      quickMoveLongPressState.startPoint = extractPointerPoint(event);
      quickMoveLongPressState.button = button;
      button.classList.add('long-press-active');

      quickMoveLongPressState.timer = setTimeout(() => {
        const commentIndex = parseInt(button.dataset.index, 10);
        const direction = button.dataset.direction === 'up' ? 'up' : 'down';
        quickMoveLongPressState.consumeClick = true;
        if (!Number.isNaN(commentIndex)) {
          quickMoveSingleCommentToEdge(commentIndex, direction);
        }
        scheduleQuickMoveConsumeReset();
        resetQuickMoveLongPress({ keepConsumeClick: true });
      }, getLongPressDelay(event, QUICK_MOVE_LONG_PRESS_DURATION));
    }

    function moveQuickMoveLongPress(event) {
      if (quickMoveLongPressState.timer === null || !quickMoveLongPressState.startPoint) return;
      suppressControlPressDefaults(event);
      if (typeof event.pointerId === 'number'
        && quickMoveLongPressState.pointerId !== null
        && event.pointerId !== quickMoveLongPressState.pointerId) {
        return;
      }
      const point = extractPointerPoint(event);
      if (!point) return;
      if (Math.hypot(point.x - quickMoveLongPressState.startPoint.x, point.y - quickMoveLongPressState.startPoint.y) > QUICK_MOVE_LONG_PRESS_MOVE_TOLERANCE) {
        resetQuickMoveLongPress();
      }
    }

    function endQuickMoveLongPress(event) {
      if (quickMoveLongPressState.consumeClick) {
        releaseControlPressCapture(event);
        return;
      }
      const button = quickMoveLongPressState.button;
      const shouldClickMove = quickMoveLongPressState.timer !== null && button && !button.disabled;
      releaseControlPressCapture(event);
      if (shouldClickMove) {
        const commentIndex = parseInt(button.dataset.index, 10);
        const direction = button.dataset.direction === 'up' ? 'up' : 'down';
        resetQuickMoveLongPress({ keepConsumeClick: true });
        quickMoveLongPressState.consumeClick = true;
        scheduleQuickMoveConsumeReset();
        if (!Number.isNaN(commentIndex)) {
          quickMoveSingleComment(commentIndex, direction);
        }
        return;
      }
      resetQuickMoveLongPress();
    }

    function cancelQuickMoveContextMenu(event) {
      const button = resolveQuickMoveButton(event && event.target);
      if (!button) return;
      stopDelegatedEvent(event);
    }

    function resetLinkLocateLongPress(options = {}) {
      const { keepConsumeClick = false } = options;
      if (linkLocateLongPressState.timer !== null) {
        clearTimeout(linkLocateLongPressState.timer);
        linkLocateLongPressState.timer = null;
      }
      if (linkLocateLongPressState.button) {
        linkLocateLongPressState.button.classList.remove('long-press-active');
      }
      linkLocateLongPressState.pointerId = null;
      linkLocateLongPressState.startPoint = null;
      linkLocateLongPressState.button = null;
      if (!keepConsumeClick) {
        linkLocateLongPressState.consumeClick = false;
        linkLocateLongPressState.consumeButton = null;
        if (linkLocateLongPressState.consumeResetTimer !== null) {
          clearTimeout(linkLocateLongPressState.consumeResetTimer);
          linkLocateLongPressState.consumeResetTimer = null;
        }
      }
    }

    function scheduleLinkLocateConsumeReset() {
      if (linkLocateLongPressState.consumeResetTimer !== null) {
        clearTimeout(linkLocateLongPressState.consumeResetTimer);
      }
      linkLocateLongPressState.consumeResetTimer = setTimeout(() => {
        linkLocateLongPressState.consumeClick = false;
        linkLocateLongPressState.consumeButton = null;
        linkLocateLongPressState.consumeResetTimer = null;
      }, 700);
    }

    function resolveLinkLocateButton(target) {
      const button = target && target.closest ? target.closest('.link-locate-btn') : null;
      if (!button || !dom.commentsList || !dom.commentsList.contains(button)) return null;
      return button;
    }

    function startLinkLocateLongPress(event) {
      const button = resolveLinkLocateButton(event && event.target);
      if (!button) return;

      suppressControlPressDefaults(event);
      resetLinkLocateLongPress();
      linkLocateLongPressState.pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
      linkLocateLongPressState.startPoint = extractPointerPoint(event);
      linkLocateLongPressState.button = button;
      button.classList.add('long-press-active');

      linkLocateLongPressState.timer = setTimeout(() => {
        const noteId = button.dataset.noteId;
        linkLocateLongPressState.consumeClick = true;
        linkLocateLongPressState.consumeButton = button;
        if (noteId) {
          sendURLToNative('focusCardInFloatMindMap', { noteId });
        }
        scheduleLinkLocateConsumeReset();
        resetLinkLocateLongPress({ keepConsumeClick: true });
      }, getLongPressDelay(event, LINK_LOCATE_LONG_PRESS_DURATION));
    }

    function moveLinkLocateLongPress(event) {
      if (linkLocateLongPressState.timer === null || !linkLocateLongPressState.startPoint) return;
      suppressControlPressDefaults(event);
      if (typeof event.pointerId === 'number'
        && linkLocateLongPressState.pointerId !== null
        && event.pointerId !== linkLocateLongPressState.pointerId) {
        return;
      }
      const point = extractPointerPoint(event);
      if (!point) return;
      if (Math.hypot(point.x - linkLocateLongPressState.startPoint.x, point.y - linkLocateLongPressState.startPoint.y) > LINK_LOCATE_LONG_PRESS_MOVE_TOLERANCE) {
        resetLinkLocateLongPress();
      }
    }

    function endLinkLocateLongPress(event) {
      releaseControlPressCapture(event);
      if (linkLocateLongPressState.timer !== null) {
        resetLinkLocateLongPress();
      }
    }

    function cancelLinkLocateContextMenu(event) {
      const button = resolveLinkLocateButton(event && event.target);
      if (!button) return;
      stopDelegatedEvent(event);
    }

    function cancelPressControlSelection(event) {
      const target = event && event.target;
      const button = target && target.closest ? target.closest('.quick-move-btn, .link-locate-btn') : null;
      if (!button || !dom.commentsList || !dom.commentsList.contains(button)) return;
      stopDelegatedEvent(event);
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
    }

    function normalizeCommentIndex(index) {
      const parsed = Number(index);
      return Number.isFinite(parsed) ? parsed : NaN;
    }

    function getCommentIndicesFromComments(comments) {
      return (Array.isArray(comments) ? comments : [])
        .map((comment) => normalizeCommentIndex(comment && comment.index))
        .filter((index) => !Number.isNaN(index));
    }

    function replaceSelection(indexCollection) {
      const nextSelection = Array.isArray(indexCollection)
        && indexCollection.some((item) => item && typeof item === 'object')
        ? getUniqueSortedIndices(getCommentIndicesFromComments(indexCollection))
        : getUniqueSortedIndices(indexCollection);
      state.selectedIndices.clear();
      nextSelection.forEach((index) => state.selectedIndices.add(index));
      return nextSelection;
    }

    function getAppendTargetIndex() {
      const comments = Array.isArray(state.comments) ? state.comments : [];
      return comments.length;
    }

    function getCommentIndexAtPosition(position, options = {}) {
      const comments = Array.isArray(state.comments) ? state.comments : [];
      const parsedPosition = parseInt(position, 10);
      const { fallbackToAppend = false } = options;

      if (Number.isNaN(parsedPosition) || parsedPosition < 0) {
        return NaN;
      }

      if (parsedPosition < comments.length) {
        return normalizeCommentIndex(comments[parsedPosition] && comments[parsedPosition].index);
      }

      if (fallbackToAppend) {
        return getAppendTargetIndex();
      }

      return NaN;
    }

    function getCommentIndicesBetween(startIndex, endIndex) {
      const startPosition = getCommentPositionByIndex(startIndex);
      const endPosition = getCommentPositionByIndex(endIndex);

      if (startPosition < 0 || endPosition < 0) {
        return [];
      }

      const rangeStart = Math.min(startPosition, endPosition);
      const rangeEnd = Math.max(startPosition, endPosition);
      return getCommentIndicesFromComments(state.comments.slice(rangeStart, rangeEnd + 1));
    }

    function getFieldCommentIndices(field) {
      return getCommentIndicesFromComments(field && field.comments);
    }

    function rebuildCommentLookup() {
      const nextMap = new Map();
      const nextPositionMap = new Map();
      (state.comments || []).forEach((comment, arrayIndex) => {
        if (!comment) return;
        const commentIndex = normalizeCommentIndex(comment.index);
        if (!Number.isNaN(commentIndex)) {
          nextMap.set(commentIndex, comment);
          nextPositionMap.set(commentIndex, arrayIndex);
          return;
        }
        nextMap.set(arrayIndex, comment);
        nextPositionMap.set(arrayIndex, arrayIndex);
      });
      commentLookupByIndex = nextMap;
      commentPositionByIndex = nextPositionMap;
    }

    function rebuildFieldLookup() {
      const nextMap = new Map();
      (state.fields || []).forEach((field) => {
        if (!field) return;
        const fieldId = field.uid || getFieldUID(field);
        if (!fieldId) return;
        nextMap.set(fieldId, field);
      });
      fieldLookupById = nextMap;
      rebuildHtmlMDGroupLookup();
    }

    function rebuildHtmlMDGroupLookup() {
      const nextMap = new Map();
      (state.fields || []).forEach((field) => {
        const groups = Array.isArray(field && field.htmlMDGroups) ? field.htmlMDGroups : [];
        groups.forEach((group) => {
          if (group && group.uid) {
            nextMap.set(group.uid, group);
          }
        });
      });
      htmlMDGroupLookupById = nextMap;
    }

    function handleCommentsListChange(event) {
      const groupCheckbox = event.target.closest('.htmlmd-group-checkbox');
      if (groupCheckbox && dom.commentsList.contains(groupCheckbox)) {
        event.stopPropagation();
        const header = groupCheckbox.closest('.htmlmd-group-header');
        const group = getHtmlMDGroupByHeaderElement(header);
        if (!group) return;
        selectHtmlMDGroupComments(group);
        return;
      }

      const fieldCheckbox = event.target.closest('.field-checkbox');
      if (fieldCheckbox && dom.commentsList.contains(fieldCheckbox)) {
        event.stopPropagation();
        const header = fieldCheckbox.closest('.field-header');
        const field = getFieldByHeaderElement(header);
        if (!field) return;
        toggleFieldSelection(field);
        return;
	      }

	      const checkbox = event.target.closest('.comment-checkbox');
	      if (!checkbox || !dom.commentsList.contains(checkbox)) return;

	      const card = checkbox.closest('.comment-card');
	      const commentIndex = parseCommentIndexFromCard(card);
	      if (Number.isNaN(commentIndex)) return;

	      if (state.selectionMode === 'manual') {
	        toggleSelection(commentIndex);
	      } else {
	        checkbox.checked = state.selectedIndices.has(commentIndex);
	      }
	    }

	    function stopDelegatedEvent(event) {
      if (!event) return;
      event.preventDefault();
      event.stopPropagation();
    }

    function handleFieldHeaderClickTarget(target, event) {
      const fieldHeader = target.closest('.field-header');
      if (!fieldHeader || !dom.commentsList.contains(fieldHeader)) return false;
      if (target.closest('.field-checkbox')) return true;

      const proofStructureButton = target.closest('.proof-structure-open-btn');
      if (proofStructureButton) {
        stopDelegatedEvent(event);
        clearFieldHeaderClickTimer();
        resetFieldHeaderLongPressState();
        const fieldName = String(proofStructureButton.dataset.fieldName || fieldHeader.dataset.field || '').trim();
        if (!state.noteId || !fieldName || !window.Bridge || typeof Bridge.openProofStructureWorkbench !== 'function') {
          showToast('结构图入口尚未就绪');
          return true;
        }
        Bridge.openProofStructureWorkbench(state.noteId, fieldName);
        return true;
      }

      if (fieldHeaderLongPressState.handled && fieldHeaderLongPressState.header === fieldHeader) {
        stopDelegatedEvent(event);
        resetFieldHeaderLongPressState();
        return true;
      }

      const field = getFieldByHeaderElement(fieldHeader);
      if (!field) return true;

      const isCustomField = (typeof field.index === 'number' && field.index >= 0);
      if (!isCustomField) {
        selectFieldComments(field);
        return true;
      }

      clearFieldHeaderClickTimer();
      fieldHeaderClickTimer = setTimeout(() => {
        fieldHeaderClickTimer = null;
        if (state.selectionMode === 'range') {
          handleRangeSelectField(field);
        } else {
          toggleFieldSelection(field);
        }
      }, 220);
      return true;
    }

    function toggleHtmlMDGroupCollapsed(groupHeader) {
      if (!groupHeader || !groupHeader.dataset.groupId) return;
      const groupId = groupHeader.dataset.groupId;
      const groupNode = groupHeader.closest('.htmlmd-group');
      const nextCollapsed = !(groupNode && groupNode.classList.contains('collapsed'));

      if (nextCollapsed) {
        htmlMDGroupCollapsedIds.add(groupId);
      } else {
        htmlMDGroupCollapsedIds.delete(groupId);
      }

      if (groupNode) {
        groupNode.classList.toggle('collapsed', nextCollapsed);
      }
      syncHtmlMDGroupCollapseVisibility();
      scheduleFieldHeaderPositionRefresh();
    }

    function handleHtmlMDGroupHeaderClickTarget(target, event) {
      const groupHeader = target.closest('.htmlmd-group-header');
      if (!groupHeader || !dom.commentsList.contains(groupHeader)) return false;
      if (target.closest('.htmlmd-group-checkbox')) return true;

      if (htmlMDGroupLongPressState.handled && htmlMDGroupLongPressState.header === groupHeader) {
        stopDelegatedEvent(event);
        resetHtmlMDGroupLongPressState();
        return true;
      }

      stopDelegatedEvent(event);
      toggleHtmlMDGroupCollapsed(groupHeader);
      return true;
    }

    function handleInsertPointClickTarget(target, event) {
      const insertPoint = target.closest('.insert-point');
      if (!insertPoint || !dom.commentsList.contains(insertPoint)) return false;

      stopDelegatedEvent(event);
      if (!state.moveMode) return true;

      const targetIndex = parseInt(insertPoint.dataset.targetIndex, 10);
      if (Number.isNaN(targetIndex)) return true;

      handleInsertPointClick(targetIndex);
      return true;
    }

    function handleQuickMoveClickTarget(target, event) {
      const quickMoveBtn = target.closest('.quick-move-btn');
      if (!quickMoveBtn || !dom.commentsList.contains(quickMoveBtn)) return false;

      stopDelegatedEvent(event);
      if (quickMoveBtn.disabled) return true;
      if (quickMoveLongPressState.consumeClick) {
        quickMoveLongPressState.consumeClick = false;
        return true;
      }

      const commentIndex = parseInt(quickMoveBtn.dataset.index, 10);
      const direction = quickMoveBtn.dataset.direction === 'up' ? 'up' : 'down';
      if (!Number.isNaN(commentIndex)) {
        quickMoveSingleComment(commentIndex, direction);
      }
      return true;
    }

    function toggleCommentPreview(card, expandBtn) {
      const preview = card.querySelector('.comment-preview');
      if (!preview) return;
      preview.classList.toggle('collapsed');
      expandBtn.textContent = preview.classList.contains('collapsed') ? '展开' : '收起';
    }

    function handleExpandButtonTarget(target, card, event) {
      const expandBtn = target.closest('.expand-btn');
      if (!expandBtn) return false;
      stopDelegatedEvent(event);
      toggleCommentPreview(card, expandBtn);
      return true;
    }

    function handleMarginNoteLinkTarget(target, event) {
      const mnLink = target.closest('.mn-link');
      if (!mnLink) return false;
      stopDelegatedEvent(event);
      const noteId = mnLink.dataset.noteId;
      if (noteId) focusNoteById(noteId);
      return true;
    }

    function handleLocateButtonTarget(target, event) {
      const locateBtn = target.closest('.link-locate-btn');
      if (!locateBtn) return false;
      stopDelegatedEvent(event);
      if (linkLocateLongPressState.consumeClick) {
        const shouldConsume = linkLocateLongPressState.consumeButton === locateBtn;
        resetLinkLocateLongPress();
        if (shouldConsume) return true;
      }
      const noteId = locateBtn.dataset.noteId;
      if (!noteId) return true;
      sendURLToNative('focusCardInMindMap', { noteId });
      return true;
    }

    function handleEditButtonTarget(target, event) {
      const editBtn = target.closest('.link-edit-btn');
      if (!editBtn) return false;
      stopDelegatedEvent(event);
      const commentIndex = parseInt(editBtn.dataset.commentIndex, 10);
      const linkIndex = parseInt(editBtn.dataset.linkIndex, 10);
      if (Number.isNaN(commentIndex) || Number.isNaN(linkIndex)) return true;
      const displayText = safeDecodeURIComponent(editBtn.dataset.displayText || '');
      const linkUrl = safeDecodeURIComponent(editBtn.dataset.linkUrl || '');
      showEditLinkModal(commentIndex, linkIndex, displayText, linkUrl);
      return true;
    }

    function handleUpdateButtonTarget(target, event) {
      const updateBtn = target.closest('.link-update-btn');
      if (!updateBtn) return false;
      stopDelegatedEvent(event);
      const commentIndex = parseInt(updateBtn.dataset.commentIndex, 10);
      const rawLinkIndex = updateBtn.dataset.linkIndex;
      const linkIndex = rawLinkIndex === undefined ? undefined : parseInt(rawLinkIndex, 10);
      if (Number.isNaN(commentIndex) || (rawLinkIndex !== undefined && Number.isNaN(linkIndex))) return true;
      handleUpdateSingleLink(commentIndex, linkIndex);
      return true;
    }

    function handlePlaceholderReplaceButtonTarget(target, event) {
      const replaceBtn = target.closest('.placeholder-replace-btn');
      if (!replaceBtn) return false;
      stopDelegatedEvent(event);
      const commentIndex = parseInt(replaceBtn.dataset.commentIndex, 10);
      const rawLinkIndex = replaceBtn.dataset.linkIndex;
      const linkIndex = rawLinkIndex === undefined ? undefined : parseInt(rawLinkIndex, 10);
      if (Number.isNaN(commentIndex) || (rawLinkIndex !== undefined && Number.isNaN(linkIndex))) return true;
      handlePlaceholderReplaceSingleLink(commentIndex, linkIndex);
      return true;
    }

    function handleIndexedCommentActionButton(target, selector, event, handler) {
      const button = target.closest(selector);
      if (!button) return false;
      stopDelegatedEvent(event);
      const commentIndex = parseInt(button.dataset.index, 10);
      if (!Number.isNaN(commentIndex)) {
        handler(commentIndex);
      }
      return true;
    }

    function handleCommentCardActionClick(target, card, event) {
      if (handleExpandButtonTarget(target, card, event)) return true;
      if (handleMarginNoteLinkTarget(target, event)) return true;
      if (handleLocateButtonTarget(target, event)) return true;
      if (handlePlaceholderReplaceButtonTarget(target, event)) return true;
      if (handleUpdateButtonTarget(target, event)) return true;
      if (handleEditButtonTarget(target, event)) return true;
      if (handleIndexedCommentActionButton(target, '.copy-comment-btn', event, copyCommentText)) return true;
      if (handleIndexedCommentActionButton(target, '.pin-comment-btn', event, pinCommentText)) return true;
      return false;
    }

    function handleCommentCardSelectionClick(target, card) {
      if (target.closest('.comment-checkbox')) return true;

      const commentIndex = parseCommentIndexFromCard(card);
      if (Number.isNaN(commentIndex)) return true;

      if (state.selectionMode === 'range') {
        handleRangeSelect(commentIndex);
        return true;
      }

      if (state.selectionMode === 'manual') {
        const checkbox = card.querySelector('.comment-checkbox');
        if (checkbox) checkbox.checked = !checkbox.checked;
        toggleSelection(commentIndex);
        return true;
      }

      return false;
    }

    function handleCommentsListClick(event) {
      const target = event.target;
      if (!target) return;

      if (handleHtmlMDGroupHeaderClickTarget(target, event)) return;
      if (handleFieldHeaderClickTarget(target, event)) return;
      if (handleInsertPointClickTarget(target, event)) return;
      if (handleQuickMoveClickTarget(target, event)) return;

      const card = target.closest('.comment-card');
      if (!card || !dom.commentsList.contains(card)) return;

      if (handleCommentCardActionClick(target, card, event)) return;
      handleCommentCardSelectionClick(target, card);
    }

	    function handleCommentsListDoubleClick(event) {
	      const target = event.target;
	      if (target.closest('.proof-structure-open-btn')) return;
	      const fieldHeader = target.closest('.field-header');
	      if (!fieldHeader || !dom.commentsList.contains(fieldHeader)) return;
	      if (target.closest('.field-checkbox')) return;

	      const field = getFieldByHeaderElement(fieldHeader);
	      if (!field) return;
	      if (typeof field.index !== 'number' || field.index < 0) return;

	      clearFieldHeaderClickTimer();
	      event.preventDefault();
	      event.stopPropagation();
	      selectFieldComments(field);
	    }

    // ========================================
