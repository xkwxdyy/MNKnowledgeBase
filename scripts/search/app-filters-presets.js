'use strict';

function syncFilterPillSelection(pill, selected) {
  pill.setAttribute('role', 'button');
  pill.setAttribute('aria-pressed', selected ? 'true' : 'false');
  pill.classList.toggle('active', selected);
}

function applyPresetPillBaseAttributes(pill, preset, level, group) {
  pill.className = 'pill';
  pill.setAttribute('data-level', level);
  pill.setAttribute('data-preset', preset);
  if (group && group.name) {
    pill.setAttribute('data-group', group.name);
  }
  pill.tabIndex = 0;
  pill.setAttribute('aria-label', preset);
  syncFilterPillSelection(pill, state.activePresets.has(preset));
}

function appendExpandablePresetPillContent(pill, preset) {
  pill.classList.add('pill--expandable');
  const isExpanded = state.expandedPresets.has(preset);
  pill.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
  pill.setAttribute('aria-keyshortcuts', 'ArrowRight ArrowLeft');

  const textSpan = document.createElement('span');
  textSpan.className = 'pill__text';
  textSpan.textContent = preset;

  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'pill__toggle';
  toggleSpan.setAttribute('aria-hidden', 'true');
  toggleSpan.textContent = isExpanded ? '▼' : '▶';

  pill.appendChild(textSpan);
  pill.appendChild(toggleSpan);
}

function createPresetPill(item, level, group) {
  const preset = typeof item === 'string' ? item : item.value;
  const hasChildren = item.children && item.children.length > 0;

  const pill = document.createElement('div');
  applyPresetPillBaseAttributes(pill, preset, level, group);

  if (hasChildren) {
    appendExpandablePresetPillContent(pill, preset);
  } else {
    pill.textContent = preset;
  }

  return pill;
}

/**
 * 切换展开/收起状态
 * @param {Object} item - 预设项
 * @param {Object} group - 所属分组
 */
function toggleExpand(item, group) {
  const preset = item.value;
  const isExpanded = state.expandedPresets.has(preset);

  // 判断当前项是否是分组的直接子项
  const isDirectChild = group?.presets?.some(p => p.value === preset);

  // 只有直接子项才触发互斥逻辑（避免子孙项误触发）
  if (group?.type === 'exclusive' && !isExpanded && isDirectChild) {
    group.presets.forEach(p => {
      if (p.value !== preset) {
        state.expandedPresets.delete(p.value);
        // 递归清除所有子项的展开状态
        clearChildrenExpanded(p);
      }
    });
  }

  // 切换当前项
  if (isExpanded) {
    state.expandedPresets.delete(preset);
    // 收起时也清除子项的展开状态
    clearChildrenExpanded(item);
  } else {
    state.expandedPresets.add(preset);
  }

  renderPresetBar();
}

/**
 * 递归清除子项的展开状态
 * @param {Object} item - 预设项
 */
function clearChildrenExpanded(item) {
  if (!item.children) return;
  item.children.forEach(child => {
    state.expandedPresets.delete(child.value);
    clearChildrenExpanded(child);
  });
}

function getPresetGroupByName(groupName) {
  if (!groupName) return null;
  const groups = getPresetGroupsWithRecent();
  return groups.find((group) => group && group.name === groupName) || null;
}

function findPresetItemByValue(items, value) {
  if (!Array.isArray(items) || !value) return null;
  for (const item of items) {
    const normalizedItem = (typeof item === 'string') ? { value: item } : item;
    if (!normalizedItem || !normalizedItem.value) continue;
    if (normalizedItem.value === value) return normalizedItem;
    if (normalizedItem.children && normalizedItem.children.length > 0) {
      const nested = findPresetItemByValue(normalizedItem.children, value);
      if (nested) return nested;
    }
  }
  return null;
}

function getCurrentPresetItemMeta(pill) {
  if (!pill) return null;
  const presetValue = pill.dataset.preset;
  const groupName = pill.dataset.group;
  const group = getPresetGroupByName(groupName);
  if (!group) return null;

  const item = findPresetItemByValue(group.presets, presetValue);
  if (!item) return null;

  return {
    value: presetValue,
    item,
    group,
    hasChildren: Array.isArray(item.children) && item.children.length > 0,
    isExpanded: state.expandedPresets.has(presetValue),
  };
}

function togglePresetSelection(presetValue) {
  if (!presetValue) return;
  bumpSearchExecutionRevision('togglePresetSelection');
  if (state.activePresets.has(presetValue)) {
    state.activePresets.delete(presetValue);
  } else {
    state.activePresets.add(presetValue);
  }
  renderPresetBar();
  scheduleSearch();
}

function handlePresetBarClick(event) {
  if (!dom.presetBar) return;
  const pill = event.target.closest('.pill[data-preset]');
  if (!pill || !dom.presetBar.contains(pill)) return;

  const meta = getCurrentPresetItemMeta(pill);
  if (!meta) return;

  if (event.target.closest('.pill__toggle')) {
    event.stopPropagation();
    toggleExpand(meta.item, meta.group);
    return;
  }

  if (event.target.closest('.pill__text') || !meta.hasChildren) {
    event.stopPropagation();
    togglePresetSelection(meta.value);
  }
}

function handlePresetBarKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (!dom.presetBar) return;
  const pill = event.target.closest('.pill[data-preset]');
  if (!pill || !dom.presetBar.contains(pill)) return;

  const meta = getCurrentPresetItemMeta(pill);
  if (!meta) return;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (event.repeat) return;
    togglePresetSelection(meta.value);
    return;
  }

  if (!meta.hasChildren) return;

  if (event.key === 'ArrowRight' && !meta.isExpanded) {
    event.preventDefault();
    toggleExpand(meta.item, meta.group);
  } else if (event.key === 'ArrowLeft' && meta.isExpanded) {
    event.preventDefault();
    toggleExpand(meta.item, meta.group);
  }
}

function toggleNegativePreset(preset) {
  if (!preset) return;
  bumpSearchExecutionRevision('toggleNegativePreset');
  if (state.activeNegativePresets.has(preset)) {
    state.activeNegativePresets.delete(preset);
  } else {
    state.activeNegativePresets.add(preset);
  }
  renderNegativeBar();
  scheduleSearch();
}

function handleNegativeBarClick(event) {
  if (!dom.negativeBar) return;
  const pill = event.target.closest('.pill.negative[data-preset]');
  if (!pill || !dom.negativeBar.contains(pill)) return;
  toggleNegativePreset(pill.dataset.preset);
}

function handleNegativeBarKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (!dom.negativeBar) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const pill = event.target.closest('.pill.negative[data-preset]');
  if (!pill || !dom.negativeBar.contains(pill)) return;
  event.preventDefault();
  if (event.repeat) return;
  toggleNegativePreset(pill.dataset.preset);
}

function selectTypeFilter(filterKey) {
  if (!filterKey || state.currentTypeKey === filterKey) return;
  bumpSearchExecutionRevision('selectTypeFilter');
  state.currentTypeKey = filterKey;
  renderTypeBar();
  renderClassificationBar();
  scheduleSearch();
}

function handleTypeBarClick(event) {
  if (!dom.typeBar) return;
  const pill = event.target.closest('.pill[data-key]');
  if (!pill || !dom.typeBar.contains(pill)) return;
  selectTypeFilter(pill.dataset.key);
}

function handleTypeBarKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (!dom.typeBar) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const pill = event.target.closest('.pill[data-key]');
  if (!pill || !dom.typeBar.contains(pill)) return;
  event.preventDefault();
  if (event.repeat) return;
  selectTypeFilter(pill.dataset.key);
}

function selectClassificationSubtype(value) {
  if (!value || state.currentClassificationSubtype === value) return;
  bumpSearchExecutionRevision('selectClassificationSubtype');
  state.currentClassificationSubtype = value;
  renderClassificationBar();
  scheduleSearch({ triggerNative: false });
}

function handleClassificationBarClick(event) {
  if (!dom.classificationBar) return;
  const pill = event.target.closest('.pill[data-subtype]');
  if (!pill || !dom.classificationBar.contains(pill)) return;
  selectClassificationSubtype(pill.dataset.subtype);
}

function handleClassificationBarKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (!dom.classificationBar) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const pill = event.target.closest('.pill[data-subtype]');
  if (!pill || !dom.classificationBar.contains(pill)) return;
  event.preventDefault();
  if (event.repeat) return;
  selectClassificationSubtype(pill.dataset.subtype);
}

/**
 * 递归渲染预设项及其子项
 * @param {Array} items - 预设项数组
 * @param {HTMLElement} container - 容器元素
 * @param {Number} level - 层级
 * @param {Object} group - 所属分组
 */
function renderPresetItems(items, container, level, group) {
  items.forEach(item => {
    const preset = typeof item === 'string' ? item : item.value;
    const hasChildren = item.children && item.children.length > 0;

    // 创建当前层级的 pill
    const pill = createPresetPill(item, level, group);
    container.appendChild(pill);

    // 如果有子项且已展开，创建子行并递归渲染
    if (hasChildren && state.expandedPresets.has(preset)) {
      const childRow = document.createElement('div');
      childRow.className = `pill-row pill-row--child pill-row--level-${level + 1}`;
      childRow.setAttribute('data-level', level + 1);

      // 递归渲染子项到子行（统一逻辑，避免重复）
      renderPresetItems(item.children, childRow, level + 1, group);

      container.appendChild(childRow);
    }
  });
}

function buildPresetBarStructureKey(groups) {
  const nodes = [];
  const walkItems = (items, level, groupName) => {
    (items || []).forEach((item) => {
      const normalizedItem = (typeof item === 'string') ? { value: item } : item;
      if (!normalizedItem || !normalizedItem.value) return;

      const value = normalizedItem.value;
      const hasChildren = Array.isArray(normalizedItem.children) && normalizedItem.children.length > 0;
      const expanded = hasChildren && state.expandedPresets.has(value);
      const active = state.activePresets.has(value);
      nodes.push(`${groupName}|${level}|${value}|${active ? 1 : 0}|${expanded ? 1 : 0}`);

      if (expanded) {
        walkItems(normalizedItem.children, level + 1, groupName);
      }
    });
  };

  (groups || []).forEach((group) => {
    if (!group || !Array.isArray(group.presets) || group.presets.length === 0) return;
    nodes.push(`group:${group.name}:${group.icon || ''}:${group.isRecent ? 1 : 0}`);
    walkItems(group.presets, 1, group.name || '');
  });

  return nodes.join('||');
}

function patchPresetBarActiveState() {
  if (!dom.presetBar) return;
  dom.presetBar.querySelectorAll('.pill[data-preset]').forEach((pill) => {
    const value = pill.dataset.preset;
    syncFilterPillSelection(pill, state.activePresets.has(value));
    const toggle = pill.querySelector('.pill__toggle');
    if (toggle) {
      toggle.textContent = state.expandedPresets.has(value) ? '▼' : '▶';
      pill.setAttribute('aria-expanded', state.expandedPresets.has(value) ? 'true' : 'false');
    }
  });
}

function buildNegativeBarStructureKey(presets) {
  return (presets || []).map((preset) => String(preset)).join('||');
}

function patchNegativeBarActiveState() {
  if (!dom.negativeBar) return;
  dom.negativeBar.querySelectorAll('.pill.negative[data-preset]').forEach((pill) => {
    const preset = pill.dataset.preset;
    syncFilterPillSelection(pill, state.activeNegativePresets.has(preset));
  });
}

function buildTypeBarStructureKey(filters) {
  return (filters || [])
    .map((filter) => `${filter?.key || ''}:${filter?.label || ''}`)
    .join('||');
}

function patchTypeBarActiveState() {
  if (!dom.typeBar) return;
  dom.typeBar.querySelectorAll('.pill[data-key]').forEach((pill) => {
    syncFilterPillSelection(pill, pill.dataset.key === state.currentTypeKey);
  });
}

function buildClassificationBarStructureKey(options, visible) {
  if (!visible) return 'hidden';
  return ['all', ...(options || [])].join('||');
}

function patchClassificationBarActiveState() {
  if (!dom.classificationBar) return;
  dom.classificationBar.querySelectorAll('.pill[data-subtype]').forEach((pill) => {
    syncFilterPillSelection(pill, pill.dataset.subtype === state.currentClassificationSubtype);
  });
}

function resetPresetBarForEmptyState(perfStart) {
  dom.presetSection?.classList.add('component-hidden');
  dom.presetBar.innerHTML = '';
  presetBarStructureKey = '';
  logPerfMetric('renderPresetBar(empty)', perfStart);
}

function createPresetGroupElement(group) {
  if (!group || !group.presets || !group.presets.length) return null;

  const groupDiv = document.createElement('div');
  groupDiv.className = 'preset-group';
  if (group.isRecent) {
    groupDiv.classList.add('preset-group--recent');
  }

  const label = document.createElement('div');
  label.className = 'preset-group__label';
  label.textContent = (group.icon ? group.icon + ' ' : '') + group.name;
  groupDiv.appendChild(label);

  const pillRow = document.createElement('div');
  pillRow.className = 'pill-row';
  renderPresetItems(group.presets, pillRow, 1, group);
  groupDiv.appendChild(pillRow);
  return groupDiv;
}

function rebuildPresetBar(groups, structureKey) {
  const focusedPill = document.activeElement?.closest('.pill[data-preset]');
  const focusIdentity = focusedPill && dom.presetBar.contains(focusedPill)
    ? { preset: focusedPill.dataset.preset, group: focusedPill.dataset.group }
    : null;
  dom.presetBar.innerHTML = '';
  presetBarStructureKey = structureKey;

  const fragment = document.createDocumentFragment();
  groups.forEach((group) => {
    const groupElement = createPresetGroupElement(group);
    if (groupElement) {
      fragment.appendChild(groupElement);
    }
  });
  dom.presetBar.appendChild(fragment);
  if (focusIdentity) {
    const replacement = Array.from(dom.presetBar.querySelectorAll('.pill[data-preset]'))
      .find((pill) => pill.dataset.preset === focusIdentity.preset && pill.dataset.group === focusIdentity.group);
    replacement?.focus({ preventScroll: true });
  }
}

function finalizePresetBarRender(perfStart, groups, mode) {
  patchPresetBarActiveState();
  logPerfMetric(`renderPresetBar(${mode})`, perfStart, `groups=${groups.length}`);
  updateClearPresetsButton();
}

/**
 * 渲染预设栏（主函数）
 */
function renderPresetBar() {
  const perfStart = getPerfNow();
  const groups = getPresetGroupsWithRecent();
  const structureKey = buildPresetBarStructureKey(groups);

  if (!groups.length) {
    resetPresetBarForEmptyState(perfStart);
    return;
  }
  dom.presetSection?.classList.remove('component-hidden');

  if (presetBarStructureKey === structureKey) {
    finalizePresetBarRender(perfStart, groups, 'patch');
    return;
  }

  rebuildPresetBar(groups, structureKey);
  finalizePresetBarRender(perfStart, groups, 'rebuild');
}

function renderNegativeBar() {
  const perfStart = getPerfNow();
  const presets = state.config.negativePresets || [];
  const structureKey = buildNegativeBarStructureKey(presets);
  if (!presets.length) {
    dom.negativeSection?.classList.add('component-hidden');
    dom.negativeBar.innerHTML = '';
    negativeBarStructureKey = '';
    logPerfMetric('renderNegativeBar(empty)', perfStart);
    return;
  }
  dom.negativeSection?.classList.remove('component-hidden');

  if (negativeBarStructureKey === structureKey) {
    patchNegativeBarActiveState();
    logPerfMetric('renderNegativeBar(patch)', perfStart, `count=${presets.length}`);
    updateClearNegativesButton();
    return;
  }

  dom.negativeBar.innerHTML = '';
  negativeBarStructureKey = structureKey;

  presets.forEach((preset) => {
    const pill = document.createElement('div');
    pill.className = 'pill negative';
    if (state.activeNegativePresets.has(preset)) pill.classList.add('active');
    pill.textContent = preset;
    pill.dataset.preset = preset;
    pill.tabIndex = 0;
    dom.negativeBar.appendChild(pill);
  });

  patchNegativeBarActiveState();
  logPerfMetric('renderNegativeBar(rebuild)', perfStart, `count=${presets.length}`);

  updateClearNegativesButton();
}

function renderTypeBar() {
  const perfStart = getPerfNow();
  const filters = state.config.typeFilters || [];
  const structureKey = buildTypeBarStructureKey(filters);
  if (!filters.length) {
    dom.typeSection?.classList.add('component-hidden');
    dom.typeBar.innerHTML = '';
    typeBarStructureKey = '';
    logPerfMetric('renderTypeBar(empty)', perfStart);
    return;
  }
  dom.typeSection?.classList.remove('component-hidden');

  if (typeBarStructureKey !== structureKey) {
    dom.typeBar.innerHTML = '';
    typeBarStructureKey = structureKey;

    filters.forEach((filter) => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      if (filter.key === state.currentTypeKey) pill.classList.add('active');
      pill.textContent = filter.label || filter.key;
      pill.dataset.key = filter.key;
      pill.tabIndex = 0;
      dom.typeBar.appendChild(pill);
    });

    logPerfMetric('renderTypeBar(rebuild)', perfStart, `count=${filters.length}`);
  } else {
    patchTypeBarActiveState();
    logPerfMetric('renderTypeBar(patch)', perfStart, `count=${filters.length}`);
  }

  patchTypeBarActiveState();

  renderClassificationBar();
}

function refreshClassificationOptions() {
  // 使用固定的子类型列表，不再动态生成
  state.classificationOptions = DEFAULT_CLASSIFICATION_SUBTYPES.slice();

  // 验证当前选择是否有效
  if (
    state.currentClassificationSubtype !== 'all' &&
    !state.classificationOptions.includes(state.currentClassificationSubtype)
  ) {
    state.currentClassificationSubtype = 'all';
  }
  renderClassificationBar();
}

function shouldShowClassificationFilter() {
  if (!dom.classificationSection || !state.classificationOptions.length) return false;
  const preset = getCurrentTypePreset();
  const types = preset.types;
  return Array.isArray(types) && types.includes('归类');
}

function applyClassificationBarPositioning(visible) {
  if (document.body.classList.contains('filters-collapsed')) return;
  if (!visible) {
    document.documentElement.style.setProperty('--negative-top', 'calc(var(--topbar-height) + var(--toolbar-gap))');
    document.documentElement.style.setProperty('--preset-top', 'calc(var(--topbar-height) + var(--toolbar-gap) * 2)');
    document.documentElement.style.setProperty('--main-padding-top', 'calc(var(--topbar-height) + var(--toolbar-gap) + var(--negative-height) + var(--preset-max-height) + var(--spacing-buffer))');
    return;
  }
  document.documentElement.style.setProperty('--negative-top', 'calc(var(--topbar-height) + var(--toolbar-gap) * 2)');
  document.documentElement.style.setProperty('--preset-top', 'calc(var(--topbar-height) + var(--toolbar-gap) * 3)');
  document.documentElement.style.setProperty('--main-padding-top', 'calc(var(--topbar-height) + var(--toolbar-gap) * 2 + var(--negative-height) + var(--preset-max-height) + var(--spacing-buffer))');
}

function hideClassificationBar(perfStart) {
  dom.classificationSection.classList.add('component-hidden');
  dom.classificationBar.innerHTML = '';
  classificationBarStructureKey = 'hidden';
  state.currentClassificationSubtype = 'all';
  applyClassificationBarPositioning(false);
  updateMainPaddingTop();
  logPerfMetric('renderClassificationBar(hidden)', perfStart);
}

function createClassificationPill(option) {
  const pill = document.createElement('div');
  pill.className = 'pill';
  const isAll = option === 'all';
  const value = isAll ? 'all' : option;
  syncFilterPillSelection(pill, state.currentClassificationSubtype === value);
  pill.textContent = isAll ? '全部子类型' : option;
  pill.dataset.subtype = value;
  pill.tabIndex = 0;
  return pill;
}

function rebuildClassificationBar(options, structureKey) {
  dom.classificationBar.innerHTML = '';
  classificationBarStructureKey = structureKey;
  const fragment = document.createDocumentFragment();
  options.forEach((option) => {
    fragment.appendChild(createClassificationPill(option));
  });
  dom.classificationBar.appendChild(fragment);
}

function renderClassificationBar() {
  const perfStart = getPerfNow();
  if (!dom.classificationBar || !dom.classificationSection) return;
  if (!shouldShowClassificationFilter()) {
    hideClassificationBar(perfStart);
    return;
  }

  dom.classificationSection.classList.remove('component-hidden');
  const options = ['all', ...state.classificationOptions];
  const structureKey = buildClassificationBarStructureKey(state.classificationOptions, true);
  applyClassificationBarPositioning(true);

  if (classificationBarStructureKey !== structureKey) {
    rebuildClassificationBar(options, structureKey);
    logPerfMetric('renderClassificationBar(rebuild)', perfStart, `count=${options.length}`);
  } else {
    patchClassificationBarActiveState();
    logPerfMetric('renderClassificationBar(patch)', perfStart, `count=${options.length}`);
  }

  patchClassificationBarActiveState();
  updateMainPaddingTop();
}
