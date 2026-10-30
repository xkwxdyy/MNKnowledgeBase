'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = process.env.MNKB_TEST_ROOT || path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const start = source.indexOf('  MNKnowledgeBaseClass.prototype.getReadingDateStr = function()')
const end = source.indexOf('  MNKnowledgeBaseClass.prototype.getManagedAutomationModeKeys = function()', start)
assert(start >= 0 && end > start)
function harness() {
  const calls = [], notes = new Map()
  function note(id, title, fields = {}, parent) {
    const n = Object.assign({ noteId: id, noteTitle: title, kind: '归类', comments: [], childNotes: [] }, fields)
    n.delete = () => { calls.push(['delete', id]); if (parent) parent.childNotes = parent.childNotes.filter(c => c !== n) }
    n.refresh = () => calls.push(['refresh', id])
    n.createChildNote = payload => { calls.push(['create', payload.title]); return note('today', payload.title, {}, n) }
    if (parent) parent.childNotes.push(n)
    notes.set(id, n)
    return n
  }
  const readingRoot = note('root', '旧粗读收集')
  const context = {
    MNKnowledgeBaseClass: function () {}, ROOT_NOTE_IDS: { readingAuto: 'root' },
    resolveAvailableNote: n => typeof n === 'string' ? notes.get(n) : n,
    safeGetChildNotes: n => { try { return { ok: true, childNotes: n.childNotes } } catch (_) { return { ok: false, childNotes: [] } } },
    KnowledgeBaseTemplate: { getNoteType: n => n.kind },
    KnowledgeBaseUtils: { addErrorLog: e => calls.push(['error', e.message]), log() {} },
    MNUtil: { getDateObject: () => ({ year: 2026, month: 10, day: 24 }) }
  }
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  const instance = new context.MNKnowledgeBaseClass()
  return { instance, note, readingRoot, calls }
}
// Historical cards may contain comments, excerpts or only a title. None are owned by cleanup.
for (const fields of [
  { comments: [{ type: 'textComment', text: '保留的正文' }] },
  { comments: [{ type: 'imageComment', imageHash: 'local-image' }] },
  { excerptText: '保留的摘录' },
  { markdown: '保留的 Markdown 内容' },
  {}
]) {
  const h = harness()
  const date = h.note('old-date', '粗读 >> 2026.10.20', fields, h.readingRoot)
  const category = h.note('old-category', '“粗读 >> 2026.10.20”相关命题', fields, date)
  const before = JSON.stringify({ date: { title: date.noteTitle, comments: date.comments, excerptText: date.excerptText }, category: { title: category.noteTitle, comments: category.comments, excerptText: category.excerptText } })
  assert.equal(h.instance.ensureReadingAutoMoveTargets(), true)
  assert.equal(h.calls.filter(c => c[0] === 'delete').length, 0, 'collecting today must never delete historical content')
  assert(h.readingRoot.childNotes.includes(date)); assert(date.childNotes.includes(category))
  assert.equal(JSON.stringify({ date: { title: date.noteTitle, comments: date.comments, excerptText: date.excerptText }, category: { title: category.noteTitle, comments: category.comments, excerptText: category.excerptText } }), before)
  assert.equal(h.instance.readingDateNote.noteTitle, '粗读 >> 2026.10.24')
  assert.equal(h.instance.ensureReadingAutoMoveTargets(), true)
  assert.equal(h.calls.filter(c => c[0] === 'create').length, 1, 'reuse the current date without another card')
}
{
  const h = harness(), date = h.note('unreadable-date', '粗读 >> 2026.10.20', {}, h.readingRoot)
  Object.defineProperty(date, 'childNotes', { get() { throw Error('unreadable') } })
  assert.equal(h.instance.ensureReadingAutoMoveTargets(), true)
  assert(h.readingRoot.childNotes.includes(date)); assert.equal(h.calls.filter(c => c[0] === 'delete').length, 0)
}
{
  const h = harness(); h.instance.readingDateStr = '2026.10.24'
  const result = h.instance.cleanupHistoricalReadingAutoNotes([])
  assert.equal(result.deletedClassificationCount, 0); assert.equal(result.deletedDateCount, 0)
}
console.log('Reading history preservation: content, empty cards, unreadable children and date reuse passed')
