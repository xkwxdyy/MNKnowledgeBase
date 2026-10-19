const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(addonRoot, '..');
const knowledgeBaseSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

const hudMessages = [];
const mainIncrementalIndexNotes = [];
const mainIncrementalIndexCalls = [];
const intermediateIncrementalIndexCalls = [];
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
      readingFollowMode: true,
      prefixMode: false,
      classificationMode: false,
      preProcessMode: false,
      classAutoPinMode: false,
    },
  },
  MNUtil: {
    _undoGroupingDepth: 0,
    getNoteById(noteId) {
      return noteId ? { noteId } : null;
    },
    undoGrouping(block) {
      return block();
    },
    log() {},
    showHUD(message) {
      hudMessages.push(String(message));
    },
  },
  KnowledgeBaseUtils: {
    log() {},
    addErrorLog(error) {
      throw error;
    },
  },
  KnowledgeBaseIndexer: {
    cleanHighlightMarkers(text) {
      return String(text || '');
    },
    addToIncrementalIndex(note, mode, options) {
      mainIncrementalIndexNotes.push(note);
      mainIncrementalIndexCalls.push({ note, mode, options });
    },
    upsertIncrementalIndexEntry(note, mode, options = {}) {
      mainIncrementalIndexNotes.push(note);
      mainIncrementalIndexCalls.push({ note, mode, options });
      return {
        success: true,
        entry: { id: note.noteId, title: note.title || '' },
        removedIds: options.staleIds || [],
        mode: mode || 'light',
      };
    },
    removeFromIncrementalIndex() {
      return { success: true };
    },
  },
  IntermediateKnowledgeIndexer: {
    addToIncrementalIndex(note, options) {
      intermediateIncrementalIndexCalls.push({ note, options });
      return true;
    },
    upsertIncrementalIndexEntry(note, options = {}) {
      intermediateIncrementalIndexCalls.push({ note, options });
      return {
        success: true,
        entry: { id: note.noteId, title: note.title || '' },
        removedIds: options.staleIds || [],
        mode: options.mode || 'light',
      };
    },
    removeFromIncrementalIndex() {
      return { success: true };
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

const knowledgeBaseEnd = knowledgeBaseSource.indexOf('\nclass KnowledgeBaseIndexer');
assert.notStrictEqual(knowledgeBaseEnd, -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');
context.KnowledgeBaseConfig.config.referenceNoteIds = {
  templates: Object.fromEntries(['定义', '命题', '例子', '反例', '归类', '思想方法', '问题', '思路', '作者', '研究进展', '论文', '书作', '文献', '总结'].map(type => [type, 'fixture-template-' + type])),
};
vm.createContext(context);
vm.runInContext(
  `${knowledgeBaseSource.slice(0, knowledgeBaseEnd)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`,
  context,
);
const KBT = context.KnowledgeBaseTemplate;

function withPatchedMethods(target, replacements, callback) {
  const originals = {};
  Object.keys(replacements).forEach((key) => {
    originals[key] = target[key];
    target[key] = replacements[key];
  });
  try {
    return callback();
  } finally {
    Object.keys(replacements).forEach((key) => {
      target[key] = originals[key];
    });
  }
}

function extractPrototypeFunction(name, nextName) {
  const assignment = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = mainSource.indexOf(assignment);
  const requestedEnd = mainSource.indexOf(`\n\n  MNKnowledgeBaseClass.prototype.${nextName}`, start);
  const nextAssignment = mainSource.indexOf('\n\n  MNKnowledgeBaseClass.prototype.', start + assignment.length);
  const end = nextAssignment !== -1 && (requestedEnd === -1 || nextAssignment < requestedEnd)
    ? nextAssignment
    : requestedEnd;
  assert.ok(start !== -1 && end > start, `Cannot locate ${name} implementation`);
  return mainSource.slice(start + assignment.length, end).trim();
}

function createNote(colorIndex, parentNote = null, title = '原始标题') {
  return {
    noteId: `NOTE-${colorIndex}-${Math.random()}`,
    title,
    noteTitle: title,
    colorIndex,
    parentNote,
    childNotes: [],
    comments: [],
    MNComments: [],
    focusCount: 0,
    focusInMindMap() {
      this.focusCount += 1;
    },
  };
}

function assertColorProtocol() {
  const expected = new Map([
    [0, '归类'],
    [2, '定义'],
    [3, '反例'],
    [7, '例子'],
    [10, '命题'],
  ]);
  expected.forEach((type, colorIndex) => {
    assert.strictEqual(KBT.getNoteTypeByColor(colorIndex), type);
  });
  assert.strictEqual(KBT.getNoteTypeByColor(15), null, 'color 15 must not be treated as 例子');
}

function assertQuickReadingPolicy() {
  const ordinaryParent = createNote(10, null, '普通父卡');
  const supportedColors = new Map([
    [0, '归类'],
    [2, '定义'],
    [3, '反例'],
    [7, '例子'],
    [10, '命题'],
  ]);
  supportedColors.forEach((noteType, colorIndex) => {
    const policy = KBT.getQuickReadingMakeCardPolicy(createNote(colorIndex, ordinaryParent));
    assert.strictEqual(policy.mode, 'rough');
    assert.strictEqual(policy.noteType, noteType);
  });
  const roughDefinition = createNote(2, ordinaryParent);
  let policy;

  const unsupportedOldPurple = createNote(15, ordinaryParent);
  policy = KBT.getQuickReadingMakeCardPolicy(unsupportedOldPurple);
  assert.strictEqual(policy.mode, 'unsupported');
  assert.strictEqual(policy.noteType, null);

  const unsupportedQuestion = createNote(1, ordinaryParent);
  policy = KBT.getQuickReadingMakeCardPolicy(unsupportedQuestion);
  assert.strictEqual(policy.mode, 'unsupported', 'quick reading only supports the five confirmed types');

  const colorZeroOrdinaryParent = createNote(0, null, '粗制归类卡');
  const child = createNote(2, colorZeroOrdinaryParent);
  policy = KBT.getQuickReadingMakeCardPolicy(child);
  assert.strictEqual(policy.mode, 'rough', 'a color-0 parent without classification semantics must remain a rough card');
  assert.strictEqual(policy.directParentIsClassification, false);
  assert.strictEqual(policy.linkParentTargetFound, false);

  const classificationParent = createNote(0, null, '“拓扑空间”相关定义');
  classificationParent.noteId = 'CLASSIFICATION-A';
  const classificationChild = createNote(2, classificationParent);
  policy = KBT.getQuickReadingMakeCardPolicy(classificationChild);
  assert.strictEqual(policy.mode, 'normal', 'only a direct semantic classification parent restores normal make-card');
  assert.strictEqual(policy.directParentIsClassification, true);
  assert.strictEqual(policy.linkParentTargetFound, true);

  const definitionParent = createNote(2, null, '【定义 >> A】A');
  const classificationColorChild = createNote(0, definitionParent, '归类 B');
  policy = KBT.getQuickReadingMakeCardPolicy(classificationColorChild);
  assert.strictEqual(
    policy.mode,
    'rough',
    'a non-classification direct parent must not be replaced by a broader classification interpretation',
  );
  assert.strictEqual(policy.directParentIsClassification, false);
  assert.strictEqual(policy.noteType, '归类');
  assert.strictEqual(policy.linkParentTargetFound, false);

  const intermediateKnowledgeCard = createNote(10, classificationParent, '中间知识卡');
  const nestedKnowledgeCard = createNote(7, intermediateKnowledgeCard, '下层知识卡');
  policy = KBT.getQuickReadingMakeCardPolicy(nestedKnowledgeCard);
  assert.strictEqual(
    policy.mode,
    'rough',
    'a classification grandparent must not replace the direct-parent exception',
  );
  assert.strictEqual(policy.directParentIsClassification, false);
  assert.strictEqual(policy.linkParentTargetFound, false);

  intermediateKnowledgeCard.comments = [{
    type: 'linkComment',
    text: `marginnote4app://note/${classificationParent.noteId}`,
  }];
  intermediateKnowledgeCard.MNComments = intermediateKnowledgeCard.comments;
  policy = KBT.getQuickReadingMakeCardPolicy(nestedKnowledgeCard);
  assert.strictEqual(
    policy.mode,
    'normal',
    'a direct parent linked to the nearest classification ancestor must restore normal make-card',
  );
  assert.strictEqual(policy.directParentIsClassification, false);
  assert.strictEqual(policy.linkParentTargetFound, true);

  const markdownLinkedParent = createNote(10, classificationParent, 'Markdown 链接父卡');
  markdownLinkedParent.comments = [{
    type: 'markdownComment',
    text: `- [归类 A](marginnote4app://note/${classificationParent.noteId})`,
  }];
  markdownLinkedParent.MNComments = markdownLinkedParent.comments;
  policy = KBT.getQuickReadingMakeCardPolicy(createNote(3, markdownLinkedParent, '下层反例'));
  assert.strictEqual(policy.mode, 'normal', 'an inline MarginNote link must also prove the two-level relation');
  assert.strictEqual(policy.linkParentTargetFound, true);

  const rootClassification = createNote(0, null, '无父归类卡');
  policy = KBT.getQuickReadingMakeCardPolicy(rootClassification);
  assert.strictEqual(policy.mode, 'rough', 'a classification card without a parent must stay rough');
  assert.strictEqual(policy.linkParentTargetFound, false);

  context.KnowledgeBaseConfig.config.readingFollowMode = false;
  policy = KBT.getQuickReadingMakeCardPolicy(roughDefinition);
  assert.strictEqual(policy.mode, 'normal');
  context.KnowledgeBaseConfig.config.readingFollowMode = true;
}

function assertQuickReadingPolicyUsesDirectParentClassification() {
  const ordinaryParent = createNote(10, null, '普通父卡');
  const colorZeroOrdinaryParent = createNote(0, null, '粗制归类卡');
  const classificationParent = createNote(0, null, '“度量空间”相关定义');

  withPatchedMethods(KBT, {
    getNoteType() {
      throw new Error('quick-reading policy must not call getNoteType');
    },
    getFirstClassificationParentNoteOptimized() {
      throw new Error('quick-reading policy must not use title-based classification lookup');
    },
  }, () => {
    let policy = KBT.getQuickReadingMakeCardPolicy(createNote(10, ordinaryParent, ''));
    assert.strictEqual(policy.mode, 'rough');
    assert.strictEqual(policy.noteType, '命题');

    policy = KBT.getQuickReadingMakeCardPolicy(createNote(2, colorZeroOrdinaryParent, ''));
    assert.strictEqual(policy.mode, 'rough');
    assert.strictEqual(policy.noteType, '定义');
    assert.strictEqual(policy.linkParentTargetFound, false);

    policy = KBT.getQuickReadingMakeCardPolicy(createNote(2, classificationParent, ''));
    assert.strictEqual(policy.mode, 'normal');
    assert.strictEqual(policy.noteType, '定义');
    assert.strictEqual(policy.linkParentTargetFound, true);

    policy = KBT.getQuickReadingMakeCardPolicy(createNote(10, classificationParent, ''));
    assert.strictEqual(policy.mode, 'normal');
    assert.strictEqual(policy.noteType, '命题');

    policy = KBT.getQuickReadingMakeCardPolicy(createNote(15, classificationParent, ''));
    assert.strictEqual(policy.mode, 'unsupported');
    assert.strictEqual(policy.noteType, null);
  });
}

function assertQuickReadingNormalMakeNoteLocksColorType() {
  const classificationParent = createNote(0, null, '“度量空间”相关定义');

  new Map([
    [2, '定义'],
    [10, '命题'],
  ]).forEach((expectedType, colorIndex) => {
    const note = createNote(colorIndex, classificationParent, '普通标题');
    const calls = [];

    withPatchedMethods(KBT, {
      _beginMakeCardPerf() { return null; },
      _recordMakeCardPerf() {},
      _finishMakeCardPerf() {},
      sanitizeNoteCommentsForMake() {},
      getNoteType() {
        throw new Error('quick-reading formal make-card must keep the color-locked type');
      },
      processNote(target, lockedNoteType) {
        assert.strictEqual(target, note);
        calls.push(['process', lockedNoteType]);
        return target;
      },
      makeCard(target, addToReview, reviewEverytime, options) {
        assert.strictEqual(target, note);
        calls.push(['makeCard', options.noteType]);
        return target;
      },
    }, () => {
      assert.strictEqual(KBT.makeNote(note, true, true, false), note);
    });

    assert.deepStrictEqual(calls, [
      ['process', expectedType],
      ['makeCard', expectedType],
    ]);
  });
}

function assertQuickReadingNormalTitleUsesClassificationParent() {
  const classificationParent = createNote(0, null, '“分类 A”相关命题');
  classificationParent.noteId = 'CLASSIFICATION-TITLE-A';
  const proposition = createNote(10, classificationParent, '命题 B');
  mainIncrementalIndexCalls.length = 0;

  withPatchedMethods(KBT, {
    getNoteType() {
      throw new Error('quick-reading title construction must not infer the type from titles');
    },
    getQuestionChainContext() { return null; },
    normalizeTitleSpaces(title) { return title; },
  }, () => {
    KBT.changeTitle(proposition, false, '命题', { syncContainLinks: false });
  });

  assert.strictEqual(proposition.title, '【命题 >> 分类 A】命题 B');
  assert.strictEqual(mainIncrementalIndexCalls.length, 1);
  assert.strictEqual(mainIncrementalIndexCalls[0].options.showErrorHUD, true);

  const intermediateParent = createNote(10, classificationParent, '【命题 >> 分类 A】命题 B');
  intermediateParent.comments = [{
    type: 'linkComment',
    text: `marginnote4app://note/${classificationParent.noteId}`,
  }];
  intermediateParent.MNComments = intermediateParent.comments;
  const nestedProposition = createNote(10, intermediateParent, '命题 C');
  mainIncrementalIndexCalls.length = 0;
  withPatchedMethods(KBT, {
    getNoteType() {
      throw new Error('quick-reading generalized title construction must keep the color-locked type');
    },
    getQuestionChainContext() { return null; },
    normalizeTitleSpaces(title) { return title; },
  }, () => {
    KBT.changeTitle(nestedProposition, false, '命题', { syncContainLinks: false });
  });

  assert.strictEqual(
    nestedProposition.title,
    '【命题 >> 分类 A】命题 C',
    'a verified A-B-C relation must use classification A for the formal prefix',
  );
  assert.strictEqual(mainIncrementalIndexCalls.length, 1);

  const untypedProposition = createNote(10, null, '普通命题');
  withPatchedMethods(KBT, {
    getNoteType() { return undefined; },
  }, () => {
    assert.strictEqual(KBT.changeNoteColor(untypedProposition), true);
  });
  assert.strictEqual(untypedProposition.colorIndex, KBT.types.命题.colorIndex);
}

function assertLockedTypeFlowsThroughTemplateMerge() {
  const calls = [];
  const note = createNote(2);
  note.comments = [{ type: 'textComment', text: '待整理内容' }];
  note.MNComments = note.comments;

  withPatchedMethods(KBT, {
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
    sanitizeNoteCommentsForMake() {},
    getSafeComments(target) { return target.comments; },
    getNoteType() { return '反例'; },
    autoGetNewContentToMoveIndexArr(target, noteType) {
      calls.push(['indices', noteType]);
      return [0];
    },
    extractMarginNoteLinksFromComments() { return []; },
    mergeTemplate(target, noteType) {
      calls.push(['template', noteType]);
      return false;
    },
    getDefaultFieldForType(noteType) {
      calls.push(['field', noteType]);
      return '摘录';
    },
    moveCommentsArrToField(target, indices, field, toBottom, noteType) {
      calls.push(['move', field, indices.length, noteType]);
    },
  }, () => {
    KBT.mergeTemplateAndAutoMoveNoteContent(note, false, { noteType: '定义' });
  });

  assert.deepStrictEqual(calls, [
    ['indices', '定义'],
    ['template', '定义'],
    ['field', '定义'],
    ['move', '摘录', 1, '定义'],
  ]);

  withPatchedMethods(KBT, {
    getNoteType() {
      throw new Error('locked type must not fall back to title or ancestors');
    },
    autoGetClassificationNewContentToMoveIndexArr() {
      return [7];
    },
  }, () => {
    assert.deepStrictEqual(
      Array.from(KBT.autoGetNewContentToMoveIndexArr(note, '归类')),
      [7],
    );
  });

  let mergedTemplateId = '';
  withPatchedMethods(KBT, {
    sanitizeNoteCommentsForMake() {},
    hasHtmlCommentSafe() { return false; },
    getNoteType() {
      throw new Error('explicit merge type must not be re-inferred');
    },
    cloneAndMergeById(target, templateId) {
      mergedTemplateId = templateId;
    },
  }, () => {
    assert.strictEqual(KBT.mergeTemplate(note, '例子'), false);
  });
  assert.strictEqual(mergedTemplateId, KBT.types.例子.templateNoteId);

  let resolvedAliasType = '';
  let moved = false;
  note.comments = [{ type: 'HtmlComment', text: '证明' }];
  note.moveCommentsByIndexArr = () => {
    moved = true;
  };
  withPatchedMethods(KBT, {
    getNoteType() {
      throw new Error('explicit move type must not be re-inferred');
    },
    resolveFieldName(field, noteType) {
      resolvedAliasType = noteType;
      return field;
    },
    getHtmlCommentsTextArrForPopup() { return []; },
    getCommentsIndexArrToMoveForPopup() { return []; },
    parseNoteComments() {
      return {
        htmlCommentsTextArr: ['证明'],
        htmlCommentsObjArr: [{ index: 0 }],
      };
    },
  }, () => {
    KBT.moveCommentsArrToField(note, [0], '证明', true, '命题');
  });
  assert.strictEqual(resolvedAliasType, '命题');
  assert.strictEqual(moved, true);
}

function assertRoughAutoMoveKeepsLockedTypeAtFieldBoundary() {
  const note = createNote(10, null, '【反例 >> 旧标题】待整理命题');
  note.comments = [
    { type: 'HtmlComment', text: '证明' },
    { type: 'mergedTextComment', text: '快速阅读下方新内容' },
  ];
  note.MNComments = note.comments;
  let moveCall = null;
  note.moveCommentsByIndexArr = (indices, targetIndex) => {
    moveCall = { indices: Array.from(indices), targetIndex };
  };

  withPatchedMethods(KBT, {
    sanitizeNoteCommentsForMake() {},
    getNoteType() { return '反例'; },
    getDefaultFieldForType(noteType) {
      assert.strictEqual(noteType, '命题');
      return '证明';
    },
    autoGetNewContentToMoveIndexArr(target, noteType) {
      assert.strictEqual(target, note);
      assert.strictEqual(noteType, '命题');
      return [1];
    },
    extractMarginNoteLinksFromComments() { return []; },
    getHtmlCommentsTextArrForPopup() { return []; },
    getCommentsIndexArrToMoveForPopup() { return []; },
  }, () => {
    KBT.autoMoveNewContent(note, '命题');
  });

  assert.deepStrictEqual(
    moveCall,
    { indices: [1], targetIndex: 2 },
    'rough make-card must use the locked proposition type when resolving the proof field',
  );
}

function assertSingleDrawingMovesIntoLockedDefaultField() {
  [
    'drawingComment',
    'imageCommentWithDrawing',
    'mergedImageCommentWithDrawing',
  ].forEach((commentType) => {
    const note = createNote(10);
    note.comments = [{ type: commentType, text: '手写内容' }];
    note.MNComments = note.comments;
    const moveCalls = [];

    withPatchedMethods(KBT, {
      _beginMakeCardPerf() { return null; },
      _recordMakeCardPerf() {},
      _finishMakeCardPerf() {},
      sanitizeNoteCommentsForMake() {},
      getSafeComments(target) { return target.comments; },
      getNoteType() {
        throw new Error('single drawing rough make-card must keep the locked color type');
      },
      autoGetNewContentToMoveIndexArr() {
        throw new Error('single drawing must not be discarded by generic merged-image filtering');
      },
      extractMarginNoteLinksFromComments() { return []; },
      mergeTemplate() { return false; },
      getDefaultFieldForType(noteType) {
        assert.strictEqual(noteType, '命题');
        return '证明';
      },
      moveCommentsArrToField(target, indices, field, toBottom, noteType) {
        moveCalls.push({ target, indices, field, toBottom, noteType });
      },
      normalizeFieldName(field) { return field; },
    }, () => {
      KBT.mergeTemplateAndAutoMoveNoteContent(note, false, { noteType: '命题' });
    });

    assert.strictEqual(moveCalls.length, 1, `${commentType} must be moved exactly once`);
    assert.strictEqual(moveCalls[0].target, note);
    assert.deepStrictEqual(Array.from(moveCalls[0].indices), [0]);
    assert.strictEqual(moveCalls[0].field, '证明');
    assert.strictEqual(moveCalls[0].toBottom, true);
    assert.strictEqual(moveCalls[0].noteType, '命题');
  });
}

function assertRoughExecutorHasNoFormalMakeCardSideEffects() {
  const parent = createNote(10, null, '普通父卡');
  const note = createNote(3, parent, '绝不能改写的标题');
  const originalColor = note.colorIndex;
  const originalTitle = note.title;
  const calls = [];
  mainIncrementalIndexNotes.length = 0;
  intermediateIncrementalIndexCalls.length = 0;

  withPatchedMethods(KBT, {
    sanitizeNoteCommentsForMake() {
      calls.push('sanitize');
    },
    mergeTemplateAndAutoMoveNoteContent(target, directly, options) {
      calls.push(`merge:${options.noteType}`);
      target.title = '模板不应覆盖标题';
      target.noteTitle = '模板不应覆盖标题';
      target.colorIndex = 10;
    },
    autoMoveNewContent(target, noteType) {
      assert.strictEqual(target, note);
      calls.push(`autoMove:${noteType}`);
    },
    refreshNotes() {
      calls.push('refresh');
    },
    changeTitle() {
      throw new Error('rough make-card must not change the title');
    },
    changeNoteColor() {
      throw new Error('rough make-card must not change the color');
    },
    linkParentNote() {
      throw new Error('rough make-card must not link a parent');
    },
    addToReview() {
      throw new Error('rough make-card must not add to review');
    },
  }, () => {
    assert.strictEqual(KBT.makeQuickReadingRoughCard(note, '反例'), note);
  });

  assert.deepStrictEqual(calls, ['sanitize', 'merge:反例', 'autoMove:反例', 'refresh']);
  assert.strictEqual(note.title, originalTitle);
  assert.strictEqual(note.noteTitle, originalTitle);
  assert.strictEqual(note.colorIndex, originalColor);
  assert.deepStrictEqual(mainIncrementalIndexNotes, [], 'rough make-card must not write into the main knowledge index');
  assert.strictEqual(intermediateIncrementalIndexCalls.length, 1);
  assert.strictEqual(intermediateIncrementalIndexCalls[0].note, note);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(intermediateIncrementalIndexCalls[0].options)),
    { staleIds: [], showErrorHUD: true },
  );
}

function assertDefinitionRoughCardSilencesEmptyIndexBuild() {
  const parent = createNote(10, null, '普通父卡');
  const note = createNote(2, parent, '');
  note.excerptText = '';
  mainIncrementalIndexNotes.length = 0;
  intermediateIncrementalIndexCalls.length = 0;

  withPatchedMethods(KBT, {
    sanitizeNoteCommentsForMake() {},
    mergeTemplateAndAutoMoveNoteContent() {},
    refreshNotes() {},
  }, () => {
    assert.strictEqual(KBT.makeQuickReadingRoughCard(note, '定义'), note);
  });

  assert.deepStrictEqual(mainIncrementalIndexNotes, []);
  assert.strictEqual(intermediateIncrementalIndexCalls.length, 1);
  assert.strictEqual(intermediateIncrementalIndexCalls[0].note, note);
  assert.strictEqual(
    intermediateIncrementalIndexCalls[0].options.showErrorHUD,
    false,
    'definition rough cards still update the process index but silence the expected empty entry',
  );
}

function assertConvertedDefinitionIntermediateIndexFailureIsSilent() {
  const functionSource = extractPrototypeFunction(
    'syncConvertedIntermediateIndexIfNeeded',
    'getDirectOCRTagCommentIndexes',
  );
  const calls = [];
  const syncConvertedIntermediateIndexIfNeeded = vm.runInNewContext(`(${functionSource})`, {
    String,
    IntermediateKnowledgeIndexer: {
      addToIncrementalIndex(note, options) {
        calls.push({ note, options });
      },
    },
    KnowledgeBaseTemplate: {
      shouldSuppressQuickReadingDefinitionIndexHUD(note) {
        return Number(note && note.colorIndex) === 2;
      },
    },
  });
  const originalNote = { noteId: 'EXCERPT-SOURCE' };
  const processedNote = { noteId: 'PROCESSED-DEFINITION', colorIndex: 2 };

  syncConvertedIntermediateIndexIfNeeded.call({}, originalNote, processedNote);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].note, processedNote);
  assert.deepStrictEqual(Array.from(calls[0].options.staleIds), ['EXCERPT-SOURCE']);
  assert.strictEqual(
    calls[0].options.showErrorHUD,
    false,
    'quick-reading definition excerpt conversion must not show an expected empty-index HUD',
  );
}

function assertQuickReadingDefinitionTitleIndexFailureIsSilent() {
  const note = createNote(2, null, '待补父链接的定义');
  mainIncrementalIndexNotes.length = 0;
  mainIncrementalIndexCalls.length = 0;

  withPatchedMethods(KBT, {
    getNoteType() { return '定义'; },
    getQuestionChainContext() { return null; },
    getFirstClassificationParentNote() { return null; },
    normalizeTitleSpaces(title) { return title; },
  }, () => {
    KBT.changeTitle(note);
  });

  assert.strictEqual(mainIncrementalIndexCalls.length, 1);
  assert.strictEqual(mainIncrementalIndexCalls[0].note, note);
  assert.strictEqual(mainIncrementalIndexCalls[0].mode, undefined);
  assert.strictEqual(
    mainIncrementalIndexCalls[0].options.showErrorHUD,
    false,
    'quick-reading color 2 normal make-card must silence an expected empty index entry',
  );

  context.KnowledgeBaseConfig.config.readingFollowMode = false;
  mainIncrementalIndexCalls.length = 0;
  withPatchedMethods(KBT, {
    getNoteType() { return '定义'; },
    getQuestionChainContext() { return null; },
    getFirstClassificationParentNote() { return null; },
    normalizeTitleSpaces(title) { return title; },
  }, () => {
    KBT.changeTitle(note);
  });
  assert.strictEqual(mainIncrementalIndexCalls[0].options.showErrorHUD, true);
  context.KnowledgeBaseConfig.config.readingFollowMode = true;
}

function assertMainIndexerHonorsSilentEmptyEntryOption() {
  const indexerStart = knowledgeBaseSource.indexOf('\nclass KnowledgeBaseIndexer');
  const indexerEnd = knowledgeBaseSource.indexOf('\nclass IntermediateKnowledgeIndexer', indexerStart);
  assert.ok(indexerStart !== -1 && indexerEnd > indexerStart, 'Cannot locate main indexer implementation');

  const indexHudMessages = [];
  const indexContext = {
    console,
    Date,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    kbSearchConfig: {
      typePresets: {},
      synonymGroups: [],
      exclusionGroups: [],
    },
    KnowledgeBaseConfig: {
      getSearchIndexMode() { return 'light'; },
    },
    KnowledgeBaseTemplate: {
      _beginMakeCardPerf() { return null; },
      _makeCardPerfNow() { return Date.now(); },
      _recordMakeCardPerf() {},
      _finishMakeCardPerf() {},
    },
    KnowledgeBaseUtils: {
      emitRuntimeLog() {},
    },
    MNUtil: {
      showHUD(message) { indexHudMessages.push(String(message)); },
    },
    MNLog: {
      error(error) { throw error; },
    },
  };
  indexContext.global = indexContext;
  indexContext.globalThis = indexContext;
  vm.createContext(indexContext);
  vm.runInContext(
    `${knowledgeBaseSource.slice(indexerStart, indexerEnd)}\nthis.MainIndexer = KnowledgeBaseIndexer;`,
    indexContext,
  );
  const Indexer = indexContext.MainIndexer;
  Indexer.loadIncrementalIndex = () => null;
  Indexer.saveIncrementalIndex = () => true;
  Indexer.getStaleIndexIdsForNote = () => [];
  Indexer.updateIncrementalRemovedIds = () => {};
  Indexer.buildIndexEntry = () => null;

  const note = createNote(2);
  let result = Indexer.upsertIncrementalIndexEntry(note, undefined, { showErrorHUD: false });
  assert.strictEqual(result.success, false);
  assert.deepStrictEqual(indexHudMessages, []);

  result = Indexer.upsertIncrementalIndexEntry(note);
  assert.strictEqual(result.success, false);
  assert.deepStrictEqual(indexHudMessages, ['无法为该卡片构建索引条目']);
}

function assertMakeCardEntryRouting() {
  const commonPerfStubs = {
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
  };
  const ordinaryParent = createNote(10, null, '普通父卡');
  const roughNote = createNote(2, ordinaryParent);
  const calls = [];

  withPatchedMethods(KBT, {
    ...commonPerfStubs,
    makeQuickReadingRoughCard(target, noteType) {
      calls.push(`rough:${noteType}`);
      return target;
    },
    sanitizeNoteCommentsForMake() { calls.push('sanitize'); },
    renewNote() { calls.push('renew'); },
    mergeTemplateAndAutoMoveNoteContent() { calls.push('normalMerge'); },
    templateMergedCardMake() { calls.push('formalize'); },
    addToReview() { calls.push('review'); },
  }, () => {
    KBT.makeCard(roughNote, true, true);
  });
  assert.deepStrictEqual(calls, ['rough:定义']);

  calls.length = 0;
  hudMessages.length = 0;
  withPatchedMethods(KBT, {
    ...commonPerfStubs,
    makeQuickReadingRoughCard() { calls.push('rough'); },
    sanitizeNoteCommentsForMake() { calls.push('sanitize'); },
    renewNote() { calls.push('renew'); },
  }, () => {
    KBT.makeCard(createNote(15, ordinaryParent), true, true);
  });
  assert.deepStrictEqual(calls, []);
  assert.ok(hudMessages.some(message => message.includes('颜色 15')));

  calls.length = 0;
  const classificationParent = createNote(0, null, '“度量空间”相关定义');
  withPatchedMethods(KBT, {
    ...commonPerfStubs,
    makeQuickReadingRoughCard() { calls.push('rough'); },
    sanitizeNoteCommentsForMake() { calls.push('sanitize'); },
    renewNote() { calls.push('renew'); },
    mergeTemplateAndAutoMoveNoteContent() { calls.push('normalMerge'); },
    templateMergedCardMake() { calls.push('formalize'); },
    addToReview() { calls.push('review'); },
  }, () => {
    KBT.makeCard(createNote(2, classificationParent), true, true);
  });
  assert.deepStrictEqual(calls, ['sanitize', 'renew', 'normalMerge', 'formalize', 'review']);

  calls.length = 0;
  const definitionParent = createNote(2, null, '【定义 >> A】A');
  const rawClassification = createNote(0, definitionParent, '归类 B');
  withPatchedMethods(KBT, {
    ...commonPerfStubs,
    convertNoteToClassificationNote(target, directly, linkParent, preprocess, options) {
      assert.strictEqual(target, rawClassification);
      assert.strictEqual(directly, true);
      assert.strictEqual(linkParent, true);
      assert.strictEqual(preprocess, true);
      assert.strictEqual(options.usePopupDefaultTitle, undefined);
      calls.push('classification');
      return target;
    },
  }, () => {
    assert.strictEqual(
      KBT.makeCard(rawClassification, true, true),
      rawClassification,
    );
  });
  assert.deepStrictEqual(
    calls,
    ['classification'],
    'quick-reading must not downgrade color 0 to a rough card',
  );
}

function assertColorZeroClassificationConversion() {
  const calls = [];
  const previousReadingFollowMode = context.KnowledgeBaseConfig.config.readingFollowMode;
  context.KnowledgeBaseConfig.config.readingFollowMode = false;
  const parent = createNote(10, null, '【命题 >> A】A');
  parent.addChild = (note) => calls.push(`addChild:${note.noteId}`);
  const source = createNote(0, parent, '归类 B');
  source.indexInBrotherNotes = 2;
  source.mergeInto = (target) => calls.push(`merge:${target.noteId}`);
  const converted = createNote(0, parent, '');
  converted.noteId = 'CLASSIFICATION-RESULT';
  converted.moveTo = (index) => calls.push(`moveTo:${index}`);

  const previousMNNote = context.MNNote;
  const previousUndoGrouping = context.MNUtil.undoGrouping;
  context.MNNote = {
    clone(templateNoteId) {
      calls.push(`clone:${templateNoteId}`);
      return converted;
    },
  };
  context.MNUtil.undoGrouping = () => {
    throw new Error('undoGrouping: false must reuse the toolbar transaction');
  };
  mainIncrementalIndexNotes.length = 0;

  try {
    withPatchedMethods(KBT, {
      toNoExcerptVersion(target) {
        calls.push('toNoExcerpt');
        return target;
      },
      normalizeTitleSpaces(value) { return String(value || ''); },
      getTypeFromInputText() { return null; },
      parseNoteTitle(target) {
        assert.strictEqual(target, parent);
        return { type: '命题' };
      },
      getDefaultClassificationTitleContent(target, title) {
        assert.strictEqual(target, source);
        return `A｜${title}`;
      },
      _hasClassificationTemplate(target) {
        return target === converted;
      },
      autoMoveNewContentToField(target, field) {
        assert.strictEqual(target, converted);
        calls.push(`field:${field}`);
      },
      changeNoteColor(target, type) {
        assert.strictEqual(target, converted);
        calls.push(`color:${type}`);
      },
      linkParentNote(target) {
        assert.strictEqual(target, converted);
        calls.push('linkParent');
      },
    }, () => {
      assert.strictEqual(
        KBT.makeNote(source, true, true, true, { undoGrouping: false }),
        converted,
      );
      assert.strictEqual(
        KBT.makeNote(converted, true, true, true, { undoGrouping: false }),
        converted,
        'repeated make must return the same formal classification note',
      );
      const staleSource = createNote(0, parent, '');
      staleSource.groupNote = converted;
      assert.strictEqual(
        KBT.convertNoteToClassificationNote(staleSource, true, true, true, { undoGrouping: false }),
        converted,
        'a stale merged source must resolve to the existing classification target',
      );
    });
  } finally {
    context.MNNote = previousMNNote;
    context.MNUtil.undoGrouping = previousUndoGrouping;
    context.KnowledgeBaseConfig.config.readingFollowMode = previousReadingFollowMode;
  }

  assert.deepStrictEqual(calls, [
    'toNoExcerpt',
    `clone:${KBT.types.归类.templateNoteId}`,
    'addChild:CLASSIFICATION-RESULT',
    'moveTo:3',
    'merge:CLASSIFICATION-RESULT',
    'field:摘录',
    'color:归类',
    'linkParent',
    'linkParent',
    'linkParent',
  ]);
  assert.strictEqual(converted.title, '“归类 B”相关命题');
  assert.strictEqual(converted.focusCount, 2);
  assert.strictEqual(context.MNUtil._undoGroupingDepth, 0);
  assert.deepStrictEqual(mainIncrementalIndexNotes, [converted]);
}

function assertClassificationConversionUsesParentColorFallback() {
  const parent = createNote(2, null, '相位协变集体作用的基本性质');
  const source = createNote(0, parent, '相位协变集体作用的基本性质');
  const originalParent = parent;
  const conversion = withPatchedMethods(KBT, {
    getTypeFromInputText() { return null; },
    parseNoteTitle(target) {
      assert.strictEqual(target, originalParent);
      return {};
    },
    normalizeTitleSpaces(value) { return String(value || ''); },
    toNoExcerptVersion(target) {
      assert.strictEqual(target, source);
      return target;
    },
  }, () => KBT._prepareClassificationConversion(source));

  assert.ok(conversion, 'a parent without a title prefix should still produce a conversion plan');
  assert.strictEqual(conversion.type, '命题');
  assert.ok(!conversion.titleContent.includes('undefined'));
}

function assertInvalidClassificationConversionDoesNotPreprocess() {
  const untypedParent = createNote(0, null, '普通父卡');
  const invalidNotes = [
    createNote(0, null, '无父卡'),
    createNote(0, untypedParent, ''),
  ];
  let preprocessCount = 0;
  withPatchedMethods(KBT, {
    toNoExcerptVersion() {
      preprocessCount += 1;
      throw new Error('invalid classification input must not mutate excerpt structure');
    },
    getTypeFromInputText() { return null; },
    parseNoteTitle() { return {}; },
  }, () => {
    invalidNotes.forEach(note => {
      assert.strictEqual(KBT.convertNoteToClassificationNote(note), undefined);
    });
  });
  assert.strictEqual(preprocessCount, 0);
}

async function assertPopupClassificationConversionBuildsDownwardChain() {
  assert.deepStrictEqual(
    Array.from(KBT.buildDownwardClassificationTitles('A // B//C')),
    ['A', 'A B', 'A BC'],
    'popup // input must use the existing downward sequential accumulation order',
  );

  const conversion = { type: '命题' };
  const convertedRoot = createNote(0, null, 'converted root');
  convertedRoot.noteId = 'CONVERTED-ROOT';
  const createdChildren = [];
  const chainResult = {};
  const previousCopy = context.MNUtil.copy;
  const previousUserInput = context.MNUtil.userInput;
  const previousUndoGrouping = context.MNUtil.undoGrouping;
  const originalMethods = {
    _resolveClassificationConversionTarget: KBT._resolveClassificationConversionTarget,
    isClassificationNote: KBT.isClassificationNote,
    _hasClassificationTemplate: KBT._hasClassificationTemplate,
    _prepareClassificationConversion: KBT._prepareClassificationConversion,
    _finishClassificationConversion: KBT._finishClassificationConversion,
    getTypeFromInputText: KBT.getTypeFromInputText,
    createClassificationNoteAsChildNote: KBT.createClassificationNoteAsChildNote,
  };
  context.MNUtil.copy = () => {};
  context.MNUtil.userInput = async () => ({ button: 1, input: 'A//B//C' });
  context.MNUtil.undoGrouping = (block) => block();
  KBT._resolveClassificationConversionTarget = target => target;
  KBT.isClassificationNote = () => false;
  KBT._hasClassificationTemplate = () => false;
  KBT._prepareClassificationConversion = () => conversion;
  KBT._finishClassificationConversion = (plan, title, linkParent, options) => {
    assert.strictEqual(plan, conversion);
    assert.strictEqual(title, 'A');
    assert.strictEqual(linkParent, true);
    assert.strictEqual(options.undoGrouping, false);
    return convertedRoot;
  };
  KBT.getTypeFromInputText = title => title === 'AB' ? '例子' : null;
  KBT.createClassificationNoteAsChildNote = (parent, title, type, linkParent) => {
    const child = createNote(0, parent, title);
    child.noteId = `CHILD-${createdChildren.length + 1}`;
    createdChildren.push({ parent, title, type, linkParent, child });
    return child;
  };
  mainIncrementalIndexNotes.length = 0;

  try {
    const lastNote = await KBT.convertNoteToClassificationNote(
      createNote(0),
      false,
      true,
      true,
      { classificationChainResult: chainResult },
    );
    assert.strictEqual(lastNote.noteId, 'CHILD-2');
    assert.deepStrictEqual(
      createdChildren.map(item => [item.parent.noteId, item.title, item.type, item.linkParent]),
      [
        ['CONVERTED-ROOT', 'AB', '例子', true],
        ['CHILD-1', 'ABC', '命题', true],
      ],
    );
    assert.deepStrictEqual(
      Array.from(chainResult.createdNotes).map(note => note.noteId),
      ['CONVERTED-ROOT', 'CHILD-1', 'CHILD-2'],
    );
    assert.strictEqual(chainResult.convertedNote, convertedRoot);
    assert.strictEqual(chainResult.lastNote, lastNote);
    assert.deepStrictEqual(mainIncrementalIndexNotes.map(note => note.noteId), ['CHILD-1', 'CHILD-2']);
  } finally {
    context.MNUtil.copy = previousCopy;
    context.MNUtil.userInput = previousUserInput;
    context.MNUtil.undoGrouping = previousUndoGrouping;
    Object.keys(originalMethods).forEach(key => { KBT[key] = originalMethods[key]; });
  }
}

function assertMakeNoteEntryRouting() {
  const parent = createNote(10, null, '普通父卡');
  const sourceNote = createNote(7, parent);
  const processedNote = createNote(7, parent);
  const calls = [];

  withPatchedMethods(KBT, {
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
    sanitizeNoteCommentsForMake() { calls.push('sanitize'); },
    toNoExcerptVersion(target) {
      calls.push('convert');
      assert.strictEqual(target, sourceNote);
      return processedNote;
    },
    makeQuickReadingRoughCard(target, noteType) {
      calls.push(`rough:${noteType}`);
      assert.strictEqual(target, processedNote);
      return target;
    },
    processNote() {
      throw new Error('rough make-note must bypass processNote');
    },
    makeCard() {
      throw new Error('rough make-note must bypass formal makeCard');
    },
  }, () => {
    assert.strictEqual(KBT.makeNote(sourceNote, true, true, true), processedNote);
  });

  assert.deepStrictEqual(calls, ['convert', 'rough:例子']);
  assert.strictEqual(processedNote.focusCount, 1);

  calls.length = 0;
  hudMessages.length = 0;
  withPatchedMethods(KBT, {
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
    sanitizeNoteCommentsForMake() { calls.push('sanitize'); },
    toNoExcerptVersion() { calls.push('convert'); },
    makeQuickReadingRoughCard() { calls.push('rough'); },
  }, () => {
    KBT.makeNote(createNote(15, parent), true, true, true);
  });
  assert.deepStrictEqual(calls, []);
  assert.ok(hudMessages.some(message => message.includes('颜色 15')));

  calls.length = 0;
  const rawClassification = createNote(0, parent, '归类 B');
  withPatchedMethods(KBT, {
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
    convertNoteToClassificationNote(target, directly, linkParent, preprocess, options) {
      assert.strictEqual(target, rawClassification);
      assert.strictEqual(directly, true);
      assert.strictEqual(linkParent, true);
      assert.strictEqual(preprocess, true);
      assert.strictEqual(options.usePopupDefaultTitle, undefined);
      calls.push('convertClassification');
      return target;
    },
    addToReview() { throw new Error('classification cards must never enter review'); },
  }, () => {
    assert.strictEqual(
      KBT.makeNote(rawClassification, true, true, true),
      rawClassification,
    );
  });
  assert.deepStrictEqual(calls, ['convertClassification']);

  const formalClassification = createNote(0, parent, '“B”相关命题');
  calls.length = 0;
  withPatchedMethods(KBT, {
    _beginMakeCardPerf() { return null; },
    _recordMakeCardPerf() {},
    _finishMakeCardPerf() {},
    convertNoteToClassificationNote(target) {
      assert.strictEqual(target, formalClassification);
      calls.push('maintainClassification');
      return target;
    },
    addToReview() { throw new Error('formal classification cards must never enter review'); },
  }, () => {
    assert.strictEqual(KBT.makeNote(formalClassification, true, true, true), formalClassification);
  });
  assert.deepStrictEqual(calls, ['maintainClassification']);
}

function assertToolbarSkipsRoughParentLinkSync() {
  const start = toolbarSource.indexOf('  function _xdyy_syncBottomUpInlineLinksWithParent');
  const end = toolbarSource.indexOf('\n  function _xdyy_makeCurrentNoteAsBottomUpType', start);
  assert.notStrictEqual(start, -1, 'Cannot locate toolbar bottom-up sync helper');
  assert.notStrictEqual(end, -1, 'Cannot locate toolbar bottom-up sync helper end');

  let getTypeCalls = 0;
  let linkCalls = 0;
  const toolbarContext = {
    KnowledgeBaseTemplate: {
      getQuickReadingMakeCardPolicy() {
        return { mode: 'rough' };
      },
      getNoteType(note) {
        getTypeCalls += 1;
        return note.type;
      },
    },
    _xdyy_normalizeMNNoteSafe(note) {
      return note;
    },
    _xdyy_linkBottomUpTypeNoteToParent() {
      linkCalls += 1;
    },
  };
  vm.createContext(toolbarContext);
  vm.runInContext(
    `${toolbarSource.slice(start, end)}\nthis.syncBottomUp = _xdyy_syncBottomUpInlineLinksWithParent;`,
    toolbarContext,
  );

  const parent = { type: '命题' };
  const note = { type: '定义', parentNote: parent };
  assert.strictEqual(toolbarContext.syncBottomUp(note), false);
  assert.strictEqual(getTypeCalls, 0, 'rough mode must be checked before title/ancestor type inference');
  assert.strictEqual(linkCalls, 0);

  toolbarContext.KnowledgeBaseTemplate.getQuickReadingMakeCardPolicy = () => ({ mode: 'unsupported' });
  assert.strictEqual(toolbarContext.syncBottomUp(note), false);
  assert.strictEqual(getTypeCalls, 0);

  toolbarContext.KnowledgeBaseTemplate.getQuickReadingMakeCardPolicy = () => ({ mode: 'normal' });
  assert.strictEqual(toolbarContext.syncBottomUp(note), true);
  assert.strictEqual(linkCalls, 1);
}

function assertToolbarSkipsRoughProofLinkPostProcessing() {
  const start = toolbarSource.indexOf('  function _xdyy_ensureProofApplicationLinksAfterMakeNote');
  const end = toolbarSource.indexOf('\n  function _xdyy_makeNoteWithPreProcessSafety', start);
  assert.notStrictEqual(start, -1, 'Cannot locate toolbar proof-link post-processing helper');
  assert.ok(end > start, 'Cannot locate toolbar proof-link post-processing helper end');

  let linkCalls = 0;
  const toolbarContext = {
    _xdyy_isNSNullLikeSafe() { return false; },
    KnowledgeBaseTemplate: {
      getQuickReadingMakeCardPolicy() { return { mode: 'rough' }; },
      ensureProofLinkedNotesApplicationLinks() { linkCalls += 1; },
    },
  };
  vm.createContext(toolbarContext);
  vm.runInContext(
    `${toolbarSource.slice(start, end)}\nthis.ensureProofLinks = _xdyy_ensureProofApplicationLinksAfterMakeNote;`,
    toolbarContext,
  );

  const note = { noteId: 'ROUGH-NOTE' };
  toolbarContext.ensureProofLinks(note);
  assert.strictEqual(linkCalls, 0, 'rough make-card must not add proof/application links after the core pipeline');

  toolbarContext.KnowledgeBaseTemplate.getQuickReadingMakeCardPolicy = () => ({ mode: 'normal' });
  toolbarContext.ensureProofLinks(note);
  assert.strictEqual(linkCalls, 1, 'formal make-card keeps the existing proof/application link maintenance');
}

function assertToolbarDelegatesQuickReadingBeforeLegacyPreProcessPath() {
  const start = toolbarSource.indexOf('  function _xdyy_shouldUsePreProcessSafePath');
  const end = toolbarSource.indexOf('\n  function _xdyy_syncKnowledgeBaseIncrementalIndex', start);
  assert.notStrictEqual(start, -1, 'Cannot locate toolbar pre-process compatibility helper');
  assert.ok(end > start, 'Cannot locate toolbar pre-process compatibility helper end');

  const toolbarContext = {
    KnowledgeBaseConfig: {
      config: {
        readingFollowMode: true,
        preProcessMode: true,
      },
    },
    KnowledgeBaseTemplate: {
      parseNoteComments() {
        return {
          htmlCommentsTextArr: ['证明', '所属', '相关链接'],
        };
      },
    },
    _xdyy_cleanupInvalidCommentsBeforeMakeNote() {},
    _xdyy_getCommentsArraySafe() {
      return [
        { type: 'HtmlComment', text: '证明' },
        { type: 'HtmlComment', text: '所属' },
        { type: 'HtmlComment', text: '相关链接' },
      ];
    },
    _xdyy_hasUnsafeComments() { return false; },
    _xdyy_getCommentTypeSafe(comment) { return comment.type; },
    _xdyy_normalizeFieldTextForLegacyCheck(text) {
      return String(text || '').replace(/[：:\s]/g, '');
    },
  };
  vm.createContext(toolbarContext);
  vm.runInContext(
    `${toolbarSource.slice(start, end)}\nthis.shouldUsePreProcessSafePath = _xdyy_shouldUsePreProcessSafePath;`,
    toolbarContext,
  );

  const note = { noteId: 'NOTE', MNComments: [] };
  assert.strictEqual(
    toolbarContext.shouldUsePreProcessSafePath(note),
    false,
    'quick reading must delegate to KnowledgeBaseTemplate.makeNote before the legacy pre-process path',
  );

  toolbarContext.KnowledgeBaseConfig.config.readingFollowMode = false;
  assert.strictEqual(
    toolbarContext.shouldUsePreProcessSafePath(note),
    true,
    'the legacy pre-process compatibility path must remain available outside quick reading',
  );
}

function assertToolbarUsesConvertedClassificationNote() {
  assert.match(
    toolbarSource,
    /const processedNote = KnowledgeBaseTemplate\.makeNote\(note, true, true, true, \{[\s\S]*?undoGrouping:\s*false,[\s\S]*?deferFinalIndexSync:\s*true,[\s\S]*?\}\);/,
    'toolbar make-card must retain the classification note returned by makeNote',
  );
  assert.match(
    toolbarSource,
    /_xdyy_syncBottomUpInlineLinksWithParent\(processedNote\)/,
    'toolbar post-processing must target the converted classification note',
  );
  assert.match(
    toolbarSource,
    /_xdyy_ensureProofApplicationLinksAfterMakeNote\(processedNote\)/,
    'toolbar related-link post-processing must not target the consumed source excerpt',
  );
  assert.match(
    toolbarSource,
    /const processedNote = KnowledgeBaseTemplate\.makeCard\(targetNote, false\) \|\| targetNote;[\s\S]*?refreshedNotes\.push\(processedNote\)/,
    'double-click make-card must refresh the returned classification target',
  );
  assert.match(
    toolbarSource,
    /const processedNote = KnowledgeBaseTemplate\.makeNote\([\s\S]*?childNote,[\s\S]*?\{ undoGrouping: false \},[\s\S]*?\);[\s\S]*?madeNotes\.push\(processedNote\)/,
    'batch child make-card must collect the returned classification target',
  );
}

function assertUserVisibleModeName() {
  assert.doesNotMatch(mainSource, /阅读跟随最后一张卡片/);
  assert.match(mainSource, /快速阅读/);
  const quickReadingIndex = mainSource.indexOf("this.indentedTableItem('📖 快速阅读'");
  const ocrIndex = mainSource.indexOf("this.indentedTableItem('❌ 关闭摘录 OCR'");
  assert.ok(quickReadingIndex !== -1 && quickReadingIndex < ocrIndex, 'quick reading must be the first common automation mode');
}

async function assertQuickReadingProcessesExcerptsOnly() {
  const processSource = extractPrototypeFunction('processReadingModeNote', 'tableItem');
  assert.match(
    processSource,
    /const source = String\(options\.source \|\| ''\)\.trim\(\)[\s\S]*?if \(source !== 'excerpt'\)/,
    'quick-reading processing must be gated by the excerpt source',
  );
  const processReadingModeNote = vm.runInNewContext(`(${processSource})`, {
    String,
    KnowledgeBaseConfig: { config: { readingAutoClassifyMode: false, readingFollowMode: true } },
    KnowledgeBaseUtils: { addErrorLog(error) { throw error; } },
  });
  const calls = [];
  const processor = {
    processReadingAutoClassifyNote() { calls.push('classify'); },
    processReadingFollowNote() { calls.push('follow'); },
  };

  await processReadingModeNote.call(processor, { noteId: 'MANUAL-CARD' }, { source: 'mindmap' });
  assert.deepStrictEqual(calls, [], 'manual mind-map cards must not enter quick-reading processing');

  await processReadingModeNote.call(processor, { noteId: 'EXCERPT-CARD' }, { source: 'excerpt' });
  assert.deepStrictEqual(calls, ['follow'], 'document excerpts must retain quick-reading processing');
}

function assertQuickReadingHighlightsAddonIcon() {
  assert.match(
    mainSource,
    /checked:\s*Number\(KnowledgeBaseConfig\.config\.excerptOCRMode\) > 0\s*\|\|\s*!!KnowledgeBaseConfig\.config\.readingFollowMode/,
    'the addon icon must stay highlighted while either direct OCR or quick reading is enabled',
  );

  const toggleStart = mainSource.indexOf('MNKnowledgeBaseClass.prototype.toggleReadingFollowMode = function()');
  const toggleEnd = mainSource.indexOf('MNKnowledgeBaseClass.prototype.demoModeToggledInternal', toggleStart);
  assert.ok(toggleStart !== -1 && toggleEnd > toggleStart, 'quick-reading toggle implementation must be present');
  const toggleSource = mainSource.slice(toggleStart, toggleEnd);
  assert.strictEqual(
    (toggleSource.match(/this\.refreshAddonCommandStatus\(\)/g) || []).length,
    2,
    'enabling and disabling quick reading must immediately refresh the addon icon',
  );
}

function assertQuickReadingAcceptsUntitledTargetCard() {
  const popupStart = mainSource.indexOf('onPopupMenuOnNote: async function (sender) {');
  const popupEnd = mainSource.indexOf('\n    /**\n     * 处理来自其他插件的通信消息', popupStart);
  assert.ok(popupStart !== -1 && popupEnd > popupStart, 'PopupMenuOnNote handler must be present');
  const popupSource = mainSource.slice(popupStart, popupEnd);
  const followStart = popupSource.indexOf('if (selectedNoteId && KnowledgeBaseConfig.config.readingFollowMode)');
  assert.notStrictEqual(followStart, -1, 'quick reading target update block must be present');
  const followSource = popupSource.slice(followStart);
  assert.match(
    followSource,
    /selectedNote && selectedNote\.noteTitle[\s\S]*?commitReadingFollowTarget\.call\(self, selectedNoteId, 'popup-titled'\)/,
    'titled targets must retain the original immediate single-target path',
  );
  assert.match(
    followSource,
    /else if \(selectedNote\)[\s\S]*?scheduleUntitledReadingFollowTarget\.call\(self, selectedNoteId\)/,
    'untitled targets must use delayed confirmation instead of weakening the original titled-target guard',
  );
  assert.ok(
    popupSource.indexOf('commitReadingFollowTarget.call(self, selectedNoteId') >
      popupSource.indexOf('await MNKnowledgeBaseClass.prototype.refreshOpenQuestionResearchWorkbenchForNote'),
    'the original target update ordering after panel refreshes must be preserved',
  );

  const excerptStart = mainSource.indexOf('onProcessNewExcerpt: async function (sender) {');
  const excerptEnd = mainSource.indexOf('\n    queryAddonCommandStatus:', excerptStart);
  assert.ok(excerptStart !== -1 && excerptEnd > excerptStart, 'ProcessNewExcerpt handler must be present');
  const excerptSource = mainSource.slice(excerptStart, excerptEnd);
  assert.match(
    excerptSource,
    /markReadingFollowSource\.call\(self, noteId\)[\s\S]*?await self\.processReadingModeNote/,
    'new excerpts must be marked before follow-mode processing can accept popup target updates',
  );

  const commitSource = extractPrototypeFunction('commitReadingFollowTarget', 'scheduleUntitledReadingFollowTarget');
  assert.match(
    commitSource,
    /getReadingFollowRecentSourceMatch\(targetNoteId\)[\s\S]*?String\(reason\)\.startsWith\('popup-'\)[\s\S]*?recentSourceMatch\.match[\s\S]*?return false/,
    'titled popup targets must reject a just-created excerpt by raw or realGroup identity',
  );
  const scheduleSource = extractPrototypeFunction('scheduleUntitledReadingFollowTarget', 'markReadingFollowSource');
  assert.match(
    scheduleSource,
    /getReadingFollowRecentSourceMatch\(targetNoteId\)[\s\S]*?recentSourceMatch\.match[\s\S]*?return false/,
    'untitled popup targets must reject a just-created excerpt by raw or realGroup identity',
  );
  assert.doesNotMatch(
    scheduleSource,
    /MNUtil\.delay\(/,
    'untitled target persistence must not race ProcessNewExcerpt with a short timer',
  );
  const sourceMarkerSource = extractPrototypeFunction('markReadingFollowSource', 'isReadingFollowTargetCompatible');
  assert.match(
    sourceMarkerSource,
    /sourceDiagnostic\.realGroupNoteId[\s\S]*?pendingDiagnostic[\s\S]*?canceledPendingTarget/,
    'source detection must cancel a pending document wrapper when it resolves to the same mind-map node',
  );
  assert.match(
    sourceMarkerSource,
    /removeReadingFollowSourceFromRecentTargets\(sourceIdentityIds\)/,
    'new excerpt auto-selection must not remain in the recent target queue',
  );
  const markReadingFollowSource = vm.runInNewContext(
    `(${extractPrototypeFunction('markReadingFollowSource', 'isReadingFollowTargetCompatible')})`,
    { Date, String, KnowledgeBaseConfig: { config: { readingFollowLastNoteId: 'OLD-TARGET' } } },
  );
  const raceInstance = {
    readingFollowPendingUntitledTarget: { noteId: 'TARGET-DOC' },
    readingFollowRecentExcerptIds: {},
    getQuickReadingNoteDiagnostic(noteOrId) {
      if (noteOrId === 'TARGET-DOC') return { noteId: 'TARGET-DOC', realGroupNoteId: 'SOURCE-GROUP' };
      return { noteId: 'SOURCE-GROUP', realGroupNoteId: 'SOURCE-GROUP' };
    },
    removeReadingFollowSourceFromRecentTargets() { return []; },
    logQuickReadingDiagnostic() {},
  };
  markReadingFollowSource.call(raceInstance, 'SOURCE-GROUP');
  assert.strictEqual(raceInstance.readingFollowPendingUntitledTarget, null);
  assert.strictEqual(
    raceInstance.readingFollowRecentExcerptIds['SOURCE-GROUP'] > 0,
    true,
    'source detection must index the realGroup identity too',
  );
  const parentSource = extractPrototypeFunction('getReadingFollowParentNote', 'getReadingFollowMoveParent');
  assert.match(
    parentSource,
    /readingFollowPendingUntitledTarget[\s\S]*?pendingTargetId[\s\S]*?return pendingTarget/,
    'a blank target must be usable immediately while its delayed persistence is pending',
  );
}

function assertQuickReadingRecentTargetFallback() {
  assert.match(
    knowledgeBaseSource,
    /readingFollowRecentNoteIds:\s*\[\]/,
    'recent quick-reading targets must be persisted in config',
  );
  assert.match(
    extractPrototypeFunction('getReadingFollowRecentTargetIds', 'setReadingFollowRecentTargetIds'),
    /return result\.slice\(0, 3\)/,
    'recent quick-reading targets must be capped at three cards',
  );
  assert.match(
    mainSource,
    /const targetParent = this\.getReadingFollowParentNote\(note\)/,
    'target fallback must validate candidates against the current excerpt notebook',
  );

  let saveCount = 0;
  const queueConfig = {
    config: {
      readingFollowLastNoteId: 'A',
      readingFollowRecentNoteIds: ['A', 'C', 'D'],
    },
    save() { saveCount += 1; },
  };
  const queueInstance = {
    getReadingFollowRecentSourceMatch() { return { match: null }; },
    getReadingFollowRecentTargetIds() {
      return getRecentTargetIds.call(this);
    },
    setReadingFollowRecentTargetIds(noteIds) {
      return setRecentTargetIds.call(this, noteIds);
    },
    getQuickReadingNoteDiagnostic(noteId) {
      if (noteId === 'B') return { noteId: 'B', realGroupNoteId: 'B-GROUP' };
      return { noteId, realGroupNoteId: noteId };
    },
    logQuickReadingDiagnostic() {},
  };
  const queueContext = { KnowledgeBaseConfig: queueConfig };
  queueInstance.getReadingFollowRecentTargetIds = vm.runInNewContext(
    `(${extractPrototypeFunction('getReadingFollowRecentTargetIds', 'setReadingFollowRecentTargetIds')})`,
    queueContext,
  );
  queueInstance.setReadingFollowRecentTargetIds = vm.runInNewContext(
    `(${extractPrototypeFunction('setReadingFollowRecentTargetIds', 'removeReadingFollowSourceFromRecentTargets')})`,
    queueContext,
  );
  const commitTargetWithConfig = vm.runInNewContext(
    `(${extractPrototypeFunction('commitReadingFollowTarget', 'scheduleUntitledReadingFollowTarget')})`,
    queueContext,
  );
  commitTargetWithConfig.call(queueInstance, 'B', 'popup-titled');
  assert.deepStrictEqual(Array.from(queueConfig.config.readingFollowRecentNoteIds), ['B', 'A', 'C']);
  assert.strictEqual(queueConfig.config.readingFollowLastNoteId, 'B');
  assert.strictEqual(saveCount, 1);

  const removeSourceWithConfig = vm.runInNewContext(
    `(${extractPrototypeFunction('removeReadingFollowSourceFromRecentTargets', 'commitReadingFollowTarget')})`,
    queueContext,
  );
  const removedIds = removeSourceWithConfig.call(queueInstance, ['B-GROUP']);
  assert.deepStrictEqual(Array.from(removedIds), ['B']);
  assert.deepStrictEqual(Array.from(queueConfig.config.readingFollowRecentNoteIds), ['A', 'C']);
  assert.strictEqual(queueConfig.config.readingFollowLastNoteId, 'A');

  const sourceNote = { noteId: 'SOURCE' };
  const notes = {
    'OTHER-STUDY': { noteId: 'OTHER-STUDY' },
    A: { noteId: 'A' },
  };
  const fallbackContext = {
    String,
    resolveAvailableNote(noteId) { return notes[noteId] || null; },
  };
  const isCompatible = vm.runInNewContext(
    `(${extractPrototypeFunction('isReadingFollowTargetCompatible', 'getReadingFollowParentNote')})`,
    fallbackContext,
  );
  const getParent = vm.runInNewContext(
    `(${extractPrototypeFunction('getReadingFollowParentNote', 'getReadingFollowMoveParent')})`,
    fallbackContext,
  );
  const fallbackLogs = [];
  const fallbackSaves = [];
  const fallbackInstance = {
    readingFollowPendingUntitledTarget: null,
    getReadingFollowRecentTargetIds() { return ['DELETED-B', 'OTHER-STUDY', 'A']; },
    setReadingFollowRecentTargetIds(noteIds) {
      fallbackSaves.push(Array.from(noteIds));
      return { changed: true, recentTargetIds: Array.from(noteIds) };
    },
    isReadingFollowTargetCompatible(target, source) {
      return isCompatible.call(this, target, source);
    },
    getQuickReadingNoteDiagnostic(noteOrId) {
      const noteId = typeof noteOrId === 'string' ? noteOrId : noteOrId.noteId;
      if (noteId === 'SOURCE') {
        return { available: true, noteId, notebookId: 'NB-1', realGroupNotebookId: 'NB-1' };
      }
      if (noteId === 'OTHER-STUDY') {
        return { available: true, noteId, notebookId: 'NB-2', realGroupNotebookId: 'NB-2' };
      }
      if (noteId === 'A') {
        return { available: true, noteId, notebookId: 'NB-1', realGroupNotebookId: 'NB-1' };
      }
      return { available: false, noteId };
    },
    getSelectedNotes() { throw new Error('available fallback A must win before current selection'); },
    logQuickReadingDiagnostic(message, detail) { fallbackLogs.push({ message, detail }); },
  };
  assert.strictEqual(getParent.call(fallbackInstance, sourceNote), notes.A);
  assert.deepStrictEqual(fallbackSaves, [['A', 'OTHER-STUDY']]);
  assert.strictEqual(fallbackLogs[0].message, 'target.recentFallbackUsed');
  assert.deepStrictEqual(Array.from(fallbackLogs[0].detail.unavailableTargetIds), ['DELETED-B']);
  assert.deepStrictEqual(Array.from(fallbackLogs[0].detail.incompatibleTargetIds), ['OTHER-STUDY']);
}

function assertQuickReadingTargetReplacementAfterClassificationConversion() {
  let saveCount = 0;
  const previousConfig = context.KnowledgeBaseConfig.config;
  const previousSave = context.KnowledgeBaseConfig.save;
  context.KnowledgeBaseConfig.config = {
    readingFollowMode: true,
    readingFollowLastNoteId: 'OLD-TARGET',
    readingFollowRecentNoteIds: ['OLD-TARGET', 'A', 'B'],
  };
  context.KnowledgeBaseConfig.save = () => { saveCount += 1; };
  try {
    const result = KBT.replaceQuickReadingTargetNoteIds(
      ['OLD-WRAPPER', 'OLD-TARGET'],
      'NEW-CLASSIFICATION',
    );
    assert.strictEqual(result.changed, true);
    assert.strictEqual(context.KnowledgeBaseConfig.config.readingFollowLastNoteId, 'NEW-CLASSIFICATION');
    assert.deepStrictEqual(
      Array.from(context.KnowledgeBaseConfig.config.readingFollowRecentNoteIds),
      ['NEW-CLASSIFICATION', 'A', 'B'],
    );
    assert.strictEqual(saveCount, 1);

    const missingResult = KBT.replaceQuickReadingTargetNoteIds(['NOT-IN-QUEUE'], 'OTHER');
    assert.strictEqual(missingResult.changed, false);
    assert.strictEqual(saveCount, 1, 'a conversion outside the target list must not rewrite config');
  } finally {
    context.KnowledgeBaseConfig.config = previousConfig;
    context.KnowledgeBaseConfig.save = previousSave;
  }

  const conversionStart = toolbarSource.indexOf('async function _xdyy_convertNoteToClassificationNoteInPlace');
  const conversionEnd = toolbarSource.indexOf('\n  global.registerCustomAction("convertToClassificationNoteDirectly"', conversionStart);
  const conversionSource = toolbarSource.slice(conversionStart, conversionEnd);
  assert.match(
    conversionSource,
    /readingFollowTargetSourceIds[\s\S]*?KnowledgeBaseTemplate\.convertNoteToClassificationNote\([\s\S]*?replaceQuickReadingTargetNoteIds\([\s\S]*?readingFollowTargetSourceIds[\s\S]*?_xdyy_getNoteIdSafe\(convertedNote\)/,
    'MNToolbar classification conversion must replace queued source identities with the new card id',
  );
  assert.doesNotMatch(
    conversionSource,
    /MNNote\.clone|mergeInto\(/,
    'MNToolbar must delegate classification conversion instead of duplicating the native merge implementation',
  );
  assert.match(
    conversionSource,
    /classificationChainResult[\s\S]*?createdNotes[\s\S]*?notesToIndex\.forEach[\s\S]*?_xdyy_refreshNotesAfterMakeCardDBRefresh\(notesToRefresh/,
    'MNToolbar must index and refresh every card produced by popup // conversion',
  );
}

function assertUnavailableTargetProxyIsRejected() {
  const resolveStart = mainSource.indexOf('const resolveAvailableNote = function(noteOrId)');
  const resolveEnd = mainSource.indexOf('\n\n  const readKnowledgeBaseNoteValue', resolveStart);
  assert.ok(resolveStart !== -1 && resolveEnd > resolveStart, 'resolveAvailableNote must be present');
  const resolveSource = mainSource.slice(resolveStart, resolveEnd);
  assert.match(
    resolveSource,
    /nativeNote[\s\S]*?candidate\.noteId[\s\S]*?nativeNote\.noteId[\s\S]*?return resolvedNoteId \? candidate : null/,
    'ghost MNNote proxies without a resolvable id must be rejected so recent-target fallback can continue',
  );
}

function assertQuickReadingConversionUsesBoundedRefresh() {
  const convert = vm.runInNewContext(
    `(${extractPrototypeFunction('convertQuickReadingExcerptWithoutGlobalRefresh', 'getReadingTypeFromColor')})`,
    { KnowledgeBaseTemplate: KBT },
  );
  const sourceNote = { noteId: 'SOURCE' };
  const parentNote = { noteId: 'PARENT' };
  const processedNote = { noteId: 'PROCESSED' };
  const calls = [];

  return withPatchedMethods(KBT, {
    runUndoGroupingWithoutGlobalDBRefresh(block, trigger) {
      calls.push({ step: 'undo', trigger });
      return block();
    },
    toNoExcerptVersion(note, parent, options) {
      calls.push({ step: 'convert', note, parent, options });
      return processedNote;
    },
    refreshNoteLocally(note, useRefreshAll, options) {
      calls.push({ step: 'refresh', note, useRefreshAll, options });
    },
  }, () => {
    assert.strictEqual(convert(sourceNote, parentNote), processedNote);
    assert.strictEqual(calls[0].step, 'undo');
    assert.strictEqual(calls[0].trigger.feature, 'mnknowledgebase.quickReadingConversion.noGlobalDBRefresh');
    assert.strictEqual(calls[1].step, 'convert');
    assert.strictEqual(calls[1].parent, parentNote);
    assert.strictEqual(calls[1].options.createChildUndoGrouping, false);
    assert.deepStrictEqual(calls.slice(2).map(call => call.note), [parentNote, processedNote]);
    assert.ok(calls.slice(2).every(call => call.useRefreshAll === false));
  });
}

function assertQuickReadingOCRRefreshUsesImmediateDBRefresh() {
  const immediateCalls = [];
  const immediateInstance = {
    currentNotebookId: 'NOTEBOOK-NOW',
    xdyyRefreshAfterDBChangedNow(notebookId) {
      immediateCalls.push(notebookId);
    },
  };
  const refresh = vm.runInNewContext(
    `(${extractPrototypeFunction('refreshAfterQuickReadingOCR', 'convertQuickReadingExcerptWithoutGlobalRefresh')})`,
    { MNUtil: immediateInstance, KnowledgeBaseUtils: { addErrorLog() {} } },
  );
  assert.strictEqual(refresh({ noteId: 'NOTE' }, 'afterConversion'), true);
  assert.deepStrictEqual(immediateCalls, ['NOTEBOOK-NOW']);

  const fallbackCalls = [];
  const fallbackRefresh = vm.runInNewContext(
    `(${extractPrototypeFunction('refreshAfterQuickReadingOCR', 'convertQuickReadingExcerptWithoutGlobalRefresh')})`,
    { MNUtil: {
      currentNotebookId: 'NOTEBOOK-FALLBACK',
      app: { refreshAfterDBChanged(notebookId) { fallbackCalls.push(notebookId); } },
    }, KnowledgeBaseUtils: { addErrorLog() {} }, fallbackCalls },
  );
  assert.strictEqual(fallbackRefresh({ noteId: 'NOTE' }, 'noTarget'), true);
  assert.deepStrictEqual(fallbackCalls, ['NOTEBOOK-FALLBACK']);
}

async function assertQuickReadingAutoMakeCard() {
  const processReadingFollowNote = vm.runInNewContext(
    `(${extractPrototypeFunction('processReadingFollowNote', 'processReadingModeNote')})`,
    {
      Date,
      String,
      KnowledgeBaseConfig: {
        config: {
          readingFollowMode: true,
          readingFollowLastNoteId: 'CLASSIFICATION-TARGET',
        },
      },
      MNUtil: { undoGrouping(callback) { callback(); } },
      KnowledgeBaseTemplate: KBT,
    },
  );

  function buildProcessor(opts) {
    const { sourceNote, targetNote, processedNote, noteType, logs = [] } = opts;
    const moveTarget = {
      noteId: targetNote.noteId,
      realGroupNoteId: targetNote.noteId,
      addChildCalls: [],
      addChild(child) { this.addChildCalls.push(child); },
    };
    return {
      readingFollowPendingUntitledTarget: null,
      extractReadingTagTypeAndCleanup() {},
      getReadingTypeFromColor() { return noteType; },
      getReadingFollowParentNote() { return targetNote; },
      getReadingFollowMoveParent() { return moveTarget; },
      getQuickReadingNoteDiagnostic(noteOrId) {
        if (noteOrId === sourceNote) return { noteId: sourceNote.noteId, realGroupNoteId: sourceNote.noteId };
        if (noteOrId === sourceNote.noteId) return {
          noteId: sourceNote.noteId, realGroupNoteId: sourceNote.noteId,
          parentNoteId: targetNote.noteId, parentRealGroupNoteId: targetNote.noteId,
        };
        if (noteOrId === targetNote || noteOrId === targetNote.noteId) {
          return { noteId: targetNote.noteId, realGroupNoteId: targetNote.noteId };
        }
        if (noteOrId === moveTarget) return { noteId: targetNote.noteId, realGroupNoteId: targetNote.noteId };
        if (noteOrId === processedNote) return {
          noteId: processedNote.noteId, realGroupNoteId: processedNote.noteId,
          parentNoteId: targetNote.noteId, parentRealGroupNoteId: targetNote.noteId,
        };
        return { noteId: '', realGroupNoteId: '' };
      },
      logQuickReadingDiagnostic(message, detail, level) { logs.push({ message, detail, level }); },
      getReadingFollowChildContainment() { return { childCount: 1, containsSource: true }; },
      shouldSkipReadingOCR() { return true; },
      async applyQuickReadingOCRToTitle() { return true; },
      convertQuickReadingExcerptWithoutGlobalRefresh() { return processedNote; },
      syncConvertedIntermediateIndexIfNeeded() {},
      refreshAfterQuickReadingOCR() { return true; },
      commitReadingFollowTarget() { return true; },
    };
  }

  // 场景 A：定义摘录 → 定义归类卡 → 自动制卡
  {
    const defTarget = createNote(0, null, '"拓扑空间"相关定义');
    defTarget.noteId = 'CLASSIFICATION-TARGET';
    const defNote = createNote(2, null, '原始定义');
    defNote.noteId = 'DEFINITION-NOTE';
    const processedNote = { noteId: 'PROCESSED', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      const logs = [];
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: defNote, targetNote: defTarget, processedNote, noteType: '定义', logs }),
        defNote,
      );
      assert.strictEqual(makeCardCalls.length, 1, '定义摘录应触发一次自动制卡');
      assert.strictEqual(makeCardCalls[0].addToReview, false, '自动制卡不应加入复习');
      assert.strictEqual(makeCardCalls[0].options.noteType, '定义');
      const autoLog = logs.find(l => l.message === 'follow.autoMakeCard');
      assert.ok(autoLog);
      assert.strictEqual(autoLog.detail.typeMatched, true);
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }

  // 场景 B：命题摘录 → 命题归类卡 → 自动制卡
  {
    const propTarget = createNote(0, null, '"度量空间"相关命题');
    propTarget.noteId = 'PROP-TARGET';
    const propNote = createNote(10, null, '原始命题');
    propNote.noteId = 'PROP-NOTE';
    const processedNote = { noteId: 'PROCESSED-PROP', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: propNote, targetNote: propTarget, processedNote, noteType: '命题' }),
        propNote,
      );
      assert.strictEqual(makeCardCalls.length, 1, '命题摘录应触发一次自动制卡');
      assert.strictEqual(makeCardCalls[0].addToReview, false);
      assert.strictEqual(makeCardCalls[0].options.noteType, '命题');
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }

  // 场景 C：例子/反例摘录 → 同类型归类卡 → 自动制卡
  for (const [noteType, title, noteId] of [
    ['例子', '"度量空间"相关例子', 'EXAMPLE-NOTE'],
    ['反例', '"度量空间"相关反例', 'COUNTEREXAMPLE-NOTE'],
  ]) {
    const target = createNote(0, null, title);
    target.noteId = `${noteType}-TARGET`;
    const source = createNote(noteType === '例子' ? 7 : 3, null, `${noteType}摘录`);
    source.noteId = noteId;
    const processedNote = {
      noteId: `${noteType}-PROCESSED`,
      focusCount: 0,
      focusInMindMap() { this.focusCount += 1; },
    };

    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: source, targetNote: target, processedNote, noteType }),
        source,
      );
      assert.strictEqual(makeCardCalls.length, 1, `${noteType}摘录应触发一次自动制卡`);
      assert.strictEqual(makeCardCalls[0].addToReview, false);
      assert.strictEqual(makeCardCalls[0].options.noteType, noteType);
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }

  // 场景 D：归类颜色(0)摘录 → 不触发
  {
    const classTarget = createNote(0, null, '"某主题"相关命题');
    classTarget.noteId = 'CLASS-T';
    const classNote = createNote(0, null, '归类摘录');
    classNote.noteId = 'CLASS-N';
    const processedNote = { noteId: 'PC', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: classNote, targetNote: classTarget, processedNote, noteType: '' }),
        classNote,
      );
      assert.strictEqual(makeCardCalls.length, 0, '归类颜色摘录不应触发自动制卡');
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }

  // 场景 E：非归类卡目标 → 不触发
  {
    const nonClassTarget = createNote(10, null, '普通命题卡');
    nonClassTarget.noteId = 'NON-CLASS';
    const defNote = createNote(2, null, '定义摘录');
    defNote.noteId = 'DEF-N';
    const processedNote = { noteId: 'PD', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: defNote, targetNote: nonClassTarget, processedNote, noteType: '定义' }),
        defNote,
      );
      assert.strictEqual(makeCardCalls.length, 0, '非归类卡目标不应触发自动制卡');
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }

  // 场景 F：类型不匹配 → 不触发（命题摘录进入定义归类卡）
  {
    const defTarget = createNote(0, null, '"某主题"相关定义');
    defTarget.noteId = 'MISMATCH-T';
    const propNote = createNote(10, null, '命题摘录');
    propNote.noteId = 'MISMATCH-N';
    const processedNote = { noteId: 'PM', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
  await assertQuickReadingAutoMakeCard();
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      const logs = [];
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: propNote, targetNote: defTarget, processedNote, noteType: '命题', logs }),
        propNote,
      );
      assert.strictEqual(makeCardCalls.length, 0, '类型不匹配不应触发自动制卡');
      const autoLog = logs.find(l => l.message === 'follow.autoMakeCard');
      assert.ok(autoLog);
      assert.strictEqual(autoLog.detail.typeMatched, false);
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }

  // 场景 G：MNLiterature 阅读归类卡 → 不触发
  {
    const readingTarget = createNote(0, null, '"某文献"相关命题');
    readingTarget.noteId = 'READING-CLASS';
    const propNote = createNote(10, null, '命题摘录');
    propNote.noteId = 'PROP-R';
    const processedNote = { noteId: 'PR', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const oIsReading = KBT.isReadingClassificationNote;
    KBT.isReadingClassificationNote = () => true;
    const makeCardCalls = [];
    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function(note, addToReview, reviewEverytime, options) {
      makeCardCalls.push({ note, addToReview, reviewEverytime, options });
    };
    try {
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: propNote, targetNote: readingTarget, processedNote, noteType: '命题' }),
        propNote,
      );
      assert.strictEqual(makeCardCalls.length, 0, 'MNLiterature 阅读归类卡不应触发自动制卡');
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
      KBT.isReadingClassificationNote = oIsReading;
    }
  }

  // 场景 H：makeCard 抛出异常 → 静默捕获
  {
    const defTarget = createNote(0, null, '"某主题"相关定义');
    defTarget.noteId = 'ERR-T';
    const defNote = createNote(2, null, '定义摘录');
    defNote.noteId = 'ERR-N';
    const processedNote = { noteId: 'PE', focusCount: 0, focusInMindMap() { this.focusCount += 1; } };

    const oToNoExcerpt = KBT.toNoExcerptVersion;
    const oMakeCard = KBT.makeCard;
    KBT.toNoExcerptVersion = () => processedNote;
    KBT.makeCard = function() { throw new Error('模拟制卡异常'); };
    try {
      const logs = [];
      await processReadingFollowNote.call(
        buildProcessor({ sourceNote: defNote, targetNote: defTarget, processedNote, noteType: '定义', logs }),
        defNote,
      );
      const errLog = logs.find(l => l.message === 'follow.autoMakeCard.error');
      assert.ok(errLog, '制卡异常应记录错误诊断');
      assert.strictEqual(errLog.level, 'warn');
      assert.ok(errLog.detail.error.includes('模拟制卡异常'));
      assert.strictEqual(processedNote.focusCount, 1, '异常后仍应聚焦卡片');
    } finally {
      KBT.toNoExcerptVersion = oToNoExcerpt;
      KBT.makeCard = oMakeCard;
    }
  }
}
async function assertQuickReadingUsesResolvedParentForMoveAndConversion() {
  const followStart = mainSource.indexOf('MNKnowledgeBaseClass.prototype.processReadingFollowNote = async function(note)');
  const followEnd = mainSource.indexOf('MNKnowledgeBaseClass.prototype.processReadingModeNote', followStart);
  assert.ok(followStart !== -1 && followEnd > followStart, 'quick-reading follow processor must be present');
  const followSource = mainSource.slice(followStart, followEnd);
  assert.match(
    followSource,
    /sourceIds\.some\(id => targetIds\.includes\(id\)\)/,
    'self-parent protection must compare resolved mind-map IDs, not only raw wrapper IDs',
  );
  assert.match(
    followSource,
    /this\.convertQuickReadingExcerptWithoutGlobalRefresh\(note, targetParentForMove\)/,
    'excerpt conversion must use the no-global-refresh path with the resolved target',
  );

  const processReadingFollowNote = vm.runInNewContext(
    `(${extractPrototypeFunction('processReadingFollowNote', 'processReadingModeNote')})`,
    {
      Date,
      String,
      KnowledgeBaseConfig: { config: { readingFollowLastNoteId: 'TARGET-DOC' } },
      MNUtil: { undoGrouping(callback) { callback(); } },
      KnowledgeBaseTemplate: KBT,
    },
  );

  const sourceNote = { noteId: 'SOURCE-DOC' };
  const selectedTarget = { noteId: 'TARGET-DOC' };
  const moveTarget = {
    noteId: 'TARGET-GROUP',
    addChildCalls: [],
    addChild(note) { this.addChildCalls.push(note); },
  };
  const processedNote = {
    noteId: 'PROCESSED',
    focusCount: 0,
    focusInMindMap() { this.focusCount += 1; },
  };
  const conversionCalls = [];
  const logMessages = [];
  const refreshCalls = [];
  const confirmedTargetCalls = [];
  const originalToNoExcerptVersion = KBT.toNoExcerptVersion;
  KBT.toNoExcerptVersion = (note, parent) => {
    conversionCalls.push({ note, parent });
    return processedNote;
  };
  try {
    const processor = {
     readingFollowPendingUntitledTarget: { noteId: 'TARGET-DOC' },
     extractReadingTagTypeAndCleanup() {},
      getReadingTypeFromColor() { return ''; },
     getReadingFollowParentNote() { return selectedTarget; },
      getReadingFollowMoveParent() { return moveTarget; },
      getQuickReadingNoteDiagnostic(noteOrId) {
        if (noteOrId === sourceNote) return { noteId: 'SOURCE-DOC', realGroupNoteId: 'SOURCE-GROUP' };
        if (noteOrId === 'SOURCE-DOC') {
          return {
            noteId: 'SOURCE-DOC',
            realGroupNoteId: 'SOURCE-GROUP',
            parentNoteId: 'TARGET-GROUP',
            parentRealGroupNoteId: 'TARGET-GROUP',
          };
        }
        if (noteOrId === selectedTarget || noteOrId === 'TARGET-DOC') {
          return { noteId: 'TARGET-DOC', realGroupNoteId: 'TARGET-GROUP' };
        }
        if (noteOrId === moveTarget) return { noteId: 'TARGET-GROUP', realGroupNoteId: 'TARGET-GROUP' };
        if (noteOrId === processedNote) {
          return {
            noteId: 'PROCESSED',
            realGroupNoteId: 'PROCESSED',
            parentNoteId: 'TARGET-GROUP',
            parentRealGroupNoteId: 'TARGET-GROUP',
          };
        }
        return { noteId: '', realGroupNoteId: '' };
      },
      logQuickReadingDiagnostic(message) { logMessages.push(message); },
      getReadingFollowChildContainment() { return { childCount: 1, containsSource: true }; },
      shouldSkipReadingOCR() { return false; },
      async applyQuickReadingOCRToTitle() {
        refreshCalls.push({ step: 'ocr' });
        return true;
      },
      convertQuickReadingExcerptWithoutGlobalRefresh(note, parent) {
        return KBT.toNoExcerptVersion(note, parent, { createChildUndoGrouping: false });
      },
      refreshAfterQuickReadingOCR(note, stage) {
        refreshCalls.push({ step: 'refresh', note, stage, focusCount: processedNote.focusCount });
        return true;
      },
      syncConvertedIntermediateIndexIfNeeded() {},
      commitReadingFollowTarget(noteId, reason) { confirmedTargetCalls.push({ noteId, reason }); },
    };

    await processReadingFollowNote.call(processor, sourceNote);
    assert.deepStrictEqual(moveTarget.addChildCalls, [sourceNote]);
    assert.strictEqual(conversionCalls.length, 1);
    assert.strictEqual(conversionCalls[0].note, sourceNote);
    assert.strictEqual(
      conversionCalls[0].parent,
      moveTarget,
      'conversion must create the replacement card under the same resolved parent used by addChild',
    );
    assert.strictEqual(processedNote.focusCount, 1);
    assert.deepStrictEqual(refreshCalls, [
      { step: 'ocr' },
      { step: 'refresh', note: processedNote, stage: 'afterConversion', focusCount: 1 },
    ], 'quick reading must refresh the converted card only after OCR and focus complete');
    assert.deepStrictEqual(confirmedTargetCalls, [
      { noteId: 'TARGET-DOC', reason: 'follow-pending-confirmed' },
    ]);
    assert.strictEqual(processor.readingFollowPendingUntitledTarget, null);
    assert.ok(logMessages.includes('follow.afterAddChild'));
    assert.ok(logMessages.includes('follow.beforeConversion'));
    assert.ok(logMessages.includes('follow.afterConversion'));
  } finally {
    KBT.toNoExcerptVersion = originalToNoExcerptVersion;
  }

  const selfTargetLogs = [];
   const selfTargetProcessor = {
     extractReadingTagTypeAndCleanup() {},
      getReadingTypeFromColor() { return ''; },
     getReadingFollowParentNote() { return selectedTarget; },
    getReadingFollowMoveParent() {
      return {
        noteId: 'SOURCE-GROUP',
        addChild() { throw new Error('resolved self-target must never be mutated'); },
      };
    },
    getQuickReadingNoteDiagnostic(noteOrId) {
      if (noteOrId === selectedTarget) return { noteId: 'TARGET-DOC', realGroupNoteId: 'SOURCE-GROUP' };
      if (noteOrId && noteOrId.noteId === 'SOURCE-GROUP') {
        return { noteId: 'SOURCE-GROUP', realGroupNoteId: 'SOURCE-GROUP' };
      }
      return { noteId: 'SOURCE-DOC', realGroupNoteId: 'SOURCE-GROUP' };
    },
    logQuickReadingDiagnostic(message) { selfTargetLogs.push(message); },
    getReadingFollowChildContainment() { return { childCount: 0, containsSource: false }; },
    shouldSkipReadingOCR() { return true; },
    syncConvertedIntermediateIndexIfNeeded() {},
    commitReadingFollowTarget() { return true; },
  };
  await processReadingFollowNote.call(selfTargetProcessor, sourceNote);
  assert.ok(
    selfTargetLogs.includes('follow.selfTargetBlocked'),
    'different raw IDs resolving to one mind-map node must be blocked',
  );
}

(async () => {
  assertColorProtocol();
  assertQuickReadingPolicy();
  assertQuickReadingPolicyUsesDirectParentClassification();
  assertQuickReadingNormalMakeNoteLocksColorType();
  assertQuickReadingNormalTitleUsesClassificationParent();
  assertLockedTypeFlowsThroughTemplateMerge();
  assertRoughAutoMoveKeepsLockedTypeAtFieldBoundary();
  assertSingleDrawingMovesIntoLockedDefaultField();
  assertRoughExecutorHasNoFormalMakeCardSideEffects();
  assertDefinitionRoughCardSilencesEmptyIndexBuild();
  assertConvertedDefinitionIntermediateIndexFailureIsSilent();
  assertQuickReadingDefinitionTitleIndexFailureIsSilent();
  assertMainIndexerHonorsSilentEmptyEntryOption();
  assertMakeCardEntryRouting();
  assertColorZeroClassificationConversion();
  assertClassificationConversionUsesParentColorFallback();
  assertInvalidClassificationConversionDoesNotPreprocess();
  await assertPopupClassificationConversionBuildsDownwardChain();
  assertMakeNoteEntryRouting();
  assertToolbarSkipsRoughParentLinkSync();
  assertToolbarSkipsRoughProofLinkPostProcessing();
  assertToolbarDelegatesQuickReadingBeforeLegacyPreProcessPath();
  assertToolbarUsesConvertedClassificationNote();
  assertUserVisibleModeName();
  await assertQuickReadingProcessesExcerptsOnly();
  assertQuickReadingHighlightsAddonIcon();
  assertQuickReadingAcceptsUntitledTargetCard();
  assertQuickReadingRecentTargetFallback();
  assertQuickReadingTargetReplacementAfterClassificationConversion();
  assertUnavailableTargetProxyIsRejected();
  assertQuickReadingConversionUsesBoundedRefresh();
  assertQuickReadingOCRRefreshUsesImmediateDBRefresh();
  await assertQuickReadingUsesResolvedParentForMoveAndConversion();
  console.log('quick reading make-card regression ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
