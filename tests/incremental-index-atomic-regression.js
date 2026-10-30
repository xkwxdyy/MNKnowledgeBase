#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))
const privateMarker = 'PRIVATE-FIXTURE-CONTENT-DO-NOT-LOG'
const evidence = []

function harness() {
  const logs = [], hud = [], rawLogs = []
  const calls = { load: 0, save: 0, renew: 0 }
  let stored = {
    metadata: { cardCount: 3, removedIds: ['already-removed'] },
    cards: [
      { id: 'current', title: 'previous entry', searchText: 'previous entry', usageScore: 4 },
      { id: 'source-excerpt', title: 'source entry' },
      { id: 'unrelated', title: 'other entry' },
    ],
  }
  const context = vm.createContext({
    console,
    KnowledgeBaseConfig: { config: {}, getConfig() { return false }, getSearchIndexMode() { return 'light' } },
    KnowledgeBaseUtils: { log() {}, addErrorLog(error) { rawLogs.push(String(error)) } },
    MNUtil: {
      dbFolder: '/fixture/database',
      showHUD(message) { hud.push(message) },
      log(payload) { logs.push(clone(payload)) },
      writeJSON() { throw new TypeError(privateMarker + '/private/path') },
    },
    MNLog: { error(error) { rawLogs.push(String(error)) } },
  })
  const end = source.indexOf('\nclass KnowledgeBaseNetwork')
  assert(end > 0)
  vm.runInContext(source.slice(0, end) + '\nthis.Template=KnowledgeBaseTemplate;this.Main=KnowledgeBaseIndexer;this.Intermediate=IntermediateKnowledgeIndexer', context)
  const policyStart = source.indexOf('  static shouldEmitRuntimeLog(')
  const policyEnd = source.indexOf('  static addErrorLog(', policyStart)
  assert(policyStart > 0 && policyEnd > policyStart)
  vm.runInContext('class RuntimePolicy {\n' + source.slice(policyStart, policyEnd) + '\n}\nthis.RuntimePolicy=RuntimePolicy', context)
  context.KnowledgeBaseUtils.emitRuntimeLog = (...args) => context.RuntimePolicy.emitRuntimeLog(...args)
  const { Template, Main, Intermediate } = context
  const saveMain = Main.saveIncrementalIndex.bind(Main)
  const saveIntermediate = Intermediate.saveIncrementalIndex.bind(Intermediate)
  Object.assign(Template, {
    _beginMakeCardPerf() { return null }, _recordMakeCardPerf() {}, _finishMakeCardPerf() {}, _makeCardPerfNow() { return 0 },
    getKeywordsFromNote() { return '' }, ifTemplateMerged(note) { return !!note.templated },
    renewLinks() { calls.renew += 1 }, getFirstClassificationParentNote() { return null },
  })
  // Keep the real type/title/search builders; unrelated field extraction has no native fixture.
  Object.assign(Main, {
    extractExcerptAreaText() { return '' }, extractSupplementalSearchText() { return '' },
    extractProofLinks() { return [] }, buildSearchEvidence() { return [] }, analyzeExclusionGroups() { return [] },
  })
  for (const Indexer of [Main, Intermediate]) {
    Indexer.loadIncrementalIndex = () => { calls.load += 1; return stored }
    Indexer.saveIncrementalIndex = value => { calls.save += 1; stored = clone(value); return true }
  }
  const note = (title = '') => ({ noteId: 'current', title, noteTitle: title, parentNoteId: null, MNComments: [], kbSourceExcerptNoteId: 'source-excerpt' })
  const run = (indexer, card, options = {}) => indexer === 'main'
    ? Main.upsertIncrementalIndexEntry(card, 'light', options)
    : Intermediate.upsertIncrementalIndexEntry(card, options)
  return { context, Template, Main, Intermediate, note, run, calls, logs, hud, rawLogs, saveMain, saveIntermediate, stored: () => stored }
}

// No title and no textual comments is an expected pre-OCR state: no disk I/O or deletion.
for (const quiet of [false, true]) {
  const h = harness(), before = clone(h.stored())
  const result = h.run('intermediate', h.note(), { showErrorHUD: !quiet, staleIds: ['unrelated'] })
  assert.equal(result.success, false)
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'empty-content')
  assert.deepEqual(h.calls, { load: 0, save: 0, renew: 0 })
  assert.deepEqual(h.stored(), before)
  assert.equal(h.logs.length, 0)
  assert.equal(h.hud.length, 0)
  evidence.push({ scenario: quiet ? 'empty-image-quiet' : 'empty-image-default', result: clone(result), calls: h.calls, oldEntryPreserved: true, hud: h.hud.length, logs: h.logs.length })
}

// A standard newly created category is recognized by real getNoteType/parseNoteTitle/buildSearchText.
for (const type of ['定义', '命题']) {
  const h = harness(), card = h.note(`“科研课题”相关${type}`)
  assert.equal(h.Template.getNoteType(card), '归类')
  const result = h.run('main', card)
  assert.equal(result.success, true)
  assert.equal(result.entry.type, '归类')
  assert.equal(result.entry.classificationSubtype, type)
  assert.equal(result.entry.searchText, `归类 科研课题 ${type}`)
  assert.equal(result.entry.usageScore, 4)
  assert.deepEqual(h.stored().cards.map(row => row.id), ['unrelated', 'current'])
  assert.deepEqual(h.stored().metadata.removedIds, ['already-removed', 'source-excerpt'])
  evidence.push({ scenario: `classification-${type}`, success: result.success, entryType: result.entry.type, classificationSubtype: result.entry.classificationSubtype, calls: h.calls })
}

// Unknown untemplated text remains searchable in the intermediate fallback.
{
  const h = harness(), result = h.run('intermediate', h.note('ordinary historical content'))
  assert.equal(result.success, true)
  assert.equal(result.entry.type, '历史卡片')
  assert.equal(result.entry.searchText, 'ordinary historical content')
  assert.equal(h.calls.save, 1)
}
// Text comments without a title are content; titleOnly deliberately ignores those comments.
for (const titleOnly of [false, true]) {
  const h = harness(), card = h.note(), before = clone(h.stored())
  card.MNComments.push({ type: 'textComment', text: 'a searchable statement' })
  const diagnostic = { steps: [], reasons: [] }
  const result = h.run('intermediate', card, { buildOptions: { titleOnly, diagnostic, skipRenewLinks: true } })
  assert.equal(result.success, !titleOnly)
  assert.equal(h.calls.renew, 0)
  if (titleOnly) {
    assert.equal(result.reason, 'empty-content')
    assert.equal(result.skipped, true)
    assert.equal(diagnostic.reason, 'empty-content')
    assert.equal(h.calls.save, 0)
    assert.deepEqual(h.stored(), before)
    assert.equal(h.logs.length, 0)
  } else assert(result.entry.searchText.includes('a searchable statement'))
}

// Missing main type remains a real diagnosable failure, even when its HUD is suppressed.
for (const showErrorHUD of [true, false]) {
  const h = harness(), before = clone(h.stored())
  const result = h.run('main', h.note(privateMarker), { showErrorHUD })
  assert.equal(result.success, false)
  assert.equal(result.skipped, false)
  assert.equal(result.reason, 'missing-type')
  assert.equal(h.calls.save, 0)
  assert.deepEqual(h.stored(), before)
  assert.equal(h.hud.length, showErrorHUD ? 1 : 0)
  assert.equal(h.logs.length, 1)
  assert.equal(h.logs[0].detail.reason, 'missing-type')
  assert.equal(h.logs[0].level, 'ERROR')
  assert(!JSON.stringify(h.logs).includes(privateMarker))
}
// A typed empty shell has no search material; retaining the previous entry is intentional.
{
  const h = harness(), before = clone(h.stored()), result = h.run('main', h.note('【命题】'))
  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'empty-search')
  assert.equal(h.calls.save, 0)
  assert.deepEqual(h.stored(), before)
  assert.equal(h.logs.length, 0)
  assert.equal(h.hud.length, 0)
}

// The final-card sync passes expected skips through without HUD, patches or opposite-index removal.
for (const indexSource of ['main', 'intermediate']) {
  const h = harness(), before = clone(h.stored())
  h.Template.resolveFinalMakeCardIndexSource = () => indexSource
  h.Template.normalizeFinalMakeCardStaleIds = () => ['source-excerpt']
  h.Template.publishFinalMakeCardIndexPatch = () => { throw new Error('empty skip must not publish a patch') }
  h.Main.removeFromIncrementalIndex = h.Intermediate.removeFromIncrementalIndex = () => { throw new Error('empty skip must not remove the other index') }
  const result = h.Template.syncFinalMakeCardIndex(h.note(indexSource === 'main' ? '【命题】' : ''), { indexSource })
  assert.equal(result.skipped, true)
  assert.equal(result.reason, indexSource === 'main' ? 'empty-search' : 'empty-content')
  assert.equal(h.calls.save, 0)
  assert.deepEqual(h.stored(), before)
  assert.equal(h.logs.length, 0)
  assert.equal(h.hud.length, 0)
}

// Both thrown builder failures and save failures leave the loaded object unchanged.
for (const indexer of ['main', 'intermediate']) {
  for (const failure of ['build', 'save-false', 'save-throw']) {
    const h = harness(), beforeRef = h.stored(), before = clone(beforeRef)
    const Indexer = indexer === 'main' ? h.Main : h.Intermediate
    if (failure === 'build') Indexer.buildIndexEntry = () => { throw new TypeError(privateMarker) }
    else Indexer.saveIncrementalIndex = () => {
      h.calls.save += 1
      if (failure === 'save-throw') throw new RangeError(privateMarker)
      return false
    }
    const result = h.run(indexer, h.note('“科研课题”相关命题'), { showErrorHUD: false })
    assert.equal(result.success, false)
    assert.equal(result.reason, failure === 'build' ? 'build-exception' : failure === 'save-false' ? 'save-failed' : 'save-exception')
    assert.deepEqual(beforeRef, before)
    assert.deepEqual(h.stored(), before)
    assert(h.logs.some(row => row.level === 'ERROR' && row.detail.reason === result.reason))
    assert(!JSON.stringify(h.logs).includes(privateMarker))
    assert(!JSON.stringify(h.logs).includes('current'))
    assert.equal(h.rawLogs.length, 0)
  }
}
// Exercise a real main builder exception (its catch returns null rather than throwing).
{
  const h = harness(), before = clone(h.stored())
  h.Main.extractExcerptAreaText = () => { throw new TypeError(privateMarker) }
  const result = h.run('main', h.note('“科研课题”相关命题'))
  assert.equal(result.reason, 'build-exception')
  assert.equal(h.calls.save, 0)
  assert.deepEqual(h.stored(), before)
  assert.equal(h.logs[0].detail.errorName, 'TypeError')
  assert.equal(h.rawLogs.length, 0)
  assert(!JSON.stringify(h.logs).includes(privateMarker))
}
// Actual persistence catches log metadata through MNUtil.log without logging the thrown path/message.
{
  const h = harness()
  assert.equal(h.saveMain({}), false)
  assert.equal(h.saveIntermediate({}), false)
  assert.equal(h.logs.length, 2)
  assert(h.logs.every(row => row.detail.reason === 'save-failed' && row.detail.errorName === 'TypeError'))
  assert.equal(h.rawLogs.length, 0)
  assert(!JSON.stringify(h.logs).includes(privateMarker))
  assert(!JSON.stringify(h.logs).includes('/fixture'))
}

if (process.env.MNKB_INDEX_EVIDENCE_PATH) {
  fs.writeFileSync(process.env.MNKB_INDEX_EVIDENCE_PATH, JSON.stringify({ source: 'real utils.js index builders/upserts in isolated Node VM; synthetic notes; no MarginNote device or persisted user data', evidence }, null, 2) + '\n')
}
console.log('incremental index atomic regression: ok')
