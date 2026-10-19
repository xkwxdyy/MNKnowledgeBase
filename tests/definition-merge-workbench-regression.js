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

const applyStart = main.indexOf('  MNKnowledgeBaseClass.prototype.applyDefinitionMergePlan = async function');
const applyEnd = main.indexOf('\n\n  MNKnowledgeBaseClass.prototype.openDefinitionMergeWorkbench', applyStart);
assert.notStrictEqual(applyStart, -1, 'cannot locate Native definition merge transaction');
assert.notStrictEqual(applyEnd, -1, 'cannot locate end of Native definition merge transaction');

function createNativeTransactionRuntime(options = {}) {
  const notes = new Map();
  let activeFailMoveId = '';
  const calls = {
    changedTitles: [],
    linkedParents: [],
    mergeOptions: [],
    undoGroups: 0,
  };
  const createNote = (noteId, type, title) => {
    const note = {
      noteId,
      type,
      noteTitle: title,
      title,
      notebookId: 'NOTEBOOK-1',
      noteURL: `marginnote4app://note/${noteId}`,
      comments: [],
      childNotes: [],
      parentNote: null,
      deleted: false,
      addChild(child) {
        if (activeFailMoveId === child.noteId) return this;
        if (child.parentNote) {
          child.parentNote.childNotes = child.parentNote.childNotes.filter((item) => item.noteId !== child.noteId);
        }
        child.parentNote = this;
        if (!this.childNotes.some((item) => item.noteId === child.noteId)) this.childNotes.push(child);
        return this;
      },
      refresh() {},
      focusInMindMap() {},
    };
    notes.set(noteId, note);
    return note;
  };
  const sourceDefinition = createNote('DEF-A', '定义', '定义 A');
  const targetDefinition = createNote('DEF-B', '定义', '定义 B');
  const sourceClassification = createNote('SRC-1', '归类', '来源归类');
  const targetClassification = createNote('TGT-1', '归类', '目标归类');
  const knowledge = createNote('KN-1', '命题', '知识点');
  const targetKnowledge = createNote('KN-TARGET-1', '命题', '目标知识点');
  sourceDefinition.addChild(sourceClassification);
  sourceClassification.addChild(knowledge);
  targetDefinition.addChild(targetClassification);
  targetClassification.addChild(targetKnowledge);
  activeFailMoveId = options.failMoveId || '';

  const sandbox = {
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Math,
    Promise,
    console,
    MNNote: {
      new(noteId) {
        const note = notes.get(String(noteId));
        return note && !note.deleted ? note : null;
      },
    },
    MNUtil: {
      undoGrouping(block) {
        calls.undoGroups += 1;
        block();
      },
    },
    KnowledgeBaseUtils: {
      addErrorLog() {},
    },
    KnowledgeBaseTemplate: {
      getNoteType(note) { return note && note.type; },
      changeTitle(note) { calls.changedTitles.push(note.noteId); },
      linkParentNote(note) { calls.linkedParents.push(note.noteId); },
      mergeTitleLinkWords() {},
      removeLinksToNoteInField() {},
      removeDuplicateLinksInField() {},
      renewKnowledgeNotesInTransaction(target, source, mergeOptions) {
        calls.mergeOptions.push({
          targetId: target.noteId,
          sourceId: source.noteId,
          options: mergeOptions,
        });
        source.deleted = true;
        if (source.parentNote) {
          source.parentNote.childNotes = source.parentNote.childNotes.filter((item) => item.noteId !== source.noteId);
        }
      },
    },
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `function MNKnowledgeBaseClass() {}\n${main.slice(applyStart, applyEnd)}\n` +
      'this.applyDefinitionMergePlan = MNKnowledgeBaseClass.prototype.applyDefinitionMergePlan;',
    sandbox,
    { filename: 'definition-merge-native-transaction.js' },
  );
  const instance = {
    prepareDefinitionMergeWorkbenchData() {
      return {
        canExecute: true,
        revision: 'native-revision-1',
        sourceNodes: [{ noteId: sourceClassification.noteId }],
        targetNodes: [{ noteId: targetClassification.noteId }],
      };
    },
    refreshSearchCardIndex() { return Promise.resolve({ success: true }); },
  };
  return {
    calls,
    instance,
    knowledge,
    sourceClassification,
    sourceDefinition,
    targetClassification,
    targetKnowledge,
    targetDefinition,
    apply: sandbox.applyDefinitionMergePlan,
  };
}

async function runNativeTransactionRegression() {
  const plan = {
    baseRevision: 'native-revision-1',
    sourceDefinitionId: 'DEF-A',
    targetDefinitionId: 'DEF-B',
    titleMode: 'target',
    keepAliases: true,
    prefixMode: 'knowledge',
    mappings: [{ sourceId: 'SRC-1', targetId: 'TGT-1' }],
    knowledgeMappings: [{ sourceId: 'KN-1', targetId: 'KN-TARGET-1' }],
  };

  const successRuntime = createNativeTransactionRuntime();
  const success = await successRuntime.apply.call(successRuntime.instance, { plan });
  assert.strictEqual(success.success, true);
  assert.strictEqual(successRuntime.calls.undoGroups, 1, 'merge must use one top-level undo group');
  assert.strictEqual(successRuntime.knowledge.deleted, true);
  assert.strictEqual(successRuntime.sourceClassification.deleted, true);
  assert.strictEqual(successRuntime.sourceDefinition.deleted, true);
  assert.deepStrictEqual(successRuntime.calls.changedTitles, []);
  assert.strictEqual(success.mergedKnowledgeCount, 1);
  const classificationMerge = successRuntime.calls.mergeOptions.find((item) => item.sourceId === 'SRC-1');
  assert.strictEqual(classificationMerge.options.mergeRelatedLinks, true);
  assert.strictEqual(
    JSON.stringify(classificationMerge.options.skipFields),
    JSON.stringify(['所属', '包含']),
  );

  const failedRuntime = createNativeTransactionRuntime({ failMoveId: 'KN-1' });
  const failure = await failedRuntime.apply.call(failedRuntime.instance, {
    plan: { ...plan, knowledgeMappings: [] },
  });
  assert.strictEqual(failure.success, false);
  assert.strictEqual(failure.requiresUndo, true);
  assert.match(failure.error, /撤销一次/);
  assert.strictEqual(failedRuntime.sourceClassification.deleted, false, 'failed child move must not delete source classification');
  assert.strictEqual(failedRuntime.sourceDefinition.deleted, false, 'failed child move must not delete source definition');
}

runNativeTransactionRegression().then(() => {
  console.log('definition merge workbench regression: ok');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
