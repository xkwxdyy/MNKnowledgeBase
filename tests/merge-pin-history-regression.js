const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'KnowledgeBaseMergeHistory.js'), 'utf8');
function fixture(chain = false) {
  const live = new Set(chain ? ['C'] : ['B']);
  const pins = [{ noteId: chain ? 'C' : 'B', title: 'custom' }, { noteId: 'B', title: 'original B' }];
  const calls = [], errors = [], receipts = [];
  const add = (oldId, newId) => receipts.push({ sourceNoteId: oldId, targetNoteId: newId,
    pinMigration: {
      rollback() { assert.equal(pins[0].noteId, newId); pins[0].noteId = oldId; calls.push('undo:' + oldId); return { success: true }; },
      apply() { assert.equal(pins[0].noteId, oldId); pins[0].noteId = newId; calls.push('redo:' + oldId); return { success: true }; },
      verify() { assert.equal(pins[0].noteId, newId); }, commit() { calls.push('commit:' + newId); },
    } });
  add('A', 'B'); if (chain) add('B', 'C');
  const context = vm.createContext({ module: { exports: {} }, KnowledgeBaseMergeTransaction: { getUndoReceipts: () => receipts },
    MNUtil: { getNoteById: id => live.has(id) ? { noteId: id } : null, showHUD: message => errors.push(message) },
    KnowledgeBaseUtils: { addErrorLog() {} }, Date, WeakMap, Set });
  vm.runInContext(source, context);
  return { api: context.module.exports, live, pins, calls, errors, receipts };
}
{
  const h = fixture(); h.api.reconcile(); assert.deepEqual(h.calls, []);
  h.live.add('A'); h.api.reconcile(); h.api.reconcile(); assert.deepEqual(h.calls, ['undo:A']);
  assert.equal(h.pins[0].noteId, 'A'); assert.equal(h.pins[0].title, 'custom'); assert.equal(h.pins[1].noteId, 'B');
  h.live.delete('A'); h.api.reconcile(); assert.deepEqual(h.calls, ['undo:A', 'redo:A', 'commit:B']);
  assert.equal(h.pins[0].noteId, 'B'); assert.deepEqual(h.errors, []);
}
{
  const h = fixture(true); h.live.add('A'); h.live.add('B'); h.api.reconcile();
  assert.deepEqual(h.calls, ['undo:B', 'undo:A']); assert.equal(h.pins[0].noteId, 'A');
  h.live.delete('A'); h.live.delete('B'); h.api.reconcile();
  assert.deepEqual(h.calls, ['undo:B', 'undo:A', 'redo:A', 'commit:B', 'redo:B', 'commit:C']);
  assert.equal(h.pins[0].noteId, 'C'); assert.deepEqual(h.errors, []);
}
{
  const h = fixture(); h.live.add('A'); h.api.reconcile(); h.live.clear(); h.api.reconcile(); h.api.reconcile();
  assert.equal(h.errors.length, 1); assert.equal(h.pins[0].noteId, 'A');
  h.live.add('B'); h.api.reconcile(); assert.equal(h.pins[0].noteId, 'B');
}
{
  const h = fixture(); h.live.add('A'); h.receipts[0].pinMigration.rollback = () => { throw Error('config changed'); };
  h.api.reconcile(); h.api.reconcile(); assert.equal(h.errors.length, 1); assert.equal(h.pins[0].noteId, 'B');
}
{
  const h = fixture(); h.live.add('A');
  let active = false;
  h.receipts[0].isSourceActive = nativeSource => !!nativeSource && active;
  h.api.reconcile(); assert.deepEqual(h.calls, [], 'merged backing note must not trigger undo');
  active = true; h.api.reconcile(); assert.deepEqual(h.calls, ['undo:A']);
  active = false; h.api.reconcile(); assert.deepEqual(h.calls, ['undo:A', 'redo:A', 'commit:B']);
}
{
  const h = fixture(); h.receipts[0].isSourceActive = () => { throw Error('state unavailable'); };
  h.api.reconcile(); assert.deepEqual(h.calls, []); assert.equal(h.errors.length, 1);
}
{
  const h=fixture(), sync=[];
  h.receipts[0].onStateReconciled=direction=>sync.push(direction);
  h.live.add('A');h.api.reconcile();h.live.delete('A');h.api.reconcile();
  assert.deepEqual(sync,['restored','merged']);
}
{
  const h=fixture(), sync=[];h.receipts[0].pinMigration=null;
  h.receipts[0].onStateReconciled=direction=>sync.push(direction);
  h.live.add('A');h.api.reconcile();h.live.delete('A');h.api.reconcile();
  assert.deepEqual(sync,['restored','merged']);
}
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.match(main, /controllerWillLayoutSubviews:[\s\S]*?KnowledgeBaseMergeHistory\.schedule\(\)/);
assert.match(main, /onPopupMenuOnNote:[\s\S]*?KnowledgeBaseMergeHistory\.schedule\(\)/);
assert.doesNotMatch(source, /MNUtil\.(?:undo|redo)\(/);
console.log('merge Pin history: native-state reconciliation, chain undo/redo, existing pins and failure guards passed');
