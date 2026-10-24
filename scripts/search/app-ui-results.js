'use strict';

function initIntersectionObserver(sentinel) {
  if (!window.IntersectionObserver) return;
  
  if (resultsIntersectionObserver) {
    resultsIntersectionObserver.disconnect();
    resultsIntersectionObserver = null;
  }
  
  resultsIntersectionObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.hasMore && !state.isLoadingMore && !state.isRenderingResults) {
      loadMore();
    }
  }, {
    root: dom.container,
    rootMargin: '200px'
  });
  
  resultsIntersectionObserver.observe(sentinel);
}

function initResultWindowTopObserver(sentinel) {
  if (!window.IntersectionObserver || !sentinel) return;

  if (resultsTopIntersectionObserver) {
    resultsTopIntersectionObserver.disconnect();
    resultsTopIntersectionObserver = null;
  }

  resultsTopIntersectionObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !state.isLoadingMore && !state.isRenderingResults) {
      restorePreviousResultWindowSegment();
    }
  }, {
    root: dom.container,
    rootMargin: '200px',
  });

  resultsTopIntersectionObserver.observe(sentinel);
}

function resetResultWindowDomNodes() {
  if (resultsIntersectionObserver) {
    resultsIntersectionObserver.disconnect();
    resultsIntersectionObserver = null;
  }
  if (resultsTopIntersectionObserver) {
    resultsTopIntersectionObserver.disconnect();
    resultsTopIntersectionObserver = null;
  }
  resultWindowTopSpacerNode = null;
  resultWindowBottomSpacerNode = null;
  resultWindowTopSentinelNode = null;
  scrollSentinelNode = null;
}

function createResultWindowSpacer(position) {
  const spacer = document.createElement('div');
  spacer.className = `result-window-spacer result-window-spacer--${position}`;
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

function ensureResultWindowTopSpacer() {
  if (!resultWindowTopSpacerNode) {
    resultWindowTopSpacerNode = createResultWindowSpacer('top');
    resultWindowTopSentinelNode = document.createElement('div');
    resultWindowTopSentinelNode.className = 'result-window-edge-sentinel result-window-edge-sentinel--top';
    resultWindowTopSentinelNode.setAttribute('aria-hidden', 'true');
    resultWindowTopSpacerNode.appendChild(resultWindowTopSentinelNode);
  }
  return resultWindowTopSpacerNode;
}

function ensureResultWindowBottomAnchor() {
  if (!resultWindowBottomSpacerNode) {
    resultWindowBottomSpacerNode = createResultWindowSpacer('bottom');
    resultWindowBottomSpacerNode.appendChild(ensureScrollSentinel());
  }
  return resultWindowBottomSpacerNode;
}

function syncResultWindowSpacers() {
  const topSpacer = ensureResultWindowTopSpacer();
  const bottomSpacer = ensureResultWindowBottomAnchor();
  const topHeight = Math.max(0, Number(state.resultWindowTopSpacerHeight) || 0);
  const bottomHeight = Math.max(0, Number(state.resultWindowBottomSpacerHeight) || 0);

  topSpacer.style.display = topHeight > 0 ? 'block' : 'none';
  topSpacer.style.height = `${topHeight}px`;
  bottomSpacer.style.height = `${Math.max(1, bottomHeight)}px`;
  bottomSpacer.classList.toggle('has-window-gap', bottomHeight > 0);
}

function getRenderedResultCardNodes() {
  return Array.from(dom.results.children).filter((node) => node.classList?.contains('card'));
}

function getRenderedResultColumnCount(cardNodes) {
  if (!Array.isArray(cardNodes) || cardNodes.length === 0) return 1;
  const firstTop = cardNodes[0].offsetTop;
  let count = 0;
  for (const node of cardNodes) {
    if (Math.abs(node.offsetTop - firstTop) > 1) break;
    count += 1;
  }
  return Math.max(1, count);
}

function measureResultCardRangeHeight(cardNodes) {
  if (!Array.isArray(cardNodes) || cardNodes.length === 0) return 0;
  const firstRect = cardNodes[0].getBoundingClientRect();
  const lastRect = cardNodes[cardNodes.length - 1].getBoundingClientRect();
  return Math.max(1, lastRect.bottom - firstRect.top);
}

function getResultGridRowGap() {
  if (!dom.results || typeof window.getComputedStyle !== 'function') return 0;
  const styles = window.getComputedStyle(dom.results);
  return Math.max(0, parseFloat(styles.rowGap || styles.gap) || 0);
}

function detachRenderedResultCard(element) {
  if (!element) return;
  const cardId = normalizeCardId(element.dataset?.id);
  if (cardId) {
    renderedCardElementLookup.delete(cardId);
    renderedCardSignatureLookup.delete(cardId);
  }
  if (selectedCardElement === element) {
    selectedCardElement = null;
  }
  element.remove();
}

function calculateResultWindowTrimCount(cardNodes) {
  const target = getResultWindowTargetCards();
  const excess = Math.max(0, cardNodes.length - target);
  if (excess === 0) return 0;
  const columns = getRenderedResultColumnCount(cardNodes);
  return Math.min(
    cardNodes.length - INITIAL_PAGE_SIZE,
    Math.ceil(excess / columns) * columns,
  );
}

function trimResultWindowTop(cardNodes, trimCount) {
  const removedNodes = cardNodes.slice(0, trimCount);
  if (removedNodes.length === 0) return;
  const priorSegmentGap = state.resultWindowTopSegments.length > 0
    ? getResultGridRowGap()
    : 0;
  const height = measureResultCardRangeHeight(removedNodes) + priorSegmentGap;
  const start = state.resultWindowStart;
  const end = start + removedNodes.length;

  state.resultWindowTopSegments.push({ start, end, height });
  state.resultWindowTopSpacerHeight += height;
  state.resultWindowStart = end;
  removedNodes.forEach(detachRenderedResultCard);
}

function trimResultWindowBottom(cardNodes, trimCount) {
  const removedNodes = cardNodes.slice(cardNodes.length - trimCount);
  if (removedNodes.length === 0) return;
  const height = measureResultCardRangeHeight(removedNodes) + getResultGridRowGap();
  const end = state.resultWindowEnd;
  const start = end - removedNodes.length;

  state.resultWindowBottomSegments.unshift({ start, end, height });
  state.resultWindowBottomSpacerHeight += height;
  state.resultWindowEnd = start;
  removedNodes.forEach(detachRenderedResultCard);
}

function enforceResultWindowLimit(preferredEdge = 'bottom') {
  if (!shouldUseResultWindowing()) {
    syncResultWindowSpacers();
    return false;
  }

  const cardNodes = getRenderedResultCardNodes();
  if (cardNodes.length <= getResultWindowMaxCards()) {
    syncResultWindowSpacers();
    return false;
  }

  const trimCount = calculateResultWindowTrimCount(cardNodes);
  if (trimCount <= 0) return false;
  if (preferredEdge === 'top') {
    trimResultWindowBottom(cardNodes, trimCount);
  } else {
    trimResultWindowTop(cardNodes, trimCount);
  }
  syncResultWindowSpacers();
  return true;
}

function appendCardsToFragment(fragment, cards) {
  (cards || []).forEach((card) => {
    appendRenderedCard(fragment, card);
  });
}

function restorePreviousResultWindowSegment() {
  if (!shouldUseResultWindowing() || state.isLoadingMore || state.isRenderingResults) return false;
  const segment = state.resultWindowTopSegments.pop();
  if (!segment) return false;

  const cards = state.displayedCards.slice(segment.start, segment.end);
  if (cards.length === 0) return false;

  state.isLoadingMore = true;
  state.isRenderingResults = true;
  const previousScrollHeight = dom.container.scrollHeight;
  const previousScrollTop = dom.container.scrollTop;
  const fragment = document.createDocumentFragment();
  appendCardsToFragment(fragment, cards);

  state.resultWindowTopSpacerHeight = Math.max(0, state.resultWindowTopSpacerHeight - segment.height);
  state.resultWindowStart = segment.start;
  const firstCard = getRenderedResultCardNodes()[0] || ensureResultWindowBottomAnchor();
  dom.results.insertBefore(fragment, firstCard);
  enforceResultWindowLimit('top');
  state.isRenderingResults = false;
  state.isLoadingMore = false;

  const heightDelta = dom.container.scrollHeight - previousScrollHeight;
  dom.container.scrollTop = Math.max(0, previousScrollTop + heightDelta);
  updateLoadMoreButton();
  return true;
}

function restoreNextResultWindowSegment() {
  if (!shouldUseResultWindowing() || state.isLoadingMore || state.isRenderingResults) return false;
  const segment = state.resultWindowBottomSegments.shift();
  if (!segment) return false;

  const cards = state.displayedCards.slice(segment.start, segment.end);
  if (cards.length === 0) return false;

  state.resultWindowBottomSpacerHeight = Math.max(0, state.resultWindowBottomSpacerHeight - segment.height);
  syncResultWindowSpacers();
  state.isLoadingMore = true;
  appendCards(cards, {
    onComplete: () => {
      state.isLoadingMore = false;
      updateLoadMoreButton();
    },
  });
  return true;
}

function createResultRenderContext(items, perfStart) {
  const totalCount = Array.isArray(items) ? items.length : 0;
  return {
    items: Array.isArray(items) ? items : [],
    perfStart,
    previousElementLookup: renderedCardElementLookup,
    previousSignatureLookup: renderedCardSignatureLookup,
    nextElementLookup: new Map(),
    nextSignatureLookup: new Map(),
    selectedId: normalizeCardId(state.selectedCardId),
    totalCount,
    renderToken: ++activeResultRenderToken,
    useChunkedRender: shouldUseChunkedResultRender(totalCount),
    chunkSize: Math.max(1, getRenderChunkSize()),
    reusedCount: 0,
    createdCount: 0,
    cursor: 0,
  };
}

function resetResultRenderState(context) {
  dom.results.innerHTML = '';
  resetResultWindowDomNodes();
  renderedCardElementLookup = context.nextElementLookup;
  renderedCardSignatureLookup = context.nextSignatureLookup;
  selectedCardElement = null;
  dom.results.appendChild(ensureResultWindowTopSpacer());
  syncResultWindowSpacers();
}

function updateRenderedCardSelection(element, card, cardId, selectedId) {
  const isSelected = !!(selectedId && cardId && selectedId === cardId);
  if (isSelected) {
    element.classList.add('selected');
  } else {
    element.classList.remove('selected');
  }
  setCardActionsVisible(element, isSelected, card);
}

function resolveRenderedCardElement(card, context) {
  const cardId = normalizeCardId(card && card.id);
  const signature = buildCardRenderSignature(card);
  let element = null;

  if (cardId) {
    const previousElement = context.previousElementLookup.get(cardId);
    const previousSignature = context.previousSignatureLookup.get(cardId);
    if (previousElement && previousSignature === signature) {
      element = previousElement;
      context.reusedCount += 1;
    }
  }

  if (!element) {
    element = createCardElement(card);
    context.createdCount += 1;
  }

  updateRenderedCardSelection(element, card, cardId, context.selectedId);

  if (cardId) {
    context.nextElementLookup.set(cardId, element);
    context.nextSignatureLookup.set(cardId, signature);
  }

  return element;
}

function finalizeResultRender(context) {
  if (context.renderToken !== activeResultRenderToken) return;

  pendingResultRenderHandle = null;
  state.isRenderingResults = false;
  const sentinel = ensureScrollSentinel();
  const bottomAnchor = ensureResultWindowBottomAnchor();
  if (bottomAnchor.parentNode !== dom.results) {
    dom.results.appendChild(bottomAnchor);
  }
  syncResultWindowSpacers();
  initIntersectionObserver(sentinel);
  initResultWindowTopObserver(resultWindowTopSentinelNode);

  if (context.selectedId) {
    setSelectedCardElement(getRenderedCardElementById(context.selectedId));
  }

  updateSearchCount(context.totalCount);
  updateSelectionInfo();
  updateActionButtonsState();
  logPerfMetric(
    'renderResults',
    context.perfStart,
    `count=${context.totalCount} reused=${context.reusedCount} created=${context.createdCount} chunk=${context.useChunkedRender ? 'on' : 'off'}`,
  );
  if (typeof window.mnkbStartupPerfMark === 'function' && window.__MNKB_STARTUP_FIRST_RENDER_DONE__ !== true) {
    window.__MNKB_STARTUP_FIRST_RENDER_DONE__ = true;
    window.mnkbStartupPerfMark(
      'renderResults(first done)',
      `count=${context.totalCount} reused=${context.reusedCount} created=${context.createdCount} chunk=${context.useChunkedRender ? 'on' : 'off'}`,
    );
  }
}

function renderResultChunk(context) {
  if (context.renderToken !== activeResultRenderToken) return;

  const fragment = document.createDocumentFragment();
  const end = context.useChunkedRender
    ? Math.min(context.cursor + context.chunkSize, context.totalCount)
    : context.totalCount;

  for (let index = context.cursor; index < end; index += 1) {
    fragment.appendChild(resolveRenderedCardElement(context.items[index], context));
  }

  dom.results.appendChild(fragment);
  context.cursor = end;

  if (context.cursor >= context.totalCount) {
    finalizeResultRender(context);
    return;
  }

  pendingResultRenderHandle = queueFilterFrame(() => renderResultChunk(context));
}

function renderResults(items) {
  const perfStart = getPerfNow();
  try {
    cancelPendingResultRenderTask();
    state.isRenderingResults = true;
    updateSearchCount(0, { phase: 'pending' });
    if (typeof window.mnkbStartupPerfMark === 'function' && window.__MNKB_STARTUP_FIRST_RENDER_STARTED__ !== true) {
      window.__MNKB_STARTUP_FIRST_RENDER_STARTED__ = true;
      window.mnkbStartupPerfMark('renderResults(first start)', `count=${Array.isArray(items) ? items.length : 0}`);
    }

    const context = createResultRenderContext(items, perfStart);
    resetResultRenderState(context);
    renderResultChunk(context);
  } catch (error) {
    state.isRenderingResults = false;
    console.error('渲染结果失败:', error);
    updateSearchCount(0, { phase: 'error' });
    showToast('渲染失败，请刷新页面');
    logPerfMetric('renderResults(error)', perfStart);
  }
}

const CARD_ACTIONS_BASE = Object.freeze([
  { icon: '📍', title: '在主脑图定位（长按：浮窗定位）', action: 'focus-mindmap' },
  { icon: '📄', title: '在文档中定位第一条摘录', action: 'focus-doc' },
  { icon: '🔄', title: '重新解析并更新索引', action: 'refresh-search-index' },
  { icon: '🔗', title: '双向链接（二次点击确认）', action: 'bi-link' },
  { lines: ['行内', '链接'], title: '复制行内链接', action: 'copy-link', isText: true },
  { lines: ['复制', 'URL'], title: '复制卡片 URL', action: 'copy-url', isText: true },
  { icon: '📌', title: 'Pin 住卡片', action: 'pin-card' },
  { icon: '🌐', title: '以此卡为根，局部搜索子孙卡片', action: 'local-search' },
]);

const CARD_ACTIONS_WITH_TEMPLATE = Object.freeze([
  { lines: ['增加', '模板'], title: '增加模板', action: 'add-template', isText: true },
  ...CARD_ACTIONS_BASE,
]);

function getCardActions(card) {
  if (card && card.type === '归类') {
    return CARD_ACTIONS_WITH_TEMPLATE;
  }
  return CARD_ACTIONS_BASE;
}

function appendInlineTextLines(element, lines) {
  if (!element || !Array.isArray(lines) || !lines.length) return;
  lines.forEach((line, index) => {
    if (index > 0) {
      element.appendChild(document.createElement('br'));
    }
    element.appendChild(document.createTextNode(line));
  });
}

function sanitizeMarkedHtmlNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  if (node.tagName !== 'MARK' || node.className !== 'matched') {
    return null;
  }

  const mark = document.createElement('mark');
  mark.className = 'matched';
  Array.from(node.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeMarkedHtmlNode(child);
    if (sanitizedChild) {
      mark.appendChild(sanitizedChild);
    }
  });
  return mark;
}

function buildSanitizedMarkedFragment(trustedHtml) {
  const template = document.createElement('template');
  template.innerHTML = trustedHtml;

  const fragment = document.createDocumentFragment();
  let isValid = true;
  Array.from(template.content.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeMarkedHtmlNode(child);
    if (sanitizedChild) {
      fragment.appendChild(sanitizedChild);
    } else {
      isValid = false;
    }
  });

  return { fragment, isValid };
}

function applyTrustedMarkedText(element, trustedHtml, fallbackText = '') {
  if (!element) return;

  const html = typeof trustedHtml === 'string' ? trustedHtml : '';
  if (!html) {
    element.textContent = fallbackText;
    return;
  }

  const { fragment, isValid } = buildSanitizedMarkedFragment(html);

  element.textContent = '';
  if (!isValid || !fragment.childNodes.length) {
    element.textContent = fallbackText;
    return;
  }

  element.appendChild(fragment);
}

function setCardTitleContent(element, card) {
  if (!element) return;
  const rawTitle = card && card.title ? String(card.title) : '';
  const highlightTokens = Array.isArray(card?.__mnkbHighlightTokens)
    ? card.__mnkbHighlightTokens
    : [];
  const trustedHtml = highlightTokens.length > 0
    ? highlightTextWithTokens(rawTitle, highlightTokens)
    : (card && typeof card.titleHtml === 'string' ? card.titleHtml : '');

  if (!trustedHtml || trustedHtml === escapeHtml(rawTitle)) {
    element.textContent = rawTitle;
    return;
  }

  applyTrustedMarkedText(element, trustedHtml, rawTitle);
}

function createCardActionIconElement(actionConfig) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `card-action-icon${actionConfig.isText ? ' text-icon' : ''}`;
  if (Array.isArray(actionConfig.lines) && actionConfig.lines.length) {
    appendInlineTextLines(btn, actionConfig.lines);
  } else {
    btn.textContent = actionConfig.icon || '';
  }
  btn.title = actionConfig.title;
  btn.setAttribute('aria-label', actionConfig.title);
  btn.dataset.action = actionConfig.action;
  return btn;
}

function createCardRenderErrorElement() {
  const errorElement = document.createElement('div');
  errorElement.className = 'card';
  errorElement.style.borderLeftColor = '#ff6b6b';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = '⚠️ 卡片渲染失败';
  errorElement.appendChild(title);
  return errorElement;
}

function initializeCardElement(element, card) {
  const normalizedId = normalizeCardId(card && card.id);
  if (normalizedId) {
    element.dataset.id = normalizedId;
  }

  if (state.selectedCardId && normalizedId && state.selectedCardId === normalizedId) {
    element.classList.add('selected');
  }

  const color = resolveTypeColor(card);
  element.style.borderLeftColor = color;
  return color;
}

function createCardActionsContainer(card) {
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'card-actions';
  actionsContainer.setAttribute('role', 'group');
  actionsContainer.setAttribute('aria-label', '选中卡片的操作');
  getCardActions(card).forEach((act) => {
    actionsContainer.appendChild(createCardActionIconElement(act));
  });
  return actionsContainer;
}

function clearCardActionInteractionState() {
  if (typeof clearPendingCardActionIcon === 'function') {
    clearPendingCardActionIcon();
  }
  if (typeof clearLocateLongPress === 'function') {
    clearLocateLongPress();
  }
  if (typeof clearPinLongPress === 'function') {
    clearPinLongPress();
  }
}

function setCardActionsVisible(element, visible, card = null) {
  if (!element) return;
  const selectionButton = element.querySelector('.card-select-btn');
  selectionButton?.setAttribute('aria-pressed', visible ? 'true' : 'false');

  const existing = element.querySelector('.card-actions');
  if (!visible) {
    if (existing) {
      clearCardActionInteractionState();
      existing.remove();
    }
    element.classList.remove('has-card-actions');
    return;
  }

  if (!existing) {
    const resolvedCard = card || getCardById(element.dataset.id);
    if (!resolvedCard) return;
    element.appendChild(createCardActionsContainer(resolvedCard));
  }
  element.classList.add('has-card-actions');
}

function createCardTitleElement(card) {
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'card-title card-select-btn';
  title.disabled = !normalizeCardId(card && card.id);
  setCardTitleContent(title, card);
  if (!title.textContent.trim()) title.textContent = '未命名卡片';
  title.setAttribute('aria-label', `选择卡片：${title.textContent}`);
  return title;
}

function normalizeUntitledCardPreviewText(card) {
  let text = getUntitledCardPreviewSource(card).replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const sourceCard = getCardRenderSource(card);
  const typePrefixes = Array.from(new Set([
    sourceCard?.type,
    card?.type,
    '中间知识',
    '历史卡片',
  ].map((value) => String(value || '').trim()).filter(Boolean)));

  for (const typePrefix of typePrefixes) {
    if (!text.toLowerCase().startsWith(typePrefix.toLowerCase())) continue;
    const remainder = text.slice(typePrefix.length);
    if (!remainder || /^[\s:：\-—|｜]/.test(remainder)) {
      text = remainder.replace(/^[\s:：\-—|｜]+/, '').trim();
      break;
    }
  }
  return text;
}

function createUntitledCardPreviewElement(card) {
  const previewText = normalizeUntitledCardPreviewText(card);
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = `card-snippet card-untitled-preview card-select-btn${previewText ? '' : ' is-empty'}`;
  preview.disabled = !normalizeCardId(card && card.id);
  preview.setAttribute('aria-label', `选择无标题卡片：${previewText || '暂无可显示的文本内容'}`);

  if (!previewText) {
    preview.textContent = '暂无可显示的文本内容';
    return preview;
  }

  const highlightTokens = Array.isArray(card?.__mnkbHighlightTokens)
    ? card.__mnkbHighlightTokens
    : [];
  const snippetTokens = highlightTokens.map((token) => String(token || '').toLowerCase());
  const displayText = typeof extractSnippet === 'function'
    ? extractSnippet(previewText, snippetTokens)
    : (previewText.length > 120 ? `${previewText.slice(0, 120)}…` : previewText);
  const trustedHtml = highlightTokens.length > 0
    ? highlightTextWithTokens(displayText, highlightTokens)
    : '';

  applyTrustedMarkedText(preview, trustedHtml, displayText);
  return preview;
}

function createCardMetaElement(card, color) {
  const intermediate = isUntemplatedCard(card);

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const typeBadge = document.createElement('span');
  typeBadge.className = 'card-type';
  typeBadge.style.background = color;
  typeBadge.textContent = card.type || '未知类型';
  meta.appendChild(typeBadge);

  if (intermediate) {
    const stateBadge = document.createElement('span');
    stateBadge.className = 'intermediate-badge';
    stateBadge.textContent = '中间卡片';
    meta.appendChild(stateBadge);
  }

  if (card.type === '归类' && card.classificationSubtype) {
    const subBadge = document.createElement('span');
    subBadge.className = 'classification-subtype';
    subBadge.textContent = card.classificationSubtype;
    meta.appendChild(subBadge);
  }

  if (card.__mnkbAISearch?.roleLabel) {
    const roleBadge = document.createElement('span');
    roleBadge.className = 'ai-card-role';
    roleBadge.textContent = card.__mnkbAISearch.roleLabel;
    meta.appendChild(roleBadge);
  }

  if (card.__mnkbAISearch?.reason) {
    const reason = document.createElement('span');
    reason.className = 'ai-card-reason';
    reason.textContent = card.__mnkbAISearch.reason;
    reason.title = card.__mnkbAISearch.reason;
    meta.appendChild(reason);
  }

  return meta;
}

// 创建单个卡片元素（优化版：无事件监听，使用事件委托）
function createCardElement(card) {
  try {
    const element = document.createElement('div');
    element.className = 'card';

    const color = initializeCardElement(element, card);
    if (shouldShowUntitledCardPreview(card)) {
      element.appendChild(createUntitledCardPreviewElement(card));
    } else {
      element.appendChild(createCardTitleElement(card));
    }
    const meta = createCardMetaElement(card, color);
    if (meta) {
      element.appendChild(meta);
    }
    const isSelected = normalizeCardId(state.selectedCardId) === normalizeCardId(card && card.id);
    setCardActionsVisible(element, isSelected, card);

    return element;
  } catch (error) {
    console.error('创建卡片元素失败:', error, card);
    return createCardRenderErrorElement();
  }
}

function resolveTypeColor(card) {
  if (card.color && /^#/.test(card.color)) return card.color;
  if (typeof card.colorIndex === 'number' && state.config.colorIndexPalette[card.colorIndex]) {
    return state.config.colorIndexPalette[card.colorIndex];
  }
  if (card.type && state.config.typeColors[card.type]) {
    return state.config.typeColors[card.type];
  }
  return '#d4d9e6';
}

function toggleSelection(cardId, element) {
  const normalizedId = normalizeCardId(cardId);
  if (!normalizedId) return;

  const isMobile = window.innerWidth <= 1024;
  const wasAlreadySelected = (state.selectedCardId === normalizedId);

  if (wasAlreadySelected) {
    // 再次点击已选中卡片
    if (isMobile) {
      // 移动端：展开侧边栏（保持选中状态）
      openSidebar();
      return;
    }
    // 桌面端：取消选中
    state.selectedCardId = null;
    setSelectedCardElement(null);
  } else {
    // 选中新卡片
    state.selectedCardId = normalizedId;
    const targetElement = element || getRenderedCardElementById(normalizedId);
    setSelectedCardElement(targetElement);
  }

  updateSelectionInfo();
  updateActionButtonsState();
  if (state.selectedCardId) {
    collapseFiltersAfterCardSelection();
  }
}

function pruneSelectionForCurrentCards() {
  const selectedId = normalizeCardId(state.selectedCardId);
  if (selectedId && (!state.cardLookup || !state.cardLookup.has(selectedId))) {
    state.selectedCardId = null;
    setSelectedCardElement(null);
    updateSelectionInfo();
    updateActionButtonsState();
  }
}

function clearSelection() {
  if (!state.selectedCardId) return;
  state.selectedCardId = null;
  setSelectedCardElement(null);
  updateSelectionInfo();
  updateActionButtonsState();
}

let searchResultFeedbackError = false;

function updateSearchCount(count, options = {}) {
  if (options.phase === 'pending' || options.phase === 'ready') searchResultFeedbackError = false;
  if (options.phase === 'error') searchResultFeedbackError = true;
  const failed = searchResultFeedbackError;
  const pending = !failed && (options.phase === 'pending' || state.isFilteringResults || state.isRenderingResults);
  const total = Array.isArray(state.filteredCards) ? state.filteredCards.length : count;
  const waiting = !state.hasRealData && state.cards.length === 0;
  dom.searchCount.textContent = pending ? '正在搜索…'
    : failed ? '搜索未完成'
    : waiting ? '等待数据'
    : state.aiCardSearch?.active ? `${total} 张相关卡片` : `${total} 条结果`;
  dom.searchCount.title = pending || failed || waiting ? '' : `共 ${total} 条结果，已加载 ${Math.min(count, total)} 条`;
  dom.results?.setAttribute('aria-busy', pending ? 'true' : 'false');
  if (dom.loadMoreBtn) dom.loadMoreBtn.disabled = pending || !!state.isLoadingMore;
  updateSearchEmptyState({ pending, failed, waiting, total });
}

function updateSearchEmptyState({ pending, failed, waiting, total }) {
  const panel = document.getElementById('searchEmptyState');
  if (!panel) return;
  // 智能检索已有独立的加载、错误与空结果反馈，避免出现两套状态。
  panel.hidden = pending || !!state.aiCardSearch?.active || (!failed && total > 0);
  if (panel.hidden) return;
  const hasFilters = getActiveFilterCount() > 0;
  const hasQuery = !!state.userInput;
  const hasCards = state.cards.length > 0;
  const local = !!state.localSearchRootId;
  const sourceLimited = !local && Array.isArray(state.searchSources) && !state.searchSources.includes('all');
  const noSources = sourceLimited && state.searchSources.length === 0;
  const title = failed ? '这次搜索未完成'
    : waiting ? '等待知识库数据'
    : !hasCards ? '当前知识库暂无卡片'
    : noSources ? '尚未选择搜索来源'
    : '没有匹配的卡片';
  const description = failed ? '请重新搜索；如果仍未完成，可刷新列表后重试。'
    : waiting ? '数据载入后会自动显示。也可以刷新列表重新获取。'
    : !hasCards ? '添加知识库卡片后，刷新列表即可搜索。'
    : noSources ? '从上方选择主知识库或其他来源后，即可显示结果。'
    : local ? '当前仅搜索所选卡片的子孙卡片。可调整条件，或从上方退出局部搜索。'
    : sourceLimited ? '当前仅搜索已选来源。可从上方加入其他来源，或调整关键词和筛选条件。'
    : hasFilters ? '试着减少筛选条件，或使用更短的关键词。清除筛选会保留关键词。'
    : '试着使用更短的关键词，或检查输入的词组。';
  document.getElementById('searchEmptyTitle').textContent = title;
  document.getElementById('searchEmptyDescription').textContent = description;
  document.getElementById('searchEmptyEditBtn').hidden = failed || !hasCards || !hasQuery;
  document.getElementById('searchEmptyFiltersBtn').hidden = failed || !hasCards || !hasFilters;
  document.getElementById('searchEmptyRefreshBtn').hidden = hasCards && !failed;
  document.getElementById('searchEmptyRetryBtn').hidden = !failed;
}

// formatUpdateTime 和 updateIndexModeBadge 已移至全局作用域（window 对象）

function renderSelectedCardInfo(title, subtitle) {
  dom.selectedCardInfo.innerHTML = '';

  const strong = document.createElement('strong');
  strong.textContent = title;

  const br = document.createElement('br');

  const small = document.createElement('small');
  small.textContent = subtitle;

  dom.selectedCardInfo.appendChild(strong);
  dom.selectedCardInfo.appendChild(br);
  dom.selectedCardInfo.appendChild(small);
  dom.selectedCardInfo.classList.remove('empty');
}

function updateSelectionInfo() {
  if (!state.selectedCardId) {
    dom.selectedCardInfo.textContent = '未选中卡片';
    dom.selectedCardInfo.classList.add('empty');
    updateLocalSearchSidebarState();
    return;
  }

  const selected = getCardById(state.selectedCardId);

  if (selected) {
    const title = selected.title || '(无标题)';
    const type = selected.type || '未分类';

    // 构建类型显示文本
    let typeDisplay = type;
    if (type === '归类' && selected.classificationSubtype) {
      typeDisplay = `${type} - ${selected.classificationSubtype}`;
    }

    renderSelectedCardInfo(title, typeDisplay);
  } else {
    const aiSelected = getAIRecommendationById(state.selectedCardId);
    if (aiSelected) {
      const title = aiSelected.title || '(无标题)';
      const type = aiSelected.type || '未分类';
      const subtype = (type === '归类' && aiSelected.classificationSubtype) ? ` - ${aiSelected.classificationSubtype}` : '';
      const datasetLabel = aiSelected.dataset === 'intermediate'
        ? '过程知识库'
        : (aiSelected.dataset === 'knowledge' ? '知识库' : aiSelected.dataset);
      const dataset = datasetLabel ? ` · ${datasetLabel}` : '';
      renderSelectedCardInfo(title, type + subtype + dataset);
    } else {
      dom.selectedCardInfo.textContent = '已选 1 项';
      dom.selectedCardInfo.classList.remove('empty');
    }
  }
  updateLocalSearchSidebarState();
}

function updateLocalSearchSidebarState() {
  const lsBtn = document.getElementById('activateLocalSearchBtn');
  const lsSubtitle = document.getElementById('localSearchSidebarSubtitle');
  if (!lsBtn || !lsSubtitle) return;
  const selected = state.selectedCardId && typeof getCardById === 'function'
    ? getCardById(state.selectedCardId)
    : null;
  const hasSelection = !!state.selectedCardId;
  const sameRoot = hasSelection
    && String(state.localSearchRootId || '') === String(state.selectedCardId || '');
  lsBtn.disabled = !hasSelection || sameRoot;
  lsSubtitle.textContent = !hasSelection
    ? '选中卡片后可用'
    : (sameRoot
      ? '已是当前局部搜索根'
      : '搜索 ' + (selected ? (selected.title || '(无标题)') : '当前卡片') + ' 的子孙卡片');
}

function updateActionButtonsState() {
  const disabled = !state.selectedCardId;

  // 更新所有 Sidebar 按钮状态（已移除 focusCardInFloatMindMapBtn 和 copyMarkdownLinkBtn）
  const sidebarButtons = [
    dom.mergeDuplicateKnowledgeNoteToTargetNoteBtn,
    dom.bidirectionalLinkFromeFocusNoteToTargetNoteBtn,
    dom.moveFocusNoteToTargetNoteAsChildBtn,
    dom.addTemplateToTargetNoteAndMoveFocusNoteAsChildBtn,
  ];

  sidebarButtons.forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });
  updateLocalSearchSidebarState();

  if (typeof syncSidebarWorkflowState === 'function') {
    syncSidebarWorkflowState();
  }
}
