'use strict';

function isCardInCurrentFilteredResults(cardId) {
  const targetId = normalizeCardId(cardId);
  if (!targetId) return false;

  if (state.filteredCardLookup && state.filteredCardLookup.has(targetId)) {
    return true;
  }

  return (state.filteredCards || []).some((item) => item && normalizeCardId(item.id) === targetId);
}

function resetFiltersForLocate() {
  if (dom.searchInput) {
    dom.searchInput.value = '';
    syncSearchUsageRoundFromInput('');
  }
  if (dom.excludeInput) {
    dom.excludeInput.value = '';
  }
  state.userInput = '';
  state.manualExclusionInput = '';

  if (state.activePresets.size > 0) {
    state.activePresets.clear();
    renderPresetBar();
    updateClearPresetsButton();
  }

  if (state.activeNegativePresets.size > 0) {
    state.activeNegativePresets.clear();
    renderNegativeBar();
  }
  updateClearNegativesButton();

  if (Array.isArray(state.config.typeFilters) && state.config.typeFilters.length) {
    const allFilter = state.config.typeFilters.find((filter) => filter && filter.key === 'all');
    const nextKey = allFilter ? allFilter.key : state.config.typeFilters[0].key;
    if (state.currentTypeKey !== nextKey) {
      state.currentTypeKey = nextKey;
      renderTypeBar();
    }
  }

  if (state.currentClassificationSubtype !== 'all') {
    state.currentClassificationSubtype = 'all';
    renderClassificationBar();
  }
}

function scrollToCardById(cardId) {
  const targetId = normalizeCardId(cardId);
  if (!targetId) return false;

  const element = getRenderedCardElementById(targetId);
  if (!element) return false;

  state.selectedCardId = targetId;
  setSelectedCardElement(element);
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  updateSelectionInfo();
  updateActionButtonsState();
  collapseFiltersAfterCardSelection();

  return true;
}

function locateCardById(noteId, options = {}) {
  const targetId = String(noteId || '').trim();
  if (!targetId) return false;

  if (!state.hasRealData) {
    window.__MNKB_pendingLocateId = targetId;
    return false;
  }

  const exists = !!getCardById(targetId);
  if (!exists) {
    if (options.preserveOnMissing !== true) {
      resetFiltersForLocate();
      applyFilters(buildQueryPayload());
    }
    showToast(options.missingMessage || '未找到卡片');
    return false;
  }

  const cardAlreadyVisible = isCardInCurrentFilteredResults(targetId);
  const resetFilters = (typeof options.resetFilters === 'boolean')
    ? options.resetFilters
    : !cardAlreadyVisible;

  if (!resetFilters && !cardAlreadyVisible) {
    showToast('目标卡片不在当前筛选结果中');
    return false;
  }

  if (resetFilters) {
    resetFiltersForLocate();
  }

  state.selectedCardId = targetId;
  state.locateTargetId = targetId;
  // Native locate can reveal a card outside the saved source range without changing it.
  state.locateOnlyId = null;
  if (!passesSearchSourceFilter(getCardById(targetId))) state.locateOnlyId = targetId;
  state.suppressSearchInputFocus = true;
  dom.searchInput?.blur();
  applyFilters(buildQueryPayload(), { keepLocate: !!state.locateOnlyId });

  return true;
}


        function setAIRecommendLoading(loading) {
          if (!AI_RECOMMENDATION_ENABLED) {
            state.aiRecommendLoading = false;
            if (dom.aiRecommendBtn) {
              dom.aiRecommendBtn.disabled = false;
              dom.aiRecommendBtn.textContent = '🤖 推荐';
            }
            return;
          }
          state.aiRecommendLoading = !!loading;
          if (dom.aiRecommendBtn) {
            dom.aiRecommendBtn.disabled = !!loading;
            dom.aiRecommendBtn.textContent = loading ? '🤖 分析中' : '🤖 推荐';
          }
          if (loading) {
            ensureSidebarVisible({ openIfCompact: true });
          }
          renderAIRecommendations();
        }

        function clearAIRecommendations() {
          state.aiRecommendations = [];
          rebuildAIRecommendationLookup();
          state.aiRecommendDebug = null;
          setAIRecommendLoading(false);
        }

function clearAIRecommendDebugDisplay() {
  if (!dom.aiRecommendDebug) return;
  dom.aiRecommendDebug.style.display = 'none';
  dom.aiRecommendDebug.textContent = '';
}

function collectAIRecommendDebugLines(dbg) {
  const lines = [];
  const baseTerms = Array.isArray(dbg.baseTerms) ? dbg.baseTerms.filter(Boolean) : [];
  const searchTerms = Array.isArray(dbg.searchTerms) ? dbg.searchTerms.filter(Boolean) : [];
  const tokenRecallQueries = Array.isArray(dbg.tokenRecallQueries) ? dbg.tokenRecallQueries.filter(Boolean) : [];
  const mathRecallQueries = Array.isArray(dbg.mathRecallQueries) ? dbg.mathRecallQueries.filter(Boolean) : [];
  const recallQueries = Array.isArray(dbg.recallQueries) ? dbg.recallQueries.filter(Boolean) : [];
  const expandedPhrases = Array.isArray(dbg.expandedPhrases) ? dbg.expandedPhrases.filter(Boolean) : [];
  const expandedQueries = Array.isArray(dbg.expandedQueries) ? dbg.expandedQueries.filter(Boolean) : [];
  const object = (dbg.mathParts && dbg.mathParts.object) ? String(dbg.mathParts.object).trim() : '';
  const aspect = (dbg.mathParts && dbg.mathParts.aspect) ? String(dbg.mathParts.aspect).trim() : '';

  if (object || aspect) {
    lines.push(`对象/属性: ${[object, aspect].filter(Boolean).join(' / ')}`);
  }
  if (baseTerms.length) lines.push(`基础分词: ${baseTerms.join(' / ')}`);
  if (mathRecallQueries.length) lines.push(`数学召回: ${mathRecallQueries.join(' | ')}`);
  if (tokenRecallQueries.length) lines.push(`关键词召回: ${tokenRecallQueries.join(' | ')}`);
  if (expandedPhrases.length) lines.push(`AI 扩展词: ${expandedPhrases.join(' / ')}`);
  if (searchTerms.length) lines.push(`最终关键词: ${searchTerms.join(' / ')}`);
  if (expandedQueries.length) lines.push(`扩展召回: ${expandedQueries.join(' | ')}`);
  if (recallQueries.length) lines.push(`召回查询: ${recallQueries.join(' | ')}`);
  return lines;
}

function renderAIRecommendDebug() {
  if (!AI_RECOMMENDATION_ENABLED) {
    clearAIRecommendDebugDisplay();
    return;
  }
  if (!dom.aiRecommendDebug) return;

  const dbg = state.aiRecommendDebug;
  if (!dbg || typeof dbg !== 'object') {
    clearAIRecommendDebugDisplay();
    return;
  }

  const lines = collectAIRecommendDebugLines(dbg);
  if (!lines.length) {
    clearAIRecommendDebugDisplay();
    return;
  }

  dom.aiRecommendDebug.textContent = lines.join('\n');
  dom.aiRecommendDebug.style.display = '';
}

function resetAIRecommendationsState() {
          state.aiRecommendations = [];
          state.aiRecommendDebug = null;
          rebuildAIRecommendationLookup();
          renderAIRecommendations();
        }

        function parseAIRecommendationPayload(recommendations) {
          let rawList = recommendations;
          let debug = null;
          let hasRecommendationsField = true;
          if (rawList && typeof rawList === 'object' && !Array.isArray(rawList)) {
            debug = rawList.debug || null;
            if (Object.prototype.hasOwnProperty.call(rawList, 'recommendations')) {
              rawList = rawList.recommendations;
            } else {
              hasRecommendationsField = false;
              rawList = null;
            }
          }
          return {
            rawList: Array.isArray(rawList) ? rawList : [],
            debug: (debug && typeof debug === 'object') ? debug : null,
            hasRecommendationsField,
          };
        }

        function normalizeStringAIRecommendation(id, seen) {
          const normalizedId = String(id || '').trim();
          if (!normalizedId || seen.has(normalizedId)) return null;
          seen.add(normalizedId);
          const existing = getCardById(normalizedId);
          return {
            id: normalizedId,
            title: existing?.title || '',
            type: existing?.type || '',
            classificationSubtype: existing?.classificationSubtype || '',
            prefix: existing?.prefix || '',
            dataset: existing?.dataset || '',
            score: existing?.score || 0,
          };
        }

        function normalizeObjectAIRecommendation(item, seen) {
          const rawId = (typeof item.id !== 'undefined' && item.id !== null) ? item.id : item.noteId;
          const normalizedId = rawId ? String(rawId).trim() : '';
          if (!normalizedId || seen.has(normalizedId)) return null;
          seen.add(normalizedId);
          return {
            id: normalizedId,
            title: item.title ? String(item.title) : '',
            type: item.type ? String(item.type) : '',
            classificationSubtype: item.classificationSubtype ? String(item.classificationSubtype) : '',
            prefix: item.prefix ? String(item.prefix) : '',
            dataset: item.dataset ? String(item.dataset) : '',
            score: item.score || 0,
          };
        }

        function normalizeAIRecommendations(rawList) {
          const seen = new Set();
          const normalized = [];
          rawList.forEach((item) => {
            if (!item) return;
            const entry = typeof item === 'string'
              ? normalizeStringAIRecommendation(item, seen)
              : (typeof item === 'object' ? normalizeObjectAIRecommendation(item, seen) : null);
            if (entry) {
              normalized.push(entry);
            }
          });
          return normalized;
        }

        function setAIRecommendations(recommendations) {
          if (!AI_RECOMMENDATION_ENABLED) {
            resetAIRecommendationsState();
            return;
          }
          const payload = parseAIRecommendationPayload(recommendations);
          state.aiRecommendDebug = payload.debug;
  
          if (!payload.hasRecommendationsField && state.aiRecommendDebug) {
            renderAIRecommendations();
            return;
          }
  
          state.aiRecommendations = normalizeAIRecommendations(payload.rawList);
          rebuildAIRecommendationLookup();
          renderAIRecommendations();
        }

        function renderAIRecommendations() {
          if (!dom.aiRecommendPanel || !dom.aiRecommendList) return;
          if (!AI_RECOMMENDATION_ENABLED) {
            dom.aiRecommendPanel.style.display = 'none';
            dom.aiRecommendList.textContent = '';
            renderAIRecommendDebug();
            return;
          }

          const recs = Array.isArray(state.aiRecommendations) ? state.aiRecommendations : [];
          const hasDebug = state.aiRecommendDebug && typeof state.aiRecommendDebug === 'object';
          const shouldShow = state.aiRecommendLoading || recs.length > 0 || hasDebug;
          if (!shouldShow) {
            dom.aiRecommendPanel.style.display = 'none';
            dom.aiRecommendList.textContent = '';
            renderAIRecommendDebug();
            return;
          }

          dom.aiRecommendPanel.style.display = '';
          dom.aiRecommendList.textContent = '';
          renderAIRecommendDebug();
  
          if (state.aiRecommendLoading && recs.length === 0) {
            dom.aiRecommendList.appendChild(createAIRecommendationEmptyState('🤖 分析中…'));
            return;
          }
  
          if (recs.length === 0) {
            dom.aiRecommendList.appendChild(createAIRecommendationEmptyState('暂无推荐结果'));
            return;
          }

          const fragment = document.createDocumentFragment();

          recs.forEach((rec, index) => {
            fragment.appendChild(createAIRecommendationItem(rec, index));
  });

  dom.aiRecommendList.appendChild(fragment);
}

function createAIRecommendationEmptyState(message) {
  const element = document.createElement('div');
  element.className = 'ai-rec-empty';
  element.textContent = message;
  return element;
}

function createAIRecommendationItem(rec, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ai-rec-item';
  btn.dataset.id = rec.id;

  const titleText = rec.title || rec.id;
  const type = rec.type || '未分类';
  const subtype = (type === '归类' && rec.classificationSubtype) ? ` - ${rec.classificationSubtype}` : '';
  const datasetLabel = rec.dataset === 'intermediate'
    ? '过程知识库'
    : (rec.dataset === 'knowledge' ? '知识库' : rec.dataset);
  const dataset = datasetLabel ? ` · ${datasetLabel}` : '';
  const prefix = rec.prefix ? ` · ${rec.prefix}` : '';

  const title = document.createElement('div');
  title.className = 'ai-rec-title';
  title.textContent = `${index + 1}. ${titleText}`;

  const meta = document.createElement('div');
  meta.className = 'ai-rec-meta';
  meta.textContent = type + subtype + dataset + prefix;

  btn.appendChild(title);
  btn.appendChild(meta);
  return btn;
}

function handleAIRecommendListClick(event) {
  const item = event.target.closest('.ai-rec-item');
  if (!item || !dom.aiRecommendList || !dom.aiRecommendList.contains(item)) return;

  const id = normalizeCardId(item.dataset.id);
  if (!id) return;

  state.selectedCardId = id;
  setSelectedCardElement(getRenderedCardElementById(id));
  updateSelectionInfo();
  updateActionButtonsState();
  showToast('已选择推荐卡片', 900);
  if (isCompactLayout()) {
    openSidebar();
  }
}

function handleCardFocus(cardId) {
  if (!cardId) return;

  if (!postBridge('focusCardInMindMap', withSearchUsageParams(
    { id: cardId },
    cardId,
    SEARCH_USAGE_TIER_POINTS.locate,
  ))) {
    showToast('操作未完成：在主脑图中定位');
  }
}

const SIDEBAR_SIMPLE_ACTION_FAILURE_MESSAGES = Object.freeze({
  focusCardInFloatMindMap: '操作未完成：在浮窗中定位',
  mergeFocusNoteToTargetNoteExcerptPart: '操作失败',
  mergeFocusNoteToTargetNoteExcerptPartAbove: '操作失败',
  clearTitleAndMergeFocusNoteToTargetNoteExcerptPart: '操作失败',
  clearTitleAndMergeFocusNoteToTargetNoteExcerptPartAbove: '操作失败',
  clearTitleMergeAndLinkOldClassificationToTargetNote: '操作失败',
  clearTitleMergeAndLinkOldClassificationToTargetNoteAbove: '操作失败',
  keepOnlyExcerptAndMergeToTargetNote: '操作失败',
  keepOnlyExcerptAndMergeToTargetNoteAbove: '操作失败',
  bidirectionalLinkFromeFocusNoteToTargetNote: '操作失败',
  moveFocusNoteToTargetNoteAsChild: '操作失败',
  moveFocusNoteToTargetNoteAsChildAndLocate: '操作失败',
  moveFocusNoteToTargetNoteAsChildAndMakeNote: '操作失败',
  moveFocusNoteToTargetNoteAsChildAndMakeNoteAndLocate: '操作失败',
  moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReview: '操作失败',
  moveFocusNoteToTargetNoteAsChildAndMakeNoteAndAddToReviewAndLocate: '操作失败',
  addTemplateToTargetNoteAndMoveFocusNoteAsChild: '操作失败',
  addTemplateToTargetNoteAndMoveFocusNoteAsChildAndLocate: '操作失败',
});

function postSidebarAction(actionName, id, failureToast = '操作失败', usageTier = 0) {
  const params = usageTier
    ? withSearchUsageParams({ id }, id, usageTier)
    : { id };
  if (postBridge(actionName, params)) {
    return true;
  }
  showToast(failureToast);
  return false;
}

function handleCopyMarkdownSidebarAction(id) {
  if (!postSidebarAction(
    'copyMarkdownLink',
    id,
    '操作未完成：复制行内链接',
    SEARCH_USAGE_TIER_POINTS.link,
  )) {
    return;
  }
  showMinorSuccessToast('已复制行内链接', 650);
}

// Native receipts own completion; scheme dispatch only starts a pending request.
const sidebarActionRequests = Object.create(null);
let sidebarActionSequence = 0;
const sidebarActionSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function completeSidebarAction(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const pending = sidebarActionRequests[payload.section];
  if (!pending || pending.requestId !== payload.requestId || pending.action !== payload.action) return false;
  clearTimeout(pending.timer);
  delete sidebarActionRequests[payload.section];
  setLastActionFeedback(payload.section, payload.success === true
    ? `已执行：${pending.summary}`
    : `未完成：${payload.message || '操作未能完成'}`, payload.success === true ? 'success' : 'error');
  return true;
}
window.completeSidebarAction = completeSidebarAction;
function postTrackedSidebarAction(section, action, params, summary) {
  const previous = sidebarActionRequests[section];
  if (previous) clearTimeout(previous.timer);
  const requestId = `${sidebarActionSession}-${++sidebarActionSequence}`;
  const pending = { requestId, action, summary, timer: null };
  sidebarActionRequests[section] = pending;
  setLastActionFeedback(section, `执行中：${summary}`, 'pending');
  pending.timer = setTimeout(() => {
    if (sidebarActionRequests[section] !== pending) return;
    delete sidebarActionRequests[section];
    setLastActionFeedback(section, '结果未确认：未收到完成回执，请核对卡片后再操作', 'error');
  }, 45000);
  try {
    if (postBridge(action, { ...params, sidebarRequestId: requestId, sidebarSection: section })) return true;
  } catch (error) {
    // Report dispatch failure through the same request identity gate.
  }
  completeSidebarAction({ requestId, action, section, success: false, message: '发送失败，操作未触发' });
  showToast('操作失败');
  return false;
}

function handleMergeSidebarAction(id) {
  postTrackedSidebarAction('merge', 'mergeDuplicateKnowledgeNoteToTargetNote', {
    id,
    removeTitle: state.mergeOptions.removeTitle,
    keepOnlyExcerpt: state.mergeOptions.keepOnlyExcerpt,
    excerptFromSelection: state.mergeOptions.excerptFromSelection,
    position: state.mergeOptions.position,
    locateAfterMerge: state.mergeOptions.locateAfterMerge,
    linkOldClassification: state.mergeOptions.linkOldClassification,
  }, formatMergeOptionsSummary());
}

function handleMoveSidebarAction(id) {
  const actionName = resolveMoveActionFromOptions();
  postTrackedSidebarAction('move', actionName, { id }, formatMoveOptionsSummary());
}

function handleTemplateSidebarAction(id) {
  const actionName = resolveTemplateActionFromOptions();
  postTrackedSidebarAction('template', actionName, { id }, formatTemplateOptionsSummary());
}

function handleSidebarAction(action) {
  if (!state.selectedCardId) {
    showToast('请先选择卡片');
    return;
  }

  const id = state.selectedCardId;

  if (Object.prototype.hasOwnProperty.call(SIDEBAR_SIMPLE_ACTION_FAILURE_MESSAGES, action)) {
    const usageTier = action === 'focusCardInFloatMindMap'
      ? SEARCH_USAGE_TIER_POINTS.locate
      : 0;
    postSidebarAction(action, id, SIDEBAR_SIMPLE_ACTION_FAILURE_MESSAGES[action], usageTier);
    return;
  }

  switch (action) {
    case 'copyMarkdownLink':
      handleCopyMarkdownSidebarAction(id);
      break;

    case 'mergeDuplicateKnowledgeNoteToTargetNote':
      handleMergeSidebarAction(id);
      break;

    case 'moveFocusNoteToTargetNoteWithOptions':
      handleMoveSidebarAction(id);
      break;

    case 'addTemplateToTargetNoteAndMoveFocusNoteWithOptions':
      handleTemplateSidebarAction(id);
      break;

    default:
      showToast('未知操作');
      break;
  }
}

        function resolveBridgeDatasetKey(options = {}) {
          return options.datasetKey || 'knowledge';
        }

