#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');

function harness() {
  const registry = new Map();
  const calls = { undoGroups: 0, hud: [], errors: [], preprocess: [], extractOptions: [] };
  const context = {
    console, Map, Set, WeakMap, Array, Object, String, Number, Boolean, RegExp, Date, Math, Promise,
    MNNote: { new(id) { return registry.get(String(id)); } },
    MNUtil: {
      undoGrouping(block) { calls.undoGroups += 1; block(); },
      showHUD(message) { calls.hud.push(message); },
      copyJSON(error) { calls.errors.push(error); },
      log() {},
    },
    KnowledgeBaseUtils: { log() {}, emitRuntimeLog() {}, addErrorLog(error) { throw error; } },
    HtmlMarkdownUtils: { isHtmlMDComment() { return false; } },
  };
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  const end = source.indexOf('\nclass KnowledgeBaseIndexer');
  assert.notEqual(end, -1);
  vm.runInContext(`${source.slice(0, end)}\nthis.Template = KnowledgeBaseTemplate;`, context);
  const Template = context.Template;
  const productionExtractComments = Template.extractComments;

  // These adapters model the host comments; the parser and merge algorithm stay production code.
  Template.getSafeComments = note => note.comments;
  Template.getSafeCommentType = comment => comment && comment.type;
  Template.getSafeCommentText = comment => comment && comment.text || '';
  Template.getNoteType = note => note.type;
  Template.extractComments = (note, indices, options) => {
    calls.extractOptions.push(options);
    return {
      mergeInto(target) {
        target.pendingContentStart = target.comments.length;
        target.comments.push(...indices.map(index => ({ ...note.comments[index] })));
      },
    };
  };
  Template.cleanupExtractedContentLinks = () => {};
  Template.autoMoveNewContentToField = (target, fieldName) => {
    const content = target.comments.splice(target.pendingContentStart);
    if (fieldName === '摘录' || fieldName === '摘录区') {
      target.comments.unshift(...content);
      delete target.pendingContentStart;
      return;
    }
    const resolvedField = Template.resolveFieldName(fieldName, target.type);
    const fieldIndex = target.comments.findIndex(comment => comment.type === 'HtmlComment' &&
      Template.normalizeFieldName(comment.text) === resolvedField);
    assert.ok(fieldIndex >= 0, `fixture target must explicitly define ${resolvedField}`);
    let insertIndex = target.comments.findIndex((comment, index) => index > fieldIndex && comment.type === 'HtmlComment');
    if (insertIndex < 0) insertIndex = target.comments.length;
    target.comments.splice(insertIndex, 0, ...content);
    delete target.pendingContentStart;
  };

  function note(id, comments) {
    const value = {
      noteId: id,
      type: '定义',
      noteTitle: `【定义】${id}`,
      noteURL: `marginnote4app://note/${id}`,
      comments: comments.map(comment => ({ ...comment })),
      childNotes: [],
      get MNComments() { return this.comments; },
      convertLinksToNewVersion() { calls.preprocess.push('convertLinksToNewVersion'); },
      cleanupBrokenLinks() { calls.preprocess.push('cleanupBrokenLinks'); },
      fixMergeProblematicLinks() { calls.preprocess.push('fixMergeProblematicLinks'); },
      removeCommentsByIndexArr(indices) {
        indices.slice().sort((left, right) => right - left).forEach(index => this.comments.splice(index, 1));
      },
      removeCommentByIndex(index) { this.comments.splice(index, 1); },
      replaceWithMarkdownComment(text, index) { this.comments[index] = { type: 'markdownComment', text }; },
      refresh() {},
      delete() { this.deleted = true; },
      mergeInto(target) {
        target.pendingContentStart = target.comments.length;
        target.comments.push(...this.comments.map(comment => ({ ...comment })));
        this.deleted = true;
      },
    };
    registry.set(id, value);
    return value;
  }
  return { calls, Template, note, registry, productionExtractComments };
}

function runFixture(prelude) {
  const runtime = harness();
  const target = runtime.note('TARGET', [{ type: 'HtmlComment', text: '核心总结' }]);
  const sourceNote = runtime.note('SOURCE', [
    ...prelude,
    { type: 'HtmlComment', text: '核心总结：' },
    { type: 'markdownComment', text: '归入核心总结的内容' },
    { type: 'HtmlComment', text: '所属：' },
    { type: 'markdownComment', text: '[旧父卡片](marginnote4app://note/OLD-PARENT)' },
  ]);
  const result = runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote, {
    removeTitle: true,
    showHUD: false,
    refreshTarget: false,
    focusAfterMerge: false,
    skipFields: ['所属'],
  });
  return {
    result,
    sourceDeleted: sourceNote.deleted,
    targetComments: target.comments,
    undoGroups: runtime.calls.undoGroups,
    hud: runtime.calls.hud,
  };
}

function runProbe() {
  return {
    markdownBeforeField: runFixture([{ type: 'markdownComment', text: '字段之前的重要原文' }]),
    textBeforeField: runFixture([{ type: 'textComment', text: '字段之前的重要文字' }]),
    drawingBeforeField: runFixture([{ type: 'drawingComment', paint: 'DRAWING-DATA' }]),
    imageBeforeField: runFixture([{ type: 'mergedImageComment', text: 'IMAGE-DATA' }]),
    mixedBeforeField: runFixture([
      { type: 'mergedImageComment', text: 'IMAGE-DATA' },
      { type: 'markdownComment', text: '字段之前的重要原文' },
      { type: 'drawingComment', paint: 'DRAWING-DATA' },
    ]),
  };
}

function assertFixed(results) {
  const markers = {
    markdownBeforeField: '字段之前的重要原文',
    textBeforeField: '字段之前的重要文字',
    drawingBeforeField: 'DRAWING-DATA',
    imageBeforeField: 'IMAGE-DATA',
  };
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.result.success, true, name);
    assert.equal(result.sourceDeleted, true, name);
    assert.equal(result.undoGroups, 0, `${name}: transaction helper must not open inner undo groups`);
    assert.deepEqual(result.hud, [], `${name}: silent transaction must not show success HUD`);
    const text = JSON.stringify(result.targetComments);
    assert.ok(text.includes('归入核心总结的内容'), `${name}: field content lost`);
    assert.ok(!text.includes('OLD-PARENT'), `${name}: skipped structural field leaked`);
    const expectedMarkers = name === 'mixedBeforeField'
      ? ['IMAGE-DATA', '字段之前的重要原文', 'DRAWING-DATA']
      : [markers[name]];
    expectedMarkers.forEach(marker => assert.ok(text.includes(marker), `${name}: pre-field content lost: ${marker}`));
  }
}

const mergeOptions = {
  removeTitle: true,
  showHUD: false,
  refreshTarget: false,
  focusAfterMerge: false,
  skipFields: ['所属'],
};

function assertSilent(runtime) {
  assert.equal(runtime.calls.undoGroups, 0, 'transaction helper must not create an inner undo group');
  assert.deepEqual(runtime.calls.hud, [], 'transaction helper must not display a success HUD');
  assert.deepEqual(runtime.calls.errors, [], 'incoming-link maintenance must not silently fail');
  runtime.calls.extractOptions.forEach(options => {
    assert.equal(options && options.createChildUndoGrouping, false,
      'renew must disable child creation undo groups for every field extraction');
  });
}

function assertExtractionUndoOptionsForwarded() {
  [undefined, { createChildUndoGrouping: false }].forEach(options => {
    const runtime = harness();
    const sourceNote = runtime.note('SOURCE', [
      { type: 'HtmlComment', text: '核心总结' },
      { type: 'markdownComment', text: 'unselected text' },
      { type: 'markdownComment', text: 'selected text' },
    ]);
    const sourceBefore = JSON.stringify(sourceNote.comments);
    let clonedChildDetached = false;
    let addedClone = null;
    let conversionOptions = null;
    sourceNote.clone = () => {
      const clone = runtime.note('CLONE', sourceNote.comments);
      clone.childNotes.push({
        removeFromParent() { clonedChildDetached = true; clone.childNotes = []; },
      });
      return clone;
    };
    sourceNote.addChild = clone => { addedClone = clone; clone.parentNote = sourceNote; };
    runtime.Template.getRawCommentIndicesForManagerIndices = (note, indices) => {
      assert.equal(note, sourceNote);
      return indices.slice();
    };
    runtime.Template.noteHasExtractableExcerpt = () => true;
    runtime.Template.toNoExcerptVersion = (clone, parent, forwarded) => {
      assert.equal(clone, addedClone);
      assert.equal(parent, sourceNote);
      conversionOptions = forwarded;
      return runtime.note('CONVERTED', [
        { type: 'markdownComment', text: 'conversion wrapper' },
        ...clone.comments,
      ]);
    };
    runtime.Template.removeConvertedSourceExcerptComment = (converted, hadExcerpt) => {
      assert.equal(converted.noteId, 'CONVERTED');
      assert.equal(hadExcerpt, true);
    };
    runtime.Template.resolveClonedCommentIndicesBySourceIndices = (note, indices, converted) => {
      assert.equal(note, sourceNote);
      return indices.map(index => converted.comments.findIndex(comment =>
        comment.type === note.comments[index].type && comment.text === note.comments[index].text));
    };
    const extracted = options === undefined
      ? runtime.productionExtractComments.call(runtime.Template, sourceNote, [2])
      : runtime.productionExtractComments.call(runtime.Template, sourceNote, [2], options);
    assert.equal(clonedChildDetached, true);
    assert.equal(conversionOptions.allowTextExcerpt, true);
    assert.equal(conversionOptions.createChildUndoGrouping, options === undefined);
    assert.deepEqual(extracted.comments, [{ type: 'markdownComment', text: 'selected text' }]);
    assert.equal(extracted.noteTitle, '');
    assert.equal(extracted.title, '');
    assert.equal(JSON.stringify(sourceNote.comments), sourceBefore);
    assertSilent(runtime);
  });
}

function assertMergeBranches() {
  const fixtures = [
    {
      name: 'no fields',
      comments: [
        { type: 'markdownComment', text: 'unstructured text' },
        { type: 'drawingComment', paint: 'unstructured drawing' },
      ],
      expected: ['unstructured text', 'unstructured drawing'],
    },
    {
      name: 'first field at index zero',
      comments: [
        { type: 'HtmlComment', text: '核心总结' },
        { type: 'markdownComment', text: 'field content' },
        { type: 'HtmlComment', text: '所属' },
        { type: 'markdownComment', text: 'skipped belonging' },
      ],
      expected: ['field content'],
      excluded: ['skipped belonging'],
      targetFields: ['核心总结'],
    },
    {
      name: 'empty duplicate field before content',
      comments: [
        { type: 'HtmlComment', text: '核心总结：' },
        { type: 'HtmlComment', text: '核心总结' },
        { type: 'markdownComment', text: 'second field content' },
        { type: 'HtmlComment', text: '所属' },
        { type: 'markdownComment', text: 'skipped belonging' },
      ],
      expected: ['second field content'],
      excluded: ['skipped belonging'],
      targetFields: ['核心总结'],
    },
    {
      name: 'source and target field mapping',
      comments: [
        { type: 'HtmlComment', text: '原理' },
        { type: 'markdownComment', text: 'mapped principle content' },
      ],
      expected: ['mapped principle content'],
      targetFields: ['证明'],
      sourceType: '思想方法',
      targetType: '命题',
    },
    {
      name: 'field alias mapping',
      comments: [
        { type: 'HtmlComment', text: '证明' },
        { type: 'markdownComment', text: 'aliased proof content' },
      ],
      expected: ['aliased proof content'],
      targetFields: ['反例'],
      sourceType: '反例',
      targetType: '反例',
    },
    {
      name: 'keep excerpt only',
      comments: [
        { type: 'markdownComment', text: 'excerpt text' },
        { type: 'drawingComment', paint: 'excerpt drawing' },
        { type: 'HtmlComment', text: '核心总结' },
        { type: 'markdownComment', text: 'excluded field content' },
      ],
      expected: ['excerpt text', 'excerpt drawing'],
      excluded: ['excluded field content'],
      options: { keepOnlyExcerpt: true },
    },
  ];
  fixtures.forEach(fixture => {
    const runtime = harness();
    const target = runtime.note('TARGET', (fixture.targetFields || [])
      .map(field => ({ type: 'HtmlComment', text: field })));
    if (fixture.targetType) target.type = fixture.targetType;
    const sourceNote = runtime.note('SOURCE', fixture.comments);
    if (fixture.sourceType) sourceNote.type = fixture.sourceType;
    const result = runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote,
      { ...mergeOptions, ...fixture.options });
    assert.equal(result.success, true, fixture.name);
    assert.equal(sourceNote.deleted, true, fixture.name);
    const content = JSON.stringify(target.comments);
    fixture.expected.forEach(text => assert.ok(content.includes(text), `${fixture.name}: lost ${text}`));
    (fixture.excluded || []).forEach(text => assert.ok(!content.includes(text), `${fixture.name}: leaked ${text}`));
    assertSilent(runtime);
  });

  const runtime = harness();
  const target = runtime.note('TARGET', []);
  const sourceNote = runtime.note('SOURCE', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: 'field only' },
  ]);
  assert.throws(() => runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote,
    { ...mergeOptions, keepOnlyExcerpt: true }), /没有摘录区内容/);
  assert.equal(sourceNote.deleted, undefined);
  assert.deepEqual(target.comments, []);
  assertSilent(runtime);
}

function assertFailuresPropagate() {
  ['extract', 'retain', 'merge', 'delete'].forEach(stage => {
    const runtime = harness();
    const target = runtime.note('TARGET', [{ type: 'HtmlComment', text: '核心总结' }]);
    const comments = stage === 'merge'
      ? [{ type: 'markdownComment', text: 'body' }]
      : stage === 'retain'
        ? [{ type: 'markdownComment', text: 'body' }, { type: 'HtmlComment', text: '所属' },
          { type: 'markdownComment', text: 'old parent' }]
        : [{ type: 'HtmlComment', text: '核心总结' }, { type: 'markdownComment', text: 'field' }];
    const sourceNote = runtime.note('SOURCE', comments);
    const error = new Error(`fixture ${stage} failure`);
    if (stage === 'extract') runtime.Template.extractComments = () => { throw error; };
    if (stage === 'retain') sourceNote.removeCommentsByIndexArr = () => { throw error; };
    if (stage === 'merge') sourceNote.mergeInto = () => { throw error; };
    if (stage === 'delete') sourceNote.delete = () => { throw error; };
    assert.throws(() => runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote, mergeOptions),
      value => value === error, `${stage}: failure must reach the outer undo transaction`);
    assert.equal(sourceNote.deleted, undefined, `${stage}: source must not be reported deleted`);
    assertSilent(runtime);
  });
}

function assertIncomingFailurePropagates() {
  const runtime = harness();
  const target = runtime.note('TARGET', [{ type: 'HtmlComment', text: '核心总结' }]);
  const beforeTargetComments = JSON.stringify(target.comments);
  const sourceNote = runtime.note('SOURCE', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: '[其他](marginnote4app://note/THIRD)' },
  ]);
  const third = runtime.note('THIRD', []);
  const error = new Error('fixture incoming link read failure');
  Object.defineProperty(third, 'MNComments', { get() { throw error; } });
  assert.throws(() => runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote, mergeOptions),
    value => value === error, 'failed incoming-link maintenance must stop source deletion');
  assert.equal(sourceNote.deleted, undefined);
  assert.equal(JSON.stringify(target.comments), beforeTargetComments);
  assert.equal(runtime.calls.undoGroups, 0);
  assert.deepEqual(runtime.calls.hud, []);
}

function assertMissingTargetFieldRejectsBeforeWrites() {
  [
    ['补充材料', '核心总结'],
    ['核心总结', '核心总结补充'],
  ].forEach(([sourceField, targetField]) => {
    const runtime = harness();
    const sourceNote = runtime.note('SOURCE', [
      { type: 'markdownComment', text: '- ' },
      { type: 'HtmlComment', text: sourceField },
      { type: 'markdownComment', text: '[目标](marginnote4app://note/TARGET) important source content' },
    ]);
    const target = runtime.note('TARGET', [
      { type: 'HtmlComment', text: targetField },
      { type: 'markdownComment', text: '[来源](marginnote4app://note/SOURCE) existing target content' },
    ]);
    const snapshot = note => JSON.stringify({
      noteTitle: note.noteTitle, title: note.title, comments: note.comments, deleted: note.deleted,
    });
    const sourceBefore = snapshot(sourceNote);
    const targetBefore = snapshot(target);
    assert.throws(() => runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote, mergeOptions),
      error => /字段/.test(error.message) && error.message.includes(sourceField),
      `missing ${sourceField} must reject before touching either card`);
    assert.equal(snapshot(sourceNote), sourceBefore);
    assert.equal(snapshot(target), targetBefore);
    assert.deepEqual(runtime.calls.preprocess, [], 'missing target field must fail before source preprocessing');
    assertSilent(runtime);
  });
}

function assertPreciseStructuralLinkCleanup() {
  const runtime = harness();
  const note = runtime.note('SOURCE', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: '正文 [目标](marginnote4app://note/TARGET) 保留' },
    { type: 'drawingComment', paint: 'BODY-DRAWING' },
    { type: 'HtmlComment', text: '相关链接' },
    { type: 'linkComment', text: 'marginnote4app://note/TARGET' },
    { type: 'markdownComment', text: '说明 [目标](marginnote4app://note/TARGET) 与 [其他](marginnote4app://note/THIRD) 末尾' },
    { type: 'markdownComment', text: '[不同编号](marginnote4app://note/TARGET-OTHER)' },
    { type: 'HtmlComment', text: '证明' },
    { type: 'markdownComment', text: '证明 [目标](marginnote4app://note/TARGET) 保留' },
  ]);
  assert.equal(runtime.Template.removeLinksToNoteInField(note, '相关链接', 'TARGET'), 2);
  const fields = runtime.Template.parseNoteComments(note).htmlCommentsObjArr;
  const related = fields.find(field => field.text === '相关链接');
  const relatedText = related.excludingFieldBlockIndexArr.map(index => note.comments[index].text).join('\n');
  assert.ok(!relatedText.includes('note/TARGET)'));
  assert.ok(relatedText.includes('[其他](marginnote4app://note/THIRD)'));
  assert.ok(relatedText.includes('TARGET-OTHER'));
  assert.ok(relatedText.includes('说明') && relatedText.includes('末尾'));
  assert.ok(note.comments.some(comment => comment.text === '正文 [目标](marginnote4app://note/TARGET) 保留'));
  assert.ok(note.comments.some(comment => comment.text === '证明 [目标](marginnote4app://note/TARGET) 保留'));
  assert.ok(note.comments.some(comment => comment.paint === 'BODY-DRAWING'));
  assertSilent(runtime);
}

function assertIncomingLinksAndBodyPreserved() {
  const runtime = harness();
  const sourceNote = runtime.note('SOURCE', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: '来源正文 [目标](marginnote4app://note/TARGET) [其他](marginnote4app://note/THIRD)' },
    { type: 'HtmlComment', text: '相关链接' },
    { type: 'markdownComment', text: '[目标](marginnote4app://note/TARGET)' },
    { type: 'markdownComment', text: '[其他](marginnote4app://note/THIRD)' },
  ]);
  const target = runtime.note('TARGET', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: '目标正文 [来源](marginnote4app://note/SOURCE)' },
    { type: 'HtmlComment', text: '相关链接' },
    { type: 'markdownComment', text: '[来源](marginnote4app://note/SOURCE)' },
  ]);
  const third = runtime.note('THIRD', [
    { type: 'markdownComment', text: '外部入链 [来源](marginnote4app://note/SOURCE)' },
  ]);
  runtime.Template.removeLinksToNoteInField(sourceNote, '相关链接', target.noteId);
  runtime.Template.removeLinksToNoteInField(target, '相关链接', sourceNote.noteId);
  const result = runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote,
    { ...mergeOptions, mergeRelatedLinks: true });
  runtime.Template.removeLinksToNoteInField(target, '相关链接', target.noteId);
  assert.equal(result.success, true);
  assert.ok(target.comments.some(comment => comment.text ===
    '来源正文 [目标](marginnote4app://note/TARGET) [其他](marginnote4app://note/THIRD)'));
  assert.ok(target.comments.some(comment => comment.text === '目标正文 [来源](marginnote4app://note/TARGET)'));
  assert.equal(third.comments[0].text, '外部入链 [来源](marginnote4app://note/TARGET)');
  const related = runtime.Template.findFieldObjectByNormalizedName(target, '相关链接');
  const relatedText = related.excludingFieldBlockIndexArr.map(index => target.comments[index].text).join('\n');
  assert.ok(!relatedText.includes('note/TARGET'));
  assert.ok(relatedText.includes('[其他](marginnote4app://note/THIRD)'));
  assertSilent(runtime);
}

function assertTargetBodyUpdatedAfterCounterpartLinksRemoved() {
  const runtime = harness();
  const sourceNote = runtime.note('SOURCE', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: '来源正文没有目标链接' },
    { type: 'HtmlComment', text: '相关链接' },
    { type: 'markdownComment', text: '[目标](marginnote4app://note/TARGET)' },
  ]);
  const target = runtime.note('TARGET', [
    { type: 'HtmlComment', text: '核心总结' },
    { type: 'markdownComment', text: '正文 [来源](marginnote4app://note/SOURCE) 保留' },
    { type: 'HtmlComment', text: '相关链接' },
    { type: 'markdownComment', text: '[来源](marginnote4app://note/SOURCE)' },
  ]);
  runtime.Template.removeLinksToNoteInField(sourceNote, '相关链接', target.noteId);
  runtime.Template.removeLinksToNoteInField(target, '相关链接', sourceNote.noteId);
  assert.ok(!JSON.stringify(sourceNote.comments).includes('note/TARGET'),
    'target must no longer be reachable through a source comment');
  const result = runtime.Template.renewKnowledgeNotesInTransaction(target, sourceNote,
    { ...mergeOptions, mergeRelatedLinks: true });
  runtime.Template.removeLinksToNoteInField(target, '相关链接', target.noteId);
  assert.equal(result.success, true);
  assert.ok(target.comments.some(comment => comment.text === '正文 [来源](marginnote4app://note/TARGET) 保留'));
  assert.ok(!JSON.stringify(target.comments).includes('note/SOURCE'));
  assert.ok(target.comments.some(comment => comment.text === '来源正文没有目标链接'));
  assertSilent(runtime);
}

assertFixed(runProbe());
assertExtractionUndoOptionsForwarded();
assertMergeBranches();
assertFailuresPropagate();
assertIncomingFailurePropagates();
assertMissingTargetFieldRejectsBeforeWrites();
assertPreciseStructuralLinkCleanup();
assertIncomingLinksAndBodyPreserved();
assertTargetBodyUpdatedAfterCounterpartLinksRemoved();
console.log('definition merge content regression: ok');
