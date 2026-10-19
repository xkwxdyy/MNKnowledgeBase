'use strict';

let sidebarReturnFocusTarget = null;

function readSidebarHiddenPreference() {
  try {
    state.sidebarHidden = localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1';
  } catch (e) {
    state.sidebarHidden = false;
  }
}

function syncSidebarToggleDisplay(checkMobile) {
  if (dom.sidebarToggle) {
    dom.sidebarToggle.style.display = checkMobile() ? 'flex' : 'none';
  }
}

function normalizeSidebarOperation(value) {
  return ['merge', 'move', 'template'].includes(value) ? value : 'merge';
}

function loadSidebarOperationPreference() {
  let operation = 'merge';
  try {
    operation = normalizeSidebarOperation(localStorage.getItem(SIDEBAR_OPERATION_KEY));
  } catch (error) {
    operation = 'merge';
  }
  state.sidebarActiveOperation = operation;
  return operation;
}

function saveSidebarOperationPreference(operation) {
  try {
    localStorage.setItem(SIDEBAR_OPERATION_KEY, normalizeSidebarOperation(operation));
  } catch (error) {
    // ignore
  }
}

function scrollSidebarToOperation(operation, options = {}) {
  const sidebar = dom.sidebar;
  const normalized = normalizeSidebarOperation(operation);
  const group = document.querySelector(`[data-operation-group="${normalized}"]`);
  const target = group?.querySelector('.sidebar-btn--merge-primary') || group;
  if (!sidebar || !target || !state.selectedCardId) return false;
  if (isCompactLayout() && !sidebar.classList.contains('show')) return false;

  requestAnimationFrame(() => {
    const sidebarRect = sidebar.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const stickyHeaderHeight = isCompactLayout()
      ? (sidebar.querySelector('.sidebar-header')?.getBoundingClientRect().height || 0)
      : 0;
    const comfortableTop = sidebarRect.top + Math.max(stickyHeaderHeight + 12, Math.min(96, sidebar.clientHeight * 0.16));
    const comfortableBottom = sidebarRect.bottom - 48;
    const alreadyComfortable = targetRect.top >= comfortableTop
      && targetRect.bottom <= comfortableBottom;
    if (alreadyComfortable) return;

    const currentTop = Number(sidebar.scrollTop) || 0;
    const desiredTop = currentTop + targetRect.top - comfortableTop;
    const maxTop = Math.max(0, (sidebar.scrollHeight || 0) - (sidebar.clientHeight || 0));
    const nextTop = Math.max(0, Math.min(maxTop, desiredTop));

    if (typeof sidebar.scrollTo === 'function') {
      sidebar.scrollTo({
        top: nextTop,
        behavior: options.behavior || 'smooth',
      });
    } else {
      sidebar.scrollTop = nextTop;
    }
  });
  return true;
}

function setSidebarOperation(operation, options = {}) {
  const normalized = normalizeSidebarOperation(operation);
  const shouldExpand = options.expanded !== false;

  document.querySelectorAll('[data-operation-group]').forEach((group) => {
    const isActive = shouldExpand && group.dataset.operationGroup === normalized;
    group.classList.toggle('is-open', isActive);
    const toggle = group.querySelector('[data-operation-toggle]');
    toggle?.setAttribute('aria-expanded', isActive ? 'true' : 'false');
  });

  state.sidebarActiveOperation = normalized;
  if (options.save !== false) {
    saveSidebarOperationPreference(normalized);
  }
  document.body.classList.toggle('sidebar-operation-ready', !!state.selectedCardId && shouldExpand);
  if (shouldExpand && options.scroll === true) {
    scrollSidebarToOperation(normalized);
  }
}

function toggleSidebarOperation(operation) {
  const normalized = normalizeSidebarOperation(operation);
  const group = document.querySelector(`[data-operation-group="${normalized}"]`);
  const isOpen = !!group?.classList.contains('is-open');
  setSidebarOperation(normalized, {
    expanded: !isOpen,
    scroll: !isOpen,
  });
}

function syncSidebarWorkflowState() {
  const hasSelection = !!state.selectedCardId;
  const hadSelection = document.body.classList.contains('sidebar-has-selection');
  document.body.classList.toggle('sidebar-has-selection', hasSelection);

  if (dom.sidebarWorkflowHint) {
    dom.sidebarWorkflowHint.textContent = hasSelection
      ? '已选定目标。选择一种操作，核对当前方案后执行。'
      : '先从右侧结果中选择一张目标卡片。';
  }

  if (hasSelection && !hadSelection) {
    setSidebarOperation(state.sidebarActiveOperation || 'merge', {
      save: false,
      scroll: true,
    });
  } else if (!hasSelection) {
    setSidebarOperation(state.sidebarActiveOperation || 'merge', {
      expanded: false,
      save: false,
    });
  }
}

function setupSidebarOperationInteractions() {
  document.querySelectorAll('[data-operation-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggleSidebarOperation(toggle.dataset.operationToggle);
    });
  });
}

function syncActualTopbarHeight() {
  if (!dom.topbar) return 0;
  const rect = dom.topbar.getBoundingClientRect();
  const height = Math.max(0, Math.ceil(rect.height || dom.topbar.offsetHeight || 0));
  if (height > 0) {
    document.documentElement.style.setProperty('--topbar-actual-height', `${height}px`);
  }
  return height;
}

function setupTopbarHeightTracking() {
  syncActualTopbarHeight();
  if (topbarResizeObserver) {
    topbarResizeObserver.disconnect();
    topbarResizeObserver = null;
  }
  if (!dom.topbar || typeof ResizeObserver !== 'function') return;

  topbarResizeObserver = new ResizeObserver(() => {
    syncActualTopbarHeight();
    updateMainPaddingTop();
  });
  topbarResizeObserver.observe(dom.topbar);
}

function applyResponsiveSidebarLayout(checkMobile) {
  finishSidebarResize(false);
  applyFilterPanelState(isFilterPanelCollapsed, { skipSave: true });

  if (checkMobile()) {
    document.body.classList.remove('sidebar-hidden');
    if (!dom.sidebar?.classList.contains('show') && dom.sidebar?.contains(document.activeElement)) {
      dom.sidebarPanelBtn?.focus({ preventScroll: true });
    }
  } else {
    document.body.classList.toggle('sidebar-hidden', !!state.sidebarHidden);
    closeSidebar();
  }
  applySidebarWidth(state.sidebarWidth, { save: false });
  updateSidebarPanelButton();
}

function setupResponsive() {
  const checkMobile = () => isCompactLayout();
  const handleViewportChange = () => {
    applyResponsiveSidebarLayout(checkMobile);
  };
  let lastViewportWidth = window.innerWidth;

  readSidebarHiddenPreference();
  setupTopbarHeightTracking();
  syncSidebarToggleDisplay(checkMobile);
  handleViewportChange();

  let resizeRafId = null;
  window.addEventListener('resize', () => {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = null;
      const viewportWidth = window.innerWidth;
      const widthChanged = Math.abs(viewportWidth - lastViewportWidth) > 1;
      lastViewportWidth = viewportWidth;
      syncSidebarToggleDisplay(checkMobile);
      handleViewportChange();
      if (widthChanged && typeof handleResultWindowViewportChange === 'function') {
        handleResultWindowViewportChange();
      }
    });
  });
}

function handleResultWindowScrollFallback(currentScrollY) {
  if (typeof window.IntersectionObserver === 'function' || !dom.container) return false;

  const edgeMargin = 240;
  const topSpacerHeight = Math.max(0, Number(state.resultWindowTopSpacerHeight) || 0);
  const hasPreviousSegments = Array.isArray(state.resultWindowTopSegments)
    && state.resultWindowTopSegments.length > 0;
  if (hasPreviousSegments && currentScrollY <= topSpacerHeight + edgeMargin) {
    return typeof restorePreviousResultWindowSegment === 'function'
      && restorePreviousResultWindowSegment();
  }

  const hasForwardResults = state.hasMore
    || (Array.isArray(state.resultWindowBottomSegments) && state.resultWindowBottomSegments.length > 0);
  const distanceFromBottom = dom.container.scrollHeight - dom.container.clientHeight - currentScrollY;
  if (hasForwardResults && distanceFromBottom <= edgeMargin) {
    if (typeof loadMore === 'function') {
      loadMore();
      return true;
    }
  }
  return false;
}

function setupScrollBehavior() {
  if (!dom.container) return;

  // 简化滚动行为：只处理返回顶部按钮的显示/隐藏
  // 移除了自动隐藏搜索栏的逻辑，避免遮挡内容
  const handleScroll = () => {
    const currentScrollY = dom.container.scrollTop;

    // 只更新滚动到顶部按钮的显示状态
    if (currentScrollY > 200) {
      dom.scrollToTopBtn?.classList.add('show');
    } else {
      dom.scrollToTopBtn?.classList.remove('show');
    }

    handleResultWindowScrollFallback(currentScrollY);
  };

  // 监听容器滚动事件（rAF 合帧）
  let scrollRafId = null;
  dom.container.addEventListener('scroll', () => {
    if (scrollRafId) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      handleScroll();
    });
  }, { passive: true });

  // 返回顶部按钮点击事件
  dom.scrollToTopBtn?.addEventListener('click', scrollToTop);
  dom.sidebarResizeHandle?.addEventListener('pointerdown', beginSidebarResize);

  // 加载更多按钮点击事件
  dom.loadMoreBtn?.addEventListener('click', loadMore);
}

function hideToolbars() {
  isToolbarHidden = true;

  // 添加全局隐藏状态,触发 padding-top 的过渡
  document.body.classList.add('toolbar-hidden');

  // 隐藏顶部搜索栏
  dom.topbar?.classList.add('hidden');

  // 隐藏所有工具栏
  const toolbars = [
    dom.typeSection,
    dom.classificationSection,
    dom.presetSection,
    dom.negativeSection
  ];

  toolbars.forEach(toolbar => {
    if (toolbar && !toolbar.classList.contains('component-hidden')) {
      toolbar.classList.add('hidden');
    }
  });
}

function showToolbars() {
  isToolbarHidden = false;

  // 移除全局隐藏状态,恢复 padding-top
  document.body.classList.remove('toolbar-hidden');

  // 显示顶部搜索栏
  dom.topbar?.classList.remove('hidden');

  // 显示所有工具栏
  const toolbars = [
    dom.typeSection,
    dom.classificationSection,
    dom.presetSection,
    dom.negativeSection
  ];

  toolbars.forEach(toolbar => {
    if (toolbar) {
      toolbar.classList.remove('hidden');
    }
  });
}

function scrollToTop() {
  if (!dom.container) return;

  // 平滑滚动到顶部
  dom.container.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

function toggleSidebar() {
          if (!dom.sidebar) return;

          const isShow = dom.sidebar.classList.contains('show');
          if (isShow) {
            closeSidebar();
          } else {
            openSidebar();
          }
        }

        function isSidebarHidden() {
          return document.body.classList.contains('sidebar-hidden');
        }

        function updateSidebarPanelButton() {
          if (!dom.sidebarPanelBtn) return;

          const isCompact = isCompactLayout();
          const isOpen = isCompact
            ? !!dom.sidebar?.classList.contains('show')
            : !isSidebarHidden();

          dom.sidebarPanelBtn.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
          dom.sidebarPanelBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          dom.sidebar?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
          dom.sidebarToggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          dom.sidebarToggle?.setAttribute('aria-label', isOpen ? '关闭卡片操作面板' : '打开卡片操作面板');
          dom.sidebarPanelBtn.title = isCompact
            ? (isOpen ? '关闭侧边栏' : '打开侧边栏')
            : (isOpen ? '隐藏侧边栏' : '显示侧边栏');
        }

        function setSidebarHidden(hidden, { save = true } = {}) {
          state.sidebarHidden = !!hidden;

          if (isCompactLayout()) {
            // 紧凑布局使用抽屉式侧边栏，不应用 display:none
            document.body.classList.remove('sidebar-hidden');
          } else {
            document.body.classList.toggle('sidebar-hidden', !!hidden);
            closeSidebar();
          }

          if (save) {
            try {
              localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0');
            } catch (e) {
              // ignore
            }
          }
          applySidebarWidth(state.sidebarWidth, { save: false });
          updateSidebarPanelButton();
          if (!hidden && state.selectedCardId) {
            scrollSidebarToOperation(state.sidebarActiveOperation || 'merge');
          }
        }

        function ensureSidebarVisible({ openIfCompact = false } = {}) {
          if (isCompactLayout()) {
            if (openIfCompact) openSidebar();
            updateSidebarPanelButton();
            return;
          }
          if (isSidebarHidden()) {
            setSidebarHidden(false);
          }
        }

        function toggleSidebarPanel() {
          if (isCompactLayout()) {
            toggleSidebar();
            updateSidebarPanelButton();
            return;
          }
          setSidebarHidden(!isSidebarHidden());
        }

        function openSidebar() {
          if (!dom.sidebar) return;
          const wasOpen = dom.sidebar.classList.contains('show');
          const compact = isCompactLayout();
          if (compact && !wasOpen) {
            const active = document.activeElement;
            sidebarReturnFocusTarget = active && active !== document.body && !dom.sidebar.contains(active)
              ? active : dom.sidebarPanelBtn;
            dismissFilterPanel();
            if (typeof hideSearchHistoryDropdown === 'function') hideSearchHistoryDropdown();
          }
          dom.sidebar?.classList.add('show');
          dom.sidebarOverlay?.classList.add('show');
          updateSidebarPanelButton();
          if (state.selectedCardId) {
            scrollSidebarToOperation(state.sidebarActiveOperation || 'merge');
          }
          if (compact && !wasOpen) {
            document.getElementById('sidebarCloseBtn')?.focus({ preventScroll: true });
          }
        }

        function closeSidebar({ restoreFocus = true } = {}) {
          // 跨断点时 CSS 可能先隐藏关闭按钮，让浏览器在 resize 回调前将焦点退回 body。
          const focusLostOnExpand = !isCompactLayout()
            && document.activeElement === document.body
            && !!sidebarReturnFocusTarget;
          const shouldRestore = restoreFocus
            && dom.sidebar?.classList.contains('show')
            && (focusLostOnExpand || (dom.sidebar.contains(document.activeElement)
              && (isCompactLayout() || document.activeElement?.id === 'sidebarCloseBtn')));
          dom.sidebar?.classList.remove('show');
          dom.sidebarOverlay?.classList.remove('show');
          updateSidebarPanelButton();
          if (shouldRestore) {
            const target = sidebarReturnFocusTarget?.isConnected ? sidebarReturnFocusTarget : dom.sidebarPanelBtn;
            target?.focus({ preventScroll: true });
          }
          sidebarReturnFocusTarget = null;
        }

function handleSidebarEscape(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat
    || event.key !== 'Escape' || !isCompactLayout() || !dom.sidebar?.classList.contains('show')) return;
  event.preventDefault();
  closeSidebar();
}

function handleSidebarFocusChange(event) {
  if (!isCompactLayout() || !dom.sidebar?.classList.contains('show')) return;
  const target = event.target;
  if (dom.sidebar.contains(target) || dom.sidebarPanelBtn?.contains(target) || dom.sidebarToggle?.contains(target)) return;
  // The toolbar remains available: moving focus back to search dismisses the drawer.
  closeSidebar({ restoreFocus: false });
}

function applyToolbarSectionState(sectionName, collapsed) {
  const content = document.querySelector(`[data-content="${sectionName}"]`);
  const btn = document.querySelector(`[data-toggle="${sectionName}"]`);
  if (!content || !btn) return;
  if (collapsed && content.contains(document.activeElement)) {
    btn.focus({ preventScroll: true });
  }
  content.classList.toggle('collapsed', collapsed);
  content.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  btn.classList.toggle('collapsed', collapsed);
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const label = btn.closest('.pill-section')?.querySelector('.pill-section__label')?.textContent.trim() || '筛选分组';
  btn.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${label}`);
}

// 处理工具栏折叠/展开
function handleToolbarToggle(event) {
  const sectionName = event.currentTarget.dataset.toggle;
  if (!sectionName) return;
  const content = document.querySelector(`[data-content="${sectionName}"]`);
  if (!content) return;
  const collapsed = !content.classList.contains('collapsed');
  applyToolbarSectionState(sectionName, collapsed);

  // 动态调整 main-layout 的 padding-top
  updateMainPaddingTop();

  // 保存折叠状态到 localStorage
  saveToolbarState(sectionName, collapsed);
}

// 动态计算并更新 main-layout 的 padding-top
function updateMainPaddingTop() {
  if (updateMainPaddingRafId) return;

  updateMainPaddingRafId = requestAnimationFrame(() => {
    updateMainPaddingRafId = null;
    applyMainPaddingTop();
  });
}

function applyMainPaddingTop() {
  const topbarHeight = dom.topbar ? (dom.topbar.offsetHeight || 64) : 64;
  syncActualTopbarHeight();

  if (document.body.classList.contains('filters-collapsed') || isCompactLayout()) {
    document.documentElement.style.setProperty('--main-padding-top', `${topbarHeight + 20}px`);
    return;
  }

  let totalHeight = topbarHeight;

  // 所有显示且未折叠的工具栏
  document.querySelectorAll('.pill-section').forEach((section) => {
    if (section.classList.contains('component-hidden')) return;

    const content = section.querySelector('.pill-section__content');
    if (content && !content.classList.contains('collapsed')) {
      totalHeight += section.offsetHeight || 0;
    } else if (!content) {
      // 没有内容包装器的，直接计算整个 section
      totalHeight += section.offsetHeight || 0;
    } else {
      // 折叠状态，只计算 header 高度
      const header = section.querySelector('.pill-section__header');
      if (header) {
        totalHeight += header.offsetHeight || 0;
      }
    }
  });

  // 添加缓冲空间
  totalHeight += 20;

  // 更新 CSS 变量
  document.documentElement.style.setProperty('--main-padding-top', `${totalHeight}px`);
}

function readToolbarStates() {
  try {
    const parsed = JSON.parse(localStorage.getItem('mnkb_toolbar_states') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    console.warn('加载工具栏状态失败', error);
  }
  return {};
}

// 保存工具栏折叠状态
function saveToolbarState(sectionName, isCollapsed) {
  try {
    const states = readToolbarStates();
    states[sectionName] = isCollapsed;
    localStorage.setItem('mnkb_toolbar_states', JSON.stringify(states));
  } catch (error) {
    console.warn('保存工具栏状态失败', error);
  }
}

// 加载工具栏折叠状态
function loadToolbarStates() {
  const states = readToolbarStates();
  const defaultStates = { preset: true, negative: true };
  document.querySelectorAll('.pill-section__toggle-btn').forEach((btn) => {
    const sectionName = btn.dataset.toggle;
    const collapsed = typeof states[sectionName] === 'boolean'
      ? states[sectionName] : defaultStates[sectionName] === true;
    applyToolbarSectionState(sectionName, collapsed);
  });
  updateMainPaddingTop();
}

function getActiveFilterCount() {
  let count = 0;
  if (state.currentTypeKey && state.currentTypeKey !== 'all') count += 1;
  if (state.currentClassificationSubtype && state.currentClassificationSubtype !== 'all') count += 1;
  count += state.activePresets?.size || 0;
  count += state.activeNegativePresets?.size || 0;
  if (state.manualExclusionInput) count += 1;
  return count;
}

function getActiveSearchFilters() {
  const filters = [];
  if (state.currentTypeKey && state.currentTypeKey !== 'all') {
    const type = state.config.typeFilters.find((item) => item.key === state.currentTypeKey);
    filters.push({ kind: 'type', value: state.currentTypeKey, label: `类型：${type?.label || state.currentTypeKey}` });
  }
  if (state.currentClassificationSubtype && state.currentClassificationSubtype !== 'all') {
    filters.push({ kind: 'subtype', value: state.currentClassificationSubtype, label: `归类：${state.currentClassificationSubtype}` });
  }
  state.activePresets.forEach((value) => {
    filters.push({ kind: 'preset', value, label: `包含：${value}` });
  });
  state.activeNegativePresets.forEach((value) => {
    filters.push({ kind: 'negative', value, label: `排除：${value}`, negative: true });
  });
  if (state.manualExclusionInput) {
    filters.push({ kind: 'manual', value: state.manualExclusionInput, label: `标题排除：${state.manualExclusionInput}`, negative: true });
  }
  return filters;
}

function renderActiveSearchFilters() {
  const container = document.getElementById('activeSearchFilters');
  const list = document.getElementById('activeSearchFilterList');
  if (!container || !list) return;
  const filters = getActiveSearchFilters();
  const signature = JSON.stringify(filters);
  if (list.dataset.signature === signature) return;

  const focusWasInside = container.contains(document.activeElement);
  const focusIndex = Array.from(list.children).indexOf(document.activeElement);
  const fragment = document.createDocumentFragment();
  filters.forEach((filter) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `active-search-filter${filter.negative ? ' is-negative' : ''}`;
    button.dataset.filterKind = filter.kind;
    button.dataset.filterValue = filter.value;
    button.title = `移除${filter.label}`;
    button.setAttribute('aria-label', button.title);
    const label = document.createElement('span');
    label.textContent = filter.label;
    const remove = document.createElement('span');
    remove.className = 'active-search-filter__remove';
    remove.textContent = '×';
    remove.setAttribute('aria-hidden', 'true');
    button.append(label, remove);
    fragment.appendChild(button);
  });
  list.replaceChildren(fragment);
  list.dataset.signature = signature;
  container.hidden = filters.length === 0;
  if (focusWasInside && (focusIndex >= 0 || container.hidden)) {
    const target = list.children[Math.min(Math.max(0, focusIndex), filters.length - 1)];
    (target || dom.toggleFiltersBtn)?.focus({ preventScroll: true });
  }
}

function updateFilterToggleLabel() {
  renderActiveSearchFilters();
  if (!dom.toggleFiltersBtn) return;
  const count = getActiveFilterCount();
  dom.toggleFiltersBtn.dataset.activeCount = count > 0 ? String(count) : '';
  const isQuickButton = dom.toggleFiltersBtn.classList.contains('quick-btn');
  dom.toggleFiltersBtn.textContent = isQuickButton
    ? '🔻'
    : (count > 0 ? `筛选 · ${count}` : '筛选');
  dom.toggleFiltersBtn.title = isFilterPanelCollapsed
    ? (count > 0 ? `展开筛选，当前有 ${count} 项生效` : '展开筛选')
    : (count > 0 ? `收起筛选，当前有 ${count} 项生效` : '收起筛选');
  dom.toggleFiltersBtn.setAttribute('aria-label', dom.toggleFiltersBtn.title);
}

function applyFilterPanelState(collapsed, options = {}) {
  const { skipSave = false } = options;
  isFilterPanelCollapsed = collapsed;
  document.body.classList.toggle('filters-collapsed', collapsed);
  const compact = isCompactLayout();
  document.body.classList.toggle('filters-overlay', !collapsed && compact);
  if (dom.filtersPanel) {
    dom.filtersPanel.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    dom.filtersPanel.dataset.layout = compact ? 'compact' : 'wide';
  }
  if (dom.filtersBackdrop) {
    dom.filtersBackdrop.setAttribute('aria-hidden', collapsed || !compact ? 'true' : 'false');
  }
  if (dom.toggleFiltersBtn) {
    dom.toggleFiltersBtn.setAttribute('aria-expanded', (!collapsed).toString());
    dom.toggleFiltersBtn.setAttribute('aria-label', collapsed ? '展开筛选工具栏' : '收起筛选工具栏');
    dom.toggleFiltersBtn.classList.toggle('collapsed', collapsed);
    updateFilterToggleLabel();
  }
  updateMainPaddingTop();
  if (!skipSave) {
    saveFilterPanelState(collapsed);
  }
}

function dismissFilterPanel(options = {}) {
  if (isFilterPanelCollapsed) return false;
  const persist = options.persist === true;
  isFilterPanelManuallySet = persist;
  applyFilterPanelState(true, { skipSave: !persist });

  if (options.restoreToggleFocus && dom.toggleFiltersBtn) {
    requestAnimationFrame(() => {
      try {
        dom.toggleFiltersBtn.focus({ preventScroll: true });
      } catch (error) {
        dom.toggleFiltersBtn.focus();
      }
    });
  }
  return true;
}

function isFilterPanelInteractionTarget(target, event) {
  if (!target) return false;
  const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
  if (path.includes(dom.filtersPanel)
    || path.includes(dom.toggleFiltersBtn)
    || path.includes(dom.searchInput)
    || path.includes(dom.excludeInput)) {
    return true;
  }
  return !!(
    dom.filtersPanel?.contains(target)
    || dom.toggleFiltersBtn?.contains(target)
    || dom.searchInput?.contains(target)
    || dom.excludeInput?.contains(target)
  );
}

function handleFilterPanelOutsideClick(event) {
  if (isFilterPanelCollapsed || isFilterPanelInteractionTarget(event.target, event)) return;
  dismissFilterPanel({ persist: true });
}

function handleFilterPanelEscape(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat
    || event.key !== 'Escape' || isFilterPanelCollapsed) return;
  event.preventDefault();
  dismissFilterPanel({ persist: true, restoreToggleFocus: true });
}

function saveFilterPanelState(collapsed) {
  try {
    localStorage.setItem('mnkb_filter_panel_collapsed', JSON.stringify(collapsed));
  } catch (error) {
    console.warn('保存筛选面板状态失败', error);
  }
}

function loadFilterPanelState() {
  try {
    const stored = localStorage.getItem('mnkb_filter_panel_collapsed');
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (typeof parsed === 'boolean') {
        isFilterPanelManuallySet = true;
        applyFilterPanelState(parsed, { skipSave: true });
        return;
      }
    }
  } catch (error) {
    console.warn('加载筛选面板状态失败，即将使用默认行为', error);
  }
  applyFilterPanelState(true, { skipSave: true });
}

// 输入框聚焦时自动展开筛选面板
function expandFiltersForSearchInput() {
  if (!isFilterPanelCollapsed) return;
  isFilterPanelManuallySet = false;
  applyFilterPanelState(false, { skipSave: true });
}

function focusSearchInput(options = {}) {
  if (options.bypassSuppression) {
    state.suppressSearchInputFocus = false;
  }
  if (!dom.searchInput) return;

  const attemptFocus = () => {
    if (options.bypassSuppression) {
      state.suppressSearchInputFocus = false;
    }
    try {
      dom.searchInput.focus({ preventScroll: true });
    } catch (error) {
      dom.searchInput.focus();
    }
  };

  attemptFocus();

  if (options.ensure !== true) return;

  requestAnimationFrame(() => {
    if (document.activeElement !== dom.searchInput) {
      attemptFocus();
    }
  });

  setTimeout(() => {
    if (document.activeElement !== dom.searchInput) {
      attemptFocus();
    }
  }, 80);
}

function handleFilterInputFocus() {
  // 1. 展开筛选面板（保持原有功能）
  expandFiltersForSearchInput();

  // 2. 在窄模式下自动关闭 sidebar
  if (isCompactLayout()) {
    const isSidebarOpen = dom.sidebar?.classList.contains('show');
    if (isSidebarOpen) {
      closeSidebar();
    }
  }
}

// 处理搜索框聚焦事件的综合函数
function handleSearchInputFocus() {
  if (state.suppressSearchInputFocus) {
    state.suppressSearchInputFocus = false;
    dom.searchInput?.blur();
    return;
  }
  if (isCompactLayout() && dom.sidebar?.classList.contains('show')) {
    closeSidebar();
  }
}

// 选中卡片后自动收起筛选面板
function collapseFiltersAfterCardSelection() {
  dismissFilterPanel();
}

function syncAIRecommendationVisibility() {
  if (dom.aiRecommendBtn) {
    dom.aiRecommendBtn.style.display = AI_RECOMMENDATION_ENABLED ? '' : 'none';
  }
  if (!AI_RECOMMENDATION_ENABLED) {
    state.aiRecommendations = [];
    state.aiRecommendDebug = null;
    state.aiRecommendLoading = false;
    rebuildAIRecommendationLookup();
  }
  if (dom.aiRecommendPanel) {
    dom.aiRecommendPanel.style.display = 'none';
  }
}
