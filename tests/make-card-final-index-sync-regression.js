const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');

const addonRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(addonRoot, '..');
const utilsSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

const mainUpserts = [];
const mainRemovals = [];
const intermediateUpserts = [];
const intermediateRemovals = [];
const persistedPatches = [];
const pushedPatches = [];

const context = {
  console,
  Map,
  Set,
  WeakMap,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Date,
  Math,
  Promise,
  KnowledgeBaseConfig: {
    getSearchIndexMode() {
      return 'full';
    },
  },
  KnowledgeBaseIndexer: {
    upsertIncrementalIndexEntry(note, mode, options) {
      mainUpserts.push({ note, mode, options, finalContent: note.finalContent });
      if (note.failMainIndex) return { success: false, error: 'main failed' };
      return {
        success: true,
        entry: { id: note.noteId, title: note.title, searchText: note.finalContent },
        removedIds: options.staleIds || [],
      };
    },
    removeFromIncrementalIndex(noteId) {
      mainRemovals.push(String(noteId));
      return { success: true, removedIds: [String(noteId)] };
    },
  },
  IntermediateKnowledgeIndexer: {
    upsertIncrementalIndexEntry(note, options) {
      intermediateUpserts.push({ note, options, finalContent: note.finalContent });
      return {
        success: true,
        entry: { id: note.noteId, title: note.title, searchText: note.finalContent },
        removedIds: options.staleIds || [],
      };
    },
    removeFromIncrementalIndex(noteId, options = {}) {
      intermediateRemovals.push({
        noteId: String(noteId),
        indexPrefix: options.indexPrefix || 'intermediate-kb-index',
      });
      return { success: true, removedIds: [String(noteId)] };
    },
    removeManyFromIncrementalIndex(noteIds, options = {}) {
      const indexPrefix = options.indexPrefix || 'intermediate-kb-index';
      noteIds.forEach(noteId => intermediateRemovals.push({
        noteId: String(noteId),
        indexPrefix,
      }));
      return { success: true, removedIds: noteIds.map(String), indexPrefix };
    },
  },
  KnowledgeBaseUtils: {
    webViewController: {
      webViewLoaded: true,
      currentHTMLType: 'search',
      webView: {},
    },
    addErrorLog(error) {
      throw error;
    },
    log() {},
  },
  MNUtil: {
    showHUD() {},
  },
  HtmlMarkdownUtils: {
    isHtmlMDComment() {
      return false;
    },
  },
};
context.global = context;
context.globalThis = context;
context.MNKnowledgeBaseInstance = {
  enqueueSearchDataOperation(label, operation) {
    return Promise.resolve().then(operation);
  },
  recordPersistedSearchIndexPatch(patchData) {
    persistedPatches.push(patchData);
  },
  pushSearchIndexPatchToWebView(patchData) {
    pushedPatches.push(patchData);
    return Promise.resolve({ ok: true });
  },
  isWebViewPushResultSuccess(result) {
    return !!(result && result.ok);
  },
  _loadSearchDataToWebView() {
    throw new Error('successful patch must not need a full refresh');
  },
};

const templateEnd = utilsSource.indexOf('\nclass KnowledgeBaseIndexer');
assert.notStrictEqual(templateEnd, -1, 'Cannot locate KnowledgeBaseTemplate');
vm.createContext(context);
vm.runInContext(
  `${utilsSource.slice(0, templateEnd)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`,
  context,
);
const KBT = context.KnowledgeBaseTemplate;
KBT.isKnowledgeNote = note => !!(note && note.hasPrefix);
KBT.parseNoteTitle = note => ({ prefixContent: note && note.hasPrefix ? '正式前缀' : '' });
KBT.ifTemplateMerged = note => !!(note && note.isTemplated);
KBT.extractNoteLinkUrlsFromField = note => note && note.hasRelatedLink
  ? ['marginnote4app://note/RELATED']
  : [];
KBT.isClassificationNote = note => !!(note && note.isClassification);

function resetCalls() {
  mainUpserts.length = 0;
  mainRemovals.length = 0;
  intermediateUpserts.length = 0;
  intermediateRemovals.length = 0;
  persistedPatches.length = 0;
  pushedPatches.length = 0;
}

async function flushAsyncPatch() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

async function assertFormalCardPromotesToMainIndex() {
  resetCalls();
  const note = {
    noteId: 'FINAL-CARD',
    title: '最终标题',
    finalContent: '模板合并和字段归位后的完整内容',
    hasPrefix: true,
    isTemplated: true,
    hasRelatedLink: true,
  };
  const result = KBT.syncFinalMakeCardIndex(note, {
    indexSource: 'main',
    staleIds: ['OCR-EXCERPT'],
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(mainUpserts.length, 1, 'formal card must upsert the main index exactly once');
  assert.strictEqual(mainUpserts[0].mode, 'full');
  assert.strictEqual(mainUpserts[0].finalContent, note.finalContent);
  assert.deepStrictEqual(mainUpserts[0].options.staleIds, ['OCR-EXCERPT']);
  assert.deepStrictEqual(
    intermediateRemovals,
    [
      { noteId: 'FINAL-CARD', indexPrefix: 'intermediate-kb-index' },
      { noteId: 'OCR-EXCERPT', indexPrefix: 'intermediate-kb-index' },
      { noteId: 'FINAL-CARD', indexPrefix: 'literature-classification-kb-index' },
      { noteId: 'OCR-EXCERPT', indexPrefix: 'literature-classification-kb-index' },
      { noteId: 'FINAL-CARD', indexPrefix: 'history-card-kb-index' },
      { noteId: 'OCR-EXCERPT', indexPrefix: 'history-card-kb-index' },
    ],
    'formal card must tombstone current and stale IDs in every non-main index source',
  );
  assert.deepStrictEqual(mainRemovals, []);

  await flushAsyncPatch();
  assert.strictEqual(persistedPatches.length, 1);
  assert.strictEqual(persistedPatches[0].upserts[0].indexSource, 'main');
  assert.deepStrictEqual(persistedPatches[0].removedIds, ['OCR-EXCERPT']);
  assert.strictEqual(pushedPatches.length, 1, 'an open search panel must receive the final entry patch');
}

async function assertFailedPromotionKeepsProcessFallback() {
  resetCalls();
  const note = {
    noteId: 'FAILED-FORMAL-CARD',
    title: '',
    finalContent: '',
    failMainIndex: true,
    hasPrefix: true,
    isTemplated: true,
    hasRelatedLink: true,
  };
  const result = KBT.syncFinalMakeCardIndex(note, {
    indexSource: 'main',
    staleIds: ['FAILED-OCR-EXCERPT'],
  });

  assert.strictEqual(result.success, false);
  assert.deepStrictEqual(
    intermediateRemovals,
    [],
    'the process fallback must survive when the authoritative main entry cannot be built',
  );
  await flushAsyncPatch();
  assert.deepStrictEqual(persistedPatches, []);
  assert.deepStrictEqual(pushedPatches, []);
}

async function assertRoughCardUsesOnlyProcessIndex() {
  resetCalls();
  const note = {
    noteId: 'ROUGH-CARD',
    title: '粗制卡标题',
    finalContent: '粗制卡归位后的完整内容',
  };
  const result = KBT.syncFinalMakeCardIndex(note, {
    indexSource: 'intermediate',
    staleIds: ['ROUGH-EXCERPT'],
    showErrorHUD: false,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(intermediateUpserts.length, 1);
  assert.strictEqual(intermediateUpserts[0].finalContent, note.finalContent);
  assert.deepStrictEqual(intermediateUpserts[0].options.staleIds, ['ROUGH-EXCERPT']);
  assert.strictEqual(intermediateUpserts[0].options.showErrorHUD, false);
  assert.deepStrictEqual(mainRemovals, ['ROUGH-CARD', 'ROUGH-EXCERPT']);
  assert.deepStrictEqual(mainUpserts, []);
  assert.deepStrictEqual(intermediateRemovals, [
    { noteId: 'ROUGH-CARD', indexPrefix: 'literature-classification-kb-index' },
    { noteId: 'ROUGH-EXCERPT', indexPrefix: 'literature-classification-kb-index' },
    { noteId: 'ROUGH-CARD', indexPrefix: 'history-card-kb-index' },
    { noteId: 'ROUGH-EXCERPT', indexPrefix: 'history-card-kb-index' },
  ]);

  await flushAsyncPatch();
  assert.strictEqual(persistedPatches[0].upserts[0].indexSource, 'intermediate');
}

async function assertIncompleteKnowledgePointStaysIntermediate() {
  resetCalls();
  const note = {
    noteId: 'INCOMPLETE-CARD',
    title: '只有前缀和模板',
    finalContent: '尚未建立相关链接',
    hasPrefix: true,
    isTemplated: true,
    hasRelatedLink: false,
  };

  const state = KBT.getKnowledgePointCompletionState(note);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), {
    complete: false,
    isKnowledgePoint: true,
    hasPrefix: true,
    isTemplated: true,
    hasRelatedLink: false,
  });

  const result = KBT.syncFinalMakeCardIndex(note, { indexSource: 'main' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.requestedIndexSource, 'main');
  assert.strictEqual(result.indexSource, 'intermediate');
  assert.strictEqual(mainUpserts.length, 0);
  assert.strictEqual(intermediateUpserts.length, 1);
  await flushAsyncPatch();
  assert.strictEqual(persistedPatches[0].upserts[0].indexSource, 'intermediate');
}

async function assertPatchExceptionFallsBackToFullRefresh() {
  resetCalls();
  const instance = context.MNKnowledgeBaseInstance;
  const originalPush = instance.pushSearchIndexPatchToWebView;
  const originalFallback = instance._loadSearchDataToWebView;
  const originalAddErrorLog = context.KnowledgeBaseUtils.addErrorLog;
  let fallbackOptions = null;
  instance.pushSearchIndexPatchToWebView = async () => {
    throw new Error('bridge failed');
  };
  instance._loadSearchDataToWebView = async (options) => {
    fallbackOptions = options;
    return { success: true, source: 'full-refresh' };
  };
  context.KnowledgeBaseUtils.addErrorLog = () => {};

  try {
    const result = await KBT.publishFinalMakeCardIndexPatch({
      success: true,
      entry: { id: 'PATCH-FALLBACK', title: '最终标题' },
      mode: 'light',
    }, {
      indexSource: 'main',
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.source, 'full-refresh');
    assert.strictEqual(fallbackOptions.force, true);
    assert.strictEqual(fallbackOptions.reason, 'makeCardFinalIndexPatchFailed');
  } finally {
    instance.pushSearchIndexPatchToWebView = originalPush;
    instance._loadSearchDataToWebView = originalFallback;
    context.KnowledgeBaseUtils.addErrorLog = originalAddErrorLog;
  }
}

function assertCrossIndexTombstoneDoesNotHideAuthoritativeEntry() {
  const start = mainSource.indexOf('  MNKnowledgeBaseClass.prototype.getWebViewKnownRemovedSearchIds = function(activeCards = [])');
  const functionStart = mainSource.indexOf('function(activeCards = [])', start);
  const end = mainSource.indexOf('\n\n  MNKnowledgeBaseClass.prototype.filterKnownRemovedSearchCards', functionStart);
  assert.ok(start !== -1 && functionStart !== -1 && end > functionStart, 'Cannot locate removed-index filter');
  const getKnownRemovedIds = vm.runInNewContext(
    `(${mainSource.slice(functionStart, end)})`,
    {
      MNUtil: { dbFolder: '/db' },
      KnowledgeBaseIndexer: {
        getRemovedIdsFromIncrementalIndex(index) {
          return index && index.metadata && Array.isArray(index.metadata.removedIds)
            ? index.metadata.removedIds
            : [];
        },
      },
      IntermediateKnowledgeIndexer: {
        loadIncrementalIndex() {
          return null;
        },
      },
      KnowledgeBaseUtils: { addErrorLog() {} },
    },
  );
  const indexes = {
    '/db/data/kb-incremental-index.json': {
      cards: [],
      metadata: { removedIds: ['OLD-EXCERPT'] },
    },
    '/db/data/intermediate-kb-incremental-index.json': {
      cards: [],
      metadata: { removedIds: ['FORMAL-CARD', 'OLD-EXCERPT'] },
    },
  };
  const removedIds = getKnownRemovedIds.call({
    readJSONIfExists(pathname) {
      return indexes[pathname] || null;
    },
  }, [{ id: 'FORMAL-CARD', indexSource: 'main' }]);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(removedIds)),
    ['OLD-EXCERPT'],
    'a process-index tombstone must not hide an active authoritative main entry',
  );
}

function assertMakeCardIndexesOnlyAfterFinalMutation() {
  const start = utilsSource.indexOf('  static makeCard(');
  const end = utilsSource.indexOf('\n  /**\n   * 已合并模板的卡片制卡', start);
  assert.ok(start !== -1 && end > start, 'Cannot locate makeCard');
  const source = utilsSource.slice(start, end);
  assert.ok(
    source.indexOf('this.syncFinalMakeCardIndex(') > source.indexOf('this.addToReview('),
    'makeCard must synchronize the final index only after all card mutations',
  );

  const templateStart = utilsSource.indexOf('  static templateMergedCardMake(');
  const templateEndIndex = utilsSource.indexOf('\n  /**\n   * 处理定义卡片与命题/例子卡片之间的链接', templateStart);
  const templateSource = utilsSource.slice(templateStart, templateEndIndex);
  assert.match(
    templateSource,
    /changeTitle\([\s\S]*?syncIndex:\s*false/,
    'the title stage must not persist a half-finished index entry',
  );
}

function assertToolbarOwnsThePostProcessedFinalSync() {
  const start = toolbarSource.indexOf('  function _xdyy_makeNoteWithPreProcessSafety');
  const end = toolbarSource.indexOf('\n  function _xdyy_getPreprocessFnSafe', start);
  assert.ok(start !== -1 && end > start, 'Cannot locate toolbar make-note wrapper');
  const source = toolbarSource.slice(start, end);
  assert.match(source, /deferFinalIndexSync:\s*true/);
  assert.ok(
    source.indexOf('_xdyy_syncKnowledgeBaseIncrementalIndex(processedNote, { staleIds: [noteId] })') >
      source.indexOf('_xdyy_ensureProofApplicationLinksAfterMakeNote(processedNote)'),
    'toolbar must sync after bottom-up and proof/application post-processing',
  );
}

function assertDirectOcrClassificationKeepsMainIndexAuthoritative() {
  const start = mainSource.indexOf('  MNKnowledgeBaseClass.prototype.processDirectOCRExcerptMakeCard');
  const end = mainSource.indexOf('\n\n  MNKnowledgeBaseClass.prototype.shouldSkipReadingOCR', start);
  assert.ok(start !== -1 && end > start, 'Cannot locate direct OCR make-card flow');
  const source = mainSource.slice(start, end);
  const classificationStart = source.indexOf("if (plan.action === 'convertToClassification')");
  const classificationEnd = source.indexOf('    } else {', classificationStart);
  const classificationSource = source.slice(classificationStart, classificationEnd);
  assert.match(classificationSource, /convertNoteToClassificationNote\(/);
  assert.doesNotMatch(
    classificationSource,
    /syncConvertedIntermediateIndexIfNeeded/,
    'a completed classification card must not be written back into the process index',
  );
}

(async () => {
  await assertFormalCardPromotesToMainIndex();
  await assertFailedPromotionKeepsProcessFallback();
  await assertRoughCardUsesOnlyProcessIndex();
  await assertIncompleteKnowledgePointStaysIntermediate();
  await assertPatchExceptionFallsBackToFullRefresh();
  assertCrossIndexTombstoneDoesNotHideAuthoritativeEntry();
  assertMakeCardIndexesOnlyAfterFinalMutation();
  assertToolbarOwnsThePostProcessedFinalSync();
  assertDirectOcrClassificationKeepsMainIndexAuthoritative();
  console.log('make-card final index sync regression ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
