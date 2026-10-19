const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractPrototypeMethod(name) {
  const marker = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `Cannot locate ${name}`);
  const next = source.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + marker.length);
  assert.notStrictEqual(next, -1, `Cannot locate end of ${name}`);
  return source.slice(start, next);
}

const logs = [];
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
  KnowledgeBaseUtils: {
    log(message, scope, detail) {
      logs.push({ message, scope, detail });
    },
  },
};
context.global = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  [
    'function MNKnowledgeBaseClass() {}',
    extractPrototypeMethod('mergeCardsById'),
    extractPrototypeMethod('getSearchDataMutationRevision'),
    extractPrototypeMethod('recordPersistedSearchIndexPatch'),
    extractPrototypeMethod('enqueueSearchDataOperation'),
    'this.MNKnowledgeBaseClass = MNKnowledgeBaseClass;',
  ].join('\n'),
  context,
);

const instance = new context.MNKnowledgeBaseClass();
const persistentWrites = [];
instance.buildWebViewSearchDataCacheKey = () => 'cache-key-after-single-refresh';
instance.writePersistentWebViewSearchDataCache = (key, data) => {
  persistentWrites.push({ key, data });
  return true;
};
instance._webViewSearchDataCache = {
  key: 'cache-key-before-single-refresh',
  fullIndexData: {
    cards: [
      { id: 'CARD-1', title: '旧标题' },
      { id: 'CARD-2', title: '保留标题' },
    ],
    metadata: { totalCards: 2, mode: 'light' },
  },
};

const patchResult = instance.recordPersistedSearchIndexPatch({
  upserts: [{ id: 'CARD-1', title: '新标题' }],
  removedIds: ['CARD-2'],
  metadata: { updateTime: 123, mode: 'light' },
});

assert.strictEqual(patchResult.revision, 1, 'single-card refresh must advance the mutation revision');
assert.strictEqual(patchResult.cacheUpdated, true, 'single-card refresh must update the in-memory full cache');
assert.strictEqual(instance._webViewSearchDataCache.key, 'cache-key-after-single-refresh');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(instance._webViewSearchDataCache.fullIndexData.cards)),
  [{ id: 'CARD-1', title: '新标题', usageScore: 0 }],
  'the refreshed card must replace the stale cached card and removed cards must stay removed',
);
assert.strictEqual(persistentWrites.length, 1, 'single-card refresh must persist the patched full cache');
assert.strictEqual(persistentWrites[0].data.cards[0].title, '新标题');

async function assertQueueSerializesOperations() {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = instance.enqueueSearchDataOperation('first', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = instance.enqueueSearchDataOperation('second', async () => {
    events.push('second');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(events, ['first:start'], 'a later full load must wait for the active single-card refresh/load operation');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepStrictEqual(events, ['first:start', 'first:end', 'second']);
}

assertQueueSerializesOperations()
  .then(() => {
    assert.ok(logs.length === 0, 'the happy-path queue must not log failures');
    console.log('search single-card refresh persistence regression ok');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
