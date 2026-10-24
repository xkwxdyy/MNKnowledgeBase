'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = process.env.MNKB_TEST_ROOT || path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
function method(name) {
  const start = source.indexOf('  MNKnowledgeBaseClass.prototype.' + name + ' = ')
  assert.ok(start >= 0, name)
  const end = source.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + 1)
  return source.slice(source.indexOf(' = ', start) + 3, end)
}
async function run() {
  const calls = [], instance = { window: 'window' }
  const context = {
    console, self: instance, MNKnowledgeBaseClass: function () {},
    MNUtil: { currentWindow: 'window', undoGrouping: fn => fn() },
    KnowledgeBaseConfig: { config: { readingFollowMode: true } },
    KnowledgeBaseTemplate: {
      types: { 定义: { colorIndex: 2 } },
      isClassificationNote: n => n.kind === 'classification',
      getNoteType: n => n.type,
      parseNoteTitle: n => ({ type: n.acceptType }),
      isReadingClassificationNote: () => false,
      runUndoGroupingWithoutGlobalDBRefresh: fn => fn(),
      toNoExcerptVersion: (n, parent, options) => { calls.push(['convert', options]); return { ...n, noteId: n.noteId + '-converted', parentNote: parent } },
      refreshNoteLocally() {},
      makeCard: (...args) => { calls.push(['make', args[1], args[2]]) },
    },
    KnowledgeBaseDefinitionConcept: { getRuntime: () => ({ begin: () => { calls.push(['definition']); return {} }, finish: () => calls.push(['finish-definition']) }) },
    KnowledgeBaseUtils: { addErrorLog: e => { throw e } },
    isKnowledgeBaseExtendNote: () => false,
    MNNote: { new: () => currentNote },
  }
  vm.createContext(context)
  for (const name of ['isReadingFollowPropositionTarget', 'convertQuickReadingExcerptWithoutGlobalRefresh', 'shouldSkipReadingOCR', 'processReadingFollowNote', 'processReadingModeNote']) {
    instance[name] = vm.runInContext('(' + method(name) + ')', context)
  }
  context.MNKnowledgeBaseClass.prototype.markReadingFollowSource = () => calls.push(['mark-source'])
  const start = source.indexOf('    onProcessNewExcerpt: async function (sender) {')
  const end = source.indexOf('\n    queryAddonCommandStatus:', start)
  const handler = vm.runInContext('({' + source.slice(start, end) + '}).onProcessNewExcerpt', context)
  let target, currentNote
  Object.assign(instance, {
    extractReadingTagTypeAndCleanup() {},
    getReadingFollowParentNote: () => target,
    getReadingFollowMoveParent: n => n,
    getQuickReadingNoteDiagnostic: n => ({ noteId: n && n.noteId, parentNoteId: n && n.parentNote && n.parentNote.noteId }),
    logQuickReadingDiagnostic() {}, getReadingFollowChildContainment: () => ({}),
    getReadingTypeFromColor: n => n.type,
    applyQuickReadingOCRToTitle: async (n, options) => { calls.push(['ocr', options]); return true },
    syncConvertedIntermediateIndexIfNeeded: () => calls.push(['index']), refreshAfterQuickReadingOCR() {},
  })
  for (const type of ['命题', '定义', '例子', '反例', '约定', '']) {
    calls.length = 0
    target = { noteId: 'proposition', type: '命题', addChild: n => { n.parentNote = target; calls.push(['move']) } }
    currentNote = { noteId: 'excerpt', type, colorIndex: type === '定义' ? 2 : 10, focusInMindMap() {} }
    await handler({ userInfo: { noteid: currentNote.noteId } })
    assert.deepEqual(calls.map(c => c[0]), ['mark-source', 'move', 'ocr', 'convert', 'index'], type)
    assert.equal(calls.find(c => c[0] === 'ocr')[1].ignoreDefinitionSkip, true)
    assert.equal(calls.find(c => c[0] === 'convert')[1].allowTextExcerpt, true)
    assert.equal(currentNote.parentNote, target)
  }
  calls.length = 0
  target = { noteId: 'classification', kind: 'classification', type: '归类', acceptType: '命题', addChild: n => { n.parentNote = target; calls.push(['move']) } }
  currentNote = { noteId: 'excerpt', type: '命题', colorIndex: 10, focusInMindMap() {} }
  await handler({ userInfo: { noteid: currentNote.noteId } })
  assert.deepEqual(calls.find(c => c[0] === 'make'), ['make', false, true], 'Classification still makes a full card without review')
  calls.length = 0
  currentNote = { noteId: 'definition', type: '定义', colorIndex: 2, focusInMindMap() {} }
  await handler({ userInfo: { noteid: currentNote.noteId } })
  assert.ok(calls.some(c => c[0] === 'definition'), 'Ordinary definition extraction remains available outside proposition collection')
  assert.ok(!calls.some(c => c[0] === 'ocr'))
  console.log('Proposition collection: broad excerpt event, OCR, text/image conversion and classification policy passed')
}
run().catch(e => { console.error(e); process.exitCode = 1 })
