'use strict';

const MNKB_MATH_TERM_CORPUS_URL = './resources/search/math-term-corpus.runtime.js';
const AI_CARD_SEARCH_RERANK_TIMEOUT_MS = 120000;
const AI_CARD_SEARCH_CORPUS_TIMEOUT_MS = 15000;
const AI_CARD_SEARCH_MODEL_TIMEOUT_MS = 30000;
const AI_CARD_SEARCH_QUERY_LIMIT = 500;
let mathTermCorpusPromise = null;
let mathTermSearchEngine = null;
let aiCardSearchContext = null;
let aiCardSearchModelRequest = null;
let latestAICardSearchModelRequestId = '';
let aiCardSearchListenersAttached = false;
const pendingAICardSearchPayloads = new Map();
const pendingAICardSearchResolvers = new Map();

function createAICardSearchRequestId() {
  state.aiCardSearch.requestSeq = Number(state.aiCardSearch.requestSeq || 0) + 1;
  return `ai-card-search-${Date.now()}-${state.aiCardSearch.requestSeq}`;
}

function loadMathTermCorpusScript(url) {
  return new Promise((resolve, reject) => {
    if (window.__MNKB_MATH_TERM_CORPUS__) {
      resolve(window.__MNKB_MATH_TERM_CORPUS__);
      return;
    }
    const script = document.createElement('script');
    let settled = false;
    const finish = (error, runtime) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve(runtime);
      }
    };
    const timeoutId = setTimeout(() => {
      finish(new Error('术语库加载超时，请重试'));
    }, AI_CARD_SEARCH_CORPUS_TIMEOUT_MS);
    script.src = url;
    script.async = true;
    script.dataset.mnkbMathTermCorpus = 'true';
    script.onload = () => {
      const runtime = window.__MNKB_MATH_TERM_CORPUS__;
      if (!runtime) {
        finish(new Error('术语库脚本已加载，但没有提供运行时数据'));
        return;
      }
      finish(null, runtime);
    };
    script.onerror = () => finish(new Error('术语库脚本读取失败'));
    try {
      document.head.appendChild(script);
    } catch (error) {
      finish(error);
    }
  });
}

function fetchMathTermCorpus() {
  if (window.__MNKB_MATH_TERM_CORPUS__) {
    return Promise.resolve(window.__MNKB_MATH_TERM_CORPUS__);
  }
  return loadMathTermCorpusScript(MNKB_MATH_TERM_CORPUS_URL);
}

function loadMathTermSearchEngine() {
  if (mathTermSearchEngine) return Promise.resolve(mathTermSearchEngine);
  if (mathTermCorpusPromise) return mathTermCorpusPromise;
  mathTermCorpusPromise = fetchMathTermCorpus()
    .then((runtime) => {
      if (!window.MNKBMathTermSearch) throw new Error('术语检索模块未加载');
      mathTermSearchEngine = window.MNKBMathTermSearch.createRuntimeEngine(runtime);
      return mathTermSearchEngine;
    })
    .catch((error) => {
      mathTermCorpusPromise = null;
      throw error;
    });
  return mathTermCorpusPromise;
}

function setAICardSearchLoading(loading) {
  state.aiCardSearch.loading = !!loading;
  if (typeof updateSearchCount === 'function') {
    updateSearchCount(state.displayedCards.length, {
      phase: loading && !state.aiCardSearch.analysis ? 'pending' : 'ready',
    });
  }
  if (dom.aiCardSearchRetryBtn) {
    dom.aiCardSearchRetryBtn.disabled = !!loading;
    dom.aiCardSearchRetryBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
  if (!dom.aiCardSearchBtn) return;
  dom.aiCardSearchBtn.disabled = !!loading;
  dom.aiCardSearchBtn.textContent = loading ? '检索中' : 'AI 找卡片';
  dom.aiCardSearchBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function isNativeAICardSearchRuntime() {
  const protocol = String(window.location?.protocol || '').toLowerCase();
  return protocol !== 'http:' && protocol !== 'https:';
}

function selectedAICardSearchModelLabel() {
  const source = String(state.aiCardSearch?.selectedSource || '').trim();
  const model = String(state.aiCardSearch?.selectedModel || '').trim();
  return source && model ? `${source}: ${model}` : '';
}

function setAICardSearchModelLoading(loading) {
  state.aiCardSearch.modelLoading = !!loading;
  if (dom.aiCardSearchRefreshModelsBtn) {
    dom.aiCardSearchRefreshModelsBtn.disabled = !!loading;
    dom.aiCardSearchRefreshModelsBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
}

function encodeAICardSearchModelValue(source, model) {
  return JSON.stringify([String(source || ''), String(model || '')]);
}

function decodeAICardSearchModelValue(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const source = String(parsed[0] || '').trim();
    const model = String(parsed[1] || '').trim();
    return source && model ? { source, model } : null;
  } catch (error) {
    return null;
  }
}

function renderAICardSearchModelCatalog() {
  const select = dom.aiCardSearchModelSelect;
  if (!select) return;
  const catalog = state.aiCardSearch.modelCatalog;
  const sources = Array.isArray(catalog?.sources) ? catalog.sources : [];
  const selectedValue = encodeAICardSearchModelValue(
    state.aiCardSearch.selectedSource,
    state.aiCardSearch.selectedModel,
  );
  select.textContent = '';

  if (sources.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = isNativeAICardSearchRuntime() ? 'MNAI 未就绪' : '本地检索';
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  sources.forEach((sourceEntry) => {
    const source = String(sourceEntry?.source || '').trim();
    const models = Array.isArray(sourceEntry?.models) ? sourceEntry.models : [];
    if (!source || models.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = source;
    models.forEach((modelValue) => {
      const model = String(modelValue || '').trim();
      if (!model) return;
      const option = document.createElement('option');
      option.value = encodeAICardSearchModelValue(source, model);
      option.textContent = model;
      group.appendChild(option);
    });
    if (group.children.length > 0) select.appendChild(group);
  });
  const hasModels = select.options.length > 0;
  const selectedExists = Array.from(select.options).some((option) => option.value === selectedValue);
  if (!selectedExists && hasModels) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '请选择精排模型';
    select.appendChild(option);
  }
  select.value = selectedExists ? selectedValue : '';
  select.disabled = !hasModels || aiCardSearchModelRequest?.kind === 'selection';
}

function handleAICardSearchModelOptions(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const requestId = String(payload.requestId || '');
  if (requestId !== latestAICardSearchModelRequestId) return false;
  if (requestId && !aiCardSearchModelRequest) return false;
  const request = aiCardSearchModelRequest;
  if (request) clearTimeout(request.timeoutId);
  aiCardSearchModelRequest = null;
  const sources = (Array.isArray(payload.sources) ? payload.sources : []).map((entry) => ({
    source: typeof entry?.source === 'string' ? entry.source.trim() : '',
    models: Array.from(new Set((Array.isArray(entry?.models) ? entry.models : [])
      .filter((model) => typeof model === 'string' && model.trim()).map((model) => model.trim()))),
  })).filter((entry) => entry.source && entry.models.length > 0);
  const source = typeof payload.selected?.source === 'string' ? payload.selected.source.trim() : '';
  const model = typeof payload.selected?.model === 'string' ? payload.selected.model.trim() : '';
  const validSelection = sources.some((entry) => entry.source === source && entry.models.includes(model));
  state.aiCardSearch.modelCatalog = { ...payload, sources };
  state.aiCardSearch.selectedSource = validSelection ? source : '';
  state.aiCardSearch.selectedModel = validSelection ? model : '';
  setAICardSearchModelLoading(false);
  renderAICardSearchModelCatalog();
  if (payload?.error) showToast(`模型列表不可用：${payload.error}`, 2200);
  else if (request?.kind === 'selection' && validSelection) {
    showMinorSuccessToast(`精排模型：${model}`, 900);
  }
  return true;
}

function beginAICardSearchModelRequest(kind) {
  if (aiCardSearchModelRequest) clearTimeout(aiCardSearchModelRequest.timeoutId);
  const requestId = `${createAICardSearchRequestId()}-models`;
  latestAICardSearchModelRequestId = requestId;
  const timeoutId = setTimeout(() => {
    failAICardSearchModelRequest(requestId, '模型请求超时，请刷新列表后重试');
  }, AI_CARD_SEARCH_MODEL_TIMEOUT_MS);
  aiCardSearchModelRequest = { requestId, kind, timeoutId };
  setAICardSearchModelLoading(true);
  renderAICardSearchModelCatalog();
  return requestId;
}

function failAICardSearchModelRequest(requestId, message) {
  if (aiCardSearchModelRequest?.requestId !== requestId) return;
  clearTimeout(aiCardSearchModelRequest.timeoutId);
  aiCardSearchModelRequest = null;
  setAICardSearchModelLoading(false);
  renderAICardSearchModelCatalog();
  showToast(message, 2200);
}

function requestAICardSearchModelCatalog(options = {}) {
  if (!isNativeAICardSearchRuntime()) {
    renderAICardSearchModelCatalog();
    return false;
  }
  if (state.aiCardSearch.modelLoading) return false;
  const requestId = beginAICardSearchModelRequest('catalog');
  try {
    if (window.Bridge && typeof window.Bridge.requestAICardSearchModels === 'function') {
      const dispatched = window.Bridge.requestAICardSearchModels({ refresh: options.refresh === true, requestId });
      if (dispatched !== false) return true;
    }
  } catch (error) {
    // Dispatch errors follow the same bounded fallback as an absent bridge.
  }
  failAICardSearchModelRequest(requestId, '模型列表通道不可用，请重试');
  return false;
}

function handleAICardSearchModelChange() {
  const selection = decodeAICardSearchModelValue(dom.aiCardSearchModelSelect?.value);
  if (!selection) return;
  const sources = state.aiCardSearch.modelCatalog?.sources || [];
  if (!sources.some((entry) => entry.source === selection.source && entry.models.includes(selection.model))) return;
  const requestId = beginAICardSearchModelRequest('selection');
  try {
    if (window.Bridge && typeof window.Bridge.setAICardSearchModel === 'function') {
      const dispatched = window.Bridge.setAICardSearchModel({ ...selection, requestId });
      if (dispatched !== false) return;
    }
  } catch (error) {
    // The selected state remains the last acknowledged Native value.
  }
  failAICardSearchModelRequest(requestId, '模型设置未完成，请重试');
}

function cancelAICardSearchPending(requestId, payload = {}) {
  if (!pendingAICardSearchResolvers.has(requestId)) return false;
  try {
    window.Bridge?.cancelAICardSearchRerank?.({ requestId });
  } catch (error) {
    // Local cleanup must still run when the Native channel has disappeared.
  }
  return settleAICardSearchRerank(requestId, { requestId, success: false, cancelled: true, ...payload });
}

function settleAICardSearchRerank(requestId, payload) {
  const pending = pendingAICardSearchResolvers.get(String(requestId || ''));
  if (!pending) return false;
  clearTimeout(pending.timeoutId);
  pendingAICardSearchResolvers.delete(String(requestId || ''));
  pendingAICardSearchPayloads.delete(String(requestId || ''));
  pending.resolve(payload || { success: false, error: 'AI 精排未返回结果' });
  return true;
}

function completeAICardSearchRerank(payload = {}) {
  const requestId = String(payload.requestId || '');
  if (!requestId) return false;
  return settleAICardSearchRerank(requestId, payload);
}

function takeAICardSearchRerankPayload(requestId) {
  const key = String(requestId || '');
  const payload = pendingAICardSearchPayloads.get(key) || null;
  pendingAICardSearchPayloads.delete(key);
  return payload;
}

function requestAICardSearchRerank(requestId, payload) {
  if (!isNativeAICardSearchRuntime()) {
    return Promise.resolve({ success: false, localOnly: true });
  }
  const source = String(state.aiCardSearch.selectedSource || '').trim();
  const model = String(state.aiCardSearch.selectedModel || '').trim();
  if (!source || !model) {
    return Promise.resolve({ success: false, localOnly: true, error: '未选择可用的 MNAI 模型' });
  }

  pendingAICardSearchPayloads.set(requestId, payload);
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      cancelAICardSearchPending(requestId, {
        cancelled: false,
        error: 'AI 精排超时，已保留本地结果',
      });
    }, AI_CARD_SEARCH_RERANK_TIMEOUT_MS);
    pendingAICardSearchResolvers.set(requestId, { resolve, timeoutId });
    try {
      if (window.Bridge && typeof window.Bridge.requestAICardSearchRerank === 'function') {
        const dispatched = window.Bridge.requestAICardSearchRerank({ requestId, source, model });
        if (dispatched !== false) return;
      }
    } catch (error) {
      // A throwing transport must not strand the resolver or payload.
    }
    cancelAICardSearchPending(requestId, {
      cancelled: false,
      error: 'Native AI 通道不可用，已保留本地结果',
    });
  });
}

function resetAICardSearchPanelContent() {
  if (dom.aiCardSearchConcepts) dom.aiCardSearchConcepts.textContent = '';
  if (dom.aiCardSearchDetails) dom.aiCardSearchDetails.textContent = '';
  if (dom.aiCardSearchStatus) dom.aiCardSearchStatus.textContent = '';
  hideAICardSearchRetryBtn();
}

function hideAICardSearchPanel() {
  if (dom.aiCardSearchPanel) dom.aiCardSearchPanel.hidden = true;
  document.body.classList.remove('ai-card-search-active');
  resetAICardSearchPanelContent();
}

function deactivateAICardSearch(options = {}) {
  if (!state.aiCardSearch) return;
  state.aiCardSearch.active = false;
  state.aiCardSearch.loading = false;
  state.aiCardSearch.requestId = '';
  state.aiCardSearch.query = '';
  state.aiCardSearch.analysis = null;
  state.aiCardSearch.resultCount = 0;
  state.aiCardSearch.error = '';
  state.aiCardSearch.localCards = [];
  state.aiCardSearch.modelReranked = false;
  state.aiCardSearch.lastRerankPayload = null;
  aiCardSearchContext = null;
  Array.from(pendingAICardSearchResolvers.keys()).forEach((requestId) => {
    cancelAICardSearchPending(requestId);
  });
  setAICardSearchLoading(false);
  if (options.keepPanel !== true) hideAICardSearchPanel();
}

window.deactivateAICardSearch = deactivateAICardSearch;

function appendAICardSearchChip(container, text, variant = '') {
  if (!container || !text) return;
  const chip = document.createElement('span');
  chip.className = `ai-card-search-chip${variant ? ` ${variant}` : ''}`;
  chip.textContent = text;
  container.appendChild(chip);
}

function renderAICardSearchLoading(query) {
  if (!dom.aiCardSearchPanel) return;
  dom.aiCardSearchPanel.hidden = false;
  document.body.classList.add('ai-card-search-active');
  resetAICardSearchPanelContent();
  appendAICardSearchChip(dom.aiCardSearchConcepts, query, 'is-query');
  dom.aiCardSearchStatus.textContent = '正在识别术语与义项';
}

function uniqueCandidateCanonicals(analysis) {
  const seen = new Set();
  const output = [];
  (analysis?.recallCandidates || analysis?.candidates || []).forEach((candidate) => {
    const canonical = String(candidate.canonical || '').trim();
    if (!canonical || seen.has(canonical)) return;
    seen.add(canonical);
    output.push({
      canonical,
      resolved: !!candidate.resolved,
      relation: candidate.matchedRelation,
    });
  });
  return output;
}

function renderAICardSearchResult(analysis, ranked, engine, options = {}) {
  if (!dom.aiCardSearchPanel) return;
  dom.aiCardSearchPanel.hidden = false;
  document.body.classList.add('ai-card-search-active');
  resetAICardSearchPanelContent();

  const concepts = uniqueCandidateCanonicals(analysis);
  if (concepts.length > 0) {
    concepts.slice(0, 5).forEach((concept) => {
      appendAICardSearchChip(
        dom.aiCardSearchConcepts,
        concept.canonical,
        concept.resolved ? 'is-resolved' : 'is-ambiguous',
      );
    });
  } else {
    appendAICardSearchChip(dom.aiCardSearchConcepts, analysis.query, 'is-query');
  }

  const matchedSurfaces = (analysis.matches || []).map((match) => match.surface).filter(Boolean);
  const recallCandidates = analysis.recallCandidates || analysis.candidates || [];
  const resolvedCount = recallCandidates.filter((candidate) => candidate.resolved).length;
  const ambiguousCount = Math.max(0, concepts.length - resolvedCount);
  const detailParts = [];
  if (state.activePresets?.size > 0) detailParts.push('正向筛选词暂不参与智能检索');
  if (matchedSurfaces.length > 0) detailParts.push(`识别 ${Array.from(new Set(matchedSurfaces)).join(' + ')}`);
  if (resolvedCount > 0) detailParts.push(`${resolvedCount} 个已消歧义项`);
  if (ambiguousCount > 0) detailParts.push(`${ambiguousCount} 个候选义项`);
  if (engine?.version) detailParts.push(`术语库 ${engine.version}`);
  dom.aiCardSearchDetails.textContent = detailParts.join(' · ') || '按原主题字段检索';
  if (options.reranking) {
    dom.aiCardSearchStatus.textContent = `${options.modelLabel || 'AI'} 精排中`;
  } else if (options.modelReranked) {
    dom.aiCardSearchStatus.textContent = `${options.modelLabel || 'AI'} 已精排 ${options.rerankedCount} 张 · 共 ${ranked.cards.length} 张`;
  } else if (options.fallbackError) {
    dom.aiCardSearchStatus.textContent = `本地结果 · ${options.fallbackError}`;
  } else {
    dom.aiCardSearchStatus.textContent = ranked.cards.length > 0
      ? `找到 ${ranked.cards.length} 张相关卡片`
      : '知识库中没有找到足够相关的卡片';
  }
}

function renderAICardSearchError(error) {
  if (!dom.aiCardSearchPanel) return;
  dom.aiCardSearchPanel.hidden = false;
  document.body.classList.add('ai-card-search-active');
  resetAICardSearchPanelContent();
  appendAICardSearchChip(dom.aiCardSearchConcepts, '检索未完成', 'is-error');
  dom.aiCardSearchStatus.textContent = String(error?.message || error || '未知错误');
}

function currentAICardSearchFilterOptions() {
  const payload = buildQueryPayload();
  return {
    payload,
    allowedTypes: payload.typeList,
    classificationSubtype: payload.classificationSubtype,
  };
}

function applyCurrentNegativeFilters(cards, payload) {
  const negativeTokens = (payload.excludePresets || []).map((word) => String(word || '').toLowerCase());
  return (cards || []).filter((card) => {
    if (!passesNegativeFilter(card, negativeTokens)) return false;
    if (!passesManualTitleExclusion(card, payload.manualExclusionTerms || [])) return false;
    return true;
  });
}

function showAICardSearchCards(cards) {
  cancelPendingFilterTask();
  cancelPendingResultRenderTask();
  state.filteredCards = cards.slice();
  rebuildFilteredCardLookup(state.filteredCards);
  filteredResultRenderSignatures = [];
  clearSelection();
  const initialCards = resetPaginationState(state.filteredCards);
  renderResults(initialCards);
  updateLoadMoreButton();
}

function captureAICardSearchContext(query) {
  return {
    query,
    cards: state.cards,
    revision: typeof searchExecutionRevision === 'number' ? searchExecutionRevision : 0,
    localRootId: state.localSearchRootId,
    localRequestId: state.localSearchRequestId,
  };
}

function isCurrentAICardSearchRequest(requestId) {
  if (!state.aiCardSearch.active || state.aiCardSearch.requestId !== requestId) return false;
  const context = aiCardSearchContext;
  if (
    !context
    || context.query !== String(dom.searchInput?.value || '').trim()
    || context.cards !== state.cards
    || context.revision !== (typeof searchExecutionRevision === 'number' ? searchExecutionRevision : 0)
    || context.localRootId !== state.localSearchRootId
    || context.localRequestId !== state.localSearchRequestId
    || state.localSearchLoading
  ) {
    deactivateAICardSearch();
    return false;
  }
  return true;
}

async function runAICardSearchRerank(requestId, ranked, analysis, engine, payload) {
  const modelLabel = selectedAICardSearchModelLabel();
  if (!isNativeAICardSearchRuntime()) return false;
  if (!modelLabel) {
    renderAICardSearchResult(analysis, ranked, engine, {
      fallbackError: '未选择可用的 MNAI 精排模型',
    });
    showAICardSearchRetryBtn();
    return false;
  }
  renderAICardSearchResult(analysis, ranked, engine, { reranking: true, modelLabel });
  const modelResult = await requestAICardSearchRerank(requestId, payload);
  if (!isCurrentAICardSearchRequest(requestId)) return false;
  if (modelResult?.cancelled) {
    renderAICardSearchResult(analysis, ranked, engine, { fallbackError: 'AI 精排已取消' });
    showAICardSearchRetryBtn();
    return false;
  }
  const candidateIds = payload.candidates.map((candidate) => candidate.id);
  const allowedIds = new Set(candidateIds);
  const validRanked = modelResult?.success === true
    && Array.isArray(modelResult.ranked)
    && modelResult.ranked.length > 0
    && modelResult.ranked.every((item) => typeof item?.id === 'string' && allowedIds.has(item.id));
  if (validRanked) {
    const rerankedCards = window.MNKBMathTermSearch.applyAIRerank(ranked.cards, modelResult, {
      modelLabel: modelResult.modelLabel || modelLabel,
      candidateIds,
    });
    const rerankedCount = rerankedCards.filter((card) => allowedIds.has(card.id) && card.__mnkbAISearch?.modelReranked).length;
    if (rerankedCount > 0) {
      ranked.cards = rerankedCards;
      state.aiCardSearch.modelReranked = true;
      state.aiCardSearch.resultCount = ranked.cards.length;
      showAICardSearchCards(ranked.cards);
      renderAICardSearchResult(analysis, ranked, engine, {
        modelReranked: true,
        modelLabel: modelResult.modelLabel || modelLabel,
        rerankedCount,
      });
      return true;
    }
  }
  renderAICardSearchResult(analysis, ranked, engine, {
    fallbackError: modelResult?.error || 'AI 未返回有效排序',
  });
  showAICardSearchRetryBtn();
  return false;
}

async function handleAICardSearchClick() {
  if (state.aiCardSearch.loading) return;
  if (aiCardSearchModelRequest?.kind === 'selection') {
    showToast('模型设置正在保存，请稍后重试');
    return;
  }
  const query = String(dom.searchInput?.value || '').trim();
  if (!query) {
    showToast('请先输入要查找的知识主题');
    dom.searchInput?.focus();
    return;
  }
  if (query.length > AI_CARD_SEARCH_QUERY_LIMIT) {
    showToast(`检索主题过长，请缩短至 ${AI_CARD_SEARCH_QUERY_LIMIT} 个字符以内`);
    dom.searchInput?.focus();
    return;
  }
  if (!state.hasRealData || !Array.isArray(state.cards) || state.cards.length === 0) {
    showToast('搜索索引尚未加载，请先刷新');
    return;
  }
  if (state.localSearchLoading) {
    showToast('局部搜索范围正在加载，请稍后重试');
    return;
  }

  deactivateAICardSearch({ keepPanel: true });
  state.userInput = query;
  const requestId = createAICardSearchRequestId();
  state.aiCardSearch.active = true;
  state.aiCardSearch.requestId = requestId;
  state.aiCardSearch.query = query;
  state.aiCardSearch.error = '';
  cancelPendingSearchDispatch();
  pendingSearchDispatchOptions = null;
  cancelPendingFilterTask();
  bumpSearchExecutionRevision('aiCardSearch');
  aiCardSearchContext = captureAICardSearchContext(query);
  setAICardSearchLoading(true);
  renderAICardSearchLoading(query);

  try {
    const engine = await loadMathTermSearchEngine();
    if (!isCurrentAICardSearchRequest(requestId)) return;
    const effectiveQuery = typeof window.MNKBMathTermSearch.augmentQueryWithSynonyms === 'function'
      ? window.MNKBMathTermSearch.augmentQueryWithSynonyms(query, state.config?.synonymGroups || [])
      : query;
    const analysis = window.MNKBMathTermSearch.queryRuntime(engine, effectiveQuery);
    const filterOptions = currentAICardSearchFilterOptions();
    const candidateCards = state.localSearchRootId
      ? state.cards.filter((card) => state.localSearchDescendantIds.has(String(card.id)))
      : state.cards;
    const eligibleCards = applyCurrentNegativeFilters(candidateCards, filterOptions.payload);
    const ranked = window.MNKBMathTermSearch.rankKnowledgeCards(
      eligibleCards,
      analysis,
      effectiveQuery,
      {
        maxCards: 80,
        allowedTypes: filterOptions.allowedTypes,
        classificationSubtype: filterOptions.classificationSubtype,
      },
    );
    if (!isCurrentAICardSearchRequest(requestId)) return;

    state.aiCardSearch.analysis = analysis;
    state.aiCardSearch.resultCount = ranked.cards.length;
    state.aiCardSearch.localCards = ranked.cards.slice();
    state.aiCardSearch.modelReranked = false;
    showAICardSearchCards(ranked.cards);
    renderAICardSearchResult(analysis, ranked, engine);

    const queryPlan = window.MNKBMathTermSearch.buildAnswerQueryPlan(query, analysis);
    const aiCandidates = window.MNKBMathTermSearch.buildAIRerankCandidates(ranked.cards, {
      limit: 40,
      queryPlan,
    });
    if (aiCandidates.length > 1 && isNativeAICardSearchRuntime()) {
      const rerankPayload = {
        requestId,
        query,
        queryPlan,
        interpretation: {
          concepts: uniqueCandidateCanonicals(analysis).slice(0, 8).map((item) => item.canonical),
          matchedSurfaces: Array.from(new Set((analysis.matches || []).map((item) => item.surface).filter(Boolean))).slice(0, 8),
        },
        candidates: aiCandidates,
      };
      state.aiCardSearch.lastRerankPayload = rerankPayload;
      await runAICardSearchRerank(requestId, ranked, analysis, engine, rerankPayload);
      if (!isCurrentAICardSearchRequest(requestId)) return;
    }
    if (typeof saveSearchHistory === 'function') {
      saveSearchHistory('ai', query, ranked.cards.length);
    }

    showMinorSuccessToast(`找到 ${ranked.cards.length} 张相关卡片`, 1000);
  } catch (error) {
    if (!isCurrentAICardSearchRequest(requestId)) return;
    state.aiCardSearch.error = String(error?.message || error || '未知错误');
    renderAICardSearchError(error);
    showToast(`AI 找卡片失败：${state.aiCardSearch.error}`, 2600);
  } finally {
    if (state.aiCardSearch.requestId === requestId) {
      setAICardSearchLoading(false);
    }
  }
}

function hideAICardSearchRetryBtn() {
  if (dom.aiCardSearchRetryBtn) dom.aiCardSearchRetryBtn.hidden = true;
}

function showAICardSearchRetryBtn() {
  if (dom.aiCardSearchRetryBtn && state.aiCardSearch.active && state.aiCardSearch.lastRerankPayload) {
    dom.aiCardSearchRetryBtn.hidden = false;
  }
}

async function retryAICardSearchRerank() {
  if (state.aiCardSearch.loading || !state.aiCardSearch.active) return;
  if (aiCardSearchModelRequest?.kind === 'selection') {
    showToast('模型设置正在保存，请稍后重试');
    return;
  }
  const payload = state.aiCardSearch.lastRerankPayload;
  if (!payload || !isCurrentAICardSearchRequest(state.aiCardSearch.requestId)) return;
  const analysis = state.aiCardSearch.analysis;
  if (!analysis || !Array.isArray(state.aiCardSearch.localCards)) return;
  hideAICardSearchRetryBtn();
  setAICardSearchLoading(true);
  state.aiCardSearch.modelReranked = false;
  if (dom.aiCardSearchStatus) dom.aiCardSearchStatus.textContent = '正在重新发送 AI 精排…';
  const requestId = createAICardSearchRequestId();
  state.aiCardSearch.requestId = requestId;
  const rerankPayload = {
    ...payload,
    requestId,
  };
  state.aiCardSearch.lastRerankPayload = rerankPayload;
  try {
    const engine = await loadMathTermSearchEngine();
    if (!isCurrentAICardSearchRequest(requestId)) return;
    const ranked = { cards: state.aiCardSearch.localCards.slice() };
    showAICardSearchCards(ranked.cards);
    const succeeded = await runAICardSearchRerank(requestId, ranked, analysis, engine, rerankPayload);
    if (!isCurrentAICardSearchRequest(requestId)) return;
    if (succeeded) {
      if (typeof saveSearchHistory === 'function') {
        const retryQuery = state.aiCardSearch.query;
        if (retryQuery) saveSearchHistory('ai', retryQuery, ranked.cards.length);
      }
      showMinorSuccessToast('AI 精排成功', 1000);
    }
  } catch (error) {
    if (!isCurrentAICardSearchRequest(requestId)) return;
    renderAICardSearchError(error);
    showToast('AI 精排重试失败：' + (error?.message || error), 2600);
    showAICardSearchRetryBtn();
  } finally {
    if (state.aiCardSearch.requestId === requestId) setAICardSearchLoading(false);
  }
}

function closeAICardSearchAndRestoreResults() {
  deactivateAICardSearch();
  lastExecutedSearchFingerprint = '';
  scheduleSearch({ triggerNative: false });
}

function attachAICardSearchListeners() {
  if (aiCardSearchListenersAttached) return;
  aiCardSearchListenersAttached = true;
  dom.aiCardSearchBtn?.addEventListener('click', handleAICardSearchClick);
  dom.aiCardSearchCloseBtn?.addEventListener('click', closeAICardSearchAndRestoreResults);
  dom.aiCardSearchModelSelect?.addEventListener('change', handleAICardSearchModelChange);
  dom.aiCardSearchRefreshModelsBtn?.addEventListener('click', () => {
    requestAICardSearchModelCatalog({ refresh: true });
  });
  dom.aiCardSearchRetryBtn?.addEventListener('click', retryAICardSearchRerank);
  window.addEventListener('pagehide', () => {
    deactivateAICardSearch();
    if (aiCardSearchModelRequest) clearTimeout(aiCardSearchModelRequest.timeoutId);
    aiCardSearchModelRequest = null;
    setAICardSearchModelLoading(false);
  });
  if (window.__MNKB_pendingAICardSearchModelOptions) {
    handleAICardSearchModelOptions(window.__MNKB_pendingAICardSearchModelOptions);
    window.__MNKB_pendingAICardSearchModelOptions = null;
  } else {
    renderAICardSearchModelCatalog();
    requestAICardSearchModelCatalog();
  }
}

window.handleAICardSearchClick = handleAICardSearchClick;
window.attachAICardSearchListeners = attachAICardSearchListeners;
window.handleAICardSearchModelOptions = handleAICardSearchModelOptions;
window.completeAICardSearchRerank = completeAICardSearchRerank;
window.takeAICardSearchRerankPayload = takeAICardSearchRerankPayload;
