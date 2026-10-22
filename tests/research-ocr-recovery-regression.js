'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Core = require('../KnowledgeBaseResearchCore')
const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }

function fixture() {
  const timers = [], logs = [], notes = new Map()
  const context = vm.createContext({ console: { log() {} }, Promise, Date, JSON })
  vm.runInContext(
    fs.readFileSync(path.join(root, 'KnowledgeBaseDefinitionConcept.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, 'KnowledgeBaseOCRPostprocess.js'), 'utf8') + '\n' +
    source.slice(source.indexOf('const kbOCRConfig = {'), source.indexOf('\nclass KnowledgeBaseTemplate')) + '\n' +
    source.slice(source.indexOf('class KnowledgeBaseNetwork'), source.indexOf('\nclass KnowledgeBaseConfig')) + '\n' +
    'this.Network = KnowledgeBaseNetwork; this.Definition = KnowledgeBaseDefinitionConcept;', context)
  context.MNUtil = {
    currentNotebookId: 'study', MD5: () => 'fixture',
    delay: seconds => new Promise(resolve => timers.push({ seconds, resolve })),
    log: entry => logs.push(JSON.parse(JSON.stringify(entry))),
    showHUD() {}, waitHUD() {}, stopHUD() {},
  }
  context.KnowledgeBaseUtils = { log() {}, emitRuntimeLog() {}, addErrorLog(error) { throw error } }
  context.KnowledgeBaseConfig = {
    config: { excerptOCRModel: 'gpt-4.1', quickReadingOCRTimeoutSeconds: 0.02, quickReadingOCRFallbackModel: '' },
    getConfig(key) { return this.config[key] },
  }
  context.ocrConfig = { config: {}, modelSource: () => ({ model: 'fixture-model', url: 'https://ocr.example', apiKey: 'fixture-key' }) }
  context.ocrNetwork = { OCRBuffer: {}, initRequestForChatGPT: () => ({ setTimeoutInterval() {} }) }
  context.ocrUtils = { getImageFromNote: () => 'fixture-image', action: (_, result) => result }
  context.MNConnection = { initRequest: (_, options) => options, sendRequest: async () => ({ choices: [{ message: { content: 'recognized' } }] }) }
  context.MNNote = { new: id => notes.get(id) }
  context.KnowledgeBaseTemplate = {
    types: { '定义': { colorIndex: 2 }, '研究进展': { colorIndex: 3 } },
    parseNoteTitle: () => ({}), normalizeTitleSpaces: value => value,
    runUndoGroupingWithoutGlobalDBRefreshAsync: async block => block(), refreshNoteLocally() {}, presentOCRResult: async () => true,
  }
  function add(id, type = '命题') {
    const note = { noteId: id, notebookId: 'study', noteTitle: 'original', title: 'original', type, colorIndex: type === '定义' ? 2 : 0, comments: [] }
    notes.set(id, note); return note
  }
  const instance = { window: {} }
  let ocrCalls = 0
  const core = Core.create({
    load: () => null, notebookId: () => 'study', isCurrentWindow: () => true, sceneActive: () => true,
    getNote: id => notes.get(id), noteNotebookId: note => note.notebookId, title: note => note.title,
    excerptType: (_, note) => note.type, groupId: () => '',
    beginDefinition: note => context.Definition.getRuntime().begin(note), finishDefinition: job => context.Definition.getRuntime().finish(job),
    ocr: (_, note) => { ocrCalls++; return context.Network.OCRToTitle(note, 1, false, 'all', { quickReadingPlainText: true, ignoreDefinitionSkip: true }) },
    convert: note => note, syncIndex() {}, refresh() {}, log(error) { throw error },
  })
  return { context, timers, logs, notes, add, core, instance, ocrCalls: () => ocrCalls }
}

;(async () => {
  {
    const h = fixture()
    h.context.KnowledgeBaseConfig.config.runtimeDiagnosticLogEnabled = false
    h.context.Network.logOCRStage('network.failed', { provider: 'gpt-4.1', reason: 'timeout', durationMs: 12, timedOut: true, noteId: 'private-note', title: 'private-title', endpoint: 'private-endpoint', key: 'private-key' })
    assert.equal(h.logs.length, 1, 'bounded OCR diagnostics must reach MNLog when verbose INFO is disabled')
    assert.deepEqual(h.logs[0], { source: 'researchOCR', level: 'WARN', message: 'network.failed', detail: { provider: 'gpt-4.1', reason: 'timeout', durationMs: 12, timedOut: true } })
    h.context.MNUtil.log = () => { throw Error('fixture sink failed') }
    assert.doesNotThrow(() => h.context.Network.logOCRStage('network.finished', { success: true }))
    assert.doesNotThrow(() => h.context.Definition.providerAvailable(), 'a broken log sink must not prevent provider fallback')
  }
  for (const unavailable of ['missing-plugin', 'missing-config']) {
    const h = fixture()
    if (unavailable === 'missing-config') h.context.chatAIConfig = { getConfigFromSource: () => ({}) }
    const note = h.add('definition', '定义')
    assert.equal(h.context.Definition.getRuntime().begin(note), null, 'unavailable concept provider must not claim the excerpt')
    await h.core.processExcerpt(h.instance, note)
    assert.equal(h.ocrCalls(), 1)
    assert.equal(note.title, 'recognized', 'ordinary OCR must remain available without the concept provider')
    assert(h.logs.some(entry => entry.source === 'definitionConcept' && entry.message === 'provider.unavailable'))
  }
  {
    const h = fixture(), first = h.add('first'), second = h.add('second')
    let release, sent = 0
    h.context.MNConnection.sendRequest = () => ++sent === 1
      ? new Promise(resolve => { release = resolve })
      : Promise.resolve({ choices: [{ message: { content: 'second recognized' } }] })
    const firstTask = h.core.processExcerpt(h.instance, first)
    const secondTask = h.core.processExcerpt(h.instance, second)
    await flush(); assert.equal(sent, 1)
    h.timers[0].resolve()
    await Promise.all([firstTask, secondTask])
    assert.equal(sent, 2, 'a missing native completion must not hold the next excerpt')
    assert.equal(first.title, 'original'); assert.equal(second.title, 'second recognized')
    release({ choices: [{ message: { content: 'late response must not be written' } }] })
    await flush()
    assert.equal(first.title, 'original'); assert.equal(second.title, 'second recognized')
    assert(h.logs.some(entry => entry.message === 'network.failed' && entry.detail.timedOut))
  }
  for (const changed of ['title', 'notebook', 'before-undo-callback']) {
    const h = fixture(), note = h.add('edited-during-network')
    let releaseNetwork, applyTitle, releaseApply
    h.context.MNConnection.sendRequest = () => new Promise(resolve => { releaseNetwork = resolve })
    if (changed === 'before-undo-callback') h.context.KnowledgeBaseTemplate.runUndoGroupingWithoutGlobalDBRefreshAsync = block => {
      applyTitle = block
      return new Promise(resolve => { releaseApply = resolve })
    }
    const task = h.core.processExcerpt(h.instance, note)
    await flush()
    if (changed === 'title') note.title = note.noteTitle = 'manual title edit'
    if (changed === 'notebook') h.context.MNUtil.currentNotebookId = 'other-study'
    releaseNetwork({ choices: [{ message: { content: 'obsolete OCR result' } }] })
    if (changed === 'before-undo-callback') {
      await flush()
      note.title = note.noteTitle = 'manual title edit'
      applyTitle(); releaseApply()
    }
    await task
    assert.equal(note.title, changed === 'notebook' ? 'original' : 'manual title edit', 'quick-reading edits must be protected independently of optional math correction')
    assert(h.logs.some(entry => entry.message === 'title.rejected' && entry.detail.reason === 'source-changed'))
  }
  for (const provider of ['Doc2X', 'SimpleTex']) {
    const h = fixture(); let release
    h.context.ocrNetwork[provider === 'Doc2X' ? 'doc2xImgOCR' : 'simpleTexOCR'] = () => new Promise(resolve => { release = resolve })
    const diagnostic = {}, task = h.context.Network.OCR('image', provider, 'rules', { timeoutSeconds: 0.02, ocrDiagnosticTarget: diagnostic })
    await flush(); h.timers[0].resolve()
    assert.equal(await task, undefined)
    assert.equal(diagnostic.attempts[0].timedOut, true, provider + ' must have a JavaScript deadline')
    release('late provider text'); await flush()
    assert.equal(h.context.ocrNetwork.OCRBuffer.fixture, undefined, 'late provider text must not enter the cache')
  }
  for (const outcome of ['timeout', 'provider-error', 'user-edited', 'format-rejected', 'make-failed', 'ocr-failed']) {
    const h = fixture(), note = h.add('definition-fallback', '定义'), made = [], records = []
    note.title = note.noteTitle = '【定义 >> 基本概念】; original'
    h.context.chatAIConfig = { getConfigFromSource: () => ({ url: 'https://api.deepseek.com/chat/completions', key: 'fixture-official-key' }) }
    h.context.MNUtil.isNSNull = value => value == null
    h.context.MNUtil.getLocalDataByKey = () => []
    h.context.MNUtil.setLocalDataByKey = value => records.push(value)
    h.context.IntermediateKnowledgeIndexer = { addToIncrementalIndex: () => ({ success: true }) }
    h.context.NSOperationQueue = { mainQueue: () => ({}) }
    h.context.NSJSONSerialization = { JSONObjectWithDataOptions: value => value }
    let calls = 0, lateConcept
    h.context.NSURLConnection = { sendAsynchronousRequestQueueCompletionHandler(request, queue, callback) {
      calls++
      if (calls === 1) {
        callback({ statusCode: () => outcome === 'ocr-failed' ? 503 : 200 }, { choices: [{ finish_reason: 'stop', message: { content: 'An operator T is compact when a_{n} converges.' } }] }, null)
      } else if (outcome === 'provider-error') callback({ statusCode: () => 503 }, {}, null)
      else lateConcept = () => callback({ statusCode: () => 200 }, { choices: [{ finish_reason: 'stop', message: { content: '{"titles":[{"zh":"紧算子","en":"compact operator"}]}' } }] }, null)
    } }
    if (outcome === 'format-rejected') h.context.Network.getOCRResultFormatViolation = () => 'fixture-format-error'
    await h.core.processExcerpt(h.instance, note)
    const manager = h.context.Definition.getRuntime()
    assert.equal(manager.deferMakeCard(note, current => { made.push(current.title); if (outcome === 'make-failed') throw Error('fixture card error') }), true)
    h.timers.find(timer => timer.seconds < 0.01).resolve()
    await flush()
    if (outcome === 'user-edited') note.title = note.noteTitle = 'user edited title'
    if (lateConcept) { h.timers.at(-1).resolve(); await flush() }
    if (['timeout', 'provider-error', 'make-failed'].includes(outcome)) {
      assert.equal(note.title, '【定义 >> 基本概念】; An operator T is compact when aₙ converges')
      assert.equal(made.length, 1, 'the deferred make must run exactly once after the visible OCR draft')
      assert.equal(records.at(-1).at(-1).status, outcome === 'make-failed' ? 'card-failed' : 'recognized-fallback')
      assert(h.logs.some(entry => entry.detail.titleKind === 'ocr-draft'))
    } else {
      assert.equal(made.length, 0, 'an edited, rejected or missing draft must not trigger deferred make')
      assert.equal(note.title, outcome === 'user-edited' ? 'user edited title' : '【定义 >> 基本概念】; original')
    }
    if (lateConcept) { const before = note.title; lateConcept(); await flush(); assert.equal(note.title, before, 'late concept responses must not overwrite fallback or user edits') }
    assert.equal(manager.pending(), 0)
  }
  {
    const h = fixture(), note = h.add('fallback')
    h.context.KnowledgeBaseConfig.config.ocrFixedPostprocessEnabled = true
    h.context.MNConnection.sendRequest = async () => ({ choices: [{ message: { content: 'a_{n}' } }] })
    assert.equal(await h.context.Network.OCRToTitle(note, 1, false, 'all', { quickReadingPlainText: true }), true)
    assert.equal(note.title, 'aₙ', 'a failed optional correction must retain the recognized draft through existing formatting')
    assert(h.logs.some(entry => entry.message === 'correction.fallback' && entry.detail.reason === 'unavailable'))
    assert(h.logs.some(entry => entry.message === 'correction.result' && entry.detail.correctionFallback))
    const serialized = JSON.stringify(h.logs)
    for (const forbidden of ['fixture-key', 'ocr.example', 'a_{n}', 'noteId', 'noteTitle']) assert(!serialized.includes(forbidden), 'new logs must contain only bounded metadata: ' + forbidden)
  }
  {
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
    const start = main.indexOf('  MNKnowledgeBaseClass.prototype.applyOCRToTitleWithMode = async function(')
    const end = main.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + 10)
    const calls = [], context = vm.createContext({ MNKnowledgeBaseClass: function () {}, KnowledgeBaseNetwork: { OCRToTitle: async (...args) => { calls.push(args); return true } }, IntermediateKnowledgeIndexer: { addToIncrementalIndex: () => calls.push('index') } })
    vm.runInContext(main.slice(start, end), context)
    const instance = new context.MNKnowledgeBaseClass(), note = { noteId: 'card' }
    await instance.applyOCRToTitleWithMode(note, 1, { skipIndex: true })
    assert(!calls.includes('index'), 'Research must not index before conversion')
    assert.equal(calls[0][4].skipIndex, true)
    await instance.applyOCRToTitleWithMode(note, 1)
    assert.equal(calls.filter(value => value === 'index').length, 1, 'existing callers retain their index update')
  }
  console.log('Research OCR recovery: missing provider fallback, hung transport, queue release, user-edit/notebook/undo guards, late result isolation, timed legacy providers, correction fallback, metadata-only MNLog and skipIndex: ok')
})().catch(error => { console.error(error); process.exitCode = 1 })
