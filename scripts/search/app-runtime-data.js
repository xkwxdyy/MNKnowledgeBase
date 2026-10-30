'use strict';

function cancelSearchFieldCachePrewarm() {
  searchFieldCachePrewarmRevision += 1;
  pendingSearchFieldCachePrewarmHandle = null;
}

function getSearchFieldCachePrewarmBudget(deadline) {
  if (deadline && typeof deadline.timeRemaining === 'function') {
    return Math.max(2, Math.min(8, deadline.timeRemaining()));
  }
  return 5;
}

function scheduleSearchFieldCachePrewarm(cards = state.cards) {
  const list = Array.isArray(cards) ? cards : [];
  const revision = ++searchFieldCachePrewarmRevision;
  let cursor = 0;

  if (list.length === 0 || typeof getCachedSearchFields !== 'function') {
    pendingSearchFieldCachePrewarmHandle = null;
    return;
  }

  const runChunk = (deadline) => {
    if (revision !== searchFieldCachePrewarmRevision) return;

    const chunkStart = getPerfNow();
    const budget = getSearchFieldCachePrewarmBudget(deadline);
    while (cursor < list.length && (getPerfNow() - chunkStart) < budget) {
      const card = list[cursor];
      if (card && typeof card === 'object') {
        getCachedSearchFields(card, normalizeFilterCardType(card));
      }
      cursor += 1;
    }

    if (revision !== searchFieldCachePrewarmRevision) return;
    if (cursor < list.length) {
      pendingSearchFieldCachePrewarmHandle = queueIdleFrame(runChunk);
      return;
    }

    pendingSearchFieldCachePrewarmHandle = null;
    emitPerfDebugLog(`searchFieldCache(prewarm done): total=${list.length}`);
  };

  pendingSearchFieldCachePrewarmHandle = queueIdleFrame(runChunk);
}

function updateCards(cards, { replace = true } = {}) {
  const perfStart = getPerfNow();
  const updateRevision = ++cardsUpdateRevision;
  cancelSearchFieldCachePrewarm();
  bumpSearchExecutionRevision('updateCards');
  emitPerfDebugLog(`updateCards(start): incoming=${cards?.length || 0} replace=${replace ? 'on' : 'off'} current=${state.cards.length}`);
  if (typeof window.mnkbStartupPerfMark === 'function') {
    window.mnkbStartupPerfMark('updateCards(start)', `incoming=${cards?.length || 0} replace=${replace ? 'on' : 'off'} current=${state.cards.length}`);
  }

  const sanitized = Array.isArray(cards) ? cards.filter(Boolean) : [];

  if (replace) {
    // 替换模式:直接使用新卡片数组
    state.cards = sanitized.slice();
  } else {
    // 合并模式:保留现有卡片,添加新卡片
    const cardMap = new Map(state.cards.map((item) => [item.id, item]));
    sanitized.forEach((item) => {
      if (!item || !item.id || cardMap.has(item.id)) return;
      cardMap.set(item.id, item);
    });
    state.cards = Array.from(cardMap.values());
  }

  normalizedCardFieldCache = new WeakMap();
  rebuildCardLookup();
  state.filteredCardLookup = new Map();
  filteredResultRenderSignatures = [];

  emitPerfDebugLog(`updateCards(accepted): total=${state.cards.length}`);
  if (typeof window.mnkbStartupPerfMark === 'function') {
    window.mnkbStartupPerfMark('updateCards(accepted)', `total=${state.cards.length}`);
  }
  cancelPendingFilterTask();
  state.isFilteringResults = true;
  updateSearchCount(0, { phase: 'pending' });

  queueIdleFrame(() => {
    if (updateRevision !== cardsUpdateRevision) return;
    const finalizeStart = getPerfNow();
    clearSelection();
    refreshClassificationOptions();
    scheduleSearch({ triggerNative: false, lowPriority: true });
    scheduleSearchFieldCachePrewarm(state.cards);
    logPerfMetric('updateCards(finalize)', finalizeStart, `total=${state.cards.length}`);
    if (typeof window.mnkbStartupPerfMark === 'function') {
      window.mnkbStartupPerfMark('updateCards(finalize)', `total=${state.cards.length}`);
    }
  });

  logPerfMetric('updateCards(accept)', perfStart, `total=${state.cards.length}`);
}

/**
 * 应用卡片差量补丁（尽量减少对现有 UI 状态的扰动）
 * @param {Object} patchData
 * @param {Array} patchData.upserts
 * @param {Array<string>} patchData.removedIds
 * @returns {boolean}
 */
function applyPatchMetadata(metadata) {
  if (!metadata) return;
  state.metadata = { ...(state.metadata || {}), ...metadata };
  if (metadata.mode) {
    state.indexMode = metadata.mode;
  }
  if (typeof updateIndexModeBadge === 'function') {
    updateIndexModeBadge();
  }
}

function createPatchedCardMap(cards) {
  const cardMap = new Map();
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    if (!card || !card.id) return;
    cardMap.set(String(card.id), card);
  });
  return cardMap;
}

function removeCardsFromPatchMap(cardMap, removedIds) {
  let classificationTouched = false;
  (removedIds || []).forEach((id) => {
    if (!id) return;
    const key = String(id);
    const previous = cardMap.get(key);
    if (previous?.type === '归类') {
      classificationTouched = true;
    }
    cardMap.delete(key);
  });
  return classificationTouched;
}

function upsertCardsIntoPatchMap(cardMap, upserts) {
  let classificationTouched = false;
  (upserts || []).forEach((card) => {
    if (!card || !card.id) return;
    const key = String(card.id);
    const previous = cardMap.get(key);
    if (card.type === '归类' || previous?.type === '归类') {
      classificationTouched = true;
    }
    cardMap.set(key, previous?.indexSources && !card.indexSources
      ? { ...card, indexSources: previous.indexSources.slice() }
      : card);
  });
  return classificationTouched;
}

function resetCardCachesAfterPatch() {
  // 未变化的卡片对象可继续复用规范化字段缓存；新增对象会自然 cache miss，
  // 删除对象则由 WeakMap 自动回收，避免单卡 patch 让 27,000+ 张卡片全部重算。
  rebuildCardLookup();
  state.filteredCardLookup = new Map();
  filteredResultRenderSignatures = [];
}

function syncSelectionAfterPatch(cardMap) {
  if (state.selectedCardId && !cardMap.has(String(state.selectedCardId))) {
    clearSelection();
    return;
  }
  if (state.selectedCardId) {
    updateSelectionInfo();
    updateActionButtonsState();
  }
}

function applyCardsPatch(patchData) {
  const perfStart = getPerfNow();
  bumpSearchExecutionRevision('applyCardsPatch');

  const upserts = Array.isArray(patchData?.upserts) ? patchData.upserts : [];
  const removedIds = Array.isArray(patchData?.removedIds) ? patchData.removedIds : [];
  const changeCount = upserts.length + removedIds.length;

  if (changeCount === 0) {
    applyPatchMetadata(patchData?.metadata);
    return true;
  }

  emitPerfDebugLog(`applyCardsPatch(start): upserts=${upserts.length} removed=${removedIds.length} current=${state.cards.length}`);

  const cardMap = createPatchedCardMap(state.cards);
  const removedTouchedClassification = removeCardsFromPatchMap(cardMap, removedIds);
  const upsertTouchedClassification = upsertCardsIntoPatchMap(cardMap, upserts);
  const classificationTouched = removedTouchedClassification || upsertTouchedClassification;

  state.cards = Array.from(cardMap.values());
  resetCardCachesAfterPatch();
  applyPatchMetadata(patchData?.metadata);
  syncSelectionAfterPatch(cardMap);

  if (classificationTouched) {
    refreshClassificationOptions();
  }

  scheduleSearch({ triggerNative: false, lowPriority: true });
  emitPerfDebugLog(`applyCardsPatch(done): total=${state.cards.length}`);
  logPerfMetric('applyCardsPatch', perfStart, `total=${state.cards.length} changed=${changeCount}`);

  return true;
}

/**
 * 创建预设 pill 元素
 * @param {Object|String} item - 预设项（可以是字符串或对象）
 * @param {Number} level - 层级（1-4）
 * @param {Object} group - 所属分组（用于互斥组逻辑）
 * @returns {HTMLElement} pill 元素
 */
