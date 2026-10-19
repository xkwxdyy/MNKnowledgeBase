const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const controllerSource = fs.readFileSync(path.join(rootDir, 'knowledgebaseWebController.js'), 'utf8');

const helperStart = controllerSource.indexOf('function runUndoGroupingWithoutGlobalDBRefresh');
const helperEnd = controllerSource.indexOf('\nasync function refreshSearchMutationNotes', helperStart);
assert.notStrictEqual(helperStart, -1, 'no-global-refresh undo helper must exist');
assert.notStrictEqual(helperEnd, -1, 'no-global-refresh undo helper boundary must exist');

let undoCount = 0;
let globalRefreshCount = 0;
let mutationCount = 0;
const context = {
  Date,
  MNUtil: {
    currentNotebookId: 'NOTEBOOK-1',
    undoGroupingNotRefresh(block, notebookId) {
      assert.strictEqual(notebookId, 'NOTEBOOK-1');
      undoCount += 1;
      block();
    },
    app: {
      refreshAfterDBChanged() {
        globalRefreshCount += 1;
      },
    },
  },
};
vm.createContext(context);
vm.runInContext(
  `${controllerSource.slice(helperStart, helperEnd)}\nthis.runWithoutGlobalRefresh = runUndoGroupingWithoutGlobalDBRefresh;`,
  context,
);
context.runWithoutGlobalRefresh(() => {
  mutationCount += 1;
});

assert.strictEqual(undoCount, 1, 'bidirectional link must remain one undoable mutation');
assert.strictEqual(mutationCount, 1, 'the mutation must execute exactly once');
assert.strictEqual(globalRefreshCount, 0, 'the no-refresh undo helper must not rebuild the global database view');
assert.doesNotMatch(
  controllerSource,
  /runUndoGroupingWithGlobalDBRefresh/,
  'the blocking global-refresh helper must not remain available to this controller',
);

const actionStart = controllerSource.indexOf("case 'bidirectionalLinkFromeFocusNoteToTargetNote':");
const actionEnd = controllerSource.indexOf("case 'moveFocusNoteToTargetNoteAsChild':", actionStart);
assert.notStrictEqual(actionStart, -1, 'bidirectional-link action must exist');
assert.notStrictEqual(actionEnd, -1, 'bidirectional-link action boundary must exist');
const actionSource = controllerSource.slice(actionStart, actionEnd);

assert.match(
  actionSource,
  /runUndoGroupingWithoutGlobalDBRefresh\(\(\)=>\{[\s\S]*?focusNote\.appendNoteLink\(targetNote, "Both"\)[\s\S]*?success = true[\s\S]*?\}\)/,
  'the link mutation must use the no-global-refresh undo group',
);
const refreshHelperStart = controllerSource.indexOf('async function refreshSearchMutationNotes');
const refreshHelperEnd = controllerSource.indexOf('\nfunction extractKnowledgeBaseNoteIdFromUrl', refreshHelperStart);
assert.notStrictEqual(refreshHelperStart, -1, 'post-transaction local refresh helper must exist');
assert.notStrictEqual(refreshHelperEnd, -1, 'post-transaction local refresh helper boundary must exist');

const refreshCalls = [];
const refreshLogs = [];
const refreshContext = {
  MNNote: {
    new(noteId) {
      refreshCalls.push(`load:${noteId}`);
      return {
        async refresh() {
          refreshCalls.push(`refresh:${noteId}`);
        },
      };
    },
  },
  MNUtil: {
    currentNotebookId: 'NOTEBOOK-1',
  },
  KnowledgeBaseUtils: {
    log(message, source, detail, level) {
      refreshLogs.push({ message, source, detail, level });
    },
  },
};
vm.createContext(refreshContext);
vm.runInContext(
  `${controllerSource.slice(refreshHelperStart, refreshHelperEnd)}\nthis.refreshSearchMutationNotes = refreshSearchMutationNotes;`,
  refreshContext,
);

(async () => {
  await refreshContext.refreshSearchMutationNotes([
    { noteId: 'FOCUS', notebookId: 'NOTEBOOK-1' },
    { noteId: 'TARGET', notebookId: 'NOTEBOOK-1' },
    { noteId: 'FOCUS' },
  ]);
  assert.deepStrictEqual(
    refreshCalls,
    ['load:FOCUS', 'refresh:FOCUS', 'load:TARGET', 'refresh:TARGET'],
    'the post-transaction path must refresh each affected card exactly once',
  );
  assert.deepStrictEqual(
    refreshLogs.map((entry) => entry.message),
    ['双向链接局部刷新开始', '双向链接局部刷新完成'],
    'the local refresh must expose start and completion timing logs',
  );
  assert.strictEqual(
    JSON.stringify(refreshLogs[1].detail.noteIds),
    JSON.stringify(['FOCUS', 'TARGET']),
    'refresh diagnostics must deduplicate and preserve both affected note IDs',
  );
  assert.strictEqual(refreshLogs[1].source, 'searchPerf.bidirectionalLink');
  assert.strictEqual(refreshLogs[1].detail.strategy, 'local-note-refresh');
  assert.strictEqual(typeof refreshLogs[1].detail.durationMs, 'number');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(refreshLogs[1].detail.refreshedNoteIds)),
    ['FOCUS', 'TARGET'],
    'both affected cards must complete their local refresh',
  );
  assert.match(
    controllerSource.slice(refreshHelperStart, refreshHelperEnd),
    /MNNote\.new[\s\S]*?await note\.refresh\(\)/,
    'the refresh path must reacquire each card before its local refresh',
  );
  assert.doesNotMatch(
    controllerSource.slice(refreshHelperStart, refreshHelperEnd),
    /xdyyRefreshAfterDBChangedNow|app\.refreshAfterDBChanged|MNUtil\.refreshAfterDBChanged|MNUtil\.delay/,
    'the card action must not trigger a global DB refresh or a delayed second pass',
  );

  assert.match(
    actionSource,
    /\}\)\s*if \(success\) \{[\s\S]*?await refreshSearchMutationNotes\(\[focusNote, targetNote\]\)/,
    'both affected notes must refresh after the undo group commits',
  );
  assert.match(
    actionSource,
    /await refreshSearchMutationNotes\(\[focusNote, targetNote\]\)[\s\S]*?const refocusDelay = autoCloseMode \? 0\.4 : 0\.1[\s\S]*?focusInMindMapSafely\(focusNote, refocusDelay\)/,
    'the current card must be reselected after local refresh in both auto-close modes',
  );
  assert.match(
    actionSource,
    /双向链接动作开始[\s\S]*?双向链接写入完成[\s\S]*?双向链接动作完成/,
    'the action must log enough boundaries to isolate mutation and refresh stalls',
  );

  console.log('search bidirectional-link lag regression ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
