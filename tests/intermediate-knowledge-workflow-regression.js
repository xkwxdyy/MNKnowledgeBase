#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function harness() {
  const calls = { create: 0, links: [], refresh: [], review: [], hud: [], errors: [], writes: [] };
  const indexes = new Map();
  const context = vm.createContext({
    console,
    KnowledgeBaseConfig: { config: {}, getConfig() { return false; }, getSearchIndexMode() { return 'light'; } },
    KnowledgeBaseUtils: { log() {}, emitRuntimeLog() {}, addErrorLog(error) { calls.errors.push(error); } },
    MNLog: { error(error) { calls.errors.push(error); } },
    MNUtil: { undoGrouping: fn => fn(), showHUD: text => calls.hud.push(text), delay: async () => {}, log() {} },
  });
  const boundary = source.indexOf('\nclass KnowledgeBaseNetwork');
  assert.ok(boundary > 0);
  vm.runInContext(source.slice(0, boundary) + '\nthis.Template=KnowledgeBaseTemplate;this.Main=KnowledgeBaseIndexer;this.Intermediate=IntermediateKnowledgeIndexer;this.RuntimeUtils=KnowledgeBaseUtils;', context);
  Object.assign(context.RuntimeUtils, { log() {}, emitRuntimeLog() {}, addErrorLog(error) { calls.errors.push(error); } });
  const { Template, Main, Intermediate } = context;
  Object.assign(Template, {
    _beginMakeCardPerf() { return null; }, _recordMakeCardPerf() {}, _finishMakeCardPerf() {}, _makeCardPerfNow() { return 0; },
    requireConfiguredReference() { return {}; },
    getKeywordsFromNote() { return ''; }, ifTemplateMerged(note) { return !!note.templated; },
    renewLinks() {}, getFirstClassificationParentNote() { return null; },
  });
  Object.assign(Main, {
    extractExcerptAreaText() { return ''; }, extractSupplementalSearchText() { return ''; },
    extractProofLinks() { return []; }, buildSearchEvidence() { return []; }, analyzeExclusionGroups() { return []; },
    getPersistedUsageScoreMap() { return new Map(); },
  });
  Main.loadIncrementalIndex = () => clone(indexes.get('main') || { metadata: { removedIds: [] }, cards: [] });
  Main.saveIncrementalIndex = value => {
    calls.writes.push('main');
    if (context.failSave === 'main') return false;
    indexes.set('main', clone(value)); return true;
  };
  Intermediate.loadIncrementalIndex = prefix => clone(indexes.get(prefix) || { metadata: { removedIds: [] }, cards: [] });
  Intermediate.saveIncrementalIndex = (value, prefix) => {
    calls.writes.push(prefix);
    if (context.failSave === prefix) return false;
    indexes.set(prefix, clone(value)); return true;
  };
  function note(id, title = `【命题 >> 基础】${id}`) {
    return {
      noteId: id, title, noteTitle: title, colorIndex: 3, childNotes: [],
      comments: [], MNComments: [], parentNote: null, parentNoteId: null, templated: false,
      get tags() { throw new Error('Workflow must not read user tags'); },
      set tags(_) { throw new Error('Workflow must not write user tags'); },
      appendTags() { throw new Error('Workflow must not append tags'); },
      removeTags() { throw new Error('Workflow must not remove tags'); },
      addChild(child) { this.childNotes.push(child); child.parentNote = this; child.parentNoteId = this.noteId; return child; },
    };
  }
  const grouping = (id = 'GROUP', title = '所需命题') => note(id, title);
  const intermediate = (id, parent = grouping('GROUP-' + id)) => parent.addChild(note(id));
  return { context, Template, Main, Intermediate, calls, indexes, note, grouping, intermediate, finalIndexSync: Template.syncFinalMakeCardIndex };
}

function setupMake(h) {
  const { Template: T, calls } = h;
  Object.assign(T, {
    shouldAutoAddToReview() { return false; }, assertMakeCardTemplateAvailable() {},
    getQuickReadingMakeCardPolicy() { return { mode: 'full', noteType: '命题' }; },
    sanitizeNoteCommentsForMake() {}, isOldTemplateCard() { return false; },
    renewNote(note) { return note; }, mergeTemplateAndAutoMoveNoteContent(note) { note.templated = true; },
    templateMergedCardMake(note) { note.templated = true; }, addToReview(note) { calls.review.push(note.noteId); },
    syncFinalMakeCardIndex(note) { return { success: true, entry: { id: note.noteId } }; },
    shouldSuppressQuickReadingDefinitionIndexHUD() { return false; },
  });
}
function useRealFinalIndexSync(h) {
  h.Template.syncFinalMakeCardIndex = h.finalIndexSync;
  h.Template.resolveFinalMakeCardIndexSource = () => 'main';
  h.Template.publishFinalMakeCardIndexPatch = () => {};
}
function setupMakeNote(h) {
  setupMake(h);
  Object.assign(h.Template, {
    toNoExcerptVersion(note) { return note; }, processNote(note) { return note; },
    addHierarchicalPrefixToTitle() {}, changeTitle() {}, changeNoteColor() {},
    moveClassificationLinksFromApplicationToRelatedField() { return {}; }, linkParentNote() {},
  });
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`not ok - ${name}\n${error.stack}`); }
}

(async () => {
  await test('required grouping identity uses the existing title forms without reading tags', () => {
    const h = harness();
    for (const title of ['所需命题', '“所需命题”相关命题', '【归类】所需命题', '所需知识', '“所需知识”相关命题', '【归类】所需知识']) {
      const group = h.grouping('GROUP', title);
      assert.equal(h.Template.isRequiredPropositionsClassification(group), true);
      assert.equal(h.Template.isClassificationNote(group), true);
      assert.equal(h.Template.getNoteType(group), '归类');
      assert.equal(h.Template.isIntermediateKnowledge(group), false);
    }
    for (const title of ['所需命题讨论', '“其他”相关命题', '【命题】所需命题', '普通归类']) {
      assert.equal(h.Template.isRequiredPropositionsClassification(h.note('OTHER', title)), false);
    }
    assert.equal(h.Template.isRequiredPropositionsClassification(null), false);
  });

  await test('intermediate identity follows ancestor position and excludes fully made cards', () => {
    const h = harness(), group = h.grouping(), step = group.addChild(h.note('STEP'));
    const descendant = step.addChild(h.note('DESCENDANT'));
    assert.equal(h.Template.isIntermediateKnowledge(step), true);
    assert.equal(h.Template.isIntermediateKnowledge(descendant), true);
    descendant.templated = true;
    assert.equal(h.Template.isIntermediateKnowledge(descendant), false);
    assert.equal(h.Template.isIntermediateKnowledge(h.note('OUTSIDE')), false);
    const cycle = h.note('CYCLE'); cycle.parentNote = cycle;
    assert.equal(h.Template.isIntermediateKnowledge(cycle), false);
    assert.equal(h.Template.isIntermediateKnowledge(null), false);
  });

  await test('successful full make leaves existing title, color and review policy unchanged by workflow handling', () => {
    const h = harness(); setupMake(h);
    const card = h.intermediate('A'), before = { title: card.title, color: card.colorIndex, parent: card.parentNote };
    assert.equal(h.Template.makeCard(card, true, true, { throwOnFailure: true }), card);
    assert.equal(h.Template.isIntermediateKnowledge(card), false);
    assert.deepEqual({ title: card.title, color: card.colorIndex, parent: card.parentNote }, before);
    assert.deepEqual(h.calls.review, []); assert.deepEqual(h.calls.hud, []);
  });

  await test('failure before complete card preparation leaves the source intermediate', () => {
    const h = harness(); setupMake(h);
    const card = h.intermediate('A');
    h.Template.mergeTemplateAndAutoMoveNoteContent = () => { throw new Error('fixture template failure'); };
    assert.throws(() => h.Template.makeCard(card, false, false, { throwOnFailure: true }), /fixture template failure/);
    assert.equal(h.Template.isIntermediateKnowledge(card), true);
  });

  await test('a failed final index write retains pending intermediate completion', () => {
    const h = harness(); setupMake(h);
    const card = h.intermediate('A');
    h.Template.syncFinalMakeCardIndex = () => ({ success: false, error: 'fixture index failure' });
    assert.throws(() => h.Template.makeCard(card, false, false, { throwOnFailure: true }), /索引|index/i);
    assert.equal(h.Template.isIntermediateKnowledge(card), true);
    assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), true);
  });

  await test('rough and unsupported operations do not queue full completion', () => {
    for (const mode of ['rough', 'unsupported']) {
      const h = harness(); setupMake(h);
      const card = h.intermediate('A');
      h.Template.getQuickReadingMakeCardPolicy = () => ({ mode, noteType: '命题' });
      h.Template.makeQuickReadingRoughCard = note => note;
      h.Template.showQuickReadingUnsupportedColorHUD = () => {};
      h.Template.makeCard(card, false, false, { throwOnFailure: true });
      assert.equal(h.Template.isIntermediateKnowledge(card), true);
      assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), false);
    }
  });

  await test('deferred full make remains pending until real final indexing succeeds', () => {
    const h = harness(); setupMake(h); useRealFinalIndexSync(h);
    const card = h.intermediate('DEFERRED');
    h.Template.makeCard(card, false, false, { deferFinalIndexSync: true, throwOnFailure: true });
    assert.equal(card.templated, true);
    assert.equal(h.Template.isIntermediateKnowledge(card), true);
    assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), true);
    assert.equal(h.calls.writes.length, 0);
    assert.equal(h.Template.syncFinalMakeCardIndex(card, { publishPatch: false, showErrorHUD: false }).success, true);
    assert.equal(h.Template.isIntermediateKnowledge(card), false);
    assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), false);
    assert.equal(h.indexes.get('main').cards[0].id, card.noteId);
  });

  await test('deferred index failure retains the queue until successful retry', () => {
    const h = harness(); setupMake(h); useRealFinalIndexSync(h);
    const card = h.intermediate('DEFERRED');
    h.Template.makeCard(card, false, false, { deferFinalIndexSync: true, throwOnFailure: true });
    h.context.failSave = 'main';
    assert.equal(h.Template.syncFinalMakeCardIndex(card, { publishPatch: false, showErrorHUD: false }).success, false);
    assert.equal(h.Template.isIntermediateKnowledge(card), true);
    assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), true);
    delete h.context.failSave;
    assert.equal(h.Template.syncFinalMakeCardIndex(card, { publishPatch: false, showErrorHUD: false }).success, true);
    assert.equal(h.Template.isIntermediateKnowledge(card), false);
    assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), false);
  });

  await test('ordinary index refresh does not make an unprepared intermediate card complete', () => {
    const h = harness(); useRealFinalIndexSync(h);
    const card = h.intermediate('UNMADE');
    assert.equal(h.Template.syncFinalMakeCardIndex(card, { publishPatch: false, showErrorHUD: false }).success, true);
    assert.equal(h.Template.isIntermediateKnowledge(card), true);
    assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), false);
  });

  await test('prefix-only and rough makeNote do not queue full completion', () => {
    for (const mode of ['prefix', 'rough']) for (const deferred of [false, true]) {
      const h = harness(); setupMakeNote(h); useRealFinalIndexSync(h);
      const card = h.intermediate('PARTIAL');
      h.context.KnowledgeBaseConfig.config.prefixMode = mode === 'prefix';
      h.Template.getQuickReadingMakeCardPolicy = () => ({ mode: mode === 'rough' ? 'rough' : 'full', noteType: '命题' });
      h.Template.makeQuickReadingRoughCard = note => note;
      assert.equal(h.Template.makeNote(card, false, false, false, { deferFinalIndexSync: deferred, throwOnFailure: true }), card);
      assert.equal(h.Template.isIntermediateKnowledge(card), true);
      assert.equal(h.Template.pendingIntermediateCompletionIds.has(card.noteId), false);
    }
  });

  await test('preprocessing queues the final converted card until successful indexing', () => {
    for (const deferred of [false, true]) {
      const h = harness(); setupMakeNote(h); useRealFinalIndexSync(h);
      h.context.KnowledgeBaseConfig.config.preProcessMode = true;
      const group = h.grouping(), original = h.intermediate('OLD', group), final = h.intermediate('FINAL', group);
      h.Template.processNote = () => final;
      assert.equal(h.Template.makeNote(original, false, false, false, { deferFinalIndexSync: deferred, throwOnFailure: true }), final);
      assert.equal(h.Template.pendingIntermediateCompletionIds.has(original.noteId), false);
      assert.equal(h.Template.isIntermediateKnowledge(final), deferred);
      if (deferred) {
        h.context.failSave = 'main';
        assert.equal(h.Template.syncFinalMakeCardIndex(final, { publishPatch: false, showErrorHUD: false }).success, false);
        assert.equal(h.Template.isIntermediateKnowledge(final), true);
        delete h.context.failSave;
        assert.equal(h.Template.syncFinalMakeCardIndex(final, { publishPatch: false, showErrorHUD: false }).success, true);
      }
      assert.equal(h.Template.isIntermediateKnowledge(final), false);
      assert.equal(h.Template.pendingIntermediateCompletionIds.has(final.noteId), false);
    }
  });

  await test('legacy finalization uses the converted ID and reports index failures', () => {
    for (const fail of [false, true]) {
      const h = harness(); setupMake(h); useRealFinalIndexSync(h);
      const group = h.grouping(), original = h.intermediate('OLD', group), final = h.intermediate('FINAL', group);
      h.Template.requireMakeCardTemplate = () => {};
      h.Template.processOldTemplateCard = () => final;
      h.Template.ensureLegacyCardTemplate = note => { note.templated = true; };
      if (fail) h.context.failSave = 'main';
      const run = () => h.Template.makeLegacyCard(original, { noteType: '命题', undoGrouping: false });
      if (fail) {
        assert.throws(run, /索引/);
        assert.equal(h.Template.isIntermediateKnowledge(final), true);
        assert.equal(h.Template.pendingIntermediateCompletionIds.has(final.noteId), true);
      } else {
        assert.equal(run(), final);
        assert.equal(h.Template.isIntermediateKnowledge(final), false);
        assert.equal(h.Template.pendingIntermediateCompletionIds.has(final.noteId), false);
        assert.ok(h.indexes.get('main').metadata.removedIds.includes(original.noteId));
      }
    }
  });

  await test('grouping creation reuses existing supported titles and never accesses tags or starts receiving', () => {
    for (const existingTitle of [null, '所需命题', '“所需命题”相关命题', '【归类】所需命题']) {
      const h = harness(), parent = h.note('P');
      h.context.KnowledgeBaseConfig.config.receivingTarget = 'UNCHANGED';
      if (existingTitle) parent.addChild(h.grouping('EXISTING', existingTitle));
      h.Template.createClassificationNoteAsChildNote = (owner, title, type, linkParent) => {
        h.calls.create++;
        assert.equal(owner, parent); assert.equal(title, '所需命题'); assert.equal(type, '命题'); assert.equal(linkParent, false);
        return owner.addChild(h.grouping('CREATED', `“${title}”相关${type}`));
      };
      h.Template.linkParentNote = child => h.calls.links.push(child.noteId);
      h.Template.refreshTemplateCreationNotes = (owner, child) => h.calls.refresh.push([owner.noteId, child.noteId]);
      const created = h.Template.createRequiredPropositionsClassification(parent);
      assert.equal(h.Template.createRequiredPropositionsClassification(parent), created);
      assert.equal(h.calls.create, existingTitle ? 0 : 1);
      assert.equal(parent.childNotes.length, 1);
      assert.equal(h.context.KnowledgeBaseConfig.config.receivingTarget, 'UNCHANGED');
      assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.review, []);
    }
  });

  await test('required knowledge shortcut reuses both title generations without changing receiver or tags', () => {
    for (const title of [null, '所需命题', '“所需命题”相关命题', '【归类】所需命题', '所需知识', '“所需知识”相关命题', '【归类】所需知识']) {
      const h = harness(), parent = h.note('P');
      h.context.KnowledgeBaseConfig.config.receivingTarget = 'UNCHANGED';
      if (title) parent.addChild(h.grouping('EXISTING', title));
      h.Template.createClassificationNoteAsChildNote = (owner, name, type, link) => {
        h.calls.create++; assert.equal(name, '所需知识'); assert.equal(type, '命题'); assert.equal(link, false);
        return owner.addChild(h.grouping('NEW', `“${name}”相关${type}`));
      };
      h.Template.linkParentNote = child => h.calls.links.push(child.noteId);
      h.Template.refreshTemplateCreationNotes = () => { throw Error('scene shortcut must not add post-group refresh writes'); };
      const result = h.Template.createRequiredKnowledgeClassification(parent);
      assert.equal(h.Template.createRequiredKnowledgeClassification(parent), result);
      assert.equal(h.Template.createRequiredPropositionsClassification(parent), result);
      assert.equal(h.calls.create, title ? 0 : 1); assert.equal(parent.childNotes.length, 1);
      assert.equal(h.context.KnowledgeBaseConfig.config.receivingTarget, 'UNCHANGED');
      assert.deepEqual(h.calls.writes, []); assert.deepEqual(h.calls.review, []);
    }
  });

  await test('required knowledge shortcut propagates swallowed link failures and rejects late callbacks', () => {
    const h = harness(), parent = h.note('P');
    h.Template.createClassificationNoteAsChildNote = owner => owner.addChild(h.grouping('NEW', '所需知识'));
    h.Template.linkParentNote = () => { throw Error('link failed') };
    h.context.MNUtil.undoGrouping = run => { try { run() } catch (_) {} };
    assert.throws(() => h.Template.createRequiredKnowledgeClassification(parent), error => error.message === 'link failed' && error.requiresUndo === true);
    const second = h.note('P2'); let late;
    h.context.MNUtil.undoGrouping = run => { late = run };
    assert.throws(() => h.Template.createRequiredKnowledgeClassification(second), /未完成/);
    late(); assert.equal(second.childNotes.length, 0);
  });

  await test('required knowledge template validation finishes before opening the undo group', () => {
    const h = harness(); let groups = 0;
    h.context.MNUtil.undoGrouping = () => { groups++ };
    h.Template.requireConfiguredReference = () => { throw Error('missing configured template') };
    assert.throws(() => h.Template.createRequiredKnowledgeClassification(h.note('P')), /missing configured template/);
    assert.equal(groups, 0); assert.equal(h.calls.create, 0);
  });

  await test('grouping creation rejects definitions and reports unavailable templates', () => {
    const h = harness();
    assert.throws(() => h.Template.createRequiredPropositionsClassification(h.note('D', '【定义 >> 基础】对象')), /命题/);
    h.Template.createClassificationNoteAsChildNote = () => { throw new Error('fixture missing template'); };
    assert.throws(() => h.Template.createRequiredPropositionsClassification(h.note('P')), /missing template/);
  });

  await test('entry builders exclude required groupings while ordinary descendants remain searchable', () => {
    const h = harness(), grouping = h.grouping(), child = h.intermediate('CHILD', grouping);
    const diagnostic = {};
    assert.equal(h.Main.buildIndexEntry(grouping, 'light', { diagnostic }), null);
    assert.equal(diagnostic.reason, 'workflow-classification');
    assert.equal(h.Intermediate.buildIndexEntry(grouping), null);
    assert.equal(h.Main.buildIndexEntry(child).id, 'CHILD');
    assert.equal(h.Intermediate.buildIndexEntry(child, 'light', { skipRenewLinks: true, skipTemplateCheck: true }).id, 'CHILD');
    assert.equal(h.Main.buildIndexEntry(h.note('NORMAL', '“普通归类”相关命题')).id, 'NORMAL');
  });

  await test('incremental exclusion removes only grouping entries across every index source', () => {
    const h = harness(), grouping = h.grouping();
    const prefixes = ['main', ...h.Template.getTransientKnowledgeIndexPrefixes()];
    for (const prefix of prefixes) h.indexes.set(prefix, { metadata: { removedIds: ['OLD'] }, cards: [{ id: 'GROUP' }, { id: 'CHILD' }, { id: 'OTHER' }] });
    for (const run of [() => h.Main.upsertIncrementalIndexEntry(grouping), () => h.Intermediate.upsertIncrementalIndexEntry(grouping), () => h.Template.syncFinalMakeCardIndex(grouping)]) {
      const result = run(); assert.equal(result.success, true); assert.equal(result.skipped, true);
      for (const prefix of prefixes) {
        const stored = h.indexes.get(prefix);
        assert.deepEqual(stored.cards.map(card => card.id), ['CHILD', 'OTHER']);
        assert.deepEqual(stored.metadata.removedIds, ['OLD', 'GROUP']);
      }
    }
    assert.deepEqual(h.calls.hud, []);
  });

  await test('failed exclusion persistence is reported', () => {
    const h = harness(); h.context.failSave = 'main';
    assert.equal(h.Template.excludeWorkflowClassificationFromIndex(h.grouping()).success, false);
  });

  await test('batch indexing skips required groupings but indexes supplied descendants', async () => {
    const h = harness(), grouping = h.grouping(), child = h.intermediate('CHILD', grouping);
    h.indexes.set('main', { metadata: { removedIds: [] }, cards: [{ id: 'GROUP' }, { id: 'OTHER' }] });
    const result = await h.Main.upsertIncrementalIndexEntries([grouping, child], 'light', { showErrorHUD: false });
    assert.equal(result.success, true);
    assert.deepEqual(Array.from(result.entries, entry => entry.id), ['CHILD']);
    assert.deepEqual(Array.from(result.failedIds), []);
    assert.deepEqual(h.indexes.get('main').cards.map(entry => entry.id), ['OTHER', 'CHILD']);
    assert.ok(h.indexes.get('main').metadata.removedIds.includes('GROUP'));
    const onlyGrouping = await h.Main.upsertIncrementalIndexEntries([grouping], 'light', { showErrorHUD: false });
    assert.equal(onlyGrouping.success, true); assert.equal(onlyGrouping.skipped, true);
    assert.deepEqual(Array.from(onlyGrouping.failedIds), []); assert.deepEqual(h.calls.hud, []);
  });

  if (failures.length) process.exitCode = 1;
  console.log(`intermediate knowledge workflow regression: ${passed} passed, ${failures.length} failed`);
})();
