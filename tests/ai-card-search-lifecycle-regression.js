'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const searchCore = require('../scripts/search/math-term-search-core.js');
const source = fs.readFileSync(path.join(__dirname, '../scripts/search/app-ai-search.js'), 'utf8');
const querySource = fs.readFileSync(path.join(__dirname, '../scripts/search/app-filters-query.js'), 'utf8');
const sourceFilter = querySource.slice(querySource.indexOf('function passesSearchSourceFilter('), querySource.indexOf('\nfunction processCardForFilter('));

function element(tagName = 'div') {
  let text = '';
  return {
    tagName,
    children: [],
    dataset: {},
    attributes: {},
    listeners: {},
    hidden: false,
    disabled: false,
    value: '',
    classList: { add() {}, remove() {} },
    set textContent(value) { text = String(value); this.children = []; },
    get textContent() { return text; },
    set innerHTML(value) { throw new Error(`Unsafe HTML assignment: ${value}`); },
    get options() {
      return this.children.flatMap((child) => child.tagName === 'option' ? [child] : child.options);
    },
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    addEventListener(name, callback) {
      (this.listeners[name] ||= []).push(callback);
    },
  };
}

function makeHarness(options = {}) {
  let timerSequence = 0;
  const timers = new Map();
  const calls = { requests: [], cancels: [], models: [], selections: [], renders: [], toasts: [], history: [], rankedInputs: [] };
  const dom = Object.fromEntries([
    'aiCardSearchBtn', 'aiCardSearchRetryBtn', 'aiCardSearchRefreshModelsBtn', 'aiCardSearchPanel',
    'aiCardSearchConcepts', 'aiCardSearchDetails', 'aiCardSearchStatus', 'aiCardSearchCloseBtn',
    'searchInput',
  ].map((name) => [name, element()]));
  dom.aiCardSearchModelSelect = element('select');
  dom.aiCardSearchPanel.hidden = true;
  dom.aiCardSearchRetryBtn.hidden = true;
  dom.searchInput.value = options.query || '强算子收敛';
  const state = {
    cards: options.cards || [{ id: 'a', title: '强算子收敛' }, { id: 'b', title: '弱算子收敛' }],
    hasRealData: true,
    config: {},
    localSearchRootId: null,
    localSearchRequestId: '',
    localSearchLoading: false,
    localSearchDescendantIds: new Set(),
    aiCardSearch: {
      requestSeq: 0, active: false, loading: false,
      selectedSource: options.noModel ? '' : 'Subscription',
      selectedModel: options.noModel ? '' : 'model-a',
      modelCatalog: null, modelLoading: false,
    },
  };
  const document = { createElement: element, head: element('head'), body: element('body') };
  const win = {
    location: { protocol: options.protocol || 'file:' },
    listeners: {},
    addEventListener: element().addEventListener,
    __MNKB_MATH_TERM_CORPUS__: options.noCorpus ? undefined : { version: 'test' },
    MNKBMathTermSearch: {
      createRuntimeEngine(runtime) { return runtime; },
      queryRuntime(engine, query) {
        if (options.throwQuery) throw new Error('broken query');
        return { query, matches: [], candidates: [] };
      },
      rankKnowledgeCards(cards, analysis, query, rankOptions) {
        calls.rankedInputs.push(cards.map((card) => card.id));
        return { cards: cards.slice(0, rankOptions.maxCards) };
      },
      buildAnswerQueryPlan(query) { return { query }; },
      buildAIRerankCandidates(cards, buildOptions) {
        return cards.slice(0, options.candidateLimit || buildOptions.limit).map((card) => ({ id: card.id }));
      },
      applyAIRerank: searchCore.applyAIRerank,
    },
  };
  if (!options.noBridge) {
    win.Bridge = {
      requestAICardSearchRerank(payload) {
        calls.requests.push(payload);
        if (options.throwBridge) throw new Error('bridge exception');
        return options.dispatch !== false;
      },
      cancelAICardSearchRerank(payload) { calls.cancels.push(payload); },
      requestAICardSearchModels(payload) { calls.models.push(payload); return true; },
      setAICardSearchModel(payload) { calls.selections.push(payload); return options.selectionDispatch !== false; },
    };
  }
  const context = {
    console, document, window: win, state, dom,
    setTimeout(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    showToast(message) { calls.toasts.push(message); },
    showMinorSuccessToast(message) { calls.toasts.push(message); },
    cancelPendingSearchDispatch() {}, cancelPendingFilterTask() {}, cancelPendingResultRenderTask() {},
    pendingSearchDispatchOptions: null, filteredResultRenderSignatures: [], lastExecutedSearchFingerprint: '',
    searchExecutionRevision: 0,
    bumpSearchExecutionRevision() { context.searchExecutionRevision += 1; },
    buildQueryPayload() { return { excludePresets: ['excluded'], manualExclusionTerms: [], typeList: null }; },
    passesNegativeFilter(card) { return !card.excluded; },
    passesManualTitleExclusion(card) { return !card.manualExcluded; },
    rebuildFilteredCardLookup() {}, clearSelection() {},
    resetPaginationState(cards) { return cards; },
    renderResults(cards) { calls.renders.push(cards.map((card) => card.id)); },
    updateLoadMoreButton() {},
    saveSearchHistory(...args) { calls.history.push(args); },
    scheduleSearch() {},
  };
  vm.createContext(context);
  vm.runInContext(sourceFilter, context);
  vm.runInContext(source, context);
  return {
    state, dom, win, document, context, calls, options, timers,
    pendingCount() { return vm.runInContext('pendingAICardSearchResolvers.size + pendingAICardSearchPayloads.size', context); },
    fireTimers(delay) {
      Array.from(timers).filter(([, timer]) => timer.delay === delay).forEach(([id, timer]) => {
        timers.delete(id);
        timer.callback();
      });
    },
    complete(requestId, ranked = [{ id: 'b', relevance: 96, reason: '答案卡片' }]) {
      return context.completeAICardSearchRerank({ requestId, success: true, ranked });
    },
  };
}

async function drain() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function catalog(requestId = '', selectedModel = 'model-a', extra = {}) {
  return {
    requestId,
    sources: [{ source: 'Subscription', models: ['model-a', 'model-b'] }],
    selected: { source: 'Subscription', model: selectedModel },
    ...extra,
  };
}

async function verifyLoadingAndCleanup() {
  for (const options of [{ noBridge: true }, { throwBridge: true }, { dispatch: false }]) {
    const h = makeHarness(options);
    await h.context.handleAICardSearchClick();
    assert.strictEqual(h.state.aiCardSearch.loading, false, 'failed dispatch releases loading immediately');
    assert.strictEqual(h.pendingCount(), 0, 'failed dispatch must release its resolver and candidate payload');
    assert.strictEqual(h.timers.size, 0);
    assert.strictEqual(h.dom.aiCardSearchRetryBtn.hidden, false);
    assert.match(h.dom.aiCardSearchStatus.textContent, /通道不可用/);
  }

  const h = makeHarness();
  const first = h.context.handleAICardSearchClick();
  await drain();
  const requestId = h.calls.requests[0].requestId;
  await h.context.handleAICardSearchClick();
  await h.context.retryAICardSearchRerank();
  assert.strictEqual(h.calls.requests.length, 1, 'repeated clicks must not launch duplicate Native calls');
  assert.strictEqual(h.dom.aiCardSearchBtn.disabled, true);
  assert.strictEqual(h.dom.aiCardSearchRetryBtn.disabled, true);
  h.complete(requestId);
  await first;
  assert.strictEqual(h.state.aiCardSearch.loading, false);
  assert.strictEqual(h.state.aiCardSearch.modelReranked, true);
  assert.strictEqual(h.state.filteredCards[0].id, 'b');
  assert.match(h.dom.aiCardSearchStatus.textContent, /已精排 1 张 · 共 2 张/);
  assert.strictEqual(h.calls.cancels.length, 0, 'successful completion must not cancel the Native request');
  assert.strictEqual(h.pendingCount(), 0);
  assert.strictEqual(h.complete(requestId), false, 'duplicate completion must be ignored');

  const timeoutHarness = makeHarness();
  const timed = timeoutHarness.context.handleAICardSearchClick();
  await drain();
  timeoutHarness.fireTimers(120000);
  await timed;
  assert.strictEqual(timeoutHarness.calls.cancels.length, 1);
  assert.strictEqual(timeoutHarness.state.aiCardSearch.loading, false);
  assert.strictEqual(timeoutHarness.dom.aiCardSearchRetryBtn.hidden, false);
  assert.match(timeoutHarness.dom.aiCardSearchStatus.textContent, /精排超时/);
  assert.strictEqual(timeoutHarness.pendingCount(), 0);

  const cancelledHarness = makeHarness();
  const cancelled = cancelledHarness.context.handleAICardSearchClick();
  await drain();
  cancelledHarness.context.completeAICardSearchRerank({
    requestId: cancelledHarness.calls.requests[0].requestId,
    success: false,
    cancelled: true,
  });
  await cancelled;
  assert.strictEqual(cancelledHarness.state.aiCardSearch.loading, false);
  assert.strictEqual(cancelledHarness.dom.aiCardSearchRetryBtn.hidden, false);
  assert.match(cancelledHarness.dom.aiCardSearchStatus.textContent, /精排已取消/);
}

async function verifyCorpusTimeoutAndRecovery() {
  const h = makeHarness({ noCorpus: true, noModel: true });
  const first = h.context.handleAICardSearchClick();
  assert.strictEqual(h.document.head.children.length, 1);
  h.fireTimers(15000);
  await first;
  assert.strictEqual(h.state.aiCardSearch.loading, false);
  assert.match(h.dom.aiCardSearchStatus.textContent, /术语库加载超时/);
  assert.strictEqual(h.document.head.children[0].removed, true);
  assert.strictEqual(h.document.head.children[0].onload, null);
  assert.strictEqual(h.dom.aiCardSearchRetryBtn.hidden, true, 'a failed corpus load has no rerank payload to retry');
  const second = h.context.handleAICardSearchClick();
  assert.strictEqual(h.document.head.children.length, 2, 'timeout must permit a fresh script load');
  h.win.__MNKB_MATH_TERM_CORPUS__ = { version: 'test-recovered' };
  h.document.head.children[1].onload();
  await second;
  assert.strictEqual(h.state.aiCardSearch.resultCount, 2);
  assert.strictEqual(h.state.aiCardSearch.loading, false);
  assert.strictEqual(h.timers.size, 0);
}

async function verifyContextIsolation() {
  const mutations = [
    (h) => h.context.deactivateAICardSearch(),
    (h) => { h.dom.searchInput.value = '新的查询'; },
    (h) => { h.state.cards = [{ id: 'new', title: 'new' }]; },
    (h) => { h.context.searchExecutionRevision += 1; },
    (h) => { h.state.localSearchRootId = 'new-root'; h.state.localSearchLoading = true; },
  ];
  for (const mutate of mutations) {
    const h = makeHarness();
    const search = h.context.handleAICardSearchClick();
    await drain();
    const requestId = h.calls.requests[0].requestId;
    const renderCount = h.calls.renders.length;
    mutate(h);
    h.complete(requestId);
    await search;
    assert.strictEqual(h.calls.renders.length, renderCount, 'stale completion must not repaint old results');
    assert.strictEqual(h.state.aiCardSearch.active, false);
    assert.strictEqual(h.state.aiCardSearch.loading, false);
    assert.strictEqual(h.calls.history.length, 0, 'cancelled queries must not reappear in history');
    assert.strictEqual(h.dom.aiCardSearchPanel.hidden, true);
    assert.strictEqual(h.pendingCount(), 0);
  }

  const h = makeHarness({ noCorpus: true });
  const loading = h.context.handleAICardSearchClick();
  h.context.deactivateAICardSearch();
  h.win.__MNKB_MATH_TERM_CORPUS__ = { version: 'late' };
  h.document.head.children[0].onload();
  await loading;
  assert.strictEqual(h.calls.renders.length, 0, 'late corpus load must not reopen the closed panel');
  assert.strictEqual(h.calls.requests.length, 0);
}

async function verifyScopeAndNegativeRecall() {
  const longQuery = makeHarness({ query: '概'.repeat(501) });
  await longQuery.context.handleAICardSearchClick();
  assert.strictEqual(longQuery.calls.rankedInputs.length, 0, 'local and model queries must not silently diverge by truncation');
  assert.match(longQuery.calls.toasts[0], /500/);

  const loading = makeHarness();
  loading.state.localSearchRootId = 'root';
  loading.state.localSearchLoading = true;
  await loading.context.handleAICardSearchClick();
  assert.strictEqual(loading.calls.rankedInputs.length, 0, 'loading local scope must never fall through to the whole library');
  assert.strictEqual(loading.calls.requests.length, 0);

  const cards = Array.from({ length: 80 }, (_, index) => ({ id: `excluded-${index}`, title: 'excluded', excluded: true }));
  cards.push({ id: 'manual', title: 'manual', manualExcluded: true }, { id: 'eligible', title: 'eligible' });
  const h = makeHarness({ cards });
  await h.context.handleAICardSearchClick();
  assert.deepStrictEqual(h.calls.rankedInputs[0], ['eligible'], 'apply exclusions before the top-80 cap');
  assert.strictEqual(h.state.filteredCards[0].id, 'eligible');
  assert.strictEqual(h.dom.aiCardSearchRetryBtn.hidden, true, 'a single candidate does not need a dead retry control');

  const local = makeHarness({ noModel: true });
  local.state.localSearchRootId = 'root';
  local.state.localSearchDescendantIds = new Set(['b']);
  await local.context.handleAICardSearchClick();
  assert.deepStrictEqual(local.calls.rankedInputs[0], ['b']);
}

async function verifyRetryLifecycleAndIdentity() {
  const h = makeHarness({ noModel: true });
  await h.context.handleAICardSearchClick();
  assert.ok(h.state.aiCardSearch.lastRerankPayload, 'local fallback must retain a retryable payload even before models arrive');
  assert.strictEqual(h.dom.aiCardSearchRetryBtn.hidden, false);
  h.context.handleAICardSearchModelOptions(catalog());
  const retry = h.context.retryAICardSearchRerank();
  await drain();
  await h.context.retryAICardSearchRerank();
  await h.context.handleAICardSearchClick();
  assert.strictEqual(h.calls.requests.length, 1);
  assert.strictEqual(h.state.aiCardSearch.loading, true);
  h.complete(h.calls.requests[0].requestId);
  await retry;
  assert.strictEqual(h.state.aiCardSearch.loading, false);
  assert.strictEqual(h.state.aiCardSearch.modelReranked, true);
  assert.strictEqual(h.dom.aiCardSearchRetryBtn.hidden, true);

  h.dom.searchInput.value = 'broken';
  h.options.throwQuery = true;
  await h.context.handleAICardSearchClick();
  assert.strictEqual(h.state.aiCardSearch.lastRerankPayload, null, 'new failed queries cannot retry old candidate data');
  assert.strictEqual(h.dom.aiCardSearchRetryBtn.hidden, true);

  for (const id of ['unknown', 'not-sent']) {
    const unsafe = makeHarness({ cards: [{ id: 'a' }, { id: 'b' }, { id: 'not-sent' }], candidateLimit: 2 });
    const search = unsafe.context.handleAICardSearchClick();
    await drain();
    unsafe.complete(unsafe.calls.requests[0].requestId, [{ id, relevance: 99 }]);
    await search;
    assert.strictEqual(unsafe.state.aiCardSearch.modelReranked, false, 'unknown or unsent IDs must not produce a success badge');
    assert.strictEqual(unsafe.dom.aiCardSearchRetryBtn.hidden, false);
    assert.strictEqual(unsafe.state.filteredCards[0].id, 'a');
    assert.match(unsafe.dom.aiCardSearchStatus.textContent, /未返回有效排序/);
  }
}

async function verifyCatalogReceipts() {
  const h = makeHarness();
  assert.strictEqual(h.context.handleAICardSearchModelOptions(catalog()), true);
  h.context.requestAICardSearchModelCatalog({ refresh: true });
  const oldRequestId = h.calls.models[0].requestId;
  h.dom.aiCardSearchModelSelect.value = JSON.stringify(['Subscription', 'model-b']);
  h.context.handleAICardSearchModelChange();
  const selectionId = h.calls.selections[0].requestId;
  assert.strictEqual(h.state.aiCardSearch.selectedModel, 'model-a', 'model changes need Native acknowledgement');
  assert.strictEqual(h.dom.aiCardSearchModelSelect.disabled, true);
  await h.context.handleAICardSearchClick();
  assert.strictEqual(h.calls.requests.length, 0, 'a pending explicit model selection must not launch the previous model');
  assert.strictEqual(h.context.handleAICardSearchModelOptions(catalog(oldRequestId)), false);
  assert.strictEqual(h.state.aiCardSearch.modelLoading, true, 'old catalog must not settle a newer model selection');
  assert.strictEqual(h.context.handleAICardSearchModelOptions(catalog(selectionId, 'model-b')), true);
  assert.strictEqual(h.state.aiCardSearch.selectedModel, 'model-b');
  assert.strictEqual(h.state.aiCardSearch.modelLoading, false);
  assert.strictEqual(h.dom.aiCardSearchModelSelect.disabled, false);
  assert.strictEqual(h.context.handleAICardSearchModelOptions(catalog(selectionId)), false, 'duplicate receipts cannot undo a saved model');
  assert.strictEqual(h.context.handleAICardSearchModelOptions(catalog()), false, 'unidentified receipts cannot replace a requested catalog');

  h.context.requestAICardSearchModelCatalog({ refresh: true });
  const timedId = h.calls.models[1].requestId;
  h.fireTimers(30000);
  assert.strictEqual(h.state.aiCardSearch.modelLoading, false);
  assert.strictEqual(h.dom.aiCardSearchRefreshModelsBtn.disabled, false);
  assert.strictEqual(h.context.handleAICardSearchModelOptions(catalog(timedId)), false, 'timed-out catalogs stay invalidated');
  assert.strictEqual(h.state.aiCardSearch.selectedModel, 'model-b');

  h.dom.aiCardSearchModelSelect.value = JSON.stringify(['Subscription', 'model-a']);
  h.context.handleAICardSearchModelChange();
  const rejectedId = h.calls.selections[1].requestId;
  h.context.handleAICardSearchModelOptions(catalog(rejectedId, 'model-b', { error: '模型已移除' }));
  assert.strictEqual(h.state.aiCardSearch.selectedModel, 'model-b', 'failed selection restores the acknowledged model');
  assert.match(h.calls.toasts[h.calls.toasts.length - 1], /模型已移除/);

  const invalid = makeHarness();
  invalid.context.handleAICardSearchModelOptions(catalog('', 'not-in-catalog'));
  assert.strictEqual(invalid.state.aiCardSearch.selectedModel, '');
  assert.strictEqual(invalid.dom.aiCardSearchModelSelect.value, '', 'visible model must agree with actual request state');
  const absent = makeHarness({ noBridge: true });
  absent.context.requestAICardSearchModelCatalog();
  assert.strictEqual(absent.timers.size, 0);
  assert.strictEqual(absent.state.aiCardSearch.modelLoading, false);
}

async function verifyListenersLocalModeAndTextSafety() {
  const local = makeHarness({ protocol: 'http:', noModel: true, query: '<img src=x onerror=alert(1)>' });
  local.context.attachAICardSearchListeners();
  local.context.attachAICardSearchListeners();
  assert.strictEqual(local.dom.aiCardSearchBtn.listeners.click.length, 1);
  assert.strictEqual(local.dom.aiCardSearchRetryBtn.listeners.click.length, 1);
  await local.context.handleAICardSearchClick();
  assert.strictEqual(local.calls.requests.length, 0);
  assert.strictEqual(local.dom.aiCardSearchRetryBtn.hidden, true);
  assert.strictEqual(local.dom.aiCardSearchConcepts.children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(local.dom.aiCardSearchStatus.textContent, /未选择/);
  local.state.activePresets = new Set(['基本性质']);
  await local.context.handleAICardSearchClick();
  assert.match(local.dom.aiCardSearchDetails.textContent, /正向筛选词暂不参与智能检索/);

  const h = makeHarness();
  h.context.attachAICardSearchListeners();
  const search = h.context.handleAICardSearchClick();
  await drain();
  h.win.listeners.pagehide[0]();
  await search;
  assert.strictEqual(h.calls.cancels.length, 1);
  assert.strictEqual(h.pendingCount(), 0);
  assert.strictEqual(h.timers.size, 0);
  assert.strictEqual(h.state.aiCardSearch.loading, false);
  assert.strictEqual(h.state.aiCardSearch.modelLoading, false);
}

(async () => {
  await verifyLoadingAndCleanup();
  await verifyCorpusTimeoutAndRecovery();
  await verifyContextIsolation();
  await verifyScopeAndNegativeRecall();
  await verifyRetryLifecycleAndIdentity();
  await verifyCatalogReceipts();
  await verifyListenersLocalModeAndTextSafety();
  console.log('AI card search lifecycle regression passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
