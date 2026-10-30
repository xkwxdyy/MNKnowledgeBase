'use strict'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const root = process.env.MNKB_TEST_ROOT || path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
function proto(name, next) {
  const start = source.indexOf('  MNKnowledgeBaseClass.prototype.' + name + ' = ')
  const end = source.indexOf('  MNKnowledgeBaseClass.prototype.' + next + ' = ', start)
  assert(start >= 0 && end > start, name)
  return source.slice(start, end)
}
function event(name, next) {
  const start = source.indexOf('    ' + name + ': '), end = source.indexOf('\n    ' + next + ':', start)
  assert(start >= 0 && end > start, name)
  return source.slice(start, end).replace(/,\s*$/, '').replace(/\/\*\*[\s\S]*?\*\/\s*$/, '')
}
async function run(saved) {
  const calls = [], note = { noteId: 'new', noteTitle: '待收集的命题' }
  const config = { readingAutoClassifyMode: saved, readingFollowMode: false, excerptOCRMode: 0, personal: 'keep' }
  const ctx = {
    MNKnowledgeBaseClass: function () {}, KnowledgeBaseConfig: { config, save() { calls.push('save') } },
    KnowledgeBaseUtils: { addErrorLog(error) { throw error } },
    MNUtil: { currentWindow: 'window', showHUD() { calls.push('hud') } },
    MNNote: { new: () => note }, isKnowledgeBaseExtendNote: () => false
  }
  vm.createContext(ctx)
  for (const [a,b] of [
    ['getManagedAutomationModeKeys','getManagedAutomationModeLabel'], ['isManagedAutomationModeEnabled','disableManagedAutomationMode'],
    ['disableManagedAutomationMode','disableManagedAutomationModes'], ['getConflictingAutomationModeKeys','showManagedAutomationModeHUD'],
    ['toggleReadingAutoClassifyMode','toggleReadingFollowMode'], ['processReadingAutoClassifyNote','processReadingFollowNote'],
    ['processReadingModeNote','tableItem'], ['getAutomationMenuItems','openMainMenu']
  ]) vm.runInContext(proto(a,b),ctx)
  const h = new ctx.MNKnowledgeBaseClass();ctx.self = h
  Object.assign(h, {
    window: 'window', isCreatingNewNote: true, newNoteCreatedFromMindMap: note, classAutoMoveMode: true,
    shouldSkipReadingOCR: () => false, processInboxAutoMoveNote: async () => calls.push('inbox'),
    processReadingFollowNote: async () => calls.push('follow'),
    ensureReadingAutoMoveTargets() { throw Error('retired mode must not create date cards') },
    getSupportedExcerptOCRMode: () => 0, menuSeparator: () => ({}),
    indentedTableItem: (title, selector) => ({ title, selector }), nestedTableItem: (title, selector) => ({ title, selector })
  })
  assert(!h.getAutomationMenuItems({}).some(item => item.selector === 'readingAutoClassifyModeToggled:'))
  assert(h.getAutomationMenuItems({}).some(item => item.selector === 'readingFollowModeToggled:'))
  assert.equal(h.isManagedAutomationModeEnabled('readingAutoClassify'), false)
  assert(!h.getManagedAutomationModeKeys().includes('readingAutoClassify'))
  for (const mode of ['excerptOCR', 'prefixMode', 'readingFollow']) assert(!h.getConflictingAutomationModeKeys(mode).includes('readingAutoClassify'))
  const before = JSON.stringify(config)
  h.toggleReadingAutoClassifyMode();h.disableManagedAutomationMode('readingAutoClassify')
  assert.equal(await h.processReadingAutoClassifyNote(note), note)
  assert.equal(JSON.stringify(config), before);assert.deepEqual(calls, [])
  // Exercise actual excerpt dispatch: a saved legacy true must not suppress Inbox.
  vm.runInContext('this.onExcerpt = ({' + event('onProcessNewExcerpt', 'queryAddonCommandStatus') + '}).onProcessNewExcerpt',ctx)
  await ctx.onExcerpt({ userInfo: { noteid: note.noteId } });assert.deepEqual(calls, ['inbox']);calls.length = 0
  // A saved legacy true must not suppress the existing follow flow either.
  config.readingFollowMode = true
  await h.processReadingModeNote(note, { source: 'excerpt' });assert.deepEqual(calls, ['follow']);calls.length = 0
  await h.processReadingModeNote(note, { source: 'mindmap' });assert.deepEqual(calls, [])
  config.readingFollowMode = false
  // Editing a new mindmap card retains its prior Inbox behavior.
  const editStart = source.indexOf('    onTextDidEndEditing: function(param) {')
  const editEnd = source.indexOf('\n    /**', editStart)
  vm.runInContext('this.onEdit = ({' + source.slice(editStart,editEnd).replace(/,\s*$/,'') + '}).onTextDidEndEditing',ctx)
  ctx.onEdit({});assert.deepEqual(calls,['inbox']);assert.equal(h.isCreatingNewNote,false)
  assert.equal(config.readingAutoClassifyMode,saved);assert.equal(config.personal,'keep')
}
Promise.all([run(false),run(true)]).then(()=>console.log('Retired date collection: hidden menu, ignored saved flags, compatible no-ops, excerpt/mindmap Inbox and follow routing passed')).catch(error=>{console.error(error);process.exitCode=1})
