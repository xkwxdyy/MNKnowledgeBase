#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8')
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const controllerSource = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8')
const commentCoreSource = fs.readFileSync(path.join(root, 'scripts', 'comment-manager', 'core.js'), 'utf8')

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert(start >= 0, `missing start marker: ${startMarker}`)
  assert(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

const runtimePolicySource = sourceSlice(
  utilsSource,
  '  static shouldEmitRuntimeLog(',
  '  static addErrorLog('
)
const emitted = []
const runtimeContext = vm.createContext({
  Error,
  String,
  KnowledgeBaseConfig: { config: { runtimeDiagnosticLogEnabled: false } },
  MNUtil: { log(payload) { emitted.push(payload) } },
})
vm.runInContext(
  `class RuntimePolicy {\n${runtimePolicySource}\n}\n` +
    'globalThis.RuntimePolicy = RuntimePolicy;',
  runtimeContext,
  { filename: 'mnkb-runtime-policy.js' }
)

const RuntimePolicy = runtimeContext.RuntimePolicy
assert.strictEqual(RuntimePolicy.emitRuntimeLog('INFO', 'startup ready', 'startup'), false)
assert.strictEqual(emitted.length, 0)
assert.strictEqual(RuntimePolicy.emitRuntimeLog('ERROR', 'startup failed', 'startup'), true)
assert.strictEqual(emitted.length, 1)
assert.strictEqual(emitted[0].level, 'ERROR')
assert.strictEqual(RuntimePolicy.emitRuntimeLog('INFO', '执行失败', 'mutation'), true)
assert.strictEqual(emitted[1].level, 'ERROR')
assert.strictEqual(RuntimePolicy.emitRuntimeLog('INFO', 'poll state', 'commentManager.autoRefresh'), true)
assert.strictEqual(RuntimePolicy.emitRuntimeLog('INFO', 'conversion phase', 'makeCardConversion'), false)
assert.strictEqual(RuntimePolicy.emitRuntimeLog('INFO', 'quick-reading state', 'MNKnowledgeBase.quickReading'), false)
assert.strictEqual(RuntimePolicy.emitRuntimeLog('WARN', 'quick-reading slow', 'MNKnowledgeBase.quickReading'), true)

runtimeContext.KnowledgeBaseConfig.config.runtimeDiagnosticLogEnabled = true
assert.strictEqual(RuntimePolicy.emitRuntimeLog('DEBUG', 'config loaded', 'startup'), true)

const persistentPolicySource = sourceSlice(
  utilsSource,
  '  static appendPersistentDiagnosticLog(',
  '  static beginPersistentDiagnosticSession('
)
const writes = []
const persistentContext = vm.createContext({ Date, JSON, Number, Object, String })
vm.runInContext(
  `class PersistentPolicy {\n${persistentPolicySource}\n}\n` +
    'PersistentPolicy.isPersistentDiagnosticLogEnabled = () => false;\n' +
    'PersistentPolicy.getPersistentDiagnosticLogPath = () => "/tmp/mnkb-log";\n' +
    'PersistentPolicy.normalizePersistentDiagnosticDetail = value => value || {};\n' +
    'PersistentPolicy.readTextFile = () => "";\n' +
    'PersistentPolicy.writeTextFile = (path, text) => { writes.push({ path, text }); return true; };\n' +
    'globalThis.PersistentPolicy = PersistentPolicy;',
  Object.assign(persistentContext, { writes }),
  { filename: 'mnkb-persistent-policy.js' }
)
const PersistentPolicy = persistentContext.PersistentPolicy
assert.strictEqual(
  PersistentPolicy.appendPersistentDiagnosticLog('addTemplate', 'stage.start', {}, 'INFO', { force: true }),
  ''
)
assert.strictEqual(writes.length, 0, 'normal force must not bypass disabled persistent logging')
assert.strictEqual(
  PersistentPolicy.appendPersistentDiagnosticLog('addTemplate', 'stage.error', {}, 'ERROR', { force: true }),
  '/tmp/mnkb-log'
)
assert.strictEqual(writes.length, 1, 'errors must remain persistable when diagnostics are disabled')

assert(utilsSource.includes('persistentDiagnosticLogEnabled: false'))
assert(utilsSource.includes('runtimeDiagnosticLogEnabled: false'))
assert(utilsSource.includes('runtimeLoggingPolicyVersion: 1'))
assert(utilsSource.includes('this.migrateRuntimeLoggingConfig()'))
assert(mainSource.includes('KnowledgeBaseUtils.emitRuntimeLog(normalizedLevel, payload)'))
const quickReadingLogStart = mainSource.indexOf(
  'MNKnowledgeBaseClass.prototype.logQuickReadingDiagnostic = function',
)
const quickReadingLogEnd = mainSource.indexOf(
  'MNKnowledgeBaseClass.prototype.getQuickReadingNoteDiagnostic = function',
  quickReadingLogStart,
)
assert(quickReadingLogStart >= 0 && quickReadingLogEnd > quickReadingLogStart)
assert(!mainSource.slice(quickReadingLogStart, quickReadingLogEnd).includes('MNLog.info'))
assert(!/\bMNUtil\.log\(|\bMNLog\.(?:log|info|debug)\(/.test(
  [mainSource, utilsSource, controllerSource].join('\n')
), 'native ordinary logs must route through the shared policy')

const proofParserSource = utilsSource.slice(utilsSource.indexOf('class ProofParser {'))
assert(!proofParserSource.includes('emitRuntimeLog('), 'ProofParser token traversal must stay silent by default')

assert(commentCoreSource.includes("window.__MNKB_COMMENT_DEBUG__ !== true"))
assert(commentCoreSource.includes("isError ? 'ERROR' : 'INFO'"))
assert(controllerSource.includes('KnowledgeBaseUtils.log(message, source, undefined, level)'))

console.log('MNKnowledgeBase runtime logging policy regression tests passed')
