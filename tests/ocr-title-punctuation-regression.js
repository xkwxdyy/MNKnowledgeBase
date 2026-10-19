const assert = require('assert')
const fs = require('./support/integration-fs.js')
const path = require('path')
const vm = require('vm')

const addonRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(addonRoot, '..')
const knowledgeBaseUtils = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8')
const literatureUtils = fs.readFileSync(path.join(repoRoot, 'mnliterature', 'utils.js'), 'utf8')
const toolbarSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
)
const literatureMain = fs.readFileSync(path.join(repoRoot, 'mnliterature', 'main.js'), 'utf8')

function extractNormalizer(source) {
  const start = source.indexOf('  static normalizeOCRTitlePunctuation')
  assert.notStrictEqual(start, -1, 'OCR title punctuation normalizer is missing')
  const end = source.indexOf('\n  static ', start + 10)
  assert.notStrictEqual(end, -1, 'OCR title punctuation normalizer boundary is missing')
  const method = source.slice(start, end).replace('static ', '')
  return vm.runInNewContext(`({${method}}).normalizeOCRTitlePunctuation`)
}

function extractPostProcessor(source, configName, configEndMarker) {
  const configStart = source.indexOf(`const ${configName} = {`)
  const configEnd = source.indexOf(configEndMarker, configStart)
  assert.notStrictEqual(configStart, -1, `Cannot locate ${configName}`)
  assert.notStrictEqual(configEnd, -1, `Cannot locate the end of ${configName}`)

  const context = vm.createContext({})
  vm.runInContext(
    `${source.slice(configStart, configEnd)}\nthis.config = ${configName};`,
    context,
  )

  const methodStart = source.indexOf('  static postProcessOCRResult')
  const methodEnd = source.indexOf('\n  static ', methodStart + 10)
  assert.notStrictEqual(methodStart, -1, 'OCR post-processor is missing')
  assert.notStrictEqual(methodEnd, -1, 'OCR post-processor boundary is missing')
  const method = source.slice(methodStart, methodEnd).replace('static ', '')
  const postProcessOCRResult = vm.runInNewContext(`({${method}}).postProcessOCRResult`)

  return (value, options = {}) => postProcessOCRResult.call({
    OCRPostProcessingRules: context.config.postProcessingRules,
    normalizeOCRTitlePunctuation: extractNormalizer(source),
  }, value, options)
}

function extractToolbarTitleWriter(source, normalizeOCRTitlePunctuation) {
  const start = source.indexOf('function _xdyy_applyOCRTextToTitle')
  const end = source.indexOf('\nfunction _xdyy_getFirstTitleLinkWordWithoutPrefix', start)
  assert.notStrictEqual(start, -1, 'MNToolbar OCR title writer is missing')
  assert.notStrictEqual(end, -1, 'MNToolbar OCR title writer boundary is missing')

  const context = vm.createContext({
    KnowledgeBaseNetwork: { normalizeOCRTitlePunctuation },
    KnowledgeBaseTemplate: {
      normalizeTitleSpaces(title) {
        return String(title || '')
          .replace(/\s*([=+\-−×÷])\s*/gu, '$1')
          .replace(/ {2,}/g, ' ')
      },
      parseNoteTitle(note) {
        return { type: '', prefixContent: '', content: note.title || '' }
      },
    },
    MNUtil: {
      undoGrouping(callback) {
        return callback()
      },
    },
  })
  vm.runInContext(`${source.slice(start, end)}\nthis.writeTitle = _xdyy_applyOCRTextToTitle;`, context)
  return context.writeTitle
}

function assertRules(normalize, label) {
  assert.strictEqual(
    normalize('； ， ① 第一项；第二项。'),
    '① 第一项, 第二项',
    `${label} must remove edge punctuation, punctuation before circled numbers, and ordinary semicolons`,
  )
  assert.strictEqual(normalize('标题：内容，'), '标题：内容', `${label} must keep useful internal punctuation`)
  assert.strictEqual(
    normalize('A; B', { preserveTitleLinkSeparator: true }),
    'A; B',
    `${label} must preserve semicolons for explicit title-link variants`,
  )
  assert.strictEqual(normalize('A；B'), 'A, B', `${label} must normalize full-width semicolons`)
}

assertRules(extractNormalizer(knowledgeBaseUtils), 'MNKnowledgeBase')
assertRules(extractNormalizer(literatureUtils), 'MNLiterature')

const postProcessors = [
  {
    label: 'MNKnowledgeBase',
    run: extractPostProcessor(knowledgeBaseUtils, 'kbOCRConfig', '\n\nclass KnowledgeBaseTemplate'),
  },
  {
    label: 'MNLiterature',
    run: extractPostProcessor(literatureUtils, 'literatureReadingOCRConfig', '\n\nclass literatureNetwork'),
  },
]

postProcessors.forEach(({ label, run }) => {
  const options = { normalizeTitlePunctuation: true }
  assert.strictEqual(
    run('普通标题；OCR 并列内容。', options),
    '普通标题, OCR 并列内容',
    `${label} must remove semicolons supplied by OCR`,
  )
  assert.strictEqual(
    run('Theorem 2.1 (Closed graph theorem): Every closed operator is bounded.', options),
    'Every closed operator is bounded; Closed graph theorem',
    `${label} must preserve the semicolon introduced when a heading becomes a title-link word`,
  )
})

const writeToolbarTitle = extractToolbarTitleWriter(
  toolbarSource,
  extractNormalizer(knowledgeBaseUtils),
)
const ordinaryToolbarNote = { title: '原标题' }
writeToolbarTitle(ordinaryToolbarNote, '普通标题;OCR 并列内容')
assert.strictEqual(
  ordinaryToolbarNote.title,
  '普通标题, OCR 并列内容',
  'MNToolbar must remove ordinary semicolons before writing a manual OCR title',
)
const spacedToolbarNote = { title: '原标题' }
writeToolbarTitle(spacedToolbarNote, 'A + B = C |x| 后文')
assert.strictEqual(
  spacedToolbarNote.title,
  'A+B=C |x| 后文',
  'MNToolbar OCR title writes must compact math operators immediately while preserving delimiter word spaces',
)
const linkedToolbarNote = { title: '原标题' }
writeToolbarTitle(linkedToolbarNote, 'OCR 正文; 后置名称', 'all', {
  preserveTitleLinkSeparator: true,
})
assert.strictEqual(
  linkedToolbarNote.title,
  'OCR 正文; 后置名称',
  'MNToolbar must preserve a post-processing title-link separator',
)
assert.match(
  knowledgeBaseUtils,
  /postProcessOptions\.normalizeTitlePunctuation\s*=\s*true[\s\S]*?preserveTitleLinkSeparator\s*=\s*place === 'firstTitleLinkWord' \|\| place === 'lastTitleLinkWord'/,
  'MNKnowledgeBase OCRToTitle must pass the title punctuation profile',
)
assert.match(
  toolbarSource,
  /postProcessOptions\.normalizeTitlePunctuation\s*=\s*true/,
  'MNToolbar MNAI translation title path must normalize OCR punctuation before translation',
)
assert.match(
  toolbarSource,
  /normalizeOCRTitlePunctuation\(finalText,[\s\S]*?preserveTitleLinkSeparator:\s*place === "firstTitleLinkWord"\s*\|\|\s*place === "lastTitleLinkWord"/,
  'MNToolbar MNAI translation title path must use the shared title punctuation profile',
)
assert.match(
  toolbarSource,
  /preserveTitleLinkSeparator:\s*\/\[;；\]\/.test\(ocrText\)/,
  'MNToolbar MNAI translation title path must retain generated title-link separators',
)
assert.match(
  literatureMain,
  /normalizeTitlePunctuation:\s*true/,
  'MNLiterature reading OCR title path must use the title punctuation profile',
)

console.log('OCR title punctuation regression ok')
