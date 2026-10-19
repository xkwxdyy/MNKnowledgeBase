const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');

function extractPrototypeFunction(name, nextName) {
  const marker = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = mainSource.indexOf(marker);
  const end = mainSource.indexOf(`\n\n  MNKnowledgeBaseClass.prototype.${nextName}`, start);
  assert.ok(start !== -1 && end > start, `Cannot locate ${name}`);
  return mainSource.slice(start + marker.length, end).trim();
}

function extractStaticMethod(name, className = 'KnowledgeBaseIndexer') {
  const classStart = utilsSource.indexOf(`class ${className}`);
  const syncMarker = `static ${name}`;
  const asyncMarker = `static async ${name}`;
  const syncStart = utilsSource.indexOf(syncMarker, classStart);
  const asyncStart = utilsSource.indexOf(asyncMarker, classStart);
  const start = syncStart === -1 ? asyncStart : syncStart;
  assert.notStrictEqual(start, -1, `Cannot locate ${name}`);
  const methodBodyMarker = utilsSource.indexOf(') {', start);
  assert.notStrictEqual(methodBodyMarker, -1, `Cannot locate body of ${name}`);
  const bodyStart = methodBodyMarker + 2;
  let depth = 0;
  for (let index = bodyStart; index < utilsSource.length; index += 1) {
    const character = utilsSource[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return utilsSource.slice(start, index + 1);
    }
  }
  throw new Error(`Cannot locate end of ${name}`);
}

async function assertSafeSubtreeTraversal() {
  const delays = [];
  const logs = [];
  const context = {
    Set,
    String,
    Array,
    KnowledgeBaseTemplate: {
      normalizeNoteIdForCompare(value) {
        return String(value || '').toUpperCase();
      },
      isClassificationNote(note) {
        return note.kind === 'classification';
      },
      isKnowledgeNote(note) {
        return note.kind === 'knowledge';
      },
    },
    KnowledgeBaseUtils: {
      addErrorLog(error, source) {
        logs.push({ error, source });
      },
    },
    MNUtil: {
      showHUD() {},
      async delay(value) {
        delays.push(value);
      },
    },
  };
  const collect = vm.runInNewContext(
    `(${extractPrototypeFunction('collectSupplementarySubtreeIndexNotes', 'publishSupplementarySubtreeIndexPatch')})`,
    context,
  );

  const root = { noteId: 'root', kind: 'classification', childNotes: [] };
  const knowledge = { noteId: 'knowledge', kind: 'knowledge', childNotes: [] };
  const ordinary = { noteId: 'ordinary', kind: 'ordinary', childNotes: [] };
  const nested = { noteId: 'nested', kind: 'classification', childNotes: [] };
  root.childNotes = [knowledge, ordinary];
  ordinary.childNotes = [nested, root];
  nested.childNotes = [knowledge];

  const result = await collect(root, { yieldEvery: 2 });
  assert.deepStrictEqual(
    Array.from(result.notes, note => note.noteId),
    ['root', 'knowledge', 'nested'],
    'the selected root and all eligible descendants must be included exactly once',
  );
  assert.strictEqual(result.visitedCount, 4, 'cycles and duplicate edges must not duplicate nodes');
  assert.strictEqual(result.skippedTypeCount, 1, 'ordinary cards must be scanned but excluded');
  assert.ok(delays.length >= 2, 'large traversals must cooperatively yield');
  assert.deepStrictEqual(logs, []);
}

async function assertBatchUpsertIsAtomicPerEntryAndDeduped() {
  const writes = [];
  const context = {
    Date,
    Set,
    String,
    Array,
    Promise,
    KnowledgeBaseConfig: {
      getSearchIndexMode() {
        return 'full';
      },
    },
    KnowledgeBaseUtils: {
      emitRuntimeLog() {},
      addErrorLog(error) {
        throw error;
      },
    },
    MNUtil: {
      showHUD() {},
      async delay() {},
    },
    MNLog: {
      error(error) {
        throw error;
      },
    },
    writes,
  };
  vm.createContext(context);
  vm.runInContext(
    `class TestIndexer {
      static loadIncrementalIndex() {
        return {
          metadata: { version: 'incremental-1.0', removedIds: ['A', 'B'] },
          removedIds: ['A'],
          cards: [
            { id: 'A', title: 'old A' },
            { id: 'B', title: 'old B' },
            { id: 'A', title: 'duplicate A' },
            { id: 'KEEP', title: 'keep' },
          ],
        };
      }
      static buildIndexEntry(note, mode) {
        if (note.fail) return null;
        return { id: note.noteId, title: note.title, mode };
      }
      static getRemovedIdsFromIncrementalIndex(index) {
        return index.metadata.removedIds || [];
      }
      static saveIncrementalIndex(index) {
        writes.push(JSON.parse(JSON.stringify(index)));
        return true;
      }
      ${extractStaticMethod('upsertIncrementalIndexEntries(notes, mode = undefined, options = {})')}
    }
    this.TestIndexer = TestIndexer;`,
    context,
  );

  const result = await context.TestIndexer.upsertIncrementalIndexEntries([
    { noteId: 'A', title: 'new A' },
    { noteId: 'B', title: 'new B', fail: true },
    { noteId: 'C', title: 'new C' },
    { noteId: 'A', title: 'newest A' },
  ]);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.mode, 'full');
  assert.deepStrictEqual(Array.from(result.entries, entry => entry.id), ['C', 'A']);
  assert.deepStrictEqual(Array.from(result.failedIds), ['B']);
  assert.strictEqual(writes.length, 1, 'the batch must persist the main incremental index once');
  assert.deepStrictEqual(
    Array.from(writes[0].cards, card => `${card.id}:${card.title}`),
    ['B:old B', 'KEEP:keep', 'C:new C', 'A:newest A'],
    'successful entries replace old values, failed entries preserve their previous value, and duplicate IDs collapse',
  );
  assert.deepStrictEqual(Array.from(writes[0].metadata.removedIds), ['B']);
  assert.deepStrictEqual(Array.from(writes[0].removedIds), ['B']);
}

function assertIntermediateBatchRemovalWritesOnce() {
  const writes = [];
  const context = {
    Date,
    Set,
    String,
    Array,
    KnowledgeBaseIndexer: {
      updateIncrementalRemovedIds(index, staleIds) {
        const current = Array.isArray(index.metadata.removedIds) ? index.metadata.removedIds : [];
        index.metadata.removedIds = Array.from(new Set(current.concat(staleIds)));
      },
    },
    MNLog: {
      error(error) {
        throw error;
      },
    },
    writes,
  };
  vm.createContext(context);
  vm.runInContext(
    `class TestIntermediateIndexer {
      static loadIncrementalIndex() {
        return {
          metadata: { version: 'intermediate-incremental-1.0', removedIds: ['OLD'] },
          cards: [{ id: 'A' }, { id: 'B' }, { id: 'KEEP' }],
        };
      }
      static saveIncrementalIndex(index, prefix) {
        writes.push({ index: JSON.parse(JSON.stringify(index)), prefix });
        return true;
      }
      ${extractStaticMethod('removeManyFromIncrementalIndex(noteIds, options = {})', 'IntermediateKnowledgeIndexer')}
    }
    this.TestIntermediateIndexer = TestIntermediateIndexer;`,
    context,
  );

  const result = context.TestIntermediateIndexer.removeManyFromIncrementalIndex(
    ['A', 'B', 'A'],
    { indexPrefix: 'intermediate-kb-index' },
  );
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.removedCount, 2);
  assert.strictEqual(writes.length, 1, 'the process incremental index must be persisted once');
  assert.deepStrictEqual(Array.from(writes[0].index.cards, card => card.id), ['KEEP']);
  assert.deepStrictEqual(Array.from(writes[0].index.metadata.removedIds), ['OLD', 'A', 'B']);
}

async function assertBatchPatchUsesOnePushAndFallback() {
  const calls = [];
  const context = {
    Array,
    Date,
    Math,
    Promise,
    KnowledgeBaseUtils: {
      webViewController: {
        webViewLoaded: true,
        currentHTMLType: 'search',
        webView: {},
      },
      addErrorLog(error) {
        throw error;
      },
    },
  };
  const publish = vm.runInNewContext(
    `(${extractPrototypeFunction('publishSupplementarySubtreeIndexPatch', 'supplementSelectedSubtreeIndexInternal')})`,
    context,
  );
  const instance = {
    recordPersistedSearchIndexPatch(patch) {
      calls.push({ type: 'record', patch });
    },
    enqueueSearchDataOperation(label, operation) {
      calls.push({ type: 'queue', label });
      return Promise.resolve().then(operation);
    },
    pushSearchIndexPatchToWebView(patch) {
      calls.push({ type: 'push', patch });
      return Promise.resolve({ ok: this.pushSucceeds !== false });
    },
    isWebViewPushResultSuccess(result) {
      return !!(result && result.ok);
    },
    _loadSearchDataToWebView(options) {
      calls.push({ type: 'fallback', options });
      return Promise.resolve({ success: true, source: 'full' });
    },
    pushSucceeds: true,
  };

  let result = await publish.call(instance, {
    success: true,
    mode: 'light',
    entries: [{ id: 'A' }, { id: 'B' }],
  }, { rootNoteId: 'ROOT' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.filter(call => call.type === 'push').length, 1);
  assert.strictEqual(calls.find(call => call.type === 'push').patch.upserts.length, 2);
  assert.strictEqual(calls.filter(call => call.type === 'fallback').length, 0);

  calls.length = 0;
  instance.pushSucceeds = false;
  result = await publish.call(instance, {
    success: true,
    mode: 'light',
    entries: [{ id: 'A' }],
  }, { rootNoteId: 'ROOT' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.filter(call => call.type === 'push').length, 1);
  assert.strictEqual(calls.filter(call => call.type === 'fallback').length, 1);
}

function assertMenuAndBatchPatchContracts() {
  assert.match(
    mainSource,
    /补充索引选中子脑图[^\n]+supplementSelectedSubtreeIndex:/,
    'the quick-access menu must expose the selected-subtree action',
  );
  assert.match(
    mainSource,
    /supplementSelectedSubtreeIndex: async function\(\)[\s\S]*?MNKnowledgeBaseClass\.prototype\.supplementSelectedSubtreeIndexInternal\.call\(self\)/,
    'the selector-bound lifecycle method must delegate to prototype logic',
  );
  assert.match(
    mainSource,
    /publishSupplementarySubtreeIndexPatch[\s\S]*?recordPersistedSearchIndexPatch[\s\S]*?pushSearchIndexPatchToWebView[\s\S]*?_loadSearchDataToWebView/,
    'a batch patch must update caches, push to an open search panel, and retain a full-refresh fallback',
  );
  assert.match(
    utilsSource,
    /class IntermediateKnowledgeIndexer[\s\S]*?static removeManyFromIncrementalIndex/,
    'successful main entries must be removed from the process incremental source in one batch',
  );
}

Promise.resolve()
  .then(assertSafeSubtreeTraversal)
  .then(assertBatchUpsertIsAtomicPerEntryAndDeduped)
  .then(assertIntermediateBatchRemovalWritesOnce)
  .then(assertBatchPatchUsesOnePushAndFallback)
  .then(assertMenuAndBatchPatchContracts)
  .then(() => {
    console.log('selected subtree supplementary index regression ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
