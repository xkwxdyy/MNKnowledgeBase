'use strict';

function cancelPendingLoadMoreTask() {
  if (state.loadMoreTimerId) {
    clearTimeout(state.loadMoreTimerId);
    state.loadMoreTimerId = null;
  }
  state.isLoadingMore = false;
}

function resetPaginationState(results) {
  cancelPendingLoadMoreTask();
  cancelPendingResultRenderTask();
  state.isRenderingResults = false;
  state.loadMoreRevision += 1;
  state.currentPage = 1;
  state.displayedCards = [];
  state.hasMore = results.length > INITIAL_PAGE_SIZE;
  state.resultWindowStart = 0;
  state.resultWindowEnd = 0;
  state.resultWindowTopSegments = [];
  state.resultWindowBottomSegments = [];
  state.resultWindowTopSpacerHeight = 0;
  state.resultWindowBottomSpacerHeight = 0;

  const initialCards = results.slice(0, INITIAL_PAGE_SIZE);
  if (initialCards.length > 0) {
    state.displayedCards.push(...initialCards);
  }
  state.resultWindowEnd = initialCards.length;
  return initialCards;
}

function hasMeasuredResultWindowSegments() {
  return (Array.isArray(state.resultWindowTopSegments) && state.resultWindowTopSegments.length > 0)
    || (Array.isArray(state.resultWindowBottomSegments) && state.resultWindowBottomSegments.length > 0);
}

function handleResultWindowViewportChange() {
  if (!hasMeasuredResultWindowSegments()) return false;

  const initialCards = resetPaginationState(state.filteredCards || []);
  if (dom.container) {
    dom.container.scrollTop = 0;
  }
  renderResults(initialCards);
  updateLoadMoreButton();
  return true;
}

// 加载更多功能
function loadMore() {
  if (state.isLoadingMore || state.isRenderingResults || state.isFilteringResults) return;

  if (typeof restoreNextResultWindowSegment === 'function' && restoreNextResultWindowSegment()) {
    return;
  }
  if (!state.hasMore) return;

  state.isLoadingMore = true;
  const requestRevision = state.loadMoreRevision;

  // 显示加载中状态
  if (dom.loadMoreBtn) dom.loadMoreBtn.style.display = 'none';
  if (dom.loadingIndicator) dom.loadingIndicator.style.display = 'block';

  // 模拟异步加载（实际是同步的，但使用 setTimeout 避免阻塞UI）
  if (state.loadMoreTimerId) {
    clearTimeout(state.loadMoreTimerId);
  }
  state.loadMoreTimerId = setTimeout(() => {
    state.loadMoreTimerId = null;

    if (requestRevision !== state.loadMoreRevision) {
      state.isLoadingMore = false;
      updateLoadMoreButton();
      return;
    }

    const startIndex = state.displayedCards.length;
    const endIndex = Math.min(startIndex + PAGE_SIZE, state.filteredCards.length);
    const newCards = state.filteredCards.slice(startIndex, endIndex);

    // 添加到显示列表
    if (newCards.length > 0) {
      state.displayedCards.push(...newCards);
    }
    state.hasMore = state.displayedCards.length < state.filteredCards.length;

    // 追加渲染新卡片（而不是重新渲染全部）
    appendCards(newCards, {
      onComplete: () => {
        state.isLoadingMore = false;
        updateLoadMoreButton();
      },
    });
  }, 100);
}

function createAppendRenderContext(cards, onComplete) {
  const totalCount = cards.length;
  return {
    cards,
    onComplete,
    totalCount,
    useChunkedRender: shouldUseChunkedResultRender(totalCount),
    chunkSize: Math.max(1, getRenderChunkSize()),
    selectedId: normalizeCardId(state.selectedCardId),
    renderToken: ++activeResultRenderToken,
    cursor: 0,
    anchor: ensureResultWindowBottomAnchor(),
  };
}

function ensureAppendRenderAnchor(anchor) {
  if (anchor.parentNode !== dom.results) {
    dom.results.appendChild(anchor);
  }
}

function appendRenderedCard(fragment, card) {
  const element = createCardElement(card);
  const cardId = normalizeCardId(card && card.id);

  updateRenderedCardElementLookup(cardId, element);
  if (cardId) {
    renderedCardSignatureLookup.set(cardId, buildCardRenderSignature(card));
  }
  fragment.appendChild(element);
}

function finalizeAppendedCards(context) {
  if (context.renderToken !== activeResultRenderToken) return;

  pendingResultRenderHandle = null;
  state.isRenderingResults = false;
  state.resultWindowEnd = Math.min(
    state.displayedCards.length,
    state.resultWindowEnd + context.totalCount,
  );

  if (typeof enforceResultWindowLimit === 'function') {
    enforceResultWindowLimit('bottom');
  }

  if (context.selectedId) {
    setSelectedCardElement(getRenderedCardElementById(context.selectedId));
  }

  updateSearchCount(state.displayedCards.length);
  if (context.onComplete) context.onComplete();
}

function renderAppendedCardChunk(context) {
  if (context.renderToken !== activeResultRenderToken) return;

  const fragment = document.createDocumentFragment();
  const end = context.useChunkedRender
    ? Math.min(context.cursor + context.chunkSize, context.totalCount)
    : context.totalCount;

  for (let index = context.cursor; index < end; index += 1) {
    appendRenderedCard(fragment, context.cards[index]);
  }

  dom.results.insertBefore(fragment, context.anchor);
  context.cursor = end;

  if (context.cursor >= context.totalCount) {
    finalizeAppendedCards(context);
    return;
  }

  pendingResultRenderHandle = queueFilterFrame(() => renderAppendedCardChunk(context));
}

// 追加渲染卡片（用于加载更多）
function appendCards(cards, options = {}) {
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;

  if (!Array.isArray(cards) || cards.length === 0) {
    updateSearchCount(state.displayedCards.length);
    if (onComplete) onComplete();
    return;
  }

  cancelPendingResultRenderTask();
  state.isRenderingResults = true;

  const context = createAppendRenderContext(cards, onComplete);
  ensureAppendRenderAnchor(context.anchor);
  renderAppendedCardChunk(context);
}

// 更新加载更多按钮状态
function updateLoadMoreButton() {
  if (!dom.loadMoreContainer) return;

  const hasWindowedForwardResults = Array.isArray(state.resultWindowBottomSegments)
    && state.resultWindowBottomSegments.length > 0;
  if ((state.hasMore || hasWindowedForwardResults) && state.filteredCards.length > 0) {
    dom.loadMoreContainer.style.display = 'block';
    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.style.display = 'inline-block';
      dom.loadMoreBtn.disabled = state.isLoadingMore || state.isRenderingResults || state.isFilteringResults;
    }
    if (dom.loadingIndicator) {
      dom.loadingIndicator.style.display = state.isLoadingMore ? 'block' : 'none';
    }

    // 更新按钮文本显示剩余数量
    const remaining = state.filteredCards.length - state.displayedCards.length;
    if (dom.loadMoreBtn) {
      dom.loadMoreBtn.textContent = hasWindowedForwardResults
        ? '继续向下浏览'
        : `加载更多 (剩余 ${remaining} 项)`;
    }
  } else {
    dom.loadMoreContainer.style.display = 'none';
  }
}

        
