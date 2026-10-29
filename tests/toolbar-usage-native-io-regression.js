const assert = require('node:assert/strict');
const fs = require('./support/integration-fs.js');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const toolbarSource = fs.readFileSync(path.join(root, '../mntoolbar/mntoolbar/xdyy_usage_statistics.js'), 'utf8');
const exportSource = fs.readFileSync(path.join(root, 'toolbarUsageExport.js'), 'utf8');
const files = new Map();
const directories = new Set(['/db', '/db/data', '/temp']);
let failedWrite = '', shared, saves = 0;
const huds = [];
const runtimeLogs = [], diagnosticLogs = [];
const manager = {
  fileExistsAtPath: name => files.has(name) || directories.has(name),
  createDirectoryAtPathWithIntermediateDirectoriesAttributes(name) {
    directories.add(name); // The host method need not return a JavaScript boolean.
  },
  contentsOfDirectoryAtPath: directory => [...files.keys()]
    .filter(name => name.startsWith(directory + '/') && !name.slice(directory.length + 1).includes('/'))
    .map(name => name.slice(directory.length + 1)),
  moveItemAtPathToPath(from, to) {
    assert(directories.has(path.posix.dirname(to)));
    files.set(to, files.get(from)); files.delete(from);
  },
};
class Data {
  constructor(text = '') { this.text = text; }
  writeToFileAtomically(name, atomic) {
    assert.equal(atomic, true);
    if (name.includes(failedWrite) && failedWrite) return false;
    assert(directories.has(path.posix.dirname(name)), 'Parent directory must exist');
    files.set(name, this.text); return true;
  }
}
const context = vm.createContext({ module: { exports: {} }, console, setTimeout, clearTimeout,
  MNUtil: { dbFolder: '/db', currentWindow: 'W1', tempPath: '/temp', showHUD(message) { huds.push(message); },
    string2data: value => new Data(value), saveFile(name) { shared = name; saves++; },
  },
  NSFileManager: { defaultManager: () => manager },
  NSData: { dataWithContentsOfFile: name => files.has(name) ? new Data(files.get(name)) : null,
    dataWithStringEncoding: value => new Data(value) },
  NSString: { stringWithContentsOfData: data => data.text },
  NSMutableData: { new() { const data = new Data(); data.appendData = part => { data.text += part.text; }; return data; } },
  KnowledgeBaseUtils: { readTextFile: name => files.get(name) || '',
    emitRuntimeLog(...args) { runtimeLogs.push(args); },
    appendPersistentDiagnosticLog(...args) { diagnosticLogs.push(args); },
    writeTextFile(name, value) { return new Data(value).writeToFileAtomically(name, true); } },
});
vm.runInContext(toolbarSource, context);
const toolbar = context.module.exports;
const store = toolbar.getStore();
store.clock = () => new Date('2026-10-26T10:00:00Z');
store.record({ actionId: 'makeNote', buttonId: 'custom5', menuId: 'menu_card', entryKey: 'make',
  gesture: 'click', eventKind: 'action', label: '制卡' }, {});
const day = '/db/data/mntoolbar-usage/2026-10-26.json';
const settings = files.get('/db/data/mntoolbar-usage/settings.json');
const savedDay = files.get(day);
assert.equal(JSON.parse(savedDay).events.length, 1);
const snapshot = store.snapshot('usage-native');
assert.equal(snapshot.files.length, 1);
assert.equal(files.get('/db/data/mntoolbar-usage/snapshots/' + snapshot.files[0]), savedDay);
assert.equal(new toolbar.Store(toolbar.nativeIO(), store.root).enabled(), true, 'Native settings must survive reload');
assert.throws(() => toolbar.nativeIO().read('/missing'), /usage read failed/);
const originalMkdir = manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes;
manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes = () => {};
assert.throws(() => toolbar.nativeIO().write('/unavailable/settings.json', '{}'), /usage directory unavailable/);
manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes = originalMkdir;
failedWrite = 'settings.json';
assert.throws(() => store.setEnabled(false), /usage write failed/);
assert.equal(store.enabled(), true);
assert.equal(files.get('/db/data/mntoolbar-usage/settings.json'), settings);
failedWrite = '';

vm.runInContext(exportSource, context);
const exporter = context.module.exports;
context.MNUtil.postNotification = (name, data) => {
  const params = Object.fromEntries(new URLSearchParams(data.message.split('?')[1]));
  if (data.message.startsWith('mntoolbar?')) toolbar.handleBroadcast({ params }, { window: 'W1' });
  else exporter.receive(params);
};
(async () => {
  assert.equal(await exporter.exportUsage(), true, 'Export must work without NSString file selectors or NSFileHandle');
  const result = JSON.parse(files.get(shared));
  assert.equal(result.summary.totalActions, 1);
  assert.equal(result.events[0].actionId, 'makeNote');
  assert.equal(result.events[0].label, '制卡');
  assert.equal(result.metadata.freshSnapshot, true);
  assert.equal(files.get(day), savedDay, 'Export must not change the saved history');
  await exporter.toggle();
  assert.equal(store.enabled(), false);
  assert.match(exporter.toggleTitle(), /已暂停.*启用/);
  store.record({ actionId: 'paused', entryKey: 'paused', gesture: 'click', eventKind: 'action' }, {});
  assert.equal(files.get(day), savedDay, 'Paused interactions must not be recorded');
  await exporter.toggle();
  assert.equal(store.enabled(), true);
  assert.match(exporter.toggleTitle(), /已启用.*暂停/);
  assert.deepEqual(huds, [], 'Successful exports and switch changes must remain silent');
  assert.equal(manager.contentsOfDirectoryAtPath(store.root + '/snapshots').length, 2,
    'The requested snapshot must be released while an unrelated snapshot remains');
  assert(manager.contentsOfDirectoryAtPath('/temp/mntoolbar-usage-snapshots').length >= 2,
    'Hosts without deletion must retire only disposable snapshots to system temp');
  failedWrite = '/temp/';
  shared = null;
  const before = saves;
  await assert.rejects(exporter.exportUsage(), /无法创建统计导出文件|统计导出文件写入失败/);
  assert.equal(saves, before, 'A failed export must never open the share sheet');
  assert.equal(shared, null);
  assert.equal(files.get(day), savedDay);
  failedWrite = '';
  // Fail only the final native-buffer commit, after the temporary file was created.
  const originalWrite = context.KnowledgeBaseUtils.writeTextFile;
  context.KnowledgeBaseUtils.writeTextFile = (name, value) => {
    const ok = originalWrite(name, value); failedWrite = '/temp/'; return ok;
  };
  await assert.rejects(exporter.exportUsage(), /统计导出文件写入失败/);
  assert.equal(saves, before);
  assert.equal(files.get(day), savedDay);
  context.KnowledgeBaseUtils.writeTextFile = originalWrite;
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const start = mainSource.indexOf('    exportToolbarUsage: async function() {');
  const end = mainSource.indexOf('    exportActualSearchIndex: function()', start);
  assert(start >= 0 && end > start);
  vm.runInContext('this.handlers = {' + mainSource.slice(start, end) + '};', context);
  let refreshedButton;
  context.self = { openMaintenanceMenu(button) { refreshedButton = button; } };
  const anchor = {};
  await context.handlers.toggleToolbarUsage(anchor);
  assert.equal(refreshedButton, anchor, 'The confirmed toggle must reopen the menu at the same anchor');
  assert.match(exporter.toggleTitle(), /已暂停/);
  await context.handlers.toggleToolbarUsage(anchor);
  assert.match(exporter.toggleTitle(), /已启用/);
  assert(mainSource.includes("this.tableItem(KBToolbarUsage.toggleTitle(), 'toggleToolbarUsage:', button)"));
  failedWrite = '/snapshots/';
  await context.handlers.exportToolbarUsage();
  assert.match(huds.at(-1), /导出工具栏统计失败.*usage write failed/);
  failedWrite = 'settings.json';
  await context.handlers.toggleToolbarUsage();
  assert.match(huds.at(-1), /设置工具栏统计失败.*usage write failed/);
  assert.deepEqual(runtimeLogs.map(row => row[0]), ['ERROR', 'ERROR']);
  assert.deepEqual(diagnosticLogs.map(row => row[2].action), ['exportUsage', 'toggle']);
  assert(diagnosticLogs.every(row => row[2].errorMessage.includes('usage write failed')));
  assert.equal(saves, before, 'A rejected snapshot must not export saved history as a fresh snapshot');
  assert.equal(store.enabled(), true, 'A rejected switch update must preserve enabled state');
  console.log('Toolbar native usage IO: exported SDK selectors, void mkdir return, persistence, snapshot, JSON export without NSFileHandle, failed writes and history preservation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
