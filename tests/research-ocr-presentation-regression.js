'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const Definition = require('../KnowledgeBaseDefinitionConcept')
const source = fs.readFileSync(path.join(__dirname, '../utils.js'), 'utf8')
const block = source.slice(source.indexOf('  static async presentOCRResult('), source.indexOf('  static refreshNoteLocally('))
function fixture() {
  const calls = [], logs = [], window = {}, util = { currentNotebookId: 'study', currentWindow: window,
    delay: async () => {}, xdyyRefreshAfterDBChangedNow: id => calls.push(['view', id]), log: entry => logs.push(entry) }
  const context = vm.createContext({ MNUtil: util, Date, String })
  vm.runInContext('this.Template = class {' + block + '}', context)
  context.Template.refreshNoteLocally = note => calls.push(['data', note.noteId])
  const note = { noteId: 'converted', notebookId: 'study', focusedInMindmap: false, focusInMindMap: async () => { throw Error('selection-only wrapper must not be used') } }
  util.app = { studyController: actualWindow => { assert.equal(actualWindow, window); return { focusNoteInMindMapById: id => { calls.push(['focus', id]); note.focusedInMindmap = true } } } }
  return { calls, logs, util, note, template: context.Template }
}
;(async () => {
  {
    const h = fixture(); assert.equal(await h.template.presentOCRResult(h.note), true)
    assert.deepEqual(h.calls, [['data', 'converted'], ['view', 'study'], ['focus', 'converted']])
    assert.deepEqual(h.logs.map(x => x.message), ['view.refreshed', 'focus.requested', 'card.focused', 'presentation.finished'])
    assert(!JSON.stringify(h.logs).includes('converted'), 'presentation logs contain no private note ids')
  }
  {
    const h = fixture(); h.util.delay = async () => { h.util.currentNotebookId = 'elsewhere' }
    assert.equal(await h.template.presentOCRResult(h.note), false)
    assert.equal(h.calls.filter(x => x[0] === 'focus').length, 0)
    assert.equal(h.logs.at(-1).message, 'presentation.skipped')
  }
  {
    const h = fixture(); h.util.delay = async () => { h.util.currentWindow = {} }
    assert.equal(await h.template.presentOCRResult(h.note), false); assert.equal(h.calls.length, 2)
  }
  {
    const h = fixture(); assert.equal(await h.template.presentOCRResult(h.note, { valid: () => false }), false)
    assert.equal(h.calls.length, 0)
    assert.equal(await h.template.presentOCRResult(h.note, { focus: false }), true)
    assert.equal(h.calls.filter(x => x[0] === 'focus').length, 0)
  }
  {
    const h = fixture(); delete h.util.xdyyRefreshAfterDBChangedNow
    h.util.app.refreshAfterDBChanged = id => h.calls.push(['native-view', id])
    assert.equal(await h.template.presentOCRResult(h.note), true)
    h.util.app.refreshAfterDBChanged = () => { throw Error('host failed') }
    assert.equal(await h.template.presentOCRResult(h.note), false)
    assert.equal(h.logs.at(-1).level, 'ERROR')
    h.util.log = () => { throw Error('log unavailable') }
    assert.equal(await h.template.presentOCRResult(h.note), false, 'logging failure cannot reject OCR completion')
  }
  {
    const h = fixture(); h.util.app.studyController = () => ({ focusNoteInMindMapById: () => {} })
    assert.equal(await h.template.presentOCRResult(h.note), false, 'a no-op native focus must not be reported as success')
    assert.equal(h.logs.some(x => x.message === 'card.focused'), false)
    assert.equal(h.logs.at(-1).detail.reason, 'focus-not-confirmed')
  }
  {
    let inUndo = false, presented = '', window = {}, saved = []
    const timers = [], notes = new Map(), original = { noteId: 'source', noteTitle: 'original', comments: [] }
    const converted = { ...original, noteId: 'converted' }; notes.set('converted', converted)
    const manager = Definition.create({ capture: () => ({ text: 'Definition: A Hausdorff space separates distinct points.' }), researchActive: () => true,
      context: () => 'study', window: () => window, getNote: id => notes.get(id), delay: ms => new Promise(resolve => timers.push({ ms, resolve })),
      request: async () => '{"titles":[{"zh":"豪斯多夫空间","en":"Hausdorff space"}]}', save: value => saved.push(value),
      apply: async fn => { inUndo = true; fn(); inUndo = false }, setTitle: (n, title) => { n.title = n.noteTitle = title },
      present: async n => { assert.equal(inUndo, false, 'presentation must run after the undo group'); presented = n.noteId } })
    const job = manager.begin(original); manager.retarget(original, converted); manager.finish(job)
    timers.find(x => x.ms === 0).resolve(); for (let i = 0; i < 80; i++) await Promise.resolve()
    assert.equal(presented, 'converted'); assert.equal(saved.at(-1).status, 'applied')
  }
  const core = fs.readFileSync(path.join(__dirname, '../KnowledgeBaseResearchCore.js'), 'utf8')
  assert(core.includes('deferPresentation: true'), 'research OCR must not focus the source before conversion')
  assert(core.includes('await deps.refresh(processed, { focus: !definitionJob'), 'refresh/focus must use the final card; pending definitions focus only after completion')
  console.log('Research OCR presentation: data/view/focus order, converted target, definition completion outside undo, context/window guards and metadata logs passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
