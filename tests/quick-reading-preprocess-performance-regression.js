const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const classEnd = source.indexOf('\nclass KnowledgeBaseIndexer');
assert.notStrictEqual(classEnd, -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');

const indexCalls = [];
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
  KnowledgeBaseConfig: {
    config: {
      referenceNoteIds: { templates: { '命题': 'fixture-proposition-template' } },
      readingFollowMode: true,
      prefixMode: false,
      classificationMode: false,
      preProcessMode: true,
      classAutoPinMode: false,
    },
  },
  KnowledgeBaseIndexer: {
    addToIncrementalIndex(note, mode, options) {
      indexCalls.push({ note, mode, options });
    },
    upsertIncrementalIndexEntry(note, mode, options = {}) {
      indexCalls.push({ note, mode, options });
      return {
        success: true,
        entry: { id: note.noteId },
        removedIds: options.staleIds || [],
        mode: mode || 'light',
      };
    },
  },
  KnowledgeBaseUtils: {
    addErrorLog(error) {
      throw error;
    },
  },
  MNUtil: {
    _undoGroupingDepth: 0,
    getNoteById(noteId) { return noteId ? { noteId } : null; },
    undoGrouping(callback) {
      return callback();
    },
    showHUD() {},
  },
};
context.global = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  `${source.slice(0, classEnd)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`,
  context,
);
const KBT = context.KnowledgeBaseTemplate;

function withPatchedMethods(replacements, callback) {
  const originals = {};
  Object.keys(replacements).forEach((key) => {
    originals[key] = KBT[key];
    KBT[key] = replacements[key];
  });
  try {
    return callback();
  } finally {
    Object.keys(replacements).forEach((key) => {
      KBT[key] = originals[key];
    });
  }
}

function assertQuickReadingPreProcessFinalizesOnce() {
  const parent = { noteId: 'PARENT', colorIndex: 0 };
  const note = { noteId: 'NOTE', colorIndex: 10, parentNote: parent };
  const processedNote = { noteId: 'PROCESSED', colorIndex: 10, parentNote: parent };
  const calls = [];
  indexCalls.length = 0;

  withPatchedMethods({
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
    getQuickReadingMakeCardPolicy() {
      return { mode: 'normal', noteType: '命题', colorIndex: 10 };
    },
    isKnowledgeNote() { return true; },
    parseNoteTitle() { return { prefixContent: '正式前缀' }; },
    ifTemplateMerged() { return true; },
    extractNoteLinkUrlsFromField() { return ['marginnote4app://note/PARENT']; },
    isClassificationNote() { return false; },
    sanitizeNoteCommentsForMake() {},
    processNote(target, lockedNoteType, options) {
      assert.strictEqual(target, note);
      assert.strictEqual(lockedNoteType, '命题');
      assert.strictEqual(options.deferFinalization, true);
      assert.strictEqual(options.syncIndex, false);
      calls.push('process');
      return processedNote;
    },
    changeTitle(target, forced, lockedNoteType, options) {
      assert.strictEqual(target, processedNote);
      assert.strictEqual(forced, true);
      assert.strictEqual(lockedNoteType, '命题');
      assert.strictEqual(options.syncContainLinks, false);
      assert.strictEqual(options.syncIndex, false);
      calls.push('title');
    },
    changeNoteColor(target, lockedNoteType) {
      assert.strictEqual(target, processedNote);
      assert.strictEqual(lockedNoteType, '命题');
      calls.push('color');
    },
    mergeTemplateAndAutoMoveNoteContent(target, directly, options) {
      assert.strictEqual(target, processedNote);
      assert.strictEqual(directly, false);
      assert.strictEqual(options.noteType, '命题');
      calls.push('merge');
    },
    autoMoveNewContent() {
      throw new Error('pre-process mode must not own generic content placement');
    },
    linkParentNote(target, force, accumulate, lockedNoteType) {
      assert.strictEqual(target, processedNote);
      assert.strictEqual(force, false);
      assert.strictEqual(accumulate, false);
      assert.strictEqual(lockedNoteType, '命题');
      calls.push('link');
    },
    shouldSuppressQuickReadingDefinitionIndexHUD() { return false; },
  }, () => {
    KBT.makeNote(note, true, true, false);
  });

  assert.deepStrictEqual(calls, ['process', 'title', 'color', 'merge', 'link']);
  assert.strictEqual(indexCalls.length, 1, 'formal quick-reading pre-process must write the main index once');
  assert.strictEqual(indexCalls[0].note, processedNote);
  assert.strictEqual(indexCalls[0].options.showErrorHUD, true);
}

function assertDeferredProcessPreservesContentPlacement() {
  const placementCalls = [];
  const forbidden = {
    changeTitle() { throw new Error('deferred processNote must not change the title'); },
    changeNoteColor() { throw new Error('deferred processNote must not change the color'); },
    linkParentNote() { throw new Error('deferred processNote must not link the parent'); },
    autoMoveNewContent(target, lockedNoteType) {
      placementCalls.push({ target, lockedNoteType });
    },
  };

  const mergedNote = { noteId: 'MERGED' };
  withPatchedMethods({
    ...forbidden,
    sanitizeNoteCommentsForMake() {},
    isOldTemplateCard() { return false; },
    ifTemplateMerged() { return true; },
    renewNote(target) {
      assert.strictEqual(target, mergedNote);
      return target;
    },
  }, () => {
    assert.strictEqual(
      KBT.processNote(mergedNote, '命题', { deferFinalization: true }),
      mergedNote,
    );
  });
  assert.strictEqual(placementCalls.length, 1);
  assert.strictEqual(placementCalls[0].target, mergedNote);
  assert.strictEqual(placementCalls[0].lockedNoteType, '命题');

  const replacementNote = { noteId: 'REPLACEMENT' };
  const oldNote = { noteId: 'OLD' };
  withPatchedMethods({
    ...forbidden,
    sanitizeNoteCommentsForMake() {},
    isOldTemplateCard() { return true; },
    processOldTemplateCard(target) {
      assert.strictEqual(target, oldNote);
      return replacementNote;
    },
    renewNote() {
      throw new Error('deferred old-template processing must bypass renewNote title sync');
    },
  }, () => {
    assert.strictEqual(
      KBT.processNote(oldNote, '命题', { deferFinalization: true }),
      replacementNote,
    );
  });
}

function assertChangeTitleCanDeferIndexSync() {
  const note = { noteId: 'TITLE', title: '标题', colorIndex: 10 };
  indexCalls.length = 0;
  withPatchedMethods({
    getNoteType() { return '思路'; },
    getQuestionChainContext() { return null; },
    normalizeTitleSpaces(title) { return title; },
  }, () => {
    KBT.changeTitle(note, false, null, { syncIndex: false });
    assert.strictEqual(indexCalls.length, 0);
    KBT.changeTitle(note);
    assert.strictEqual(indexCalls.length, 1, 'default changeTitle behavior must still sync the index');
  });
}

assertQuickReadingPreProcessFinalizesOnce();
assertDeferredProcessPreservesContentPlacement();
assertChangeTitleCanDeferIndexSync();
console.log('quick reading pre-process performance regression ok');
