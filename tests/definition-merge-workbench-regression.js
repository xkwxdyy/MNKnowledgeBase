const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const coreSource = read('scripts/definition-merge-workbench/core.js');
const sandbox = { window: {} };
vm.runInNewContext(coreSource, sandbox, { filename: 'definition-merge-core.js' });
const Core = sandbox.window.DefinitionMergeCore;
assert(Core, 'DefinitionMergeCore should be exported');

const model = {
  revision: 'revision-1',
  sourceDefinition: { noteId: 'DEF-A', title: '定义 A' },
  targetDefinition: { noteId: 'DEF-B', title: '定义 B' },
  sourceNodes: [
    {
      noteId: 'SRC-1',
      title: '来源 1',
      knowledgeCount: 3,
      knowledgeChildren: [
        { noteId: 'KN-1', kind: '命题', title: '来源知识点' },
        { noteId: 'KN-2', kind: '命题', title: '来源知识点 2' },
        { noteId: 'KN-3', kind: '命题', title: '来源知识点 3' },
      ],
    },
    { noteId: 'SRC-2', title: '来源 2', knowledgeCount: 2 },
  ],
  targetNodes: [
    { noteId: 'TGT-1', title: '目标 1', knowledgeChildren: [{ noteId: 'KN-TARGET-1', kind: '命题', title: '目标知识点' }] },
    { noteId: 'TGT-2', title: '目标 2' },
  ],
};

const mappings = Core.createDefaultMappings(model);
let plan = Core.buildPlan(model, {
  mappings,
  titleMode: 'source',
  keepAliases: true,
});
assert.strictEqual(plan.pairedCount, 0);
assert.strictEqual(plan.movedTreeCount, 2);
assert.strictEqual(plan.movedKnowledgeCount, 0);
assert.strictEqual(plan.deletedCount, 1);
assert.strictEqual(Core.validatePlan(model, plan).valid, true);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(Object.keys(plan).sort())),
  [
    'baseRevision',
    'deletedCount',
    'finalTitle',
    'keepAliases',
    'knowledgeMappings',
    'mappings',
    'mergedKnowledgeCount',
    'movedKnowledgeCount',
    'movedTreeCount',
    'pairedCount',
    'prefixMode',
    'sourceDefinitionId',
    'targetDefinitionId',
    'titleMode',
  ],
  'frontend merge plan contract must remain stable',
);

mappings.set('SRC-1', 'TGT-1');
plan = Core.buildPlan(model, {
  mappings,
  titleMode: 'target',
  keepAliases: false,
});
assert.strictEqual(plan.pairedCount, 1);
assert.strictEqual(plan.movedTreeCount, 1);
assert.strictEqual(plan.movedKnowledgeCount, 3);
assert.strictEqual(plan.deletedCount, 2);
assert.strictEqual(plan.finalTitle, '定义 B');
assert.strictEqual(Core.validatePlan(model, plan).valid, true);
assert.strictEqual(Core.validatePlan({ ...model, revision: 'revision-2' }, plan).valid, false);

plan = Core.buildPlan(model, {
  mappings,
  knowledgeMappings: new Map([['KN-1', 'KN-TARGET-1']]),
  titleMode: 'target',
  keepAliases: false,
});
assert.strictEqual(plan.mergedKnowledgeCount, 1);
assert.strictEqual(plan.movedKnowledgeCount, 2);
assert.strictEqual(plan.deletedCount, 3);
assert.strictEqual(Core.validatePlan(model, plan).valid, true);

const html = read('definition-merge-workbench.html');
const app = read('scripts/definition-merge-workbench/app.js');
const controller = read('knowledgebaseWebController.js');
const main = read('main.js');
const utils = read('utils.js');
const menu = readRepo('mntoolbar/mntoolbar/xdyy_menu_registry.js');
const actions = readRepo('mntoolbar/mntoolbar/xdyy_custom_actions_registry.js');
const batchBuild = readRepo('batch_build_addons.sh');
const triggerStart = actions.indexOf('global.registerCustomAction("openDefinitionMergeWorkbenchWebview"');
const triggerEnd = actions.indexOf('\n\n\n', triggerStart);
const trigger = actions.slice(triggerStart, triggerEnd === -1 ? undefined : triggerEnd);

assert(html.includes('./scripts/definition-merge-workbench/core.js'));
assert(html.includes('./scripts/definition-merge-workbench/app.js'));
assert(!html.includes('https://'), 'runtime workbench must not depend on network assets');
assert(!html.includes('原型不会写入 MarginNote'));
assert(app.includes("postToNative('ready'"));
assert(app.includes("postToNative('executeDefinitionMerge'"));
assert(app.includes("postToNative(swap ? 'swapDefinitionMergeWorkbench' : 'refreshDefinitionMergeWorkbench'"));
assert(app.includes("postToNative('closeDefinitionMergeWorkbench'"));
assert(app.includes('id: plan.targetDefinitionId'));
assert(app.includes('requestId: requestId'));
assert(app.includes('plan: JSON.stringify(plan)'));
assert(app.includes('sourceNoteId: swap ? targetId : sourceId'));
assert(app.includes('targetNoteId: swap ? sourceId : targetId'));
assert(app.includes('loadDefinitionMergeWorkbenchData'));
assert(app.includes('completeDefinitionMergeAction'));
assert(app.includes('合并中断，请在 MarginNote 撤销一次'));
assert(app.includes('result.pairedCount !== undefined'));
assert(app.includes('result.deletedCount !== undefined'));
assert(app.includes('result.mergedKnowledgeCount !== undefined'));
assert(app.includes('knowledgeMappings'));

const htmlIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
Array.from(app.matchAll(/getElementById\('([^']+)'\)/g), (match) => match[1]).forEach((id) => {
  assert(htmlIds.has(id), `optimized frontend DOM contract missing #${id}`);
});

[
  'loadDefinitionMergeWorkbenchHTML',
  'loadDefinitionMergeWorkbenchData',
  'notifyDefinitionMergeActionComplete',
  'executedefinitionmerge',
  'refreshdefinitionmergeworkbench',
  'swapdefinitionmergeworkbench',
  'closedefinitionmergeworkbench',
].forEach((token) => assert(controller.includes(token), `controller missing ${token}`));

[
  'openDefinitionMergeWorkbench',
  'prepareDefinitionMergeWorkbenchData',
  'getDefinitionMergeWorkbenchRevision',
  'applyDefinitionMergePlan',
  'currentDefinitionMergeContext',
].forEach((token) => assert(main.includes(token), `main missing ${token}`));

assert(utils.includes('static renewKnowledgeNotesInTransaction'));
assert(utils.includes('this.renewKnowledgeNotesInTransaction(targetNote, sourceNote, options)'));
assert(utils.includes('options.mergeRelatedLinks !== true'));
assert(main.includes('两张定义卡不在同一学习集'));
assert(main.includes('moveChildOrThrow'));
assert(main.includes('mergeRelatedLinks: true'));
assert(main.includes('skipFields: ["所属", "包含"]'));
assert(main.includes('requiresUndo: true'));
assert(controller.includes("reason: 'webview-rejected-payload'"));
assert.strictEqual((menu.match(/action: "openDefinitionMergeWorkbenchWebview"/g) || []).length, 1);
assert(actions.includes('global.registerCustomAction("openDefinitionMergeWorkbenchWebview"'));
assert(actions.includes('mnknowledgebase?action=openDefinitionMergeWorkbench'));
assert(trigger.includes('const { focusNote } = context || {}'));
assert(trigger.includes('_xdyy_normalizeMNNoteSafe(focusNote)'));
assert(trigger.includes('const rawParent = source.parentNote'));
assert(trigger.includes('_xdyy_normalizeMNNoteSafe(rawParent)'));
assert(trigger.includes('rawParent && rawParent.noteId'));
assert(trigger.includes('只有选中的卡片及其直接父卡片都是定义卡时才能打开此工作台'));
assert(!trigger.includes('focusNotes'), 'definition merge trigger must not infer target from multi-focus candidates');
assert(menu.includes('定义卡合并工作台（当前卡与父卡）'));

[
  'definition-merge-workbench.html',
  'styles/definition-merge-workbench.css',
  'scripts/definition-merge-workbench/core.js',
  'scripts/definition-merge-workbench/app.js',
].forEach((file) => assert(batchBuild.includes(file), `batch build missing ${file}`));

// Exercise the actual Toolbar callback with the production data provider and opener.
// Native rendering and note storage are doubles; preflight is never replaced.
async function runToolbarEntryRegression() {
  const sourceDefinition = { noteId: 'DEF-A', type: '定义', noteTitle: '来源定义', notebookId: 'BOOK', comments: [], childNotes: [] };
  const targetDefinition = { noteId: 'DEF-B', type: '定义', noteTitle: '父定义', notebookId: 'BOOK', comments: [], childNotes: [sourceDefinition] };
  sourceDefinition.parentNote = targetDefinition;
  const notes = new Map([[sourceDefinition.noteId, sourceDefinition], [targetDefinition.noteId, targetDefinition]]);
  const calls = { hud: [], loads: [], broadcasts: [] };
  let callback;
  let pendingOpen;
  const nativeSandbox = {
    MNKnowledgeBaseClass: function() {},
    MNNote: { new: id => notes.get(String(id)), getFocusNote: () => sourceDefinition },
    MNUtil: { showHUD: message => calls.hud.push(message), delay: async () => {} },
    KnowledgeBaseTemplate: {
      getNoteType: note => note && note.type,
      parseNoteTitle: note => ({ type: note.type, content: note.noteTitle }),
    },
    KnowledgeBaseUtils: { checkCommentWebViewController() {}, log() {}, addErrorLog() {} },
    _xdyy_normalizeMNNoteSafe: note => note,
    registerCustomAction(name, handler) { callback = handler; },
    _xdyy_openKnowledgeBaseDefinitionMergeWorkbench(sourceId, targetId) {
      calls.broadcasts.push([sourceId, targetId]);
      pendingOpen = instance.openDefinitionMergeWorkbench(sourceId, targetId);
      return true;
    },
  };
  nativeSandbox.global = nativeSandbox;
  vm.createContext(nativeSandbox);
  const names = ['getCommentRevisionForManager', 'getDefinitionMergeWorkbenchRevision',
    'getDefinitionMergeClassificationTitle', 'prepareDefinitionMergeClassificationNode',
    'prepareDefinitionMergeWorkbenchData', 'openDefinitionMergeWorkbench'];
  const methods = names.map(name => {
    const start = main.indexOf(`  MNKnowledgeBaseClass.prototype.${name} = `);
    const end = main.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + 1);
    assert(start >= 0 && end > start, `missing production method ${name}`);
    return main.slice(start, end);
  }).join('\n');
  vm.runInContext(methods, nativeSandbox);
  const instance = new nativeSandbox.MNKnowledgeBaseClass();
  const webController = {
    currentHTMLType: 'comment-manager', webViewLoaded: false,
    canReplaceCommentSurface: async () => true,
    loadDefinitionMergeWorkbenchHTML() { this.currentHTMLType = 'definition-merge-workbench'; this.webViewLoaded = true; },
    show: async () => {},
    async loadDefinitionMergeWorkbenchData(a, b) {
      const payload = instance.prepareDefinitionMergeWorkbenchData(a, b);
      calls.loads.push({ a, b, payload });
      return { success: payload.canExecute };
    },
  };
  nativeSandbox.KnowledgeBaseUtils.commentWebViewController = webController;
  vm.runInContext(trigger, nativeSandbox);
  await callback({ focusNote: sourceDefinition });
  assert.equal(await pendingOpen, true, 'the actual current-card/parent-card entry must open');
  assert.deepStrictEqual(calls.broadcasts, [['DEF-A', 'DEF-B']]);
  assert.equal(calls.loads[0].payload.canExecute, true);
  assert.equal(calls.loads[0].payload.canSwap, false);
  assert.deepStrictEqual(calls.hud, [], 'opening a valid workbench must be silent');
  assert.equal(instance.currentManagedNote.noteId, 'DEF-B');
  assert.equal(await instance.openDefinitionMergeWorkbench('DEF-B', 'DEF-A'), false, 'reverse ancestry must remain blocked');
  assert.equal(calls.loads.length, 1, 'invalid direction must not replace the valid surface');
}

runToolbarEntryRegression().then(() => {
  console.log('definition merge workbench regression: ok');
}).catch(error => { console.error(error); process.exitCode = 1; });
