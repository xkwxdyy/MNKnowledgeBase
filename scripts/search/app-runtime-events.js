'use strict';

function bindCheckboxChange(element, onChange) {
  element?.addEventListener('change', (event) => {
    onChange(!!event.target.checked, event);
  });
}

function attachSearchBoxListeners() {
  document.getElementById('searchSourceBar')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-search-source]');
    if (button) toggleSearchSource(button.dataset.searchSource);
  });
  dom.searchInput.addEventListener('input', () => {
    syncSearchUsageRoundFromInput(dom.searchInput.value);
    if (state.aiCardSearch?.active && dom.searchInput.value.trim() !== state.aiCardSearch.query) {
      bumpSearchExecutionRevision('aiSearchInputChanged');
    }
  }, { passive: true });
  dom.searchInput.addEventListener('input', debouncedInputHandler, { passive: true });
  dom.searchInput.addEventListener('focus', handleSearchInputFocus);
  dom.excludeInput?.addEventListener('input', debouncedExclusionInputHandler, { passive: true });
  dom.excludeInput?.addEventListener('input', () => {
    if (state.aiCardSearch?.active) bumpSearchExecutionRevision('aiSearchExclusionChanged');
  }, { passive: true });
  dom.excludeInput?.addEventListener('focus', handleFilterInputFocus);
  dom.clearBtn.addEventListener('click', handleClearFilters);
  dom.clearPresetsBtn?.addEventListener('click', handleClearPresets);
  dom.clearNegativesBtn?.addEventListener('click', handleClearNegatives);
}

function attachAutoCloseModeListener() {
  const autoCloseModeBtn = document.getElementById('autoCloseModeBtn');
  if (autoCloseModeBtn) {
    autoCloseModeBtn.addEventListener('click', toggleAutoCloseMode);
  }
}

function attachOptionToggleListeners() {
  bindCheckboxChange(dom.mergeRemoveTitleToggle, (checked) => {
    updateMergeOptions({ removeTitle: checked });
  });

  bindCheckboxChange(dom.mergeKeepOnlyExcerptToggle, (checked) => {
    updateMergeOptions({ keepOnlyExcerpt: checked });
  });

  bindCheckboxChange(dom.mergeExcerptFromSelectionToggle, (checked) => {
    updateMergeOptions({ excerptFromSelection: checked });
  });

  bindCheckboxChange(dom.mergeLocateAfterToggle, (checked) => {
    updateMergeOptions({ locateAfterMerge: checked });
  });

  bindCheckboxChange(dom.mergeLinkOldClassificationToggle, (checked) => {
    updateMergeOptions({ linkOldClassification: checked });
  });

  bindCheckboxChange(dom.moveMakeNoteToggle, (checked) => {
    updateMoveOptions({ makeNote: checked, addToReview: checked ? state.moveOptions.addToReview : false });
  });

  bindCheckboxChange(dom.moveAddToReviewToggle, (checked) => {
    updateMoveOptions({ makeNote: true, addToReview: checked });
  });

  bindCheckboxChange(dom.moveLocateAfterToggle, (checked) => {
    updateMoveOptions({ locateAfterMove: checked });
  });

  bindCheckboxChange(dom.templateLocateAfterToggle, (checked) => {
    updateTemplateOptions({ locateAfterCreate: checked });
  });

  dom.mergePositionToggle?.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-position]');
    if (!btn) return;
    updateMergeOptions({ position: btn.dataset.position === 'above' ? 'above' : 'below' });
  });
}

function getSidebarActionBindings() {
  return [
    { btn: dom.mergeDuplicateKnowledgeNoteToTargetNoteBtn, action: 'mergeDuplicateKnowledgeNoteToTargetNote' },
    { btn: dom.bidirectionalLinkFromeFocusNoteToTargetNoteBtn, action: 'bidirectionalLinkFromeFocusNoteToTargetNote' },
    { btn: dom.moveFocusNoteToTargetNoteAsChildBtn, action: 'moveFocusNoteToTargetNoteWithOptions' },
    { btn: dom.addTemplateToTargetNoteAndMoveFocusNoteAsChildBtn, action: 'addTemplateToTargetNoteAndMoveFocusNoteWithOptions' },
  ];
}

function createSidebarConfirmState() {
  return {
    buttonClickStates: new WeakMap(),
    pendingButton: null,
    confirmWindowMs: 2600,
  };
}

function syncSidebarConfirmCopy(btn, clickState, pending) {
  if (!btn) return;
  const title = btn.querySelector('.sidebar-btn-title');
  const subtitle = btn.querySelector('.sidebar-btn-subtitle');

  if (pending) {
    clickState.originalTitle = title?.textContent || '';
    clickState.originalSubtitle = subtitle?.textContent || '';
    if (title) title.textContent = '再点一次确认执行';
    if (subtitle) subtitle.textContent = '请核对目标卡片和当前设置';
    return;
  }

  if (title && typeof clickState.originalTitle === 'string') {
    title.textContent = clickState.originalTitle;
  }
  if (subtitle && typeof clickState.originalSubtitle === 'string') {
    subtitle.textContent = clickState.originalSubtitle;
  }
}

function clearPendingSidebarConfirm(confirmState, btn = confirmState.pendingButton) {
  if (!btn) return;
  const clickState = confirmState.buttonClickStates.get(btn);
  if (clickState && clickState.timer) {
    clearTimeout(clickState.timer);
    clickState.timer = null;
    clickState.armed = false;
  }
  if (clickState) {
    syncSidebarConfirmCopy(btn, clickState, false);
  }
  btn.classList.remove('confirm-pending');
  btn.removeAttribute('data-confirm-pending');
  if (confirmState.pendingButton === btn) {
    confirmState.pendingButton = null;
  }
  document.body.classList.toggle('sidebar-confirming', !!confirmState.pendingButton);
}

function armSidebarConfirm(confirmState, btn) {
  clearPendingSidebarConfirm(confirmState);
  const clickState = confirmState.buttonClickStates.get(btn) || { timer: null, armed: false };
  clickState.armed = true;
  clickState.timer = setTimeout(() => {
    clearPendingSidebarConfirm(confirmState, btn);
  }, confirmState.confirmWindowMs);
  syncSidebarConfirmCopy(btn, clickState, true);
  confirmState.buttonClickStates.set(btn, clickState);
  confirmState.pendingButton = btn;
  btn.classList.add('confirm-pending');
  btn.setAttribute('data-confirm-pending', 'true');
  document.body.classList.add('sidebar-confirming');
}

function bindSidebarActionButton(btn, action, confirmState) {
  if (!btn) return;
  confirmState.buttonClickStates.set(btn, { timer: null, armed: false });

  btn.addEventListener('click', () => {
    if (btn.disabled) return;

    const clickState = confirmState.buttonClickStates.get(btn) || { timer: null, armed: false };
    if (confirmState.pendingButton === btn && clickState.armed) {
      clearPendingSidebarConfirm(confirmState, btn);
      handleSidebarAction(action);
      return;
    }

    armSidebarConfirm(confirmState, btn);
  });

  btn.addEventListener('blur', () => {
    if (confirmState.pendingButton === btn) {
      clearPendingSidebarConfirm(confirmState, btn);
    }
  });
}

function attachSidebarActionListeners() {
  const confirmState = createSidebarConfirmState();
  getSidebarActionBindings().forEach(({ btn, action }) => {
    bindSidebarActionButton(btn, action, confirmState);
  });
}

let locateMNSelectionWatchdogTimer = null;

function setLocateMNSelectionBusy(isBusy) {
  const button = dom.locateMNSelectionBtn;
  if (!button) return;

  button.disabled = !!isBusy;
  button.textContent = isBusy ? '⏳' : '📍';
  button.title = isBusy
    ? '正在读取 MarginNote 当前选中的卡片'
    : '定位 MarginNote 当前选中的卡片';
  button.setAttribute('aria-label', button.title);
}

function handleLocateMNSelectionResult(payload = {}) {
  if (locateMNSelectionWatchdogTimer !== null) {
    clearTimeout(locateMNSelectionWatchdogTimer);
    locateMNSelectionWatchdogTimer = null;
  }
  setLocateMNSelectionBusy(false);

  const status = String(payload.status || '').trim().toLowerCase();
  if (status === 'located') {
    showMinorSuccessToast('📍 已定位到 MarginNote 当前选卡', 1200);
    return true;
  }
  if (status === 'pending') {
    showToast('正在加载搜索索引，完成后会自动定位当前选卡', 2200);
    return true;
  }
  if (status === 'no-selection') {
    showToast('请先在 MarginNote 中选中一张卡片', 2200);
    return false;
  }
  if (status === 'multiple-selection') {
    showToast('请只选中一张卡片后再定位', 2200);
    return false;
  }
  if (status === 'not-found') {
    showToast('当前选卡不在搜索索引中，请先更新索引', 2400);
    return false;
  }

  showToast(payload.message || '定位当前选卡失败', 2200);
  return false;
}

function handleLocateMNSelectionClick() {
  const button = dom.locateMNSelectionBtn;
  if (!button || button.disabled) return;

  setLocateMNSelectionBusy(true);
  showToast('正在读取 MarginNote 当前选卡...', 1800);

  let dispatched = false;
  try {
    dispatched = !!(
      window.Bridge
      && typeof window.Bridge.requestLocateCurrentMNSelectedCard === 'function'
      && window.Bridge.requestLocateCurrentMNSelectedCard()
    );
  } catch (error) {
    console.warn('定位当前选卡请求失败', error);
  }

  if (!dispatched) {
    handleLocateMNSelectionResult({ message: '定位功能暂不可用' });
    return;
  }

  locateMNSelectionWatchdogTimer = setTimeout(() => {
    locateMNSelectionWatchdogTimer = null;
    handleLocateMNSelectionResult({ message: '读取 MarginNote 当前选卡超时，请重试' });
  }, 4500);
}

function handleRefreshButtonClick() {
  if (state.isRefreshReloading) {
    showToast('正在刷新，请稍候', 1000);
    return;
  }

  if (window.Bridge && typeof window.Bridge.refreshAllData === 'function') {
    const requestId = createRefreshRequestId();
    beginRefreshReloading(requestId, { autoResetMs: 10000 });
    showToast('正在重新读取最新数据...');
    try {
      const dispatched = window.Bridge.refreshAllData({ requestId });
      if (dispatched === false) {
        completeRefreshReloading({
          requestId,
          success: false,
          message: '刷新派发失败',
        });
      }
    } catch (error) {
      console.error('refreshAllData 调用失败', error);
      completeRefreshReloading({
        requestId,
        success: false,
        message: '刷新失败',
      });
    }
    return;
  }

  console.error('Bridge.refreshAllData 方法不存在');
  completeRefreshReloading({
    success: false,
    message: '刷新功能不可用',
  });
}

function handleAIRecommendClick() {
  if (!AI_RECOMMENDATION_ENABLED) return;
  if (state.aiRecommendLoading) return;
  state.aiRecommendations = [];
  rebuildAIRecommendationLookup();
  state.aiRecommendDebug = null;
  setAIRecommendLoading(true);
  showToast('🤖 正在推荐归类/定义父卡片...');
  const ok = postBridge('aiRecommendClassification', {});
  setTimeout(() => {
    if (state.aiRecommendLoading) {
      setAIRecommendLoading(false);
      showToast('⚠️ AI 推荐超时');
    }
  }, 35000);
  if (!ok) {
    setAIRecommendLoading(false);
    showToast('AI 功能不可用');
  }
}

function attachNativeActionListeners() {
  dom.locateMNSelectionBtn?.addEventListener('click', handleLocateMNSelectionClick);

  dom.refreshBtn?.addEventListener('click', () => {
    handleRefreshButtonClick();
  });

  dom.aiRecommendBtn?.addEventListener('click', handleAIRecommendClick);

  dom.aiRecommendClearBtn?.addEventListener('click', () => {
    clearAIRecommendations();
  });

  dom.aiRecommendList?.addEventListener('click', handleAIRecommendListClick);

  document.getElementById('activateLocalSearchBtn')?.addEventListener('click', () => {
    if (!state.selectedCardId) return;
    const card = typeof getCardById === 'function' ? getCardById(state.selectedCardId) : null;
    activateLocalSearch(state.selectedCardId, card ? (card.title || '') : undefined, {
      usageTier: SEARCH_USAGE_TIER_POINTS.auxiliary,
    });
  });

  if (typeof attachAICardSearchListeners === 'function') {
    attachAICardSearchListeners();
  }
}

function attachLayoutToggleListeners() {
  dom.toggleFiltersBtn?.addEventListener('click', () => {
    isFilterPanelManuallySet = true;
    applyFilterPanelState(!isFilterPanelCollapsed);
  });

  dom.sidebarPanelBtn?.addEventListener('click', toggleSidebarPanel);
  dom.sidebarToggle?.addEventListener('click', toggleSidebar);
  dom.sidebarOverlay?.addEventListener('click', closeSidebar);
  document.getElementById('sidebarCloseBtn')?.addEventListener('click', closeSidebar);
  setupSidebarOperationInteractions();
  document.addEventListener('click', handleFilterPanelOutsideClick, { capture: true });
  document.addEventListener('keydown', handleFilterPanelEscape);
  document.addEventListener('keydown', handleSidebarEscape);
  document.addEventListener('focusin', handleSidebarFocusChange);
}

function attachFilterBarListeners() {
  document.getElementById('activeSearchFilterList')?.addEventListener('click', handleActiveSearchFilterClick);
  document.querySelectorAll('[data-search-recovery]').forEach((button) => {
    button.addEventListener('click', handleSearchRecovery);
  });
  document.querySelectorAll('.pill-section__toggle-btn').forEach((btn) => {
    btn.addEventListener('click', handleToolbarToggle);
  });

  dom.presetBar?.addEventListener('click', handlePresetBarClick);
  dom.presetBar?.addEventListener('keydown', handlePresetBarKeydown);
  dom.negativeBar?.addEventListener('click', handleNegativeBarClick);
  dom.negativeBar?.addEventListener('keydown', handleNegativeBarKeydown);
  dom.typeBar?.addEventListener('click', handleTypeBarClick);
  dom.typeBar?.addEventListener('keydown', handleTypeBarKeydown);
  dom.classificationBar?.addEventListener('click', handleClassificationBarClick);
  dom.classificationBar?.addEventListener('keydown', handleClassificationBarKeydown);
}

function refreshSearchFilterControls() {
  renderPresetBar();
  renderTypeBar();
  renderClassificationBar();
  renderNegativeBar();
  updateClearNegativesButton();
  scheduleSearch();
}

function handleActiveSearchFilterClick(event) {
  const button = event.target.closest('button[data-filter-kind]');
  if (!button || !event.currentTarget.contains(button)) return;
  const { filterKind, filterValue } = button.dataset;
  if (filterKind === 'type') state.currentTypeKey = 'all';
  else if (filterKind === 'subtype') state.currentClassificationSubtype = 'all';
  else if (filterKind === 'preset') state.activePresets.delete(filterValue);
  else if (filterKind === 'negative') state.activeNegativePresets.delete(filterValue);
  else if (filterKind === 'manual') {
    state.manualExclusionInput = '';
    if (dom.excludeInput) dom.excludeInput.value = '';
  } else return;
  bumpSearchExecutionRevision('removeSearchFilter');
  refreshSearchFilterControls();
}

function handleSearchRecovery(event) {
  const action = event.currentTarget.dataset.searchRecovery;
  if (action === 'edit') {
    focusSearchInput({ bypassSuppression: true, ensure: true });
    dom.searchInput.select();
  } else if (action === 'filters') {
    state.activePresets.clear();
    state.activeNegativePresets.clear();
    state.currentTypeKey = 'all';
    state.currentClassificationSubtype = 'all';
    state.manualExclusionInput = '';
    if (dom.excludeInput) dom.excludeInput.value = '';
    bumpSearchExecutionRevision('clearSearchFilters');
    refreshSearchFilterControls();
    dom.toggleFiltersBtn?.focus({ preventScroll: true });
  } else if (action === 'refresh') {
    dom.refreshBtn?.focus({ preventScroll: true });
    handleRefreshButtonClick();
  } else if (action === 'retry') {
    dom.searchInput?.focus({ preventScroll: true });
    bumpSearchExecutionRevision('retrySearch');
    scheduleSearch();
  }
}

function attachEventListeners() {
  attachSearchBoxListeners();
  attachAutoCloseModeListener();
  attachOptionToggleListeners();
  attachSidebarActionListeners();
  attachNativeActionListeners();
  attachLayoutToggleListeners();
  attachFilterBarListeners();
}

function handleSearchInputChange() {
  const nextInput = dom.searchInput.value.trim();
  const preservesActiveAICardSearch = !!(
    state.aiCardSearch?.active
    && nextInput === state.aiCardSearch.query
  );
  state.userInput = nextInput;
  if (preservesActiveAICardSearch) return;
  if (typeof emitSearchDebugLog === 'function' && state.userInput) {
    emitSearchDebugLog('input', JSON.stringify({ query: state.userInput }));
  }
  bumpSearchExecutionRevision('searchInput');
  scheduleSearch({ lowPriority: true });
}

function handleManualExclusionInputChange() {
  state.manualExclusionInput = dom.excludeInput?.value.trim() || '';
  bumpSearchExecutionRevision('manualExclusionInput');
  scheduleSearch({ lowPriority: true });
  updateClearNegativesButton();
}

function handleClearFilters() {
  bumpSearchExecutionRevision('clearFilters');

  // 先拿住这次用户手势，避免后续调度或布局切换把输入焦点抢掉。
  expandFiltersForSearchInput();

  if (isCompactLayout()) {
    const isSidebarOpen = dom.sidebar?.classList.contains('show');
    if (isSidebarOpen) {
      closeSidebar();
    }
  }

  focusSearchInput({ bypassSuppression: true, ensure: true });

  dom.searchInput.value = '';
  syncSearchUsageRoundFromInput('');
  if (dom.excludeInput) dom.excludeInput.value = '';
  state.userInput = '';
  state.manualExclusionInput = '';
  state.activePresets.clear();
  state.activeNegativePresets.clear();
  state.currentTypeKey = state.config.typeFilters[0]?.key || 'all';
  state.currentClassificationSubtype = 'all';
  deactivateLocalSearch();
  refreshClassificationOptions();
  renderPresetBar();
  renderTypeBar();
  renderClassificationBar();
  renderNegativeBar();
  clearSelection();
  scheduleSearch();
}

function handleClearPresets() {
  if (state.activePresets.size === 0) return;
  bumpSearchExecutionRevision('clearPresets');

  state.activePresets.clear();
  renderPresetBar();
  scheduleSearch();
  showToast('已清除所有预设');
}

function handleClearNegatives() {
  if (state.activeNegativePresets.size === 0 && !state.manualExclusionInput) return;
  bumpSearchExecutionRevision('clearNegatives');

  state.activeNegativePresets.clear();
  state.manualExclusionInput = '';
  if (dom.excludeInput) dom.excludeInput.value = '';
  renderNegativeBar();
  scheduleSearch();
  showToast('已清除所有排除词');
}

function updateClearPresetsButton() {
  if (!dom.clearPresetsBtn) return;

  if (state.activePresets.size === 0) {
    dom.clearPresetsBtn.classList.add('disabled');
  } else {
    dom.clearPresetsBtn.classList.remove('disabled');
  }
}

function updateClearNegativesButton() {
  if (!dom.clearNegativesBtn) return;

  if (state.activeNegativePresets.size === 0 && !state.manualExclusionInput) {
    dom.clearNegativesBtn.classList.add('disabled');
  } else {
    dom.clearNegativesBtn.classList.remove('disabled');
  }
}

/**
 * 更新卡片数据（简化版：直接更新 state.cards）
 * @param {Array} cards - 卡片数组
 * @param {Object} options - 选项
 * @param {boolean} options.replace - 是否替换（true）或合并（false）
 */
