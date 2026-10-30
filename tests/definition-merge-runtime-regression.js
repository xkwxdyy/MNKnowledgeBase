const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function method(name) {
  const start = main.indexOf(`  MNKnowledgeBaseClass.prototype.${name} = `);
  assert.notEqual(start, -1, `missing runtime method ${name}`);
  const end = main.indexOf('\n  MNKnowledgeBaseClass.prototype.', start + 1);
  assert.notEqual(end, -1, `missing next method after ${name}`);
  return main.slice(start, end);
}

const methods = [
  'getCommentRevisionForManager',
  'getDefinitionMergeWorkbenchRevision',
  'getDefinitionMergeClassificationTitle',
  'prepareDefinitionMergeClassificationNode',
  'prepareDefinitionMergeWorkbenchData',
  'applyDefinitionMergePlan',
  'openDefinitionMergeWorkbench',
].map(method).join('\n');
const coreSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts/definition-merge-workbench/core.js'), 'utf8'), coreSandbox);
const Core = coreSandbox.window.DefinitionMergeCore;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Native movement, field/link merging and undo registration are isolated host doubles.
// The production data builders, revision checks, plan builder and transaction run unchanged.
function createRuntime(options = {}) {
  const notes = new Map();
  const calls = { undo: 0, moves: [], merges: [], prefixes: [], relinks: [], linkRemovals: [], dedupes: [], aliases: [], index: [], hud: [], loads: [] };
  let initialized = false;
  function createNote(noteId, type, title = noteId, notebookId = 'BOOK') {
    const note = {
      noteId, type, noteTitle: title, notebookId,
      noteURL: `marginnote4app://note/${noteId}`,
      comments: [{ type: 'TextNote', text: `${noteId} content`, markdown: true }],
      childNotes: [], parentNote: null, deleted: false,
      addChild(child) {
        if (initialized) calls.moves.push([this.noteId, child.noteId]);
        if (initialized && options.failMoveId === child.noteId) return this;
        let ancestor = this;
        const seen = new Set();
        while (ancestor && !seen.has(ancestor.noteId)) {
          assert.notEqual(ancestor.noteId, child.noteId, 'transaction must not create a structural cycle');
          seen.add(ancestor.noteId);
          ancestor = ancestor.parentNote;
        }
        if (child.parentNote) child.parentNote.childNotes = child.parentNote.childNotes.filter((item) => item !== child);
        child.parentNote = this;
        if (!this.childNotes.includes(child)) this.childNotes.push(child);
        return this;
      },
      refresh() {}, focusInMindMap() {},
    };
    notes.set(noteId, note);
    return note;
  }
  const source = createNote('DEF-SOURCE', '定义', '来源定义');
  const target = createNote('DEF-TARGET', '定义', '目标定义');
  if (options.relationship !== 'independent') target.addChild(source);
  const sourceClass = createNote('CLASS-SOURCE', '归类', '同名归类');
  const sourceExtra = createNote('CLASS-EXTRA', '归类', '来源独有归类');
  const nestedClass = createNote('CLASS-NESTED', '归类', '嵌套归类');
  const sourceKnowledge = createNote('KN-SOURCE', '命题');
  const secondKnowledge = createNote('KN-SECOND', '定理');
  const nestedKnowledge = createNote('KN-NESTED', '命题');
  const looseKnowledge = createNote('KN-LOOSE', '例子');
  const targetClass = createNote('CLASS-TARGET', '归类', '同名归类');
  const targetNestedClass = createNote('CLASS-TARGET-NESTED', '归类', '目标嵌套归类');
  const targetKnowledge = createNote('KN-TARGET', '命题');
  source.addChild(sourceClass);
  source.addChild(sourceExtra);
  source.addChild(looseKnowledge);
  sourceClass.addChild(sourceKnowledge);
  sourceClass.addChild(secondKnowledge);
  sourceClass.addChild(nestedClass);
  nestedClass.addChild(nestedKnowledge);
  target.addChild(targetClass);
  targetClass.addChild(targetNestedClass);
  targetClass.addChild(targetKnowledge);
  initialized = true;

  const controller = {
    currentHTMLType: 'definition-merge-workbench', webViewLoaded: true,
    canReplaceCommentSurface: async () => options.busy !== true,
    show: async () => {},
    loadDefinitionMergeWorkbenchHTML() { this.webViewLoaded = true; },
    async loadDefinitionMergeWorkbenchData(sourceId, targetId) {
      calls.loads.push([sourceId, targetId]);
      const model = instance.prepareDefinitionMergeWorkbenchData(sourceId, targetId);
      return { success: model.canExecute && options.rejectLoad !== true };
    },
  };
  const sandbox = {
    MNKnowledgeBaseClass: function () {},
    MNNote: { new: (id) => { const note = notes.get(String(id)); return note && !note.deleted ? note : null; } },
    MNUtil: {
      undoGrouping(block) { calls.undo += 1; block(); },
      showHUD(message) { calls.hud.push(message); },
      delay: async () => {},
    },
    KnowledgeBaseUtils: { checkCommentWebViewController() {}, commentWebViewController: controller, addErrorLog() {}, log() {} },
    KnowledgeBaseTemplate: {
      getNoteType: (note) => note && note.type,
      parseNoteTitle: (note) => ({ type: note.type, content: note.noteTitle }),
      changeTitle(note) { calls.prefixes.push(note.noteId); },
      linkParentNote(note) { calls.relinks.push(note.noteId); },
      mergeTitleLinkWords(kept, removed) { calls.aliases.push([kept.noteId, removed.noteId]); },
      removeLinksToNoteInField(note, field, removedId) { calls.linkRemovals.push([note.noteId, field, removedId]); },
      removeDuplicateLinksInField(note, field, dedupeOptions) { calls.dedupes.push([note.noteId, field, plain(dedupeOptions)]); },
      renewKnowledgeNotesInTransaction(kept, removed, mergeOptions) {
        calls.merges.push({ kept: kept.noteId, removed: removed.noteId, options: plain(mergeOptions) });
        if (options.failMergeId === removed.noteId) throw new Error('host merge failed');
        if (options.failMergeReturnId === removed.noteId) return { success: false, error: 'host merge rejected' };
        assert.notEqual(kept.noteId, removed.noteId, 'must not merge a card into itself');
        assert.equal(removed.childNotes.length, 0, 'transaction must move descendants before deleting their source');
        kept.comments.push(...removed.comments);
        removed.comments = [];
        if (removed.parentNote) removed.parentNote.childNotes = removed.parentNote.childNotes.filter((item) => item !== removed);
        removed.parentNote = null;
        removed.deleted = true;
        return { success: true };
      },
    },
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(methods, sandbox, { filename: 'definition-merge-production-methods.js' });
  const instance = new sandbox.MNKnowledgeBaseClass();
  instance.refreshSearchCardIndex = async (noteId, indexOptions) => { calls.index.push({ noteId, options: plain(indexOptions) }); };
  function model(sourceId = source.noteId, targetId = target.noteId) {
    return instance.prepareDefinitionMergeWorkbenchData(sourceId, targetId);
  }
  function plan(state = {}, currentModel = model()) {
    assert.equal(currentModel.canExecute, true, `direct child must merge into parent: ${currentModel.errors.join('; ')}`);
    const result = plain(Core.buildPlan(currentModel, {
      mappings: Core.createDefaultMappings(currentModel), titleMode: 'target', ...state,
    }));
    assert.equal(Core.validatePlan(currentModel, result).valid, true, 'real frontend plan must pass real frontend validation');
    return result;
  }
  return { instance, calls, notes, source, target, sourceClass, sourceExtra, nestedClass, sourceKnowledge, secondKnowledge,
    nestedKnowledge, looseKnowledge, targetClass, targetNestedClass, targetKnowledge, model, plan, createNote,
    apply: (mergePlan) => instance.applyDefinitionMergePlan({ plan: mergePlan }) };
}

async function mustRejectBeforeMutation(runtime, plan, message) {
  const before = snapshot(runtime);
  const result = await runtime.apply(plan);
  assert.equal(result.success, false, message);
  assert.equal(runtime.calls.undo, 0, `${message}: must reject before opening an undo group`);
  assert.deepEqual(snapshot(runtime), before, `${message}: must not mutate notes`);
  return result;
}

function snapshot(runtime) {
  return Array.from(runtime.notes.values(), (note) => ({
    noteId: note.noteId, title: note.noteTitle, parentId: note.parentNote && note.parentNote.noteId,
    children: note.childNotes.map((child) => child.noteId), comments: plain(note.comments), deleted: note.deleted,
  }));
}

function assertTreeIntegrity(runtime) {
  for (const note of runtime.notes.values()) {
    if (note.deleted) { assert.equal(note.childNotes.length, 0); continue; }
    if (note.parentNote) {
      assert.equal(note.parentNote.deleted, false, `${note.noteId} must not remain under a deleted parent`);
      assert.equal(note.parentNote.childNotes.filter((child) => child === note).length, 1);
    }
    assert.equal(new Set(note.childNotes).size, note.childNotes.length);
    for (const child of note.childNotes) { assert.equal(child.deleted, false); assert.equal(child.parentNote, note); }
    const seen = new Set();
    let cursor = note;
    while (cursor) { assert.equal(seen.has(cursor.noteId), false, 'parent chain must stay acyclic'); seen.add(cursor.noteId); cursor = cursor.parentNote; }
  }
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('direct child model and existing workbench opening use real preflight', async () => {
  const runtime = createRuntime();
  const model = runtime.model();
  assert.equal(model.canExecute, true, `direct child must merge into parent: ${model.errors.join('; ')}`);
  assert.equal(model.canSwap, false, 'child-to-parent must not offer the destructive reverse direction');
  assert.match(model.swapDisabledReason, /交换|方向/);
  assert.deepEqual(plain(model.sourceNodes.map((node) => node.noteId)), ['CLASS-SOURCE', 'CLASS-EXTRA']);
  assert.deepEqual(plain(model.targetNodes.map((node) => node.noteId)), ['CLASS-TARGET', 'CLASS-TARGET-NESTED']);
  assert.equal(model.sourceNodes[0].suggestedTarget, 'CLASS-TARGET');
  assert.equal(model.sourceNodes[0].knowledgeCount, 2);
  assert.equal(model.sourceNodes[0].totalKnowledgeCount, 3);
  assert.equal(model.sourceNodes[0].nestedCount, 1);
  assert.equal(await runtime.instance.openDefinitionMergeWorkbench(runtime.source.noteId, runtime.target.noteId), true);
  assert.deepEqual(runtime.calls.loads, [['DEF-SOURCE', 'DEF-TARGET']]);
  assert.deepEqual(runtime.calls.hud, [], 'normal opening must stay silent');
  assert.equal(runtime.instance.currentManagedNote, runtime.target);
});

test('all source trees move into the direct parent without losing descendants', async () => {
  const runtime = createRuntime();
  const result = await runtime.apply(runtime.plan());
  assert.equal(result.success, true);
  assert.equal(result.movedTreeCount, 2);
  assert.equal(result.pairedCount, 0);
  assert.equal(result.deletedCount, 1);
  assert.equal(runtime.source.deleted, true);
  assert.equal(runtime.sourceClass.parentNote, runtime.target);
  assert.equal(runtime.sourceExtra.parentNote, runtime.target);
  assert.equal(runtime.looseKnowledge.parentNote, runtime.target);
  assert.equal(runtime.nestedClass.parentNote, runtime.sourceClass);
  assert.equal(runtime.nestedKnowledge.parentNote, runtime.nestedClass);
  assert.deepEqual(runtime.calls.prefixes, ['KN-LOOSE']);
  assert.equal(runtime.calls.undo, 1);
  assert.equal(runtime.target.noteTitle, '目标定义');
  assert.deepEqual(runtime.calls.aliases, [['DEF-TARGET', 'DEF-SOURCE']]);
  assert.equal(new Set(runtime.calls.index.map((item) => item.noteId)).size, runtime.calls.index.length);
  assert(runtime.calls.index.some((item) => item.noteId === 'DEF-SOURCE'), 'deleted source must be refreshed in the index');
  assert(runtime.calls.index.every((item) => item.options.showSuccessHUD === false && item.options.showErrorHUD === false));
  assertTreeIntegrity(runtime);
});

test('classification pairing moves nested subtrees and direct knowledge separately', async () => {
  const runtime = createRuntime();
  const result = await runtime.apply(runtime.plan({ mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]) }));
  assert.equal(result.success, true);
  assert.equal(result.pairedCount, 1);
  assert.equal(result.movedTreeCount, 1);
  assert.equal(result.movedKnowledgeCount, 2);
  assert.equal(result.deletedCount, 2);
  assert.equal(runtime.sourceClass.deleted, true);
  assert.equal(runtime.nestedClass.parentNote, runtime.targetClass);
  assert.equal(runtime.sourceKnowledge.parentNote, runtime.targetClass);
  assert.equal(runtime.secondKnowledge.parentNote, runtime.targetClass);
  assert.deepEqual(runtime.calls.prefixes, ['KN-SOURCE', 'KN-SECOND', 'KN-LOOSE']);
  const merge = runtime.calls.merges.find((item) => item.removed === 'CLASS-SOURCE');
  assert.deepEqual(merge.options.skipFields, ['所属', '包含']);
  assert.equal(merge.options.mergeRelatedLinks, true);
  assertTreeIntegrity(runtime);
});

test('knowledge pairing merges content into the selected target before removing the source', async () => {
  const runtime = createRuntime();
  const result = await runtime.apply(runtime.plan({
    mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]),
    knowledgeMappings: new Map([['KN-SOURCE', 'KN-TARGET']]),
  }));
  assert.equal(result.success, true);
  assert.equal(result.mergedKnowledgeCount, 1);
  assert.equal(result.movedKnowledgeCount, 1);
  assert.equal(result.deletedCount, 3);
  assert.equal(runtime.sourceKnowledge.deleted, true);
  assert(runtime.targetKnowledge.comments.some((comment) => comment.text === 'KN-SOURCE content'));
  assert.equal(runtime.calls.merges[0].removed, 'KN-SOURCE');
  assert.equal(runtime.calls.merges[0].options.mergeRelatedLinks, true, 'knowledge pairing must preserve manual related links');
  assert.equal(runtime.calls.merges[1].removed, 'CLASS-SOURCE');
  assert.deepEqual(runtime.calls.linkRemovals.filter(([noteId]) => noteId === 'KN-SOURCE'), [
    ['KN-SOURCE', '相关链接', 'CLASS-SOURCE'],
    ['KN-SOURCE', '相关链接', 'KN-TARGET'],
  ], 'only the old source parent and merge counterpart are cleared from source knowledge');
  assert(runtime.calls.linkRemovals.some(([noteId, field, removedId]) => noteId === 'KN-TARGET' && field === '相关链接' && removedId === 'KN-TARGET'), 'knowledge target must remove self-links after incoming link rewrites');
  assert.deepEqual(runtime.calls.dedupes.find(([noteId]) => noteId === 'KN-TARGET'), [
    'KN-TARGET', '相关链接', { includeMarkdown: true },
  ]);
  assert(!runtime.calls.relinks.includes('KN-TARGET'), 'unchanged knowledge parent must not trigger broad related-link rebuilding');
  assert(runtime.calls.merges.every((item) => item.options.showHUD === false && item.options.focusAfterMerge === false));
  assertTreeIntegrity(runtime);
});

test('merged knowledge retains its child cards and nested child subtrees', async () => {
  const runtime = createRuntime();
  const proof = runtime.createNote('KN-SOURCE-PROOF', '证明');
  const childClass = runtime.createNote('KN-SOURCE-CHILD-CLASS', '归类');
  const nestedProof = runtime.createNote('KN-SOURCE-NESTED-PROOF', '证明');
  runtime.sourceKnowledge.addChild(proof);
  runtime.sourceKnowledge.addChild(childClass);
  childClass.addChild(nestedProof);
  const result = await runtime.apply(runtime.plan({
    mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]),
    knowledgeMappings: new Map([['KN-SOURCE', 'KN-TARGET']]),
  }));
  assert.equal(result.success, true);
  assert.equal(runtime.sourceKnowledge.deleted, true);
  assert.equal(proof.parentNote, runtime.targetKnowledge);
  assert.equal(childClass.parentNote, runtime.targetKnowledge);
  assert.equal(nestedProof.parentNote, childClass, 'nested descendants must preserve their existing parent');
  assert.equal(proof.comments[0].text, 'KN-SOURCE-PROOF content');
  assert.equal(nestedProof.comments[0].text, 'KN-SOURCE-NESTED-PROOF content');
  assert(runtime.calls.prefixes.includes(proof.noteId), 'moved knowledge child must receive its new parent prefix');
  assert(!runtime.calls.prefixes.includes(childClass.noteId), 'classification title must keep its current policy');
  assert(runtime.calls.relinks.includes(proof.noteId));
  assert(runtime.calls.relinks.includes(childClass.noteId));
  assert(runtime.calls.index.some((item) => item.noteId === proof.noteId));
  assert(runtime.calls.index.some((item) => item.noteId === childClass.noteId));
  assertTreeIntegrity(runtime);
});

test('failed knowledge-child movement stops before merging or deleting its source', async () => {
  const options = {};
  const runtime = createRuntime(options);
  const firstProof = runtime.createNote('KN-SOURCE-PROOF-FIRST', '证明');
  const secondProof = runtime.createNote('KN-SOURCE-PROOF-SECOND', '证明');
  runtime.sourceKnowledge.addChild(firstProof);
  runtime.sourceKnowledge.addChild(secondProof);
  options.failMoveId = secondProof.noteId;
  const result = await runtime.apply(runtime.plan({
    mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]),
    knowledgeMappings: new Map([['KN-SOURCE', 'KN-TARGET']]),
  }));
  assert.equal(result.success, false);
  assert.equal(result.requiresUndo, true);
  assert.match(result.error, /撤销一次/);
  assert.equal(firstProof.parentNote, runtime.targetKnowledge, 'earlier successful move demonstrates the need for undo');
  assert.equal(secondProof.parentNote, runtime.sourceKnowledge);
  assert.equal(runtime.sourceKnowledge.deleted, false);
  assert.equal(runtime.sourceClass.deleted, false);
  assert.equal(runtime.source.deleted, false);
  assert.deepEqual(runtime.calls.merges, [], 'source knowledge merge must not run after child movement fails');
  assert.equal(runtime.calls.undo, 1);
  assert.equal(runtime.calls.index.length, 0);
  assertTreeIntegrity(runtime);
});

test('independent definitions retain source title and alias choices', async () => {
  const runtime = createRuntime({ relationship: 'independent' });
  assert.equal(runtime.model().canSwap, true, 'unrelated definitions may still exchange merge direction');
  assert.equal(runtime.model().swapDisabledReason, '');
  const result = await runtime.apply(runtime.plan({ titleMode: 'source', keepAliases: false }));
  assert.equal(result.success, true);
  assert.equal(runtime.target.noteTitle, '来源定义');
  assert.deepEqual(runtime.calls.aliases, []);
  assertTreeIntegrity(runtime);
});

test('paired classification can target an existing nested target classification', async () => {
  const runtime = createRuntime();
  const result = await runtime.apply(runtime.plan({ mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET-NESTED'], ['CLASS-EXTRA', 'move']]) }));
  assert.equal(result.success, true);
  assert.equal(runtime.sourceKnowledge.parentNote, runtime.targetNestedClass);
  assert.equal(runtime.nestedClass.parentNote, runtime.targetNestedClass);
  assertTreeIntegrity(runtime);
});

test('same card, missing card, wrong type and different notebooks reject before mutation', async () => {
  for (const mutate of [
    (runtime, plan) => { plan.targetDefinitionId = runtime.source.noteId; },
    (runtime, plan) => { plan.targetDefinitionId = 'MISSING'; },
    (runtime) => { runtime.target.type = '命题'; },
    (runtime) => { runtime.target.notebookId = 'OTHER-BOOK'; },
  ]) {
    const runtime = createRuntime();
    const plan = runtime.plan();
    mutate(runtime, plan);
    const result = await mustRejectBeforeMutation(runtime, plan, 'invalid definition context');
    assert.equal(result.stale, true);
  }
});

test('ancestor into descendant and non-direct ancestor targets stay forbidden', async () => {
  for (const relationship of ['reverse', 'grandparent']) {
    const runtime = createRuntime();
    const plan = runtime.plan();
    if (relationship === 'reverse') {
      plan.sourceDefinitionId = runtime.target.noteId;
      plan.targetDefinitionId = runtime.source.noteId;
    } else {
      const grandparent = runtime.createNote('DEF-GRANDPARENT', '定义');
      grandparent.addChild(runtime.target);
      plan.targetDefinitionId = grandparent.noteId;
    }
    const result = await mustRejectBeforeMutation(runtime, plan, relationship);
    assert.equal(result.stale, true);
    assert.match(result.error, /祖先|父|后代/);
  }
});

test('title, comments, parent, order and nested descendant changes invalidate revisions', async () => {
  for (const mutate of [
    (runtime) => { runtime.target.noteTitle += ' changed'; },
    (runtime) => { runtime.sourceKnowledge.comments[0].text += ' changed'; },
    (runtime) => { runtime.nestedKnowledge.noteTitle += ' changed'; },
    (runtime) => { runtime.target.childNotes.reverse(); },
    (runtime) => { runtime.sourceExtra.addChild(runtime.sourceKnowledge); },
  ]) {
    const runtime = createRuntime();
    const plan = runtime.plan();
    mutate(runtime);
    const result = await mustRejectBeforeMutation(runtime, plan, 'stale plan');
    assert.equal(result.stale, true);
    assert.match(result.error, /变化|刷新/);
  }
});

test('the revision includes exactly 500 unique cards and changes at the traversal boundary', async () => {
  for (const side of ['source', 'target']) {
    const runtime = createRuntime();
    const parent = side === 'source' ? runtime.sourceExtra : runtime.targetClass;
    let last = null;
    while (runtime.notes.size < 500) {
      last = runtime.createNote(`BOUNDARY-${runtime.notes.size}`, '命题');
      parent.addChild(last);
    }
    const current = runtime.model();
    assert.equal(current.canExecute, true, `500 cards on ${side} side must remain valid`);
    assert.match(current.revision, /^definition-merge:500:/, 'nested source is counted only once under its target parent');
    const plan = runtime.plan({}, current);
    last.comments[0].text += ' changed';
    assert.notEqual(runtime.model().revision, current.revision, `last ${side} card must contribute to revision`);
    const result = await mustRejectBeforeMutation(runtime, plan, `500th ${side} card changed`);
    assert.equal(result.stale, true);
  }
});

test('a 501st source or target card blocks preparation and an already prepared plan', async () => {
  for (const side of ['source', 'target']) {
    const runtime = createRuntime();
    const parent = side === 'source' ? runtime.sourceExtra : runtime.targetClass;
    while (runtime.notes.size < 500) parent.addChild(runtime.createNote(`BOUNDARY-${runtime.notes.size}`, '命题'));
    const plan = runtime.plan();
    parent.addChild(runtime.createNote('BOUNDARY-501', '命题'));
    const current = runtime.model();
    assert.equal(current.canExecute, false, `${side} limit overflow must block preparation`);
    assert.equal(current.revision, '', 'overflow must not return a partial revision');
    assert.match(current.errors.join('; '), /500/);
    const result = await mustRejectBeforeMutation(runtime, plan, `501 cards on ${side}`);
    assert.match(result.error, /500/);
  }
});

test('tampered classification, knowledge and strategy plans reject before mutation', async () => {
  const mutations = [
    (plan) => { plan.mappings.pop(); },
    (plan) => { plan.mappings.push({ ...plan.mappings[0] }); },
    (plan) => { plan.mappings[0].targetId = 'CLASS-NESTED'; },
    (plan) => { plan.titleMode = 'unexpected'; },
    (plan) => { plan.prefixMode = 'all'; },
    (plan) => { plan.knowledgeMappings = [{ sourceId: 'KN-SOURCE', targetId: 'KN-TARGET' }]; },
    (plan) => { plan.mappings[0].targetId = 'CLASS-TARGET-NESTED'; plan.knowledgeMappings = [{ sourceId: 'KN-SOURCE', targetId: 'KN-TARGET' }]; },
    (plan) => { plan.mappings[0].targetId = 'CLASS-TARGET'; plan.knowledgeMappings = [{ sourceId: 'KN-SOURCE', targetId: 'KN-SOURCE' }]; },
    (plan) => { plan.mappings[0].targetId = 'CLASS-TARGET'; plan.knowledgeMappings = [{ sourceId: 'KN-SOURCE', targetId: 'KN-TARGET' }, { sourceId: 'KN-SOURCE', targetId: 'KN-TARGET' }]; },
  ];
  for (const mutate of mutations) {
    const runtime = createRuntime();
    const plan = runtime.plan();
    mutate(plan);
    await mustRejectBeforeMutation(runtime, plan, 'tampered plan');
  }
});

test('failed moves keep source containers and require the single undo group', async () => {
  const runtime = createRuntime({ failMoveId: 'KN-SECOND' });
  const result = await runtime.apply(runtime.plan({ mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]) }));
  assert.equal(result.success, false);
  assert.equal(result.requiresUndo, true);
  assert.match(result.error, /撤销一次/);
  assert.equal(runtime.calls.undo, 1);
  assert.equal(runtime.sourceKnowledge.parentNote, runtime.targetClass, 'failure occurs after a previous child moved');
  assert.equal(runtime.secondKnowledge.parentNote, runtime.sourceClass);
  assert.equal(runtime.sourceClass.deleted, false);
  assert.equal(runtime.source.deleted, false);
  assert.equal(runtime.calls.index.length, 0, 'failed transaction must not report index completion');
  assertTreeIntegrity(runtime);
});

test('field merge failures preserve remaining source and surface required undo', async () => {
  const runtime = createRuntime({ failMergeId: 'CLASS-SOURCE' });
  const result = await runtime.apply(runtime.plan({ mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]) }));
  assert.equal(result.success, false);
  assert.equal(result.requiresUndo, true);
  assert.match(result.error, /host merge failed.*撤销一次/);
  assert.equal(runtime.sourceClass.deleted, false);
  assert.equal(runtime.source.deleted, false);
  assert.equal(runtime.calls.undo, 1);
  assertTreeIntegrity(runtime);
});

test('host merge rejection results require undo for knowledge, classification and definition merges', async () => {
  for (const failMergeReturnId of ['KN-SOURCE', 'CLASS-SOURCE', 'DEF-SOURCE']) {
    const runtime = createRuntime({ failMergeReturnId });
    const result = await runtime.apply(runtime.plan({
      mappings: new Map([['CLASS-SOURCE', 'CLASS-TARGET'], ['CLASS-EXTRA', 'move']]),
      knowledgeMappings: new Map([['KN-SOURCE', 'KN-TARGET']]),
    }));
    assert.equal(result.success, false, `${failMergeReturnId} result must not be ignored`);
    assert.equal(result.requiresUndo, true);
    assert.match(result.error, /host merge rejected.*撤销一次/);
    assert.equal(runtime.notes.get(failMergeReturnId).deleted, false);
    assert.equal(runtime.source.deleted, false);
    assert.equal(runtime.calls.undo, 1);
    assert.equal(runtime.calls.index.length, 0);
    assert.equal(runtime.calls.merges.at(-1).removed, failMergeReturnId, 'no subsequent merge may execute');
    assertTreeIntegrity(runtime);
  }
});

test('busy workbench and failed data delivery reject opening', async () => {
  for (const options of [{ busy: true }, { rejectLoad: true }]) {
    const runtime = createRuntime(options);
    assert.equal(await runtime.instance.openDefinitionMergeWorkbench(runtime.source.noteId, runtime.target.noteId), false);
    assert.equal(runtime.calls.hud.length, 1, 'failed opening must expose an error');
    assert.equal(runtime.calls.undo, 0);
  }
});

async function run() {
  for (const { name, run } of tests) {
    try { await run(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
  console.log(`definition merge runtime regression: ok (${tests.length} scenario groups)`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
