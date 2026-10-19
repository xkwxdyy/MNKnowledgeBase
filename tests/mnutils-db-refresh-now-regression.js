const fs = require('./support/integration-fs.js');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const mnutilsDir = path.resolve(rootDir, '..', 'mnutils');
const mnutilsSource = fs.readFileSync(path.join(mnutilsDir, 'mnutils', 'mnutils.js'), 'utf8');
const xdyyutilsSource = fs.readFileSync(path.join(mnutilsDir, 'mnutils', 'xdyyutils.js'), 'utf8');
const updaterSource = fs.readFileSync(path.join(mnutilsDir, 'update-mnutils.py'), 'utf8');

function extractBalancedBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `missing block marker: ${marker}`);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated block: ${marker}`);
}

const refreshPatch = extractBalancedBlock(
  xdyyutilsSource,
  'if (!MNUtil._xdyyRefreshAfterDBChangedPatchApplied)',
);
const context = {
  Date,
  pendingDelays: [],
  MNUtil: {
    currentNotebookId: 'NOTEBOOK-CURRENT',
    _lastRefreshAfterDBChangedTime: 0,
    _needRefreshAfterDBChanged: false,
    delay(seconds) {
      return new Promise((resolve) => context.pendingDelays.push({ seconds, resolve }));
    },
  },
};
const refreshes = [];
context.MNUtil.app = {
  refreshAfterDBChanged(notebookId) {
    refreshes.push(notebookId);
  },
};
vm.createContext(context);
vm.runInContext(refreshPatch, context);

(async () => {
  context.MNUtil.refreshAfterDBChanged('NOTEBOOK-PENDING');
  assert.strictEqual(context.pendingDelays.length, 1, 'default refresh must remain trailing-debounced');

  context.MNUtil.xdyyRefreshAfterDBChangedNow('NOTEBOOK-NOW');
  assert.deepStrictEqual(refreshes, ['NOTEBOOK-NOW'], 'custom immediate refresh must flush synchronously once');

  context.pendingDelays[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(
    refreshes,
    ['NOTEBOOK-NOW'],
    'custom immediate refresh must invalidate the older trailing callback instead of double flushing',
  );

  refreshes.length = 0;
  context.pendingDelays.length = 0;
  context.MNUtil.refreshAfterDBChanged('NOTEBOOK-A');
  context.MNUtil.refreshAfterDBChanged('NOTEBOOK-B');
  context.pendingDelays[0].resolve();
  context.pendingDelays[1].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(
    refreshes,
    ['NOTEBOOK-B'],
    'ordinary repeated refresh requests must still coalesce to the last notebook',
  );

  assert.doesNotMatch(
    mnutilsSource,
    /static xdyyRefreshAfterDBChangedNow/,
    'the personal immediate-refresh API must not expand the MNUtil base source',
  );
  assert.match(updaterSource, /MNUtil\.xdyyRefreshAfterDBChangedNow = function/);
  assert.doesNotMatch(updaterSource, /static xdyyRefreshAfterDBChangedNow/);

  console.log('xdyyutils immediate DB refresh regression ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
