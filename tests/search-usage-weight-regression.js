const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'scripts/search/app-core.js'), 'utf8');
const scoreSource = fs.readFileSync(path.join(root, 'scripts/search/app-filters-score.js'), 'utf8');
const querySource = fs.readFileSync(path.join(root, 'scripts/search/app-filters-query.js'), 'utf8');
const interactionsSource = fs.readFileSync(path.join(root, 'scripts/search/app-ui-interactions.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'scripts/search/app-ui.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'scripts/search/bridge.js'), 'utf8');
const aiCoreSource = fs.readFileSync(path.join(root, 'scripts/search/math-term-search-core.js'), 'utf8');

function extractBalancedBlock(source, marker, startOffset = 0) {
  const markerIndex = source.indexOf(marker, startOffset);
  assert.notStrictEqual(markerIndex, -1, `Cannot locate ${marker}`);
  const braceStart = source.indexOf('{', markerIndex + marker.length);
  assert.notStrictEqual(braceStart, -1, `Cannot locate body for ${marker}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          markerIndex,
          braceStart,
          end: index + 1,
          body: source.slice(braceStart + 1, index),
          source: source.slice(markerIndex, index + 1),
        };
      }
    }
  }
  throw new Error(`Unclosed body for ${marker}`);
}

function extractPrototypeMethod(name) {
  const marker = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = mainSource.indexOf(marker);
  assert.notStrictEqual(start, -1, `Cannot locate ${name}`);
  const next = mainSource.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + marker.length);
  assert.notStrictEqual(next, -1, `Cannot locate end of ${name}`);
  return mainSource.slice(start, next);
}

function assertFrontendRoundLifecycle() {
  const start = coreSource.indexOf('const SEARCH_USAGE_TIER_POINTS');
  const end = coreSource.indexOf('\nfunction getAIRecommendationById', start);
  assert.ok(start >= 0 && end > start, 'usage round helpers must remain available');

  const context = {
    Date,
    Number,
    Object,
    String,
    state: {
      searchUsageRoundSeq: 0,
      searchUsageRoundId: '',
      searchUsageAwaitingNewRound: true,
      searchUsageHadNonEmptyInput: false,
      userInput: '',
      filteredCards: [{ id: 'CARD-1', indexSource: 'main' }],
    },
    dom: { searchInput: { value: '' } },
    normalizeCardId(value) {
      return String(value || '').trim();
    },
  };
  context.getCardById = id => context.state.filteredCards.find(card => card.id === id) || null;
  vm.createContext(context);
  vm.runInContext(coreSource.slice(start, end), context);

  context.dom.searchInput.value = 'alpha';
  const first = context.buildSearchUsageParams('CARD-1', 10);
  assert.strictEqual(first.usageTier, 10);
  assert.strictEqual(first.indexSource, 'main');
  assert.ok(first.usageRoundId);

  const unchanged = context.buildSearchUsageParams('CARD-1', 5);
  assert.strictEqual(unchanged.usageRoundId, first.usageRoundId, 'unchanged input must retain the round');

  context.dom.searchInput.value = 'beta';
  context.syncSearchUsageRoundFromInput('beta');
  const editedNonEmpty = context.buildSearchUsageParams('CARD-1', 1);
  assert.strictEqual(editedNonEmpty.usageRoundId, first.usageRoundId, 'non-empty edits must remain in the round');

  context.dom.searchInput.value = '';
  context.syncSearchUsageRoundFromInput('');
  assert.strictEqual(Object.keys(context.buildSearchUsageParams('CARD-1', 10)).length, 0);

  context.dom.searchInput.value = 'alpha';
  const afterClear = context.buildSearchUsageParams('CARD-1', 10);
  assert.notStrictEqual(afterClear.usageRoundId, first.usageRoundId, 'clearing before searching again must open a new round');
}

function createNativeRuntime() {
  const mainIndex = { metadata: {}, cards: [] };
  const secondaryIndexes = new Map();
  const persistedPatches = [];
  const pushedPatches = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const KnowledgeBaseIndexer = {
    loadIncrementalIndex() {
      return clone(mainIndex);
    },
    saveIncrementalIndex(data) {
      Object.assign(mainIndex, clone(data));
      return true;
    },
    updateIncrementalRemovedIds(index, removedIds, restoredId) {
      index.metadata.removedIds = (index.metadata.removedIds || [])
        .filter(id => id !== restoredId && !removedIds.includes(id));
    },
  };
  const IntermediateKnowledgeIndexer = {
    loadIncrementalIndex(indexPrefix) {
      return clone(secondaryIndexes.get(indexPrefix) || { metadata: {}, cards: [] });
    },
    saveIncrementalIndex(data, indexPrefix) {
      secondaryIndexes.set(indexPrefix, clone(data));
      return true;
    },
  };
  const context = {
    Array,
    Date,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    KnowledgeBaseIndexer,
    IntermediateKnowledgeIndexer,
    KnowledgeBaseUtils: {
      webViewController: {
        webViewLoaded: true,
        currentHTMLType: 'search',
        webView: {},
      },
    },
  };
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext([
    'function MNKnowledgeBaseClass() {}',
    extractPrototypeMethod('mergeCardsById'),
    extractPrototypeMethod('normalizeSearchUsageScore'),
    extractPrototypeMethod('persistSearchUsageCard'),
    extractPrototypeMethod('recordSearchCardUsage'),
    extractPrototypeMethod('_recordSearchCardUsage'),
    'this.MNKnowledgeBaseClass = MNKnowledgeBaseClass;',
  ].join('\n'), context);

  const instance = new context.MNKnowledgeBaseClass();
  instance.enqueueSearchDataOperation = (label, operation) => operation();
  instance.resolveSearchIndexSource = (id, requested) => requested || (id === 'CARD-I' ? 'intermediate' : 'main');
  instance.getSearchIndexSourceSpec = source => ({
    source,
    indexPrefix: source === 'main' ? '' : `${source}-kb-index`,
  });
  instance.recordPersistedSearchIndexPatch = (patch) => {
    persistedPatches.push(clone(patch));
    instance._webViewSearchDataCache.fullIndexData.cards = instance.mergeCardsById(
      instance._webViewSearchDataCache.fullIndexData.cards,
      patch.upserts,
      patch.removedIds,
    );
  };
  instance.pushSearchIndexPatchToWebView = async (patch) => {
    pushedPatches.push(clone(patch));
    return true;
  };
  instance._webViewSearchDataCache = {
    fullIndexData: {
      cards: [
        { id: 'CARD-1', title: 'Main', indexSource: 'main', usageScore: 0 },
        { id: 'CARD-I', title: 'Intermediate', indexSource: 'intermediate', usageScore: 7 },
      ],
    },
  };

  return { instance, mainIndex, secondaryIndexes, persistedPatches, pushedPatches };
}

async function assertNativeCreditAndPersistence() {
  const runtime = createNativeRuntime();
  const { instance, mainIndex, secondaryIndexes, persistedPatches, pushedPatches } = runtime;

  let result = await instance.recordSearchCardUsage('CARD-1', 1, 'round-a', { indexSource: 'main' });
  assert.strictEqual(result.credited, 1);
  assert.strictEqual(result.usageScore, 1);

  result = await instance.recordSearchCardUsage('CARD-1', 1, 'round-a', { indexSource: 'main' });
  assert.strictEqual(result.credited, 0, 'same tier in the same round must not repeat');

  result = await instance.recordSearchCardUsage('CARD-1', 5, 'round-a', { indexSource: 'main' });
  assert.strictEqual(result.credited, 4, 'higher tier in the same round must add only the difference');
  assert.strictEqual(result.usageScore, 5);

  result = await instance.recordSearchCardUsage('CARD-1', 1, 'round-b', { indexSource: 'main' });
  assert.strictEqual(result.credited, 1, 'a new round must credit the card again');
  assert.strictEqual(result.usageScore, 6);

  result = await instance.recordSearchCardUsage('CARD-1', 10, 'round-a', { indexSource: 'main' });
  assert.strictEqual(result.credited, 5, 'interleaved older rounds must retain their own highest tier');
  assert.strictEqual(result.usageScore, 11);
  assert.strictEqual(mainIndex.cards.find(card => card.id === 'CARD-1').usageScore, 11);
  assert.strictEqual(persistedPatches.length, 4);
  assert.strictEqual(pushedPatches.length, 4);

  result = await instance.recordSearchCardUsage('CARD-I', 1, 'round-i', { indexSource: 'intermediate' });
  assert.strictEqual(result.usageScore, 8);
  assert.strictEqual(
    secondaryIndexes.get('intermediate-kb-index').cards.find(card => card.id === 'CARD-I').usageScore,
    8,
    'secondary sources must persist into their own incremental JSON',
  );

  instance._webViewSearchDataCache.fullIndexData.cards = instance.mergeCardsById(
    instance._webViewSearchDataCache.fullIndexData.cards,
    [{ id: 'CARD-1', title: 'Main', indexSource: 'main', usageScore: 999 }],
  );
  result = await instance.recordSearchCardUsage('CARD-1', 10, 'round-cap-a', { indexSource: 'main' });
  assert.strictEqual(result.credited, 1);
  assert.strictEqual(result.usageScore, 1000);
  const patchCountAtCap = persistedPatches.length;
  result = await instance.recordSearchCardUsage('CARD-1', 10, 'round-cap-b', { indexSource: 'main' });
  assert.strictEqual(result.credited, 0);
  assert.strictEqual(result.reason, 'usage-score-capped');
  assert.strictEqual(persistedPatches.length, patchCountAtCap, 'capped scores must not rewrite the index');

  const merged = instance.mergeCardsById(
    [{ id: 'DUP', title: 'old', usageScore: 80 }],
    [{ id: 'DUP', title: 'new', usageScore: 10 }],
  );
  assert.strictEqual(merged[0].title, 'new');
  assert.strictEqual(merged[0].usageScore, 80, 'duplicate sources must keep the maximum usage score');
}

function assertPersistedScoreInheritance() {
  const firstMethod = extractBalancedBlock(utilsSource, "static getPersistedUsageScoreMap(mode = 'light')");
  const getMainScores = vm.runInNewContext(`(function(mode = 'light') {${firstMethod.body}})`, {
    Array,
    Map,
    String,
    KnowledgeBaseUtils: { addErrorLog() {} },
  });
  const mainScores = getMainScores.call({
    normalizeUsageScore(value) {
      return Math.min(1000, Math.max(0, Number(value) || 0));
    },
    loadIndexManifest() {
      return { parts: [{ filename: 'part-1.json' }] };
    },
    loadIndexPart() {
      return { data: [{ id: 'A', usageScore: 4 }, { id: 'B', usageScore: 6 }] };
    },
    loadIndex() {
      return { cards: [{ id: 'A', usageScore: 3 }] };
    },
    loadIncrementalIndex() {
      return { cards: [{ id: 'A', usageScore: 9 }] };
    },
  }, 'light');
  assert.strictEqual(mainScores.get('A'), 9);
  assert.strictEqual(mainScores.get('B'), 6);

  assert.match(utilsSource, /buildIndexEntry\(rootNote, mode, \{\s*usageScore: usageScoreMap\.get/);
  assert.match(utilsSource, /buildIndexEntry\(mnNote, mode, \{\s*usageScore: usageScoreMap\.get/);
  assert.match(utilsSource, /usageScore: usageScoreMap\.get\(String\(noteId\)\) \|\| 0/);
  assert.ok(
    utilsSource.indexOf('const usageScoreMap = this.getPersistedUsageScoreMap(mode)')
      < utilsSource.indexOf('this.clearIncrementalIndex();'),
    'main rebuild must read usage scores before clearing incremental overrides',
  );
  assert.ok(
    utilsSource.indexOf('const usageScoreMap = this.getPersistedUsageScoreMap(indexPrefix)')
      < utilsSource.indexOf('this.clearIncrementalIndex(indexPrefix);'),
    'secondary rebuild must read usage scores before clearing incremental overrides',
  );
}

function assertRankingAndActionWiring() {
  const contributionBlock = extractBalancedBlock(scoreSource, 'function calculateUsageContribution(usageScore)');
  const calculate = vm.runInNewContext(`(${contributionBlock.source})`, { Math, Number });
  assert.strictEqual(calculate(0), 0);
  assert.ok(Math.abs(calculate(10) - (40 / 11)) < 1e-9);
  assert.strictEqual(calculate(100), 20);
  assert.ok(Math.abs(calculate(1000) - (400 / 11)) < 1e-9);
  assert.strictEqual(calculate(100000), calculate(1000), 'ranking input must share the storage cap');

  assert.match(querySource, /evaluation\.score \+ calculateUsageContribution\(card\.usageScore\)/);
  assert.doesNotMatch(aiCoreSource, /usageScore|calculateUsageContribution/, 'AI ranking must remain independent of usage weight');

  assert.match(interactionsSource, /copyMarkdownLink[\s\S]*?SEARCH_USAGE_TIER_POINTS\.link/);
  assert.match(interactionsSource, /bidirectionalLinkFromeFocusNoteToTargetNote[\s\S]*?SEARCH_USAGE_TIER_POINTS\.link/);
  assert.match(uiSource, /focusCardInMindMap[\s\S]*?SEARCH_USAGE_TIER_POINTS\.locate/);
  assert.match(interactionsSource, /focusFirstExcerptInDocument[\s\S]*?SEARCH_USAGE_TIER_POINTS\.auxiliary/);
  assert.match(interactionsSource, /pinToCurrentNode[\s\S]*?SEARCH_USAGE_TIER_POINTS\.auxiliary/);
  assert.match(interactionsSource, /activateLocalSearch[\s\S]*?SEARCH_USAGE_TIER_POINTS\.auxiliary/);
  assert.doesNotMatch(
    interactionsSource.match(/function handleRefreshSearchIndexCardAction[\s\S]*?\n}/)?.[0] || '',
    /SEARCH_USAGE_TIER_POINTS/,
  );
  assert.doesNotMatch(
    interactionsSource.match(/function handleCopyUrlCardAction[\s\S]*?\n}/)?.[0] || '',
    /SEARCH_USAGE_TIER_POINTS/,
  );
  assert.match(bridgeSource, /usageRoundId: options\.usageRoundId \|\| ''/);
  assert.match(controllerSource, /success === true[\s\S]*?recordSearchCardUsage/);
}

Promise.resolve()
  .then(assertFrontendRoundLifecycle)
  .then(assertNativeCreditAndPersistence)
  .then(assertPersistedScoreInheritance)
  .then(assertRankingAndActionWiring)
  .then(() => {
    console.log('search usage weight regression ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
