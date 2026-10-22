'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Core = require('../KnowledgeBaseResearchCore')
const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
const existing = fs.readFileSync(path.join(__dirname, 'research-ocr-recovery-regression.js'), 'utf8')
const shared = vm.createContext({ vm, fs, path, root, source, Core, JSON, Promise })
vm.runInContext(existing.slice(existing.indexOf('function fixture()'), existing.indexOf('\n;(async () =>')), shared)
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }

function researchFixture(active = true) {
  const h = shared.fixture(), images = [], concepts = []
  const initialConfig = h.context.KnowledgeBaseConfig.config
  h.context.KnowledgeBaseTemplate.getConfiguredReferenceList = () => []
  h.context.KnowledgeBaseTemplate.getConfiguredReference = () => ''
  vm.runInContext(source.slice(source.indexOf('class KnowledgeBaseConfig'), source.indexOf('\nclass HtmlMarkdownUtils')) + '\nthis.KnowledgeBaseConfig = KnowledgeBaseConfig;', h.context)
  h.context.KnowledgeBaseConfig.config = { ...initialConfig, ocrFixedPostprocessEnabled: true, quickReadingOCRModel: 'deepseek-flash', quickReadingOCRFallbackModel: 'deepseek-flash' }
  h.context.KnowledgeBaseResearchCore = { sceneSnapshot: Core.sceneSnapshot }
  h.context.Application = { immersiveTemplateForAddon: () => ({ allowed: active, config: { scene: 'research' } }) }
  h.context.ocrConfig.inModelSource = () => true
  h.context.ocrConfig.modelSource = alias => ({ model: alias, url: 'https://ocr.example', apiKey: 'fixture-key' })
  h.context.ocrNetwork.initRequestForChatGPT = (_, url, model) => ({ model, json: { messages: JSON.parse(JSON.stringify(h.context.ocrNetwork.history)) }, setTimeoutInterval() {} })
  h.context.MNConnection.sendRequest = async request => { images.push(request); return { choices: [{ message: { content: 'A compact operator maps bounded sets to relatively compact sets' } }] } }
  h.context.ocrNetwork.sendRequest = h.context.MNConnection.sendRequest
  h.context.MNUtil.isNSNull = value => value == null
  h.context.MNUtil.getLocalDataByKey = () => []
  h.context.MNUtil.setLocalDataByKey = () => {}
  h.context.IntermediateKnowledgeIndexer = { addToIncrementalIndex: () => ({ success: true }) }
  h.context.chatAIConfig = { getConfigFromSource: () => ({ url: 'https://api.deepseek.com/chat/completions', key: 'fixture-official-key' }) }
  h.context.NSOperationQueue = { mainQueue: () => ({}) }
  h.context.NSJSONSerialization = { JSONObjectWithDataOptions: value => value }
  h.context.NSURLConnection = { sendAsynchronousRequestQueueCompletionHandler(request, queue, callback) {
    concepts.push(request.json)
    callback({ statusCode: () => 200 }, { choices: [{ finish_reason: 'stop', message: { content: '{"titles":[{"zh":"紧算子","en":"compact operator"}]}' } }] }, null)
  } }
  return { ...h, images, concepts }
}

;(async () => {
  {
    const h = researchFixture(), Config = h.context.KnowledgeBaseConfig
    assert.equal(Config.getResearchOCRModel(), 'gemini-3.5-flash-minimal')
    assert.deepEqual(Array.from(Config.getAvailableOCRSources(1)), Array.from(Config.RESEARCH_OCR_SOURCES), 'the existing temporary model picker must offer only Top5 in research')
    Config.config.researchOCRModel = 'glm-5.3-flashx-low'
    assert.equal(Config.getResearchOCRModel(), 'glm-5.3-flashx-low')
    assert.equal(Config.getResearchOCRModel('qwen3.8-flash-nothinking'), 'qwen3.8-flash-nothinking')
    assert.equal(Config.getResearchOCRModel('deepseek-flash'), 'glm-5.3-flashx-low', 'an explicit DS image override must not bypass the research policy')
    Config.config.researchOCRModel = 'deepseek-flash'
    assert.equal(Config.getResearchOCRModel(), 'gemini-3.5-flash-minimal')
    const note = h.add('proposition')
    await h.core.processExcerpt(h.instance, note)
    assert.equal(h.images.length, 1); assert.equal(h.images[0].model, 'gemini-3.5-flash-minimal')
    assert.equal(h.concepts.length, 0, 'research propositions must never send an image to DS')
    const prompt = h.images[0].json.messages[0].content
    assert(prompt.includes('下标内部的上下标')); assert(prompt.includes('Unicode')); assert(prompt.includes('当前模式规则'))
    assert.equal(Config.config.ocrFixedPostprocessEnabled, true, 'the global correction setting must remain unchanged')
    await h.context.Network.OCRToTitle(h.add('toolbar-default'), 1, false, 'all')
    assert.equal(h.images.length, 2, 'the unflagged Toolbar default must detect the active scene')
    await h.context.Network.OCRToTitle(h.add('temporary-model'), 1, false, 'all', { ocrModelOverride: 'qwen3.8-flash-nothinking' })
    assert.equal(h.images.at(-1).model, 'qwen3.8-flash-nothinking')
    const copied = []; h.context.MNUtil.copy = value => copied.push(value)
    assert.equal(typeof await h.context.Network.OCRDirectlyToClipboard({ note, timeoutSeconds: 1 }), 'string')
    assert.equal(copied.length, 1); assert.equal(h.images.at(-1).model, 'gemini-3.5-flash-minimal')
    assert.equal(h.concepts.length, 0)
  }
  for (const available of [true, false]) {
    const h = researchFixture(), note = h.add('definition', '定义'), made = []
    note.title = note.noteTitle = '【定义 >> 科研】; original'
    if (!available) delete h.context.chatAIConfig
    await h.core.processExcerpt(h.instance, note)
    const manager = h.context.Definition.getRuntime()
    assert.equal(manager.deferMakeCard(note, current => made.push(current.title)), true)
    h.timers.find(timer => timer.seconds < 0.01).resolve(); await flush()
    assert.equal(h.images.length, 1); assert.equal(h.images[0].model, 'gemini-3.5-flash-minimal')
    assert.equal(made.length, 1, 'concept failure must retain the visible OCR draft and execute the deferred make only once')
    if (available) {
      assert.equal(h.concepts.length, 1)
      assert.equal(typeof h.concepts[0].messages[1].content, 'string')
      assert(!JSON.stringify(h.concepts).includes('image_url')); assert(!JSON.stringify(h.concepts).includes('data:image'))
      assert.equal(note.title, '【定义 >> 科研】; 紧算子; compact operator')
    } else {
      assert.equal(h.concepts.length, 0)
      assert.equal(note.title, '【定义 >> 科研】; A compact operator maps bounded sets to relatively compact sets')
    }
    assert.equal(manager.pending(), 0)
  }
  {
    const h = researchFixture(), requests = []
    h.context.MNConnection.sendRequest = request => {
      requests.push(request.model)
      return requests.length === 1 ? new Promise(() => {}) : Promise.resolve({ choices: [{ message: { content: 'fallback recognized' } }] })
    }
    const task = h.core.processExcerpt(h.instance, h.add('fallback'))
    await flush(); h.timers[0].resolve(); await task
    assert.deepEqual(requests, ['gemini-3.5-flash-minimal', 'glm-5.3-flashx-low'])
    assert.equal(h.concepts.length, 0)
  }
  {
    const h = researchFixture(), note = h.add('unavailable', '定义')
    h.context.ocrConfig.modelSource = () => ({})
    assert.equal(h.context.Definition.getRuntime().begin(note), null)
    await h.core.processExcerpt(h.instance, note)
    assert.equal(note.title, 'original'); assert.equal(h.images.length, 0); assert.equal(h.concepts.length, 0)
  }
  {
    const h = researchFixture(false), calls = []
    h.context.Definition.requestOfficial = async body => {
      calls.push(body)
      return calls.length === 1 ? 'raw recognized' : '{"readable":true,"text":"corrected recognized"}'
    }
    assert.equal(await h.context.Network.OCR('image', 'deepseek-flash', 'ordinary rules', { mode: 1, timeoutSeconds: 2 }), 'corrected recognized')
    assert.equal(calls.length, 2, 'nonresearch modes must retain their configured independent correction')
    assert.equal(h.images.length, 0)
  }
  console.log('Research MNOCR: Top5-only default/override, one image request, text-only DS concepts, visible fallback/deferred make, GLM-only timeout fallback, Toolbar scene defaults and nonresearch isolation: ok')
})().catch(error => { console.error(error); process.exitCode = 1 })
