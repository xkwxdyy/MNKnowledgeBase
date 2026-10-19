'use strict';

const iconClickStates = new WeakMap();
const CARD_ACTION_CONFIRM_WINDOW_MS = 2200;
let pendingCardActionIcon = null;

function clearCardActionLongPressState(target) {
  if (!target) return;
  target.classList.remove('long-press-pending');
  target.removeAttribute('data-long-press-pending');
}

function armCardActionLongPressState(target) {
  if (!target) return;
  clearCardActionLongPressState(target);
  target.classList.add('long-press-pending');
  target.setAttribute('data-long-press-pending', 'true');
}

function clearPendingCardActionIcon(target = pendingCardActionIcon) {
  if (!target) return;
  const clickState = iconClickStates.get(target);
  if (clickState && clickState.timer) {
    clearTimeout(clickState.timer);
    clickState.timer = null;
    clickState.armed = false;
  }
  target.classList.remove('confirm-pending');
  target.removeAttribute('data-confirm-pending');
  if (clickState && clickState.originalTitle) {
    target.setAttribute('title', clickState.originalTitle);
    target.setAttribute('aria-label', clickState.originalTitle);
  }
  if (pendingCardActionIcon === target) {
    pendingCardActionIcon = null;
  }
}

function armCardActionIcon(target) {
  clearPendingCardActionIcon();
  const originalTitle = (target.getAttribute && (target.getAttribute('title') || target.getAttribute('aria-label'))) || '';
  const clickState = iconClickStates.get(target) || { timer: null, armed: false, originalTitle };
  if (originalTitle && !clickState.originalTitle) {
    clickState.originalTitle = originalTitle;
  }
  clickState.armed = true;
  clickState.timer = setTimeout(() => {
    clearPendingCardActionIcon(target);
  }, CARD_ACTION_CONFIRM_WINDOW_MS);
  iconClickStates.set(target, clickState);
  pendingCardActionIcon = target;
  target.classList.add('confirm-pending');
  target.setAttribute('data-confirm-pending', 'true');
  target.setAttribute('title', '再点一次确认建立双向链接（Esc 取消）');
  target.setAttribute('aria-label', '再点一次确认建立双向链接');
  if (typeof showMinorSuccessToast === 'function') {
    showMinorSuccessToast('再点一次 🔗 确认建立双向链接', 1100);
  }
}

// ==================== 📍 长按浮窗定位 ====================
const LOCATE_LONG_PRESS_MS = 520;

// Apple Pencil contact is reported as pointerType=pen or Touch.touchType=stylus.
// Keep finger/mouse timing unchanged, while giving Pencil a larger hold window
// so a slightly slow tap does not become a long press.
function getLongPressDelay(event, baseMs) {
  const pointerType = String(event?.pointerType || '').toLowerCase();
  const touch = (event?.touches && event.touches[0]) || (event?.changedTouches && event.changedTouches[0]);
  const touchType = String(touch?.touchType || '').toLowerCase();
  const isPencil = pointerType === 'pen' || pointerType === 'stylus' || touchType === 'stylus';
  return isPencil ? Math.min(Number(baseMs) + 220, 760) : Number(baseMs);
}
const LOCATE_LONG_PRESS_MOVE_TOLERANCE_PX = 12;
let _locateLongPressTimer = null;
let _locateLongPressIcon = null;
let _locateLongPressStartPoint = null;

function clearLocateLongPress() {
  if (_locateLongPressTimer) {
    clearTimeout(_locateLongPressTimer);
    _locateLongPressTimer = null;
  }
  clearCardActionLongPressState(_locateLongPressIcon);
  _locateLongPressIcon = null;
  _locateLongPressStartPoint = null;
}

function getTouchPoint(e) {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  if (!t) return null;
  return { x: t.clientX, y: t.clientY };
}

function getLongPressPoint(event) {
  return getTouchPoint(event) || (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
    ? { x: event.clientX, y: event.clientY } : null);
}

function handleLocateLongPressStart(e) {
  const icon = e.target.closest('.card-action-icon[data-action="focus-mindmap"]');
  if (!icon || icon.disabled) return;

  const card = icon.closest('.card');
  const id = card?.dataset?.id;
  if (!id) return;

  clearPendingCardActionIcon();
  clearLocateLongPress();
  _locateLongPressIcon = icon;
  armCardActionLongPressState(icon);
  _locateLongPressStartPoint = getTouchPoint(e) || { x: e.clientX, y: e.clientY };

  _locateLongPressTimer = setTimeout(() => {
    _locateLongPressTimer = null;
    if (!icon.isConnected || icon.disabled) {
      clearLocateLongPress();
      return;
    }
    if (_locateLongPressIcon) {
      _locateLongPressIcon.dataset.longPressFired = '1';
      clearCardActionLongPressState(_locateLongPressIcon);
    }

    if (!postBridge('focusCardInFloatMindMap', withSearchUsageParams(
      { id },
      id,
      SEARCH_USAGE_TIER_POINTS.locate,
    ))) {
      showToast('操作未完成：在浮窗中定位');
    } else {
      showToast('正在浮窗中定位...');
    }
  }, getLongPressDelay(e, LOCATE_LONG_PRESS_MS));
}

function handleLocateLongPressMove(e) {
  if (!_locateLongPressTimer || !_locateLongPressStartPoint) return;
  const point = getLongPressPoint(e);
  if (!point) return;

  const dx = point.x - _locateLongPressStartPoint.x;
  const dy = point.y - _locateLongPressStartPoint.y;
  if (Math.hypot(dx, dy) > LOCATE_LONG_PRESS_MOVE_TOLERANCE_PX) {
    clearLocateLongPress();
  }
}

        function handleLocateLongPressEnd() {
          clearLocateLongPress();
        }
  
        // ==================== 📌 长按 Pin 到 Focus ====================
        const PIN_LONG_PRESS_MS = 520;
        const PIN_LONG_PRESS_MOVE_TOLERANCE_PX = 12;
        let _pinLongPressTimer = null;
        let _pinLongPressIcon = null;
        let _pinLongPressStartPoint = null;
  
        function clearPinLongPress() {
          if (_pinLongPressTimer) {
            clearTimeout(_pinLongPressTimer);
            _pinLongPressTimer = null;
          }
          clearCardActionLongPressState(_pinLongPressIcon);
          _pinLongPressIcon = null;
          _pinLongPressStartPoint = null;
        }
  
        function handlePinLongPressStart(e) {
          const icon = e.target.closest('.card-action-icon[data-action="pin-card"]');
          if (!icon || icon.disabled) return;
  
          const card = icon.closest('.card');
          const id = card?.dataset?.id;
          if (!id) return;
  
          clearPendingCardActionIcon();
          clearPinLongPress();
          _pinLongPressIcon = icon;
          armCardActionLongPressState(icon);
          _pinLongPressStartPoint = getTouchPoint(e) || { x: e.clientX, y: e.clientY };
  
          _pinLongPressTimer = setTimeout(() => {
            _pinLongPressTimer = null;
            if (!icon.isConnected || icon.disabled) {
              clearPinLongPress();
              return;
            }
            if (_pinLongPressIcon) {
              _pinLongPressIcon.dataset.longPressFired = '1';
              clearCardActionLongPressState(_pinLongPressIcon);
            }
  
            if (!postBridge('pinCard', withSearchUsageParams(
              { id },
              id,
              SEARCH_USAGE_TIER_POINTS.auxiliary,
            ))) {
              showToast('操作失败');
            } else {
              showMinorSuccessToast('已发送浮窗 Pin 请求', 700);
            }
          }, PIN_LONG_PRESS_MS);
        }
  
        function handlePinLongPressMove(e) {
          if (!_pinLongPressTimer || !_pinLongPressStartPoint) return;
          const point = getLongPressPoint(e);
          if (!point) return;
  
          const dx = point.x - _pinLongPressStartPoint.x;
          const dy = point.y - _pinLongPressStartPoint.y;
          if (Math.hypot(dx, dy) > PIN_LONG_PRESS_MOVE_TOLERANCE_PX) {
            clearPinLongPress();
          }
        }
  
        function handlePinLongPressEnd() {
          clearPinLongPress();
        }

function shouldSuppressLongPressClick(actionIcon) {
  if (!actionIcon) return false;
  if (actionIcon.dataset.longPressFired !== '1') return false;
  delete actionIcon.dataset.longPressFired;
  return true;
}

function handleResultActionIconInteraction(event) {
  const actionIcon = event.target.closest('.card-action-icon');
  if (!actionIcon) return false;

  event.stopPropagation();
  // dblclick follows two click events; it must not dispatch a third action.
  if (event.type !== 'click' || actionIcon.disabled) return true;

  if (shouldSuppressLongPressClick(actionIcon)) {
    return true;
  }

  const action = actionIcon.dataset.action;
  const cardEl = actionIcon.closest('.card');
  if (pendingCardActionIcon && pendingCardActionIcon !== actionIcon) {
    clearPendingCardActionIcon();
  }
  if (action && cardEl) {
    handleCardAction(action, cardEl.dataset.id, actionIcon);
  }
  return true;
}

function hasActiveTextSelection() {
  return !!window.getSelection().toString();
}

function handleResultCardInteraction(event) {
  const cardEl = event.target.closest('.card');
  if (!cardEl) return;

  clearPendingCardActionIcon();
  const cardId = cardEl.dataset.id;

  if (event.type === 'dblclick') {
    const isMobile = window.innerWidth <= 1024;
    if (isMobile) {
      if (state.selectedCardId !== cardId) {
        toggleSelection(cardId, cardEl);
      }
      openSidebar();
    }
    return;
  }

  if (event.type === 'click') {
    if (event.detail !== 0 && hasActiveTextSelection()) return;
    toggleSelection(cardId, cardEl);
  }
}

function handleResultsInteraction(event) {
  if (handleResultActionIconInteraction(event)) {
    return;
  }
  handleResultCardInteraction(event);
}

function handleResultsKeydown(event) {
  const button = event.target.closest('.card-select-btn, .card-action-icon');
  if (!button || button.disabled) return;
  if (event.isComposing || event.keyCode === 229 || event.repeat) {
    // Native buttons synthesize clicks on Enter; held keys must never confirm an action.
    if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && pendingCardActionIcon) {
    event.preventDefault();
    event.stopPropagation();
    clearPendingCardActionIcon();
    return;
  }
  if (!button.classList.contains('card-select-btn') || event.altKey || event.ctrlKey || event.metaKey) return;
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const cards = getRenderedResultCardNodes();
  const index = cards.indexOf(button.closest('.card'));
  if (index < 0) return;
  const columns = getRenderedResultColumnCount(cards);
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1
    : Math.max(0, Math.min(cards.length - 1, index + offsets[event.key]));
  const nextButton = cards[nextIndex]?.querySelector('.card-select-btn');
  if (!nextButton || nextButton.disabled) return;
  event.preventDefault();
  nextButton.focus({ preventScroll: true });
  nextButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function handleResultsFocusOut(event) {
  if (event.target === pendingCardActionIcon) clearPendingCardActionIcon();
}

function bindResultsTouchLongPress(startHandler, moveHandler, endHandler) {
  dom.results.addEventListener('touchstart', startHandler, { passive: true });
  dom.results.addEventListener('touchend', endHandler, { passive: true });
  dom.results.addEventListener('touchcancel', endHandler, { passive: true });
  dom.results.addEventListener('touchmove', moveHandler, { passive: true });
}

function bindResultsMouseLongPress(startHandler, moveHandler, endHandler) {
  dom.results.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    startHandler(event);
  });
  dom.results.addEventListener('mousemove', moveHandler);
  dom.results.addEventListener('mouseup', endHandler);
  dom.results.addEventListener('mouseleave', endHandler);
}

function cancelPendingResultGestures() {
  clearLocateLongPress();
  clearPinLongPress();
  clearPendingCardActionIcon();
}

function setupDelegation() {
  dom.results.addEventListener('click', handleResultsInteraction);
  dom.results.addEventListener('dblclick', handleResultsInteraction);
  dom.results.addEventListener('keydown', handleResultsKeydown);
  dom.results.addEventListener('focusout', handleResultsFocusOut);

  bindResultsTouchLongPress(handleLocateLongPressStart, handleLocateLongPressMove, handleLocateLongPressEnd);
  bindResultsTouchLongPress(handlePinLongPressStart, handlePinLongPressMove, handlePinLongPressEnd);
  bindResultsMouseLongPress(handleLocateLongPressStart, handleLocateLongPressMove, handleLocateLongPressEnd);
  bindResultsMouseLongPress(handlePinLongPressStart, handlePinLongPressMove, handlePinLongPressEnd);
  window.addEventListener('blur', cancelPendingResultGestures);
  window.addEventListener('pagehide', cancelPendingResultGestures);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelPendingResultGestures();
  });
}

function postCardActionRequest(
  actionName,
  cardId,
  failureToast,
  successToast = '',
  successDuration = 650,
  usageTier = 0,
) {
  const params = usageTier
    ? withSearchUsageParams({ id: cardId }, cardId, usageTier)
    : { id: cardId };
  if (!postBridge(actionName, params)) {
    showToast(failureToast || '操作失败');
    return false;
  }
  if (successToast) {
    showMinorSuccessToast(successToast, successDuration);
  }
  return true;
}

function handleAddTemplateCardAction(cardId) {
  if (postBridge('addTemplate', { id: cardId })) {
    showMinorSuccessToast('已打开模板工作台');
    return;
  }
  showToast('操作失败');
}

function handleFocusDocCardAction(cardId) {
  if (!postBridge('focusFirstExcerptInDocument', withSearchUsageParams(
    { id: cardId },
    cardId,
    SEARCH_USAGE_TIER_POINTS.auxiliary,
  ))) {
    showToast('操作未完成：在文档中定位');
    return;
  }
  showToast('正在定位到文档...');
}

function handleRefreshSearchIndexCardAction(cardId) {
  const card = typeof getCardById === 'function' ? getCardById(cardId) : null;
  const params = { id: cardId };
  if (card && card.indexSource) {
    params.indexSource = String(card.indexSource);
  }
  if (!postBridge('refreshSearchCardIndex', params)) {
    showToast('操作失败');
    return;
  }
  showToast('正在更新索引...');
}

function handlePinCardAction(cardId) {
  postCardActionRequest(
    'pinToCurrentNode',
    cardId,
    '操作失败',
    '已发送 Pin 请求',
    700,
    SEARCH_USAGE_TIER_POINTS.auxiliary,
  );
}

function handleCopyLinkCardAction(cardId) {
  postCardActionRequest(
    'copyMarkdownLink',
    cardId,
    '操作未完成：复制行内链接',
    '已复制行内链接',
    650,
    SEARCH_USAGE_TIER_POINTS.link,
  );
}

function handleCopyUrlCardAction(cardId) {
  postCardActionRequest('copyNoteURL', cardId, '操作未完成：复制卡片 URL', '已复制卡片 URL', 650);
}

function handleBiLinkCardAction(cardId, target) {
  const clickState = iconClickStates.get(target) || { timer: null, armed: false };
  if (pendingCardActionIcon === target && clickState.armed) {
    clearPendingCardActionIcon(target);
    if (!postBridge('bidirectionalLinkFromeFocusNoteToTargetNote', withSearchUsageParams(
      { id: cardId },
      cardId,
      SEARCH_USAGE_TIER_POINTS.link,
    ))) {
      showToast('操作失败');
    } else {
      showToast('✅ 已建立双向链接');
    }
    return;
  }

  armCardActionIcon(target);
}

function handleCardAction(action, cardId, target) {
  if (!cardId) return;

  switch (action) {
    case 'add-template':
      handleAddTemplateCardAction(cardId);
      break;
    case 'focus-mindmap':
      handleCardFocus(cardId);
      break;
    case 'focus-doc':
      handleFocusDocCardAction(cardId);
      break;
    case 'refresh-search-index':
      handleRefreshSearchIndexCardAction(cardId);
      break;
    case 'pin-card':
      handlePinCardAction(cardId);
      break;
    case 'copy-link':
      handleCopyLinkCardAction(cardId);
      break;
    case 'copy-url':
      handleCopyUrlCardAction(cardId);
      break;
    case 'bi-link':
      handleBiLinkCardAction(cardId, target);
      break;
    case 'local-search':
      handleLocalSearchCardAction(cardId);
      break;
    default:
      showToast('未知操作');
      break;
  }
}

function handleLocalSearchCardAction(cardId) {
  const card = typeof getCardById === 'function' ? getCardById(cardId) : null;
  if (!card) {
    showToast('未找到卡片信息');
    return;
  }
  if (typeof activateLocalSearch === 'function') {
    activateLocalSearch(cardId, card.title || '', {
      usageTier: SEARCH_USAGE_TIER_POINTS.auxiliary,
    });
    showMinorSuccessToast('正在设置为局部搜索根...', 800);
  } else {
    showToast('局部搜索功能未就绪');
  }
}
