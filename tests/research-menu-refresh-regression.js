// The same test runs against canonical sources and the exact unpacked scene payload.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = process.env.MNKB_TEST_ROOT || path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
function method(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
  assert(a >= 0 && b > a)
  return source.slice(a, b)
}
const actualMake = method('  static makeCard(note,', '\n  /**')
const actualUndo = method('  static runUndoGroupingWithoutGlobalDBRefresh(', '\n  static async runUndoGroupingWithoutGlobalDBRefreshAsync(')
function fixture() {
  const calls = [], notes = new Map(), stored = new Map(), window = {}, instance = { window }
  let converted, made, deferred, applying = false, makeError, active = true
  const util = {
    currentWindow: window, currentNotebookId: 'study',
    refreshAfterDBChanged: id => calls.push(['db', id]),
    undoGroupingNotRefresh: block => { calls.push(['undo.start']); try { return block() } finally { calls.push(['undo.end']) } },
  }
  const context = vm.createContext({ console, module: { exports: {} }, Set, Map, Date, MNUtil: util, KnowledgeBaseConfig: { config: {} },
    Application: { sharedInstance: () => ({ studyController: () => ({ notebookController: { notebookId: util.currentNotebookId } }) }),
      immersiveTemplateForAddon: () => ({ allowed: active, config: { scene: 'research' } }) },
    NSUserDefaults: { standardUserDefaults: () => ({ objectForKey: key => stored.get(key), setObjectForKey: (value, key) => stored.set(key, value) }) },
    MNNote: { new: id => notes.get(id) },
    IntermediateKnowledgeIndexer: { upsertIncrementalIndexEntry: () => ({ success: true }) },
    KnowledgeBaseUtils: { addErrorLog: error => { throw error } },
  })
  vm.runInContext('this.KnowledgeBaseTemplate = class {' + actualMake + '\n' + actualUndo + '}', context)
  const T = context.KnowledgeBaseTemplate
  Object.assign(T, {
    types: { 归类: { colorIndex: 0 } }, shouldAutoAddToReview: () => true, getReadingScene: () => active ? 'research' : '',
    getNoteType: () => '命题', assertMakeCardTemplateAvailable: () => calls.push(['preflight']),
    getQuickReadingMakeCardPolicy: () => ({ mode: 'rough' }),
    makeQuickReadingRoughCard: () => { throw Error('saved rough policy must not replace explicit full make') },
    _beginMakeCardPerf() {}, _finishMakeCardPerf() {}, _makeCardPerfNow: () => 0, _recordMakeCardPerf() {},
    isOldTemplateCard: () => false, isIntermediateKnowledge: () => false, completeIntermediateKnowledge() {}, queueIntermediateKnowledgeCompletion() {}, sanitizeNoteCommentsForMake() {}, renewNote: note => { calls.push(['renew']); return note; },
    mergeTemplateAndAutoMoveNoteContent: () => { calls.push(['fields']); if (makeError) throw makeError },
    templateMergedCardMake: () => calls.push(['links']),
    syncFinalMakeCardIndex: () => calls.push(['final.index']), shouldSuppressQuickReadingDefinitionIndexHUD: () => true,
    addToReview: () => { throw Error('review must remain disabled') },
    toNoExcerptVersion: note => { calls.push(['convert', note.noteId]); return converted || note },
    refreshNoteLocally: (note, full) => note[full ? 'refreshAll' : 'refresh'](),
    convertNoteToClassificationNote: () => made,
  })
  function add(id, parent) {
    const note = { noteId: id, note: {}, notebookId: 'study', colorIndex: 10, parentNote: parent,
      refreshAll: () => calls.push(['all', id]), refresh: () => calls.push(['local', id]),
      focusInMindMap: seconds => calls.push(['focus', id, seconds]) }
    notes.set(id, note); return note
  }
  vm.runInContext(fs.readFileSync(path.join(root, 'KnowledgeBaseResearchCore.js'), 'utf8'), context)
  const core = context.module.exports.getRuntime()
  return { calls, T, context, add, core,
    command: note => core.dispatch(instance, { version: 1, requestId: 'make', command: 'makeCard', notebookId: 'study', payload: { noteId: note.noteId } }),
    convertTo: note => { converted = note }, makeTo: note => { made = note },
    fail: () => { makeError = Error('fixture make failure') },
    defer() { context.KnowledgeBaseDefinitionConcept = { getRuntime: () => ({ retarget() {}, deferMakeCard: (_, make) => { if (applying) return false; deferred = make; return true } }) } },
    complete: note => { applying = true; return deferred(note) },
    switchNotebook: () => { util.currentNotebookId = 'other' },
    leaveScene: () => { active = false },
  }
}
const presentation = h => h.calls.filter(row => ['db', 'all', 'local', 'focus'].includes(row[0]))
;(async () => {
  {
    const h = fixture(), parent = h.add('parent'), sourceNote = h.add('excerpt', parent), converted = h.add('converted', parent)
    h.convertTo(converted)
    const result = await h.command(sourceNote)
    assert.equal(result.noteId, 'converted'); assert.equal(result.addedToReview, false); assert.equal(result.cardPending, false)
    assert.deepEqual(presentation(h), [['db', 'study'], ['all', 'converted'], ['local', 'parent'], ['focus', 'converted', 0.3]])
    assert(h.calls.findIndex(row => row[0] === 'undo.end') < h.calls.findIndex(row => row[0] === 'db'))
    assert(h.calls.findIndex(row => row[0] === 'final.index') < h.calls.findIndex(row => row[0] === 'all'))
    assert.equal(h.T.getQuickReadingMakeCardPolicy().mode, 'rough')
  }
  {
    const h = fixture(), sourceNote = h.add('classification-source'), parent = h.add('parent'), replacement = h.add('classification-result', parent)
    sourceNote.colorIndex = 0; h.makeTo(replacement)
    const result = await h.command(sourceNote)
    assert.equal(result.noteId, replacement.noteId)
    assert.deepEqual(presentation(h), [['db', 'study'], ['all', replacement.noteId], ['local', 'parent'], ['focus', replacement.noteId, 0.3]])
  }
  {
    const h = fixture(), note = h.add('root')
    await h.command(note)
    assert.deepEqual(presentation(h), [['db', 'study'], ['all', 'root'], ['focus', 'root', 0.3]])
    h.calls.length = 0; await h.command(note)
    assert.equal(presentation(h).length, 3, 'repeated manual make still refreshes exactly once')
  }
  {
    const h = fixture(), parent = h.add('parent'), note = h.add('pending', parent)
    h.defer()
    const result = await h.command(note)
    assert.equal(result.cardPending, true); assert.deepEqual(presentation(h), [])
    h.complete(note)
    assert.deepEqual(presentation(h), [], 'DefinitionConcept owns presentation after the outer undo group; do not focus inside its callback')
    assert(h.calls.some(row => row[0] === 'final.index'), 'deferred completion still runs the full card maker')
  }
  for (const change of ['switchNotebook', 'leaveScene']) {
    const h = fixture(), note = h.add('pending')
    h.defer(); await h.command(note); h[change]()
    assert.throws(() => h.complete(note), /context-changed/)
    assert.deepEqual(presentation(h), [], 'stale deferred make must neither write nor focus')
  }
  {
    const h = fixture(), note = h.add('failed')
    h.fail(); await assert.rejects(h.command(note), /fixture make failure/)
    assert.equal(h.calls.some(row => row[0] === 'focus'), false)
  }
  console.log('Research menu refresh: converted and replacement result, Toolbar DB/all/parent/focus order, final index, deferred presentation ownership, lifecycle guard, no review and error path passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
