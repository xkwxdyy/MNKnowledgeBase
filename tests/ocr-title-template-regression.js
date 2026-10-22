'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
const logs = []
const context = vm.createContext({ console: { log() {} }, Promise, Date, JSON })
vm.runInContext(fs.readFileSync(path.join(root, 'KnowledgeBaseDefinitionConcept.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'KnowledgeBaseOCRPostprocess.js'), 'utf8') + '\n' +
  source.slice(source.indexOf('const kbOCRConfig = {'), source.indexOf('\nclass KnowledgeBaseTemplate')) + '\n' +
  source.slice(source.indexOf('class KnowledgeBaseNetwork'), source.indexOf('\nclass KnowledgeBaseConfig')) + '\n' +
  'this.Network = KnowledgeBaseNetwork; this.Definition = KnowledgeBaseDefinitionConcept;', context)
context.MNUtil = { currentNotebookId: 'study', currentWindow: {}, log(payload) { logs.push(payload) }, undoGrouping: block => block(), showHUD() {} }
context.KnowledgeBaseUtils = { log() {} }
context.KnowledgeBaseConfig = { config: { excerptOCRModel: 'fixture' }, getConfig: () => '' }
context.KnowledgeBaseTemplate = {
  types: { '定义': {colorIndex: 2}, '研究进展': {colorIndex: 3} },
  parseNoteTitle: () => ({type: '', content: 'existing {{template}}'}),
  normalizeTitleSpaces: text => text, runUndoGroupingWithoutGlobalDBRefreshAsync: async block => block(), refreshNoteLocally() {},
}
const Network = context.Network
const genericFormatter = Network.postProcessOCRResult.bind(Network)
Object.assign(Network, {
  usesResearchOCR: () => false, usesManualOCRInputPolicy: () => false,
  resolveOCRImageInput: async () => ({data: 'synthetic-image'}), prepareOCRImageData: input => input.data,
  buildOCRPostProcessOptions: () => ({}), getOCRResultFormatViolation: () => null,
  postProcessOCRResult: text => text, normalizeOCRTitlePrefixNumberSpacing: text => text,
})
const cases = [
  ['{{x}}', '{ {x} }'], ['{{{x}}}', '{ { {x} } }'],
  ['{{a}_{b}} + {{c}}', '{ {a}_{b} } + { {c} }'],
  ['{{line\nnext}}', '{ {line\nnext} }'],
  ['{{outer {{inner}} tail}}', '{ {outer { {inner} } tail}}'],
  ['{x} x_{i_{j}}', '{x} x_{i_{j}}'], ['{{unfinished', '{{unfinished'],
  ['{ {already} }', '{ {already} }'], ['plain title', 'plain title'],
]
;(async () => {
  let count = 0
  for (const mode of [1, 2, 3]) for (const [input, expected] of cases) {
    Network.OCR = async () => input
    const note = { title: 'old', noteTitle: 'old', noteId: 'fixture', colorIndex: mode === 3 ? 2 : 10 }
    assert.equal(await Network.OCRToTitle(note, mode, false, 'all', {ignoreDefinitionSkip: true}), true)
    assert.equal(note.title, expected); assert.equal(note.noteTitle, expected)
    const protection = logs.findLast(log => log.message === 'title.template-protected')
    assert.equal(protection.source, 'researchOCR')
    assert.deepEqual(JSON.parse(JSON.stringify(protection.detail)), {
      matchesBefore: (input.match(/\{{2,}[\s\S]*?\}{2,}/g) || []).length,
      matchesAfter: (expected.match(/\{{2,}[\s\S]*?\}{2,}/g) || []).length,
      changed: input !== expected,
    }, 'protection diagnostics must contain only counts and a boolean')
    Network.OCR = async () => expected
    await Network.OCRToTitle(note, mode, false, 'all', {ignoreDefinitionSkip: true})
    assert.equal(note.title, expected, 'title protection must be idempotent')
    count++
  }
  for (const place of ['firstTitleLinkWord', 'lastTitleLinkWord']) {
    Network.OCR = async () => '{{new}}'
    const note = { title: 'existing {{template}}', noteTitle: 'existing {{template}}', noteId: 'fixture', colorIndex: 10 }
    await Network.OCRToTitle(note, 1, false, place)
    assert.equal(note.title, place === 'firstTitleLinkWord' ? '{ {new} }; existing {{template}}' : 'existing {{template}}; { {new} }', 'only incoming OCR must be changed')
  }
  const timers = [], note = {noteId: 'definition', noteTitle: 'original', title: 'original', comments: []}
  const manager = context.Definition.create({
    capture: () => ({text: 'Definition: compact space.'}), context: () => 'study', getNote: () => note,
    delay: ms => new Promise(resolve => timers.push({ms, resolve})), apply: async block => block(), save() {},
    request: async () => '{"titles":[{"zh":"{{紧空间}}","en":"{{compact space}}"}]}',
    setTitle: (n, title) => { n.title = n.noteTitle = title },
  })
  manager.enqueue(note); timers.find(timer => timer.ms === 0).resolve()
  for (let i = 0; i < 80; i++) await Promise.resolve()
  assert.equal(note.title, '{ {紧空间} }; { {compact space} }', 'concept output must be protected after the concept model returns')
  assert.equal(genericFormatter('{{clipboard text}}', {disableTheoremHeadingCleanup: true}), '{{clipboard text}}', 'the shared formatter is not a title escape boundary')
  context.MNUtil.log = () => { throw new Error('logger unavailable') }
  Network.OCR = async () => '{{still visible}}'
  const loggerFailureNote = { title: 'old', noteTitle: 'old', noteId: 'fixture', colorIndex: 10 }
  assert.equal(await Network.OCRToTitle(loggerFailureNote, 1, false, 'all'), true)
  assert.equal(loggerFailureNote.title, '{ {still visible} }', 'diagnostic failures must not block title writes')
  console.log('OCR title template protection passed: ' + count + ' mode/case combinations, append placements, idempotence and background concept output')
})().catch(error => { console.error(error); process.exitCode = 1 })
