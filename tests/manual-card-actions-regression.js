'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = process.env.MNKB_TEST_ROOT || path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
function event(start, end, name) {
  const a = main.indexOf(start), b = main.indexOf(end, a + start.length)
  assert(a >= 0 && b > a, name)
  return '({' + main.slice(a, b).trim().replace(/,$/, '') + '}).' + name
}
const popup = event('    onPopupMenuOnNote: async function (sender) {', '    /**\n     * 处理来自其他插件的通信消息', 'onPopupMenuOnNote')
const editing = event('    onTextDidEndEditing: function(param) {', '    /**\n     *\n     * @param {{userInfo:{noteid:String}}} sender', 'onTextDidEndEditing')
async function run(classificationMode, options = {}) {
  const calls = [], parent = { noteId: 'synthetic-parent' }
  const note = { noteId: 'synthetic-card', title: '补充说明', noteTitle: '补充说明', parentNote: parent, colorIndex: 8 }
  const config = { classificationMode, readingFollowMode: !!options.reading, classAutoPinMode: !!options.pin, privatePreference: 'retained' }
  const before = JSON.stringify(config)
  const self = { window: 'window', isCreatingNewNote: true, newNoteCreatedFromMindMap: note, classAutoMoveMode: !!options.inbox,
    processReadingModeNote: () => calls.push('reading'), processInboxAutoMoveNote: () => calls.push('inbox') }
  const prototype = {}
  for (const name of ['refreshOpenCommentManagerForNote', 'refreshOpenTemplateWorkbenchForNote', 'refreshOpenQuestionResearchWorkbenchForNote']) prototype[name] = async () => calls.push('refresh')
  const ctx = { self, KnowledgeBaseMergeHistory: { schedule() {} }, MNKnowledgeBaseClass: { prototype }, MNUtil: { currentWindow: 'window', copy: () => calls.push('copy') }, MNNote: { new: () => note },
    KnowledgeBaseConfig: { config, save: () => calls.push('save') },
    KnowledgeBaseResearchCore: { getRuntime: () => ({ isSceneActive: () => !!options.research }) },
    KnowledgeBaseClassUtils: { createClassificationNoteAfterTextEditingInMindMap: () => { calls.push('convert'); note.title = 'unexpected-conversion' } },
    KnowledgeBaseTemplate: { getNoteType: () => '归类', parseNoteTitle: () => ({ content: '补充说明' }) },
    KnowledgeBaseUtils: { addErrorLog: e => { throw e } }, isKnowledgeBaseExtendNote: () => false,
    pinnerUtils: { pinCard: () => calls.push('pin') } }
  prototype.commitReadingFollowTarget = () => calls.push('legacy-reading-target')
  prototype.scheduleUntitledReadingFollowTarget = () => calls.push('legacy-reading-target')
  vm.createContext(ctx)
  await vm.runInContext(popup, ctx)({ userInfo: { note: { noteId: note.noteId } } })
  assert(!calls.includes('copy'), 'Viewing a card must not overwrite clipboard, including saved legacy true')
  assert.equal(calls.filter(c => c === 'refresh').length, 3, 'Existing open panels still refresh')
  calls.length = 0
  vm.runInContext(editing, ctx)({})
  assert(!calls.includes('convert'), 'Completing a manual card must not convert it to classification')
  assert.equal(note.title, '补充说明'); assert.equal(note.parentNote, parent); assert.equal(note.colorIndex, 8)
  assert.equal(self.isCreatingNewNote, false)
  const expected = options.research ? [] : options.reading ? ['reading'] : options.inbox ? ['inbox'] : options.pin ? ['pin'] : []
  assert.deepEqual(calls, expected, 'Unrelated existing handlers remain available')
  assert.equal(JSON.stringify(config), before, 'Saved preferences must remain unchanged')
}
(async () => {
  for (const flag of [false, true]) for (const options of [{}, { research: true }, { reading: true }, { inbox: true }, { pin: true }]) await run(flag, options)
  console.log('Manual card actions: no implicit copy/conversion, saved flags preserved, panel/reading/Inbox/Pin paths passed')
})().catch(e => { console.error(e); process.exitCode = 1 })
