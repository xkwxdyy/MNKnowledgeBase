const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(addonRoot, 'knowledgebaseWebController.js'), 'utf8');
const searchInteractionsSource = fs.readFileSync(
  path.join(addonRoot, 'scripts/search/app-ui-interactions.js'),
  'utf8',
);

function extractPrototypeMethod(name) {
  const marker = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = mainSource.indexOf(marker);
  assert.notStrictEqual(start, -1, `Cannot locate ${name}`);
  const next = mainSource.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + marker.length);
  assert.notStrictEqual(next, -1, `Cannot locate end of ${name}`);
  return mainSource.slice(start, next);
}

const mainCalls = [];
const intermediateCalls = [];
const patches = [];
const context = {
  console,
  Array,
  Date,
  Map,
  Number,
  Object,
  Promise,
  Set,
  String,
  KnowledgeBaseConfig: {
    getSearchIndexMode() {
      return 'full';
    },
  },
  MNNote: {
    new(noteId) {
      return { noteId, title: '过程卡标题', parentNoteId: null };
    },
  },
  MNUtil: {
    showHUD() {},
  },
  KnowledgeBaseUtils: {
    webViewController: null,
    log() {},
  },
  KnowledgeBaseIndexer: {
    upsertIncrementalIndexEntry(note, mode, options) {
      mainCalls.push({ note, mode, options });
      return {
        success: true,
        entry: { id: note.noteId, title: note.title, searchText: note.title },
        removedIds: options.staleIds || [],
        cardCount: 1,
      };
    },
    getRemovedIdsFromIncrementalIndex() {
      return [];
    },
  },
  IntermediateKnowledgeIndexer: {
    upsertIncrementalIndexEntry(note, options) {
      intermediateCalls.push({ note, options });
      return {
        success: true,
        entry: { id: note.noteId, title: note.title, searchText: note.title },
        removedIds: options.staleIds || [],
        cardCount: 1,
      };
    },
  },
};
context.global = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  [
    'function MNKnowledgeBaseClass() {}',
    extractPrototypeMethod('normalizeSearchIndexSource'),
    extractPrototypeMethod('getSearchIndexSourceSpec'),
    extractPrototypeMethod('tagSearchCardsWithIndexSource'),
    extractPrototypeMethod('resolveSearchIndexSource'),
    extractPrototypeMethod('normalizeSearchUsageScore'),
    extractPrototypeMethod('_refreshSearchCardIndex'),
    'this.MNKnowledgeBaseClass = MNKnowledgeBaseClass;',
  ].join('\n'),
  context,
);

const instance = new context.MNKnowledgeBaseClass();
instance.convertExcerptToNoExcerptIfNeeded = (note) => note;
instance._webViewSearchDataCache = {
  fullIndexData: {
    cards: [
      { id: 'CARD-1', usageScore: 15 },
      { id: 'CARD-2', usageScore: 8 },
    ],
  },
};
instance.recordPersistedSearchIndexPatch = (patchData) => {
  patches.push(patchData);
};
instance.isWebViewPushResultSuccess = () => true;

const tagged = [{ id: 'CARD-TAG', title: '过程卡' }];
assert.strictEqual(instance.tagSearchCardsWithIndexSource(tagged, 'intermediate'), tagged);
assert.strictEqual(tagged[0].indexSource, 'intermediate');
assert.strictEqual(instance.normalizeSearchIndexSource('knowledge-base'), 'main');
assert.strictEqual(instance.getSearchIndexSourceSpec('intermediate').indexPrefix, 'intermediate-kb-index');

async function run() {
  const intermediateResult = await instance._refreshSearchCardIndex('CARD-1', {
    indexSource: 'intermediate',
    showErrorHUD: false,
    showSuccessHUD: false,
  });
  assert.strictEqual(intermediateResult.success, true);
  assert.strictEqual(mainCalls.length, 0, '过程卡刷新不得调用主知识库索引器');
  assert.strictEqual(intermediateCalls.length, 1, '过程卡刷新必须调用过程知识库索引器');
  assert.strictEqual(intermediateCalls[0].options.indexPrefix, 'intermediate-kb-index');
  assert.strictEqual(intermediateCalls[0].options.usageScore, 15, '过程卡刷新必须继承使用权重');
  assert.strictEqual(intermediateResult.entry.indexSource, 'intermediate');
  assert.strictEqual(patches[0].upserts[0].indexSource, 'intermediate');

  const mainResult = await instance._refreshSearchCardIndex('CARD-2', {
    indexSource: 'main',
    showErrorHUD: false,
    showSuccessHUD: false,
  });
  assert.strictEqual(mainResult.success, true);
  assert.strictEqual(mainCalls.length, 1, '主卡刷新仍必须调用主知识库索引器');
  assert.strictEqual(mainCalls[0].options.usageScore, 8, '主卡刷新必须继承使用权重');
  assert.strictEqual(intermediateCalls.length, 1);
  assert.strictEqual(mainResult.entry.indexSource, 'main');

  assert.match(searchInteractionsSource, /params\.indexSource\s*=\s*String\(card\.indexSource\)/);
  assert.match(controllerSource, /indexSource:\s*config\.params\.indexSource/);
  assert.match(utilsSource, /static upsertIncrementalIndexEntry\(note, options = \{\}\)/);
  assert.match(utilsSource, /const result = this\.upsertIncrementalIndexEntry\(note, options\)/);
  console.log('search intermediate-card refresh regression ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
