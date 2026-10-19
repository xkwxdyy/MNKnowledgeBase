'use strict';

var SEARCH_HISTORY_STORAGE_KEY = 'mnkb_search_history';
var SEARCH_HISTORY_MAX_PER_TYPE = 3;
var restoringSearchHistoryFocus = false;

function loadSearchHistory() {
  if (!window.state) {
    window.__MNKB_pendingSearchHistory = true;
    return;
  }
  var history = { normal: [], ai: [] };
  try {
    var stored = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (stored) {
      var parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.normal)) history.normal = parsed.normal.slice(0, SEARCH_HISTORY_MAX_PER_TYPE);
        if (Array.isArray(parsed.ai)) history.ai = parsed.ai.slice(0, SEARCH_HISTORY_MAX_PER_TYPE);
      }
    }
  } catch (error) {
    console.warn('加载搜索历史失败，将使用空列表', error);
  }
  state.searchHistory = history;
}

function persistSearchHistory() {
  try {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(state.searchHistory));
  } catch (error) {
    console.warn('保存搜索历史失败', error);
  }
}

function saveSearchHistory(type, query, resultCount, localSearchRoot) {
  var trimmed = String(query || '').trim();
  if (!trimmed) return;

  if (!state.searchHistory) {
    state.searchHistory = { normal: [], ai: [] };
  }

  var entry = {
    query: trimmed,
    timestamp: Date.now(),
    resultCount: typeof resultCount === 'number' ? resultCount : undefined,
  };

  if (localSearchRoot && localSearchRoot.rootId) {
    entry.localSearchRoot = {
      rootId: String(localSearchRoot.rootId),
      rootTitle: String(localSearchRoot.rootTitle || '').trim() || '未命名卡片',
    };
  }

  var list = state.searchHistory[type] || [];
  // 去重：同 query + 同 localSearchRoot 的旧条目删除
  var filtered = list.filter(function(existing) {
    if (String(existing.query || '').trim().toLowerCase() !== trimmed.toLowerCase()) return true;
    var oldRoot = existing.localSearchRoot;
    var newRoot = entry.localSearchRoot;
    if (!oldRoot && !newRoot) return false; // 同 query + 都是全局搜索 → 重复
    if (oldRoot && newRoot && oldRoot.rootId === newRoot.rootId) return false; // 同 query + 同根卡片 → 重复
    return true;
  });
  filtered.unshift(entry);
  state.searchHistory[type] = filtered.slice(0, SEARCH_HISTORY_MAX_PER_TYPE);
  persistSearchHistory();
}

function getLastSavedNormalQuery() {
  var list = state.searchHistory && state.searchHistory.normal;
  if (!list || list.length === 0) return '';
  return String(list[0].query || '').trim();
}

function getLastSavedNormalRootId() {
  var list = state.searchHistory && state.searchHistory.normal;
  if (!list || list.length === 0) return null;
  var root = list[0].localSearchRoot;
  return root && root.rootId ? root.rootId : null;
}

function isSameAsLastSavedNormalEntry(query) {
  var lastQuery = getLastSavedNormalQuery();
  if (!lastQuery) return false;
  if (String(query || '').trim().toLowerCase() !== lastQuery.toLowerCase()) return false;

  var lastRootId = getLastSavedNormalRootId();
  var currentRootId = state.localSearchRootId || null;
  return lastRootId === currentRootId;
}

function getRelativeTimeText(timestamp) {
  var now = Date.now();
  var diff = now - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  var d = new Date(timestamp);
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return month + '-' + day;
}

function buildHistoryDropdownItem(type, entry, index) {
  var isLocal = !!(entry.localSearchRoot && entry.localSearchRoot.rootId);

  var item = document.createElement('div');
  item.className = 'search-history-item';
  item.setAttribute('data-type', type);
  item.setAttribute('data-index', String(index));

  var selectBtn = document.createElement('button');
  selectBtn.className = 'search-history-item__select';
  selectBtn.type = 'button';

  var icon = document.createElement('span');
  icon.className = 'search-history-item__icon';
  if (type === 'ai') {
    icon.textContent = '\uD83E\uDD16';
  } else if (isLocal) {
    icon.textContent = '\uD83D\uDCCD';
  } else {
    icon.textContent = '\uD83D\uDD0D';
  }

  var content = document.createElement('span');
  content.className = 'search-history-item__content';

  var querySpan = document.createElement('span');
  querySpan.className = 'search-history-item__query';
  querySpan.textContent = entry.query;

  var metaSpan = document.createElement('span');
  metaSpan.className = 'search-history-item__meta';
  var metaParts = [];
  if (type === 'ai') {
    metaParts.push('AI');
  } else if (isLocal) {
    var rootTitle = entry.localSearchRoot.rootTitle;
    metaParts.push('\u5C40\u90E8 \u00B7 ' + (rootTitle.length > 12 ? rootTitle.slice(0, 12) + '\u2026' : rootTitle));
  } else {
    metaParts.push('\u666E\u901A');
  }
  metaParts.push(getRelativeTimeText(entry.timestamp));
  if (typeof entry.resultCount === 'number') {
    metaParts.push(entry.resultCount + ' \u6761\u7ED3\u679C');
  }
  metaSpan.textContent = metaParts.join(' \u00B7 ');

  content.appendChild(querySpan);
  content.appendChild(metaSpan);

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'search-history-item__delete';
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', '\u5220\u9664\u8FD9\u6761\u5386\u53F2');
  deleteBtn.textContent = '\u2715';
  deleteBtn.addEventListener('click', function(event) {
    event.stopPropagation();
    var restoreFocus = item.contains(document.activeElement);
    deleteSearchHistoryItem(type, index);
    if (restoreFocus) {
      var nextDelete = dom.searchHistoryDropdown.querySelector('.search-history-item__delete');
      if (nextDelete) nextDelete.focus();
      else restoreSearchHistoryInputFocus();
    }
  });

  selectBtn.appendChild(icon);
  selectBtn.appendChild(content);
  item.appendChild(selectBtn);
  item.appendChild(deleteBtn);

  selectBtn.addEventListener('click', function() {
    executeSearchHistoryItem(type, entry);
  });

  return item;
}

function renderSearchHistoryDropdown() {
  if (!dom.searchHistoryDropdown) return;

  var history = state.searchHistory || { normal: [], ai: [] };
  var hasNormal = history.normal && history.normal.length > 0;
  var hasAI = history.ai && history.ai.length > 0;

  if (!hasNormal && !hasAI) {
    hideSearchHistoryDropdown();
    dom.searchHistoryDropdown.textContent = '';
    return;
  }

  var fragment = document.createDocumentFragment();

  if (hasNormal) {
    var normalHeader = document.createElement('div');
    normalHeader.className = 'search-history-section-header';
    normalHeader.textContent = '\uD83D\uDD0D \u6700\u8FD1\u641C\u7D22';
    fragment.appendChild(normalHeader);

    history.normal.forEach(function(entry, index) {
      fragment.appendChild(buildHistoryDropdownItem('normal', entry, index));
    });
  }

  if (hasAI) {
    if (hasNormal) {
      var divider = document.createElement('div');
      divider.className = 'search-history-divider';
      fragment.appendChild(divider);
    }

    var aiHeader = document.createElement('div');
    aiHeader.className = 'search-history-section-header';
    aiHeader.textContent = '\uD83E\uDD16 AI \u627E\u5361\u7247';
    fragment.appendChild(aiHeader);

    history.ai.forEach(function(entry, index) {
      fragment.appendChild(buildHistoryDropdownItem('ai', entry, index));
    });
  }

  dom.searchHistoryDropdown.textContent = '';
  dom.searchHistoryDropdown.appendChild(fragment);
  dom.searchHistoryDropdown.hidden = false;
  dom.searchInput?.setAttribute('aria-expanded', 'true');
}

function showSearchHistoryDropdown() {
  if (!dom.searchHistoryDropdown) return;
  var history = state.searchHistory || { normal: [], ai: [] };
  var hasAny = (history.normal && history.normal.length > 0)
    || (history.ai && history.ai.length > 0);
  if (!hasAny) {
    hideSearchHistoryDropdown();
    return;
  }
  renderSearchHistoryDropdown();
}

function hideSearchHistoryDropdown() {
  if (dom.searchHistoryDropdown) {
    dom.searchHistoryDropdown.hidden = true;
  }
  dom.searchInput?.setAttribute('aria-expanded', 'false');
}

function restoreSearchHistoryInputFocus() {
  restoringSearchHistoryFocus = true;
  try {
    dom.searchInput?.focus({ preventScroll: true });
  } finally {
    restoringSearchHistoryFocus = false;
  }
}

function focusSearchHistoryItem(index) {
  var buttons = dom.searchHistoryDropdown?.querySelectorAll('.search-history-item__select');
  if (!buttons || !buttons.length) return false;
  var button = buttons[(index + buttons.length) % buttons.length];
  button.focus({ preventScroll: true });
  button.scrollIntoView({ block: 'nearest' });
  return true;
}

function handleSearchHistoryKeydown(event) {
  if (event.isComposing || event.keyCode === 229 || !dom.searchHistoryDropdown || dom.searchHistoryDropdown.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hideSearchHistoryDropdown();
    restoreSearchHistoryInputFocus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  var buttons = Array.from(dom.searchHistoryDropdown.querySelectorAll('.search-history-item__select'));
  var row = event.target.closest('.search-history-item');
  var current = buttons.indexOf(row?.querySelector('.search-history-item__select'));
  var next = current + (event.key === 'ArrowDown' ? 1 : -1);
  if (focusSearchHistoryItem(next)) event.preventDefault();
}

function deleteSearchHistoryItem(type, index) {
  var list = state.searchHistory && state.searchHistory[type];
  if (!list || index < 0 || index >= list.length) return;
  list.splice(index, 1);
  persistSearchHistory();
  renderSearchHistoryDropdown();

  var history = state.searchHistory || { normal: [], ai: [] };
  if ((!history.normal || history.normal.length === 0)
    && (!history.ai || history.ai.length === 0)) {
    hideSearchHistoryDropdown();
  }
}

function executeSearchHistoryItem(type, entry) {
  if (type === 'ai') {
    if (typeof deactivateAICardSearch === 'function') deactivateAICardSearch();
    if (dom.searchInput) {
      dom.searchInput.value = entry.query;
      state.userInput = entry.query;
    }
    hideSearchHistoryDropdown();
    if (typeof handleAICardSearchClick === 'function') {
      handleAICardSearchClick();
    }
    return;
  }

  // 普通搜索（含局部搜索）
  if (dom.searchInput) {
    dom.searchInput.value = entry.query;
  }
  state.userInput = entry.query;
  hideSearchHistoryDropdown();

  var localRoot = entry.localSearchRoot;
  if (localRoot && localRoot.rootId) {
    // 先退出当前局部搜索（如果有的话），再激活新的
    if (state.localSearchRootId) {
      if (typeof deactivateLocalSearch === 'function') {
        deactivateLocalSearch();
      } else {
        state.localSearchRootId = null;
        state.localSearchRootTitle = '';
        state.localSearchDescendantIds = new Set();
        state.localSearchLoading = false;
      }
    }
    // 激活局部搜索：设置状态 + 请求子孙 ID。
    // Native 返回后代 ID 后会自动触发 scheduleSearch，届时 query 已在 state.userInput 中。
    if (typeof activateLocalSearch === 'function') {
      activateLocalSearch(localRoot.rootId, localRoot.rootTitle);
    } else {
      // 降级：只填 query，不做局部限定
      bumpSearchExecutionRevision('searchHistory');
      scheduleSearch({ triggerNative: true });
    }
  } else {
    // 全局搜索：如果是局部搜索状态下点击全局历史，先退出局部搜索
    if (state.localSearchRootId) {
      if (typeof deactivateLocalSearch === 'function') {
        deactivateLocalSearch();
      } else {
        state.localSearchRootId = null;
        state.localSearchRootTitle = '';
        state.localSearchDescendantIds = new Set();
        state.localSearchLoading = false;
        if (typeof renderLocalSearchBanner === 'function') {
          renderLocalSearchBanner();
        }
      }
    }
    bumpSearchExecutionRevision('searchHistory');
    scheduleSearch({ triggerNative: true });
  }

  focusSearchInput({ bypassSuppression: true });
}

function trySaveNormalSearchHistory() {
  var query = dom.searchInput ? String(dom.searchInput.value || '').trim() : '';
  if (!query) return;
  if (isSameAsLastSavedNormalEntry(query)) return;

  var resultCount = Array.isArray(state.filteredCards) ? state.filteredCards.length : 0;
  var localRoot = null;
  if (state.localSearchRootId) {
    localRoot = {
      rootId: state.localSearchRootId,
      rootTitle: state.localSearchRootTitle,
    };
  }
  saveSearchHistory('normal', query, resultCount, localRoot);
}

function handleSearchInputKeydown(event) {
  // 输入法的确认键不能被历史导航接管。
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape' && dom.searchHistoryDropdown && !dom.searchHistoryDropdown.hidden) {
    handleSearchHistoryKeydown(event);
    return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !dom.searchInput.value.trim()) {
    showSearchHistoryDropdown();
    if (focusSearchHistoryItem(event.key === 'ArrowDown' ? 0 : -1)) event.preventDefault();
    return;
  }
  if (event.key === 'Enter') {
    trySaveNormalSearchHistory();
  }
}

function handleSearchInputBlur(event) {
  trySaveNormalSearchHistory();
}

function handleSearchHistoryInputFocus() {
  if (restoringSearchHistoryFocus) return;
  var inputValue = dom.searchInput ? String(dom.searchInput.value || '').trim() : '';
  if (inputValue === '') {
    showSearchHistoryDropdown();
  } else {
    hideSearchHistoryDropdown();
  }
}

function handleSearchHistoryInputChange() {
  var inputValue = dom.searchInput ? String(dom.searchInput.value || '') : '';
  if (inputValue.trim() === '') {
    showSearchHistoryDropdown();
  } else {
    hideSearchHistoryDropdown();
  }
}

function handleSearchHistoryOutsideClick(event) {
  if (!dom.searchHistoryDropdown || dom.searchHistoryDropdown.hidden) return;
  var target = event.target;
  if (!target) return;
  if (dom.searchHistoryDropdown.contains(target)) return;
  if (dom.searchInput && dom.searchInput.contains(target)) return;
  hideSearchHistoryDropdown();
}

function attachSearchHistoryListeners() {
  if (dom.searchInput) {
    dom.searchInput.addEventListener('keydown', handleSearchInputKeydown);
    dom.searchInput.addEventListener('blur', handleSearchInputBlur);
    dom.searchInput.addEventListener('focus', handleSearchHistoryInputFocus);
    dom.searchInput.addEventListener('input', handleSearchHistoryInputChange);
  }
  dom.searchHistoryDropdown?.addEventListener('keydown', handleSearchHistoryKeydown);
  document.addEventListener('click', handleSearchHistoryOutsideClick, { capture: true });
  document.addEventListener('focusin', handleSearchHistoryOutsideClick);
}

window.saveSearchHistory = saveSearchHistory;
window.loadSearchHistory = loadSearchHistory;
window.showSearchHistoryDropdown = showSearchHistoryDropdown;
window.hideSearchHistoryDropdown = hideSearchHistoryDropdown;
window.renderSearchHistoryDropdown = renderSearchHistoryDropdown;
window.attachSearchHistoryListeners = attachSearchHistoryListeners;
