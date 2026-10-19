const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const repoRoot = path.resolve(__dirname, '..', '..');
const knowledgeBaseSource = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const knowledgeBaseWebControllerSource = fs.readFileSync(
  path.join(__dirname, '..', 'knowledgebaseWebController.js'),
  'utf8',
);
const toolbarSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);
const literatureSource = fs.readFileSync(
  path.join(repoRoot, 'mnliterature', 'literatureNoteParser.js'),
  'utf8',
);

function createUndoContext() {
  const refreshCalls = [];
  const undoCalls = [];
  const asyncUndoCalls = [];
  const context = {
    console,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Math,
    Promise,
    MNUtil: {
      currentNotebookId: 'NOTEBOOK-1',
      _undoGroupingDepth: 0,
      _suppressRefreshAfterDBChangedDepth: 0,
      _suppressedRefreshAfterDBChangedNotebookId: '',
      refreshAfterDBChanged(notebookId) {
        refreshCalls.push(notebookId);
      },
      undoGroupingNotRefresh(block, notebookId) {
        if (this._undoGroupingDepth > 0) return block();
        undoCalls.push(notebookId);
        this._undoGroupingDepth += 1;
        try {
          return block();
        } finally {
          this._undoGroupingDepth -= 1;
        }
      },
      async undoGroupingNotRefreshAsync(block, notebookId) {
        if (this._undoGroupingDepth > 0) return await block();
        asyncUndoCalls.push(notebookId);
        this._undoGroupingDepth += 1;
        let result;
        try {
          result = block();
        } finally {
          this._undoGroupingDepth -= 1;
        }
        return await result;
      },
      log() {},
      showHUD() {},
    },
    KnowledgeBaseUtils: {
      log() {},
      addErrorLog(error) {
        throw error;
      },
    },
    HtmlMarkdownUtils: {
      isHtmlMDComment() {
        return false;
      },
    },
  };
  context.global = context;
  context.globalThis = context;
  context.__refreshCalls = refreshCalls;
  context.__undoCalls = undoCalls;
  context.__asyncUndoCalls = asyncUndoCalls;
  return context;
}

function loadKnowledgeBaseTemplate(context) {
  const end = knowledgeBaseSource.indexOf('\nclass KnowledgeBaseIndexer');
  assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');
  vm.createContext(context);
  vm.runInContext(
    `${knowledgeBaseSource.slice(0, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`,
    context,
  );
  return context.KnowledgeBaseTemplate;
}

function loadToolbarUndoHelper(context) {
  const start = toolbarSource.indexOf('function _xdyy_runUndoGroupingWithoutGlobalDBRefresh');
  const end = toolbarSource.indexOf('\nfunction _xdyy_refreshNoteLocally', start);
  assert.notStrictEqual(start, -1, 'Cannot locate toolbar undo helper');
  assert.notStrictEqual(end, -1, 'Cannot locate end of toolbar undo helper');
  vm.createContext(context);
  vm.runInContext(
    `${toolbarSource.slice(start, end)}\nthis.runWithoutGlobalRefresh = _xdyy_runUndoGroupingWithoutGlobalDBRefresh;`,
    context,
  );
  return context.runWithoutGlobalRefresh;
}

function assertUndoRefreshContract(runWithoutGlobalRefresh, context, label) {
  const originalRefresh = context.MNUtil.refreshAfterDBChanged;
  const result = runWithoutGlobalRefresh(() => {
    context.MNUtil.refreshAfterDBChanged('NOTEBOOK-INNER');
    return 'RESULT';
  }, {
    feature: `${label}.success`,
    finalRefreshAfterDBChanged: true,
  });

  assert.strictEqual(result, 'RESULT', `${label} must preserve the callback result`);
  assert.deepStrictEqual(context.__undoCalls, ['NOTEBOOK-1'], `${label} must open one undo group`);
  assert.deepStrictEqual(context.__refreshCalls, ['NOTEBOOK-INNER'], `${label} must emit one final refresh`);
  assert.strictEqual(context.MNUtil.refreshAfterDBChanged, originalRefresh, `${label} must restore refreshAfterDBChanged`);
  assert.strictEqual(context.MNUtil._undoGroupingDepth, 0, `${label} must restore undo depth`);

  context.__undoCalls.length = 0;
  context.__refreshCalls.length = 0;
  runWithoutGlobalRefresh(() => {
    runWithoutGlobalRefresh(() => {
      context.MNUtil.refreshAfterDBChanged('NOTEBOOK-NESTED');
    }, {
      feature: `${label}.nested.inner`,
      finalRefreshAfterDBChanged: true,
    });
  }, {
    feature: `${label}.nested.outer`,
    finalRefreshAfterDBChanged: true,
  });
  assert.deepStrictEqual(context.__undoCalls, ['NOTEBOOK-1'], `${label} must collapse nested undo groups`);
  assert.deepStrictEqual(context.__refreshCalls, ['NOTEBOOK-NESTED'], `${label} must coalesce nested final refreshes`);

  context.__undoCalls.length = 0;
  context.__refreshCalls.length = 0;
  assert.throws(() => {
    runWithoutGlobalRefresh(() => {
      context.MNUtil.refreshAfterDBChanged('NOTEBOOK-ERROR');
      throw new Error('expected failure');
    }, {
      feature: `${label}.error`,
      finalRefreshAfterDBChanged: true,
    });
  }, /expected failure/);
  assert.deepStrictEqual(context.__refreshCalls, ['NOTEBOOK-ERROR'], `${label} must refresh partial mutations after failure`);
  assert.strictEqual(context.MNUtil.refreshAfterDBChanged, originalRefresh, `${label} must restore state after failure`);
  assert.strictEqual(context.MNUtil._undoGroupingDepth, 0, `${label} must restore depth after failure`);

  context.__undoCalls.length = 0;
  context.__refreshCalls.length = 0;
  delete context.MNUtil.refreshAfterDBChanged;
  context.MNUtil.app = {
    refreshAfterDBChanged(notebookId) {
      context.__refreshCalls.push(notebookId);
    },
  };
  runWithoutGlobalRefresh(() => 'FALLBACK', {
    feature: `${label}.appFallback`,
    finalRefreshAfterDBChanged: true,
  });
  assert.deepStrictEqual(context.__refreshCalls, ['NOTEBOOK-1'], `${label} must fall back to app refresh`);
  context.MNUtil.refreshAfterDBChanged = originalRefresh;
}

async function assertAsyncUndoRefreshContract(runWithoutGlobalRefresh, context, label) {
  const originalRefresh = context.MNUtil.refreshAfterDBChanged;
  context.__undoCalls.length = 0;
  context.__asyncUndoCalls.length = 0;
  context.__refreshCalls.length = 0;

  const result = await runWithoutGlobalRefresh(async () => {
    await Promise.resolve();
    return 'ASYNC-RESULT';
  }, {
    feature: `${label}.async`,
    finalRefreshAfterDBChanged: true,
  });

  assert.strictEqual(result, 'ASYNC-RESULT', `${label} must preserve an async callback result`);
  assert.deepStrictEqual(context.__asyncUndoCalls, ['NOTEBOOK-1'], `${label} must use the official async no-refresh undo API`);
  assert.deepStrictEqual(context.__undoCalls, [], `${label} must not fall back to the sync undo API when async is available`);
  assert.deepStrictEqual(context.__refreshCalls, ['NOTEBOOK-1'], `${label} must emit one final async refresh`);
  assert.strictEqual(context.MNUtil.refreshAfterDBChanged, originalRefresh, `${label} must restore refreshAfterDBChanged after async work`);
  assert.strictEqual(context.MNUtil._undoGroupingDepth, 0, `${label} must restore undo depth after async work`);

  context.__asyncUndoCalls.length = 0;
  context.__refreshCalls.length = 0;
  await runWithoutGlobalRefresh(async () => {
    await Promise.resolve();
  }, {
    feature: `${label}.async.noRefresh`,
  });
  assert.deepStrictEqual(context.__refreshCalls, [], `${label} must not refresh after a no-refresh async transaction`);

  context.__asyncUndoCalls.length = 0;
  context.__refreshCalls.length = 0;
  await assert.rejects(
    runWithoutGlobalRefresh(async () => {
      await Promise.resolve();
      throw new Error('expected async failure');
    }, {
      feature: `${label}.async.error`,
      finalRefreshAfterDBChanged: true,
    }),
    /expected async failure/,
  );
  assert.deepStrictEqual(context.__refreshCalls, ['NOTEBOOK-1'], `${label} must keep the final refresh contract after async failure`);
  assert.strictEqual(context.MNUtil.refreshAfterDBChanged, originalRefresh, `${label} must restore refreshAfterDBChanged after async failure`);
  assert.strictEqual(context.MNUtil._undoGroupingDepth, 0, `${label} must restore undo depth after async failure`);
}

async function assertLiteratureUndoContract() {
  const refreshCalls = [];
  let undoCount = 0;
  const context = {
    Promise,
    Date,
    Math,
    String,
    UndoManager: {
      sharedInstance() {
        return {
          undoGrouping(groupId, notebookId, block) {
            undoCount += 1;
            block();
            return undefined;
          },
        };
      },
    },
    MNUtil: {
      currentNotebookId: 'LITERATURE-NOTEBOOK',
      delay() {
        return Promise.resolve();
      },
      app: {
        refreshAfterDBChanged(notebookId) {
          refreshCalls.push(notebookId);
        },
      },
    },
  };
  const end = literatureSource.indexOf('\nclass literatureTemplate');
  assert.notStrictEqual(end, -1, 'Cannot locate literatureUndoGrouping');
  vm.createContext(context);
  vm.runInContext(
    `${literatureSource.slice(0, end)}\nthis.literatureUndoGrouping = literatureUndoGrouping;`,
    context,
  );
  const grouping = context.literatureUndoGrouping;
  const result = grouping.run(() => grouping.run(() => 42));
  assert.strictEqual(result, 42, 'literatureUndoGrouping must preserve callback results');
  assert.strictEqual(undoCount, 1, 'literatureUndoGrouping must collapse nested groups');
  await Promise.resolve();
  assert.deepStrictEqual(refreshCalls, ['LITERATURE-NOTEBOOK']);
}

async function assertAddTemplateSearchFallback(KnowledgeBaseTemplate, context) {
  let pushCount = 0;
  let fullRefreshCount = 0;
  context.MNUtil.delay = () => Promise.resolve();
  context.KnowledgeBaseConfig = {
    getSearchIndexMode() {
      return 'test';
    },
  };
  context.KnowledgeBaseIndexer = {
    upsertIncrementalIndexEntry(note) {
      return {
        success: true,
        entry: { id: note.noteId },
        removedIds: [],
      };
    },
  };
  context.KnowledgeBaseUtils.webViewController = {
    webViewLoaded: true,
    currentHTMLType: 'search',
    webView: {},
  };
  context.KnowledgeBaseUtils.getActivePersistentDiagnosticSession = () => null;
  context.KnowledgeBaseUtils.addErrorLog = () => {};
  context.MNKnowledgeBaseInstance = {
    pushSearchIndexPatchToWebView() {
      pushCount += 1;
      return Promise.reject(new Error('push failed'));
    },
    loadSearchDataToWebView() {
      fullRefreshCount += 1;
      return Promise.resolve({ success: true });
    },
    isWebViewPushResultSuccess() {
      return false;
    },
  };

  KnowledgeBaseTemplate.scheduleTemplateCreationSearchRefresh([{ noteId: 'CREATED-1' }]);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pushCount > 0, 'AddTemplate must attempt an incremental search patch');
  assert.strictEqual(fullRefreshCount, pushCount, 'every rejected search patch must fall back to a full refresh');
}

function assertAddTemplateRefreshCompletesBeforeFocus(KnowledgeBaseTemplate, context) {
  const refreshDelaySeconds = [];
  context.MNUtil.delay = (seconds) => {
    refreshDelaySeconds.push(seconds);
    return new Promise(() => {});
  };
  context.KnowledgeBaseUtils.getActivePersistentDiagnosticSession = () => null;

  const sourceNote = {
    noteId: 'SOURCE-REFRESH-1',
    noteTitle: 'Source note',
    parentNote: null,
    refresh() {},
  };
  const createdNote = {
    noteId: 'CREATED-REFRESH-1',
    noteTitle: 'Created note',
    parentNote: sourceNote,
    refresh() {},
    refreshAll() {},
  };

  KnowledgeBaseTemplate.refreshTemplateCreationNotes(sourceNote, createdNote);
  KnowledgeBaseTemplate.refreshCreatedTemplateNotesForFocus([createdNote]);

  assert.deepStrictEqual(
    refreshDelaySeconds,
    [0.1, 0.15],
    'AddTemplate must not schedule refreshes after the final 0.2s focus retry',
  );
  assert.ok(
    refreshDelaySeconds.every(seconds => seconds < 0.2),
    'every delayed refresh must finish before the final focus retry',
  );
}

async function assertAddTemplateFocusDoesNotSelect(KnowledgeBaseTemplate, context) {
  let wrapperFocusCount = 0;
  let helperFocusCount = 0;
  let multiSelectCount = 0;
  const focusDelaySeconds = [];
  context.MNUtil.delay = (seconds) => {
    focusDelaySeconds.push(seconds);
    return Promise.resolve();
  };
  context.MNUtil.mindmapView = {};
  context.MNUtil.focusNoteInMindMapById = () => {
    helperFocusCount += 1;
  };
  context.MNUtil.selectNotesInMindmap = () => {
    multiSelectCount += 1;
  };
  context.KnowledgeBaseUtils.getActivePersistentDiagnosticSession = () => null;

  KnowledgeBaseTemplate.focusCreatedTemplateNote({
    noteId: 'CREATED-FOCUS-1',
    noteTitle: 'Created focus note',
    note: {},
    focusInMindMap() {
      wrapperFocusCount += 1;
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepStrictEqual(focusDelaySeconds, [0.2], 'focus must wait for the final bounded refresh');
  assert.strictEqual(wrapperFocusCount, 1, 'focus must directly call the returned MNNote object');
  assert.strictEqual(helperFocusCount, 0, 'focus retries must not use the selection-fallback MNUtil helper');
  assert.strictEqual(multiSelectCount, 0, 'focus retries must never enter multiple-selection mode');
}

async function run() {
  const knowledgeBaseContext = createUndoContext();
  const KnowledgeBaseTemplate = loadKnowledgeBaseTemplate(knowledgeBaseContext);
  assertUndoRefreshContract(
    KnowledgeBaseTemplate.runUndoGroupingWithoutGlobalDBRefresh.bind(KnowledgeBaseTemplate),
    knowledgeBaseContext,
    'mnknowledgebase',
  );
  await assertAsyncUndoRefreshContract(
    KnowledgeBaseTemplate.runUndoGroupingWithoutGlobalDBRefreshAsync.bind(KnowledgeBaseTemplate),
    knowledgeBaseContext,
    'mnknowledgebase',
  );
  await assertAddTemplateSearchFallback(KnowledgeBaseTemplate, knowledgeBaseContext);
  assertAddTemplateRefreshCompletesBeforeFocus(KnowledgeBaseTemplate, knowledgeBaseContext);
  await assertAddTemplateFocusDoesNotSelect(KnowledgeBaseTemplate, knowledgeBaseContext);

  const toolbarContext = createUndoContext();
  const toolbarRunWithoutGlobalRefresh = loadToolbarUndoHelper(toolbarContext);
  assertUndoRefreshContract(toolbarRunWithoutGlobalRefresh, toolbarContext, 'mntoolbar');

  const addTemplateRegistrations = toolbarSource.match(/registerCustomAction\("addTemplate"/g) || [];
  assert.strictEqual(addTemplateRegistrations.length, 1, 'addTemplate action must be registered exactly once');
  assert.match(
    toolbarSource,
    /changeTitle\(note, true, null, \{ syncContainLinks: false \}\)/,
    'safe make-card path must not run contain-link synchronization twice',
  );
  assert.match(
    toolbarSource,
    /parentType === "归类"[\s\S]*?return false/,
    'generic make-card bottom-up sync must leave classification-parent semantics to mnknowledgebase',
  );
  const addTemplateStart = knowledgeBaseSource.indexOf('static async addTemplate(');
  const addTemplateEnd = knowledgeBaseSource.indexOf('\n  static getTemplateChainBaseTitle', addTemplateStart);
  assert.notStrictEqual(addTemplateStart, -1, 'Cannot locate addTemplate implementation');
  assert.notStrictEqual(addTemplateEnd, -1, 'Cannot locate end of addTemplate implementation');
  const addTemplateSource = knowledgeBaseSource.slice(addTemplateStart, addTemplateEnd);
  const addTemplateMutations = addTemplateSource.match(/feature: "mnknowledgebase\.addTemplate\.noGlobalDBRefresh"/g) || [];
  const addTemplateFinalRefreshes = addTemplateSource.match(/finalRefreshAfterDBChanged: true/g) || [];
  assert.ok(addTemplateMutations.length > 0, 'addTemplate must use the no-global mutation wrapper');
  assert.strictEqual(
    addTemplateFinalRefreshes.length,
    addTemplateMutations.length,
    'every addTemplate mutation branch must request one final DB refresh',
  );
  assert.match(
    addTemplateSource,
    /const shouldCleanupSourceParentLinks = this\.getNoteType\(note\) === "归类"[\s\S]*?this\.linkParentNote\(note, shouldCleanupSourceParentLinks\)/,
    'upward AddTemplate must replace the exclusive belonging parent of classification cards',
  );
  assert.match(
    knowledgeBaseSource,
    /useRefreshAllForFocus && note === focusNote/,
    'AddTemplate refreshAll must be limited to the final focus target',
  );
  const focusCreatedTemplateNoteStart = knowledgeBaseSource.indexOf('static focusCreatedTemplateNote(');
  const focusCreatedTemplateNoteEnd = knowledgeBaseSource.indexOf(
    '\n\n  /**',
    focusCreatedTemplateNoteStart,
  );
  assert.notStrictEqual(
    focusCreatedTemplateNoteStart,
    -1,
    'Cannot locate focusCreatedTemplateNote implementation',
  );
  assert.notStrictEqual(
    focusCreatedTemplateNoteEnd,
    -1,
    'Cannot locate end of focusCreatedTemplateNote implementation',
  );
  const focusCreatedTemplateNoteSource = knowledgeBaseSource.slice(
    focusCreatedTemplateNoteStart,
    focusCreatedTemplateNoteEnd,
  );
  assert.doesNotMatch(
    focusCreatedTemplateNoteSource,
    /selectNotesInMindmap/,
    'AddTemplate focus retries must not enter mind-map multiple-selection mode',
  );
  assert.doesNotMatch(
    focusCreatedTemplateNoteSource,
    /focusNoteInMindMapById|selectNotesInMindmap|rawNote\.focusInMindMap/,
    'AddTemplate focus must not route through indirect native or selection helpers',
  );
  assert.match(
    focusCreatedTemplateNoteSource,
    /note\.focusInMindMap\(duration\)/,
    'AddTemplate focus must directly call the returned MNNote object',
  );
  assert.doesNotMatch(
    focusCreatedTemplateNoteSource,
    /delay-(?:0\.65|1\.5|3\.0)s/,
    'AddTemplate focus must not keep retrying after a visible delay',
  );
  assert.match(
    toolbarSource,
    /convertClassificationNoteToDefinitionNote[\s\S]*?undo: "noGlobalDBRefresh",\s*finalRefreshAfterDBChanged: true/,
    'classification-to-definition conversion must preserve final refresh semantics',
  );
  const autoMoveStart = knowledgeBaseSource.indexOf('static autoGetNewContentToMoveIndexArr(');
  const autoMoveEnd = knowledgeBaseSource.indexOf('\n  static isStandaloneMarkdownMarginNoteLinkText', autoMoveStart);
  const autoMoveSource = knowledgeBaseSource.slice(autoMoveStart, autoMoveEnd);
  assert.doesNotMatch(
    autoMoveSource,
    /filterNonStructuralNoteLinkCommentIndices/,
    'initial make-card auto-move must not use the global structural-link filter',
  );
  assert.match(
    autoMoveSource,
    /excludeBoundaryLinks[\s\S]*?filterAutoMoveBoundaryLinkCommentIndices[\s\S]*?: moveIndexArr/,
    'initial make-card must preserve the complete batch unless a field-organizing caller explicitly requests filtering',
  );
  const autoMoveToFieldStart = knowledgeBaseSource.indexOf('static autoMoveNewContentToField(');
  const autoMoveToFieldEnd = knowledgeBaseSource.indexOf('\n  /**', autoMoveToFieldStart);
  const autoMoveToFieldSource = knowledgeBaseSource.slice(autoMoveToFieldStart, autoMoveToFieldEnd);
  assert.match(
    autoMoveToFieldSource,
    /autoGetNewContentToMoveIndexArr\(note, null, \{\s*excludeBoundaryLinks: this\.hasHtmlCommentSafe\(note\),/,
    'explicit field organization must filter existing boundary links without changing initial make-card semantics',
  );
  assert.match(
    toolbarSource,
    /function _xdyy_getMergedNewCommentIndexArr[\s\S]*?beforeSnapshot\.identityCountMap/,
    'merged-comment movement must identify actual additions from the pre-merge snapshot',
  );
  assert.match(
    knowledgeBaseSource,
    /const includeMarkdown = options\.includeMarkdown === true/,
    'Markdown link dedupe must remain opt-in outside classification maintenance',
  );

  const moveAndMakeStart = knowledgeBaseWebControllerSource.indexOf(
    "case 'moveFocusNoteToTargetNoteAsChildAndMakeNote':",
  );
  const moveAndMakeEnd = knowledgeBaseWebControllerSource.indexOf(
    "case 'addTemplate':",
    moveAndMakeStart,
  );
  const moveAndMakeSource = knowledgeBaseWebControllerSource.slice(moveAndMakeStart, moveAndMakeEnd);
  assert.strictEqual(
    (moveAndMakeSource.match(/processedNote = KnowledgeBaseTemplate\.makeNote\(/g) || []).length,
    4,
    'all WebView move-and-make actions must retain the final returned note',
  );
  assert.strictEqual(
    (moveAndMakeSource.match(/focusInMindMapSafely\(processedNote, 0\.5\)/g) || []).length,
    2,
    'both locating WebView actions must focus the final returned note',
  );
  assert.doesNotMatch(
    moveAndMakeSource,
    /focusInMindMapSafely\(focusNote, 0\.5\)/,
    'WebView move-and-make actions must never refocus the consumed source note',
  );

  await assertLiteratureUndoContract();
}

run()
  .then(() => console.log('make-card refresh contract regression ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
