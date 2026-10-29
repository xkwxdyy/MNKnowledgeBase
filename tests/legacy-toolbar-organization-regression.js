'use strict';
const assert = require('node:assert/strict');
const fs = require('./support/integration-fs');
const path = require('node:path');
const vm = require('node:vm');
const registry = fs.readFileSync(path.join(__dirname, '../../mntoolbar/mntoolbar/xdyy_custom_actions_registry.js'), 'utf8');
const begin = registry.indexOf('  async function _xdyy_presentLegacyCardResults(');
const end = registry.indexOf('  global.registerCustomAction(\n    "retainFieldContentOnly",', begin);
assert.ok(begin > 0 && end > begin);
async function fixture({ missing = false, unknown = false, cancel = false, changed = false, make = true, refreshTicks = 0, wrongFocus = false, selectionFailure = false, switchNotebook = false, vanished = false, callbackFailure = false, skipCallback = false, ordinary = false, newCard = false } = {}) {
  const events = [], handlers = {};
  const old = { noteId: 'OLD', title: '命题', parentNote: null };
  let selected = old, ticks = refreshTicks;
  const fresh = { noteId: 'NEW', focusInMindMap() { assert.equal(context.MNUtil._needRefreshAfterDBChanged, false, 'focus must follow actual refresh completion'); events.push(['focus', this.noteId]); if (!wrongFocus) selected = fresh; } };
  const T = {
    isOldTemplateCard: () => !newCard,
    async prepareCardMigrationSelection() { events.push(['selectionGuard']); },
    types: { 命题: { templateNoteId: 'template' } }, getNoteType: () => unknown ? '' : '命题',
    requireMakeCardTemplate(id, type) { events.push(['preflight', type]); if (missing) throw Error('缺少模板'); },
    makeLegacyCard(note, options) { events.push(['make', note.noteId, options.noteType]); old.title = ''; return fresh; },
    processOldTemplateCard(note, options) { if (callbackFailure) throw Error('archive copy failed'); assert.equal(options.refresh, false); events.push(['process', note.noteId]); old.title = ''; return fresh; },
    syncFinalMakeCardIndex(note, options) { events.push(['index', note.noteId, options.staleIds]); },
  };
  const context = { global: { registerCustomAction(name, fn) { handlers[name] = fn; } }, KnowledgeBaseTemplate: T,
    MNNote: {getFocusNotes: () => [selected]},
    MNUtil: { currentNotebookId: 'BOOK', _needRefreshAfterDBChanged: false,
      getNoteById: () => vanished ? null : fresh,
      async delay() { if (switchNotebook) this.currentNotebookId = 'OTHER'; if (--ticks <= 0 && this._needRefreshAfterDBChanged) { this._needRefreshAfterDBChanged = false; events.push(['refreshComplete']); } },
      async selectNotesInMindmap(ids) { events.push(['select', ...ids]); if (!selectionFailure) selected = fresh; },
      async userSelect() { events.push(['choose']); if (changed) old.title = 'changed'; return cancel ? 0 : 2; } },
    _xdyy_getSafeFocusNotesFromContext: ctx => ctx.focusNotes,
    _xdyy_invalidateKnowledgeBaseTemplateCaches() {},
    _xdyy_runUndoGroupingWithoutGlobalDBRefresh(fn) { events.push(['undo']); if (!skipCallback) {try {fn();} catch (_) {}} events.push(['dbRefresh']); context.MNUtil._needRefreshAfterDBChanged = refreshTicks > 0; },
    _xdyy_refreshNotesAfterMakeCardDBRefresh(notes) { events.push(['refresh', ...notes.map(n => n.noteId)]); },
  };
  Object.assign(context, {
    _xdyy_createMakeCardPerfTrace: () => ({}), _xdyy_makeCardPerfNow: () => 0,
    _xdyy_recordMakeCardPerf() {}, _xdyy_finishMakeCardPerf() {}, _xdyy_logMakeCardPerf() {},
    _xdyy_getNoteIdSafe: n => n.noteId, _xdyy_prepareNoteForSafeMakeNote() {},
    _xdyy_createMakeNoteLocateSnapshot: n => n.noteId, _xdyy_isAuthorNoteLike: () => false,
    _xdyy_isJournalNoteLike: () => false, _xdyy_makeNoteWithPreProcessSafety: n => T.makeLegacyCard(n, {noteType:'命题'}),
    _xdyy_resolvePostMakeLocateNote: (_, n) => n, _xdyy_ensureProofLinkedNotesInReview: async () => ({}),
  });
  vm.runInNewContext(registry.slice(begin, end), context);
  const ordinaryStart = registry.indexOf('  global.registerCustomAction("makeNote",');
  vm.runInNewContext(registry.slice(ordinaryStart, registry.indexOf('  // doubleClickMakeNote',ordinaryStart)), context);
  let error;
  try { await handlers[ordinary ? 'makeNote' : make ? 'forceOldCardMakeNote' : 'handleOldCardWithoutMakeNote']({ focusNotes: [old] }); } catch (e) { error = e; }
  return { events, error };
}
(async () => {
  for (const make of [true, false]) {
    const result = await fixture({ make }); assert.equal(result.error, undefined);
    assert.deepEqual(result.events.find(e => e[0] === 'focus'), ['focus','NEW']);
    assert.equal(result.events.some(e => e[0] === 'refresh'), false, 'local refresh must not add another native undo entry');
    assert.equal(result.events.filter(e => e[0] === 'dbRefresh').length,1);
    if (!make) assert.equal(result.events.find(e => e[0] === 'index')[1], 'NEW');
  }
  for (const options of [{ missing:true }, { unknown:true, changed:true }]) {
    const result = await fixture(options); assert.ok(result.error); assert.equal(result.events.some(e => e[0] === 'undo'), false);
  }
  const delayed = await fixture({refreshTicks: 12}); assert.equal(delayed.error, undefined); assert(delayed.events.findIndex(e => e[0] === 'refreshComplete') < delayed.events.findIndex(e => e[0] === 'focus'));
  const recovered = await fixture({wrongFocus:true}); assert.equal(recovered.error, undefined); assert(recovered.events.some(e => e[0] === 'select' && e[1] === 'NEW'));
  for (const options of [{wrongFocus:true,selectionFailure:true},{refreshTicks:200},{refreshTicks:3,switchNotebook:true},{vanished:true}]) { const failed=await fixture(options); assert(failed.error); }
  const callbackFailed=await fixture({make:false,callbackFailure:true}); assert.match(callbackFailed.error.message,/archive copy failed/); assert.equal(callbackFailed.error.requiresUndo,true); assert.equal(callbackFailed.events.some(e=>e[0]==='focus'),false);
  const skipped=await fixture({skipCallback:true}); assert.match(skipped.error.message,/未同步完成/); assert.equal(skipped.error.requiresUndo,false);
  const ordinaryOld=await fixture({ordinary:true}); assert.equal(ordinaryOld.error,undefined); assert.equal(ordinaryOld.events.some(e=>e[0]==='refresh'),false); assert(ordinaryOld.events.some(e=>e[0]==='selectionGuard')); assert.deepEqual(ordinaryOld.events.find(e=>e[0]==='focus'),['focus','NEW']);
  const ordinaryNew=await fixture({ordinary:true,newCard:true}); assert.equal(ordinaryNew.error,undefined); assert.equal(ordinaryNew.events.some(e=>e[0]==='refresh'),true); assert.equal(ordinaryNew.events.some(e=>e[0]==='selectionGuard'),false);
  const cancelled = await fixture({ unknown:true, cancel:true }); assert.equal(cancelled.error, undefined); assert.equal(cancelled.events.length,1);
  const selected = await fixture({ unknown:true }); assert.equal(selected.error, undefined); assert.equal(selected.events.find(e => e[0] === 'make')[2], '命题');
  console.log('Toolbar legacy actions: final object, preflight, type selection/cancellation, stale selection and refresh identity passed');
})().catch(error => { console.error(error); process.exitCode=1; });
