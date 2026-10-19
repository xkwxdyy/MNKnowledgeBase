const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')

const indexerStart = utilsSource.indexOf('class IntermediateKnowledgeIndexer')
const indexerEnd = utilsSource.indexOf('\nclass KnowledgeBaseNetwork', indexerStart)
assert(indexerStart >= 0 && indexerEnd > indexerStart, 'IntermediateKnowledgeIndexer source not found')

const sandbox = {
  console,
  KnowledgeBaseUtils: {},
  KnowledgeBaseTemplate: {
    ifTemplateMerged: () => false,
    getNoteType: () => '',
  },
  KnowledgeBaseConfig: { getConfig: () => false },
  KnowledgeBaseIndexer: {
    cleanHighlightMarkers: value => value,
  },
  MNLog: {},
  MNUtil: {},
  MNNote: {},
}
vm.createContext(sandbox)
vm.runInContext(`${utilsSource.slice(indexerStart, indexerEnd)}\nthis.Indexer = IntermediateKnowledgeIndexer`, sandbox)

const uuidA = '00000000-0000-4000-8000-000000000001'
const uuidB = '00000000-0000-4000-8000-000000000002'
const dangerousDetail = {
  toString() {
    throw new Error('native-like detail must not be coerced')
  },
}
dangerousDetail.self = dangerousDetail

const info = sandbox.Indexer.getMergedChildMapInfo({
  noteId: '00000000-0000-4000-8000-000000000003',
  MNComments: [
    { type: 'mergedChildMapComment', noteid: uuidA, detail: dangerousDetail },
    { type: 'mergedChildMapComment', detail: JSON.stringify({ targetNoteId: uuidB }) },
  ],
  comments: [
    { type: 'mergedChildMapComment', noteId: uuidA },
  ],
})

assert.strictEqual(info.hasMerged, true)
assert.deepStrictEqual(Array.from(info.noteIds), [uuidA, uuidB])

const checkpointStages = []
const entry = sandbox.Indexer.buildIndexEntry({
  noteId: uuidA,
  title: 'Checkpoint test',
  parentNoteId: null,
  MNComments: [],
}, 'light', {
  titleOnly: true,
  skipRenewLinks: true,
  onCheckpoint: stage => checkpointStages.push(stage),
})
assert(entry)
assert.deepStrictEqual(checkpointStages, [
  'beforeContentCheck',
  'beforeTemplateCheck',
  'beforeFallbackBuild',
])

assert(mainSource.includes("persistentCheckpointPath: MNUtil.dbFolder + '/data/intermediate-index-last.json'"))
assert(mainSource.includes("this.tableItem('📤 导出过程索引卡点 JSON', 'exportIntermediateIndexCheckpoint:')"))
assert(mainSource.includes("'beforeLiteratureCheck'"))
assert(utilsSource.includes("onCheckpoint('beforeTemplateCheck')"))
assert(utilsSource.includes('KnowledgeBaseUtils.writeTextFile(path, serialized)'))

console.log('intermediate index checkpoint regression: ok')
