#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8')
const end = source.indexOf('\nclass KnowledgeBaseIndexer')
assert.notEqual(end, -1, 'Cannot locate the real KnowledgeBaseTemplate class')
const addonId = 'marginnote.extension.mnknowledgebase'

function dictionary(fields) {
  return { objectForKey(key) { return fields[key] } }
}

function harness(application) {
  const commands = [], operations = []
  const savedConfig = { prefixMode: false, classificationMode: false, preProcessMode: false, classAutoPinMode: false }
  const context = {
    console,
    KnowledgeBaseConfig: { config: savedConfig },
    KnowledgeBaseUtils: { log() {}, addErrorLog(error) { throw error } },
    MNUtil: { undoGrouping(block) { return block() }, isNoteInReview() { return false }, showHUD(message) { throw Error(message) } },
    MNCommand: { executeBuiltInCommand(command) { commands.push(command); return true } },
  }
  if (application !== undefined) context.Application = application
  vm.createContext(context)
  vm.runInContext(source.slice(0, end) + '\nthis.Template = KnowledgeBaseTemplate', context)
  const Template = context.Template
  Object.assign(Template, {
    assertMakeCardTemplateAvailable() {},
    _beginMakeCardPerf() { return null }, _finishMakeCardPerf() {}, _recordMakeCardPerf() {}, _makeCardPerfNow() { return 0 },
    getQuickReadingMakeCardPolicy() { return { mode: 'normal', noteType: '命题' } },
    getNoteType() { return '命题' },
    sanitizeNoteCommentsForMake() { operations.push('sanitize') },
    renewNote() { operations.push('renew') },
    mergeTemplateAndAutoMoveNoteContent() { operations.push('fields') },
    templateMergedCardMake() { operations.push('make') },
    syncFinalMakeCardIndex() {}, shouldSuppressQuickReadingDefinitionIndexHUD() { return false },
    processNote(note) { operations.push('process'); return note },
  })
  return { Template, context, commands, operations, savedConfig }
}

function snapshotApi(snapshot, instance = false) {
  const read = id => { assert.equal(id, addonId); return snapshot }
  return instance ? { sharedInstance() { return { immersiveTemplateForAddon: read } } } : { immersiveTemplateForAddon: read }
}

function runEntry(Template, method, requested = true) {
  const note = { noteId: 'fixture-card', colorIndex: 10, comments: [] }
  const options = { undoGrouping: false }
  return { note, result: method === 'makeCard' ? Template.makeCard(note, requested, true, options) : Template.makeNote(note, requested, true, false, options) }
}

const nativeResearch = dictionary({ allowed: { boolValue() { return true } }, config: dictionary({ scene: 'research' }) })
for (const [application, expected] of [
  [snapshotApi({ allowed: true, config: { scene: 'research' } }), false],
  [snapshotApi(JSON.stringify({ allowed: true, config: JSON.stringify({ scene: 'research' }) })), false],
  [snapshotApi(nativeResearch, true), false],
  [snapshotApi({ allowed() { return true }, config() { return { scene: 'research' } } }), false],
  [snapshotApi(dictionary({ allowed: { boolValue: true }, config: dictionary({ scene: 'research' }) })), false],
  [snapshotApi(dictionary({ allowed: { boolValue() { return false } }, config: dictionary({ scene: 'research' }) })), true],
  [snapshotApi({ allowed: { boolValue: false }, config: { scene: 'research' } }), true],
  [snapshotApi({ allowed: false, config: { scene: 'research' } }), true],
  [snapshotApi({ allowed: true, config: { scene: 'ordinary' } }), true],
  [snapshotApi({ allowed: true, config: {} }), true],
  [snapshotApi('invalid-json'), true],
  [{ sharedInstance() { return {} } }, true],
  [undefined, true],
]) {
  const { Template } = harness(application)
  assert.equal(Template.shouldAutoAddToReview(), expected)
}

for (const method of ['makeCard', 'makeNote']) {
  const research = harness(snapshotApi({ allowed: true, config: { scene: 'research' } }))
  const originalConfig = JSON.stringify(research.savedConfig)
  const made = runEntry(research.Template, method)
  assert.equal(made.result, made.note)
  assert.ok(research.operations.includes('fields'), method + ' must still merge card fields')
  assert.deepEqual(research.commands, [], method + ' must not send native AddToReview in research')
  assert.equal(JSON.stringify(research.savedConfig), originalConfig, 'Scene policy must not change saved configuration')

  for (const application of [undefined, snapshotApi({ allowed: true, config: { scene: 'ordinary' } })]) {
    const legacy = harness(application)
    const made = runEntry(legacy.Template, method)
    assert.equal(made.result, made.note)
    assert.deepEqual(legacy.commands, ['AddToReview'], method + ' must preserve ordinary review behavior')
    legacy.commands.length = 0
    runEntry(legacy.Template, method, false)
    assert.deepEqual(legacy.commands, [], 'An explicit false request must remain false')
  }

  const manual = harness(snapshotApi({ allowed: true, config: { scene: 'research' } }))
  manual.Template.addToReview({ noteId: 'manual-fixture' }, true)
  assert.deepEqual(manual.commands, ['AddToReview'], 'Explicit manual review must remain available')

  let snapshot = { allowed: true, config: { scene: 'research' } }, continuation, deferred = false
  const pending = harness({ immersiveTemplateForAddon(id) { assert.equal(id, addonId); return snapshot } })
  pending.context.KnowledgeBaseDefinitionConcept = { getRuntime() { return { deferMakeCard(note, callback) {
    if (deferred) return false
    deferred = true; continuation = callback; return true
  } } } }
  const madePending = runEntry(pending.Template, method)
  assert.equal(madePending.result, madePending.note)
  assert.deepEqual(pending.operations, [], 'Definition processing must defer card mutations')
  snapshot = { allowed: true, config: { scene: 'ordinary' } }
  const actualEntry = pending.Template[method]
  let resumedReview
  pending.Template[method] = function (...args) { resumedReview = args[1]; return actualEntry.apply(this, args) }
  const converted = { noteId: 'converted-fixture', colorIndex: 10, comments: [] }
  assert.equal(continuation(converted), converted)
  assert.equal(resumedReview, false, 'The deferred continuation must retain the frozen review flag')
  assert.deepEqual(pending.commands, [], 'Leaving research before definition completion must not re-enable review')
  assert.ok(pending.operations.includes('fields'), 'Deferred completion must still make the card')
}

console.log('scene card review policy regression passed: actual makeCard/makeNote, native review commands, manual review, deferred flags, native snapshot forms and legacy fallback')
