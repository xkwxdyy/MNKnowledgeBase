'use strict';
const assert = require('node:assert/strict');
const fs = require('./support/integration-fs.js');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../toolbarUsageExport.js'), 'utf8');
const files = new Map();
const timers = new Map();
let timerId = 0;
const sent = [];
const context = vm.createContext({ module: { exports: {} }, console,
  setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
  clearTimeout(key) { timers.delete(key); },
  MNUtil: { dbFolder: '/db', currentWindow: 'W1', tempPath: '/temp',
    postNotification(value, data) { sent.push(data.message); },
    string2data: text => text, showHUD() {}, saveFile(file) { context.shared = file; },
  },
  KnowledgeBaseUtils: { readTextFile: name => files.get(name) || '', writeTextFile(name, text) { files.set(name, text); return true; } },
  NSFileManager: { defaultManager: () => ({ fileExistsAtPath: name => files.has(name) || [...files.keys()].some(key => key.startsWith(name + '/')), contentsOfDirectoryAtPath: directory => [...files.keys()].filter(key => key.startsWith(directory + '/')).map(key => key.slice(directory.length + 1)) }) },
  NSFileHandle: { fileHandleForWritingAtPath: name => ({ writeData(text) { files.set(name, files.get(name) + text); }, synchronizeFile() {}, closeFile() {} }) },
});
vm.runInContext(source, context);
const exporter = context.module.exports;
const event = (eventId, day, menu, kind = 'action') => ({ eventId, sourceId: 'device1', localDate: day,
  timestamp: day + 'T23:30:00+08:00', offsetMinutes: 480,
  actionId: 'splitComments', variantId: '{}', buttonId: menu, menuId: menu, entryId: menu + '-split', gesture: kind === 'navigation' ? 'longPress' : 'menuSelect', eventKind: kind,
  title: 'PRIVATE_NOTE_CONTENT', extra: 'PRIVATE_SECRET',
});
const parts = {
  first: { schemaVersion: 1, recoveredFromBackup: true, events: [event('e1', '2026-10-17', 'menu_card'), event('n1', '2026-10-17', 'menu_card', 'navigation')] },
  second: { schemaVersion: 1, events: [event('e2', '2026-10-18', 'menu_comment'), event('e1', '2026-10-17', 'menu_card')] },
};
let content = '';
const summary = exporter.exportFiles({ files: ['first', 'second'], cutoff: 'now', fresh: true }, { append: text => { content += text; } }, name => parts[name]);
const result = JSON.parse(content);
assert.equal(summary.totalActions, 2);
assert.equal(summary.totalEvents, 3);
assert.equal(summary.actions.splitComments.activeDays, 2);
assert.equal(Object.keys(summary.entries).length, 2);
assert.equal(summary.daily['2026-10-17'], 1);
assert.equal(result.events.length, 3);
assert.equal(result.metadata.writeFailureObserved, true);
assert(!content.includes('PRIVATE_'));
assert(result.events.every(item => !('title' in item)));
assert.throws(() => exporter.collectFiles({ ready: true, requestId: '../bad' }));
assert.throws(() => exporter.exportFiles({ files: ['bad'] }, { append() {} }, () => ({ schemaVersion: 2, events: [] })));
assert.throws(() => exporter.aggregate([{ ...event('valid', '2026-10-17', 'menu_card'), eventId: '../bad' }], summary, new Set()));
(async () => {
  const pending = exporter.request('usageSnapshot');
  const requestId = new URLSearchParams(sent.at(-1).split('?')[1]).get('requestId');
  assert.equal(exporter.receive({ source: 'other', requestId, ok: '1' }), false);
  assert.equal(exporter.receive({ source: 'mntoolbar', requestId, windowToken: 'wW2', ok: '1' }), false);
  context.MNUtil.currentWindow = 'W2';
  assert.equal(exporter.receive({ source: 'mntoolbar', requestId, windowToken: 'wW1', ok: '1' }), false);
  context.MNUtil.currentWindow = 'W1';
  assert.equal(exporter.receive({ source: 'mntoolbar', requestId, windowToken: 'wW1', ok: '1' }), true);
  assert.equal((await pending).ready, true);
  assert.equal(exporter.receive({ source: 'mntoolbar', requestId, windowToken: 'wW1', ok: '1' }), false);
  const timeout = exporter.request('usageSnapshot');
  [...timers.values()].forEach(fn => fn()); timers.clear();
  const timed = await timeout;
  assert.equal(timed.timedOut, true);
  const dir = '/db/data/mntoolbar-usage/';
  files.set(dir + '2026-10-17.json', JSON.stringify(parts.first));
  files.set(dir + '2026-10-18-000001.json', JSON.stringify(parts.second));
  assert.equal(exporter.collectFiles(timed).files.length, 2);
  assert.equal(exporter.collectFiles(timed).fresh, false);
  assert.throws(() => exporter.collectFiles({ ready: false, timedOut: false }));
  context.MNUtil.postNotification = (name, data) => {
    sent.push(data.message);
    const params = Object.fromEntries(new URLSearchParams(data.message.split('?')[1]));
    if (params.action !== 'usageSnapshot') return;
    const filename = params.requestId + '-2026-10-17.json';
    files.set(dir + 'snapshots/' + filename, JSON.stringify(parts.first));
    files.set(dir + 'snapshots/' + params.requestId + '.json', JSON.stringify({ schemaVersion: 1, requestId: params.requestId, sourceId: 'device1', cutoff: 'now', files: [filename] }));
    exporter.receive({ source: 'mntoolbar', requestId: params.requestId, windowToken: params.windowToken, ok: '1' });
  };
  assert.equal(await exporter.exportUsage(), true);
  assert.equal(JSON.parse(files.get(context.shared)).summary.totalActions, 1);
  assert(sent.at(-1).includes('releaseUsageSnapshot'));
  assert.equal(timers.size, 0);
  context.MNUtil.postNotification = (name, data) => {
    sent.push(data.message);
    const params = Object.fromEntries(new URLSearchParams(data.message.split('?')[1]));
    assert.equal(params.action, 'setUsageEnabled');
    assert.equal(params.enabled, 'false', 'custom Toolbar starts enabled even before settings are written');
    exporter.receive({ source: 'mntoolbar', requestId: params.requestId, windowToken: params.windowToken, ok: '1' });
  };
  await exporter.toggle();
  // Exercise the real MNUtil URL parser: it decodes query JSON into booleans/numbers.
  const utilSource = fs.readFileSync(path.join(__dirname, '../../mnutils/mnutils/mnutils.js'), 'utf8');
  const parserStart = utilSource.indexOf('  static parseURL(urlString) {');
  const parserEnd = utilSource.indexOf('\n  /**', parserStart + 30);
  assert(parserStart >= 0 && parserEnd > parserStart);
  context.NSURL = { URLWithString(text) {
    const url = new URL(text);
    return { absoluteString: () => text, scheme: url.protocol.slice(0, -1), host: url.hostname, query: url.search.slice(1), fragment: url.hash.slice(1), pathComponents: () => ['/', ...url.pathname.split('/').filter(Boolean)] };
  } };
  context.MNUtil.isValidJSON = text => { try { JSON.parse(text); return true; } catch (_) { return false; } };
  vm.runInContext('class ProductionParser {\n' + utilSource.slice(parserStart, parserEnd) + '\n}; this.parseProductionURL = ProductionParser.parseURL;', context);
  context.NSString = { stringWithContentsOfFileEncodingError: name => files.get(name), stringWithString: text => ({ writeToFileAtomicallyEncodingError(name) { files.set(name, text); return true; } }) };
  const originalFM = context.NSFileManager.defaultManager;
  context.NSFileManager.defaultManager = () => ({ ...originalFM(), createDirectoryAtPathWithIntermediateDirectoriesAttributesError: () => true, removeItemAtPathError: name => files.delete(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../mntoolbar/mntoolbar/xdyy_usage_statistics.js'), 'utf8'), context);
  const toolbar = context.module.exports;
  context.MNUtil.postNotification = (name, data) => {
    const config = context.parseProductionURL('marginnote4app://addon/' + data.message);
    if (config.pathComponents[0] === 'mntoolbar') toolbar.handleBroadcast(config, { window: 'W1' });
    else exporter.receive(config.params);
  };
  assert.equal(await exporter.exportUsage(), true, 'real URL parser, Toolbar snapshot and Knowledge Base receipt must interoperate');
  await exporter.toggle();
  assert.equal(toolbar.getStore().enabled(), false);
  await exporter.toggle();
  assert.equal(toolbar.getStore().enabled(), true);
  assert.equal(timers.size, 0);
  const originalHandle = context.NSFileHandle.fileHandleForWritingAtPath;
  let closed = false;
  context.shared = null;
  context.NSFileHandle.fileHandleForWritingAtPath = () => ({ writeData() { throw new Error('disk full'); }, closeFile() { closed = true; } });
  await assert.rejects(exporter.exportUsage(), /disk full/);
  assert.equal(closed, true);
  assert.equal(context.shared, null, 'a partial export must never be shared');
  context.NSFileHandle.fileHandleForWritingAtPath = originalHandle;
  context.MNUtil.postNotification = () => {};
  const switched = exporter.exportUsage();
  context.MNUtil.currentWindow = 'W2';
  [...timers.values()].forEach(fn => fn()); timers.clear();
  await assert.rejects(switched, /窗口已切换/);
  console.log('Toolbar usage export: daily/entry totals, dedupe, redaction, streaming JSON, snapshot receipts, stale windows, timeout fallback and cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
