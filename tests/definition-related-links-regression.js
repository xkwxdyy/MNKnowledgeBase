const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const start = 0;
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
if (end === -1) {
  throw new Error('Cannot locate KnowledgeBaseTemplate in utils.js');
}

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
  MNUtil: {
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
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`, context);

const KBT = context.KnowledgeBaseTemplate;
const notesById = new Map();
let nextId = 1;

class FakeNote {
  constructor(title, type) {
    this.noteId = `NOTE-${nextId++}`;
    this.noteTitle = title || '';
    this.title = title || '';
    this._type = type || '';
    this.comments = [];
    this.parentNote = null;
    this.childNotes = [];
    this.noteURL = `marginnote4app://note/${this.noteId}`;
    notesById.set(this.noteId.toUpperCase(), this);
  }

  get MNComments() {
    return this.comments;
  }

  appendNoteLink(note) {
    this.comments.push({ type: 'linkComment', text: note.noteURL });
  }

  appendMarkdownComment(text) {
    this.comments.push({ type: 'markdownComment', text });
  }

  replaceWithMarkdownComment(text, index) {
    this.comments[index] = { type: 'markdownComment', text };
  }

  removeCommentsByIndexArr(indices) {
    Array.from(new Set(indices)).sort((a, b) => b - a).forEach(index => {
      this.comments.splice(index, 1);
    });
  }

  removeCommentByIndex(index) {
    this.comments.splice(index, 1);
  }

  moveCommentsByIndexArr(indices, targetIndex) {
    const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
    const moving = unique.map(index => this.comments[index]).filter(Boolean);
    unique.slice().reverse().forEach(index => this.comments.splice(index, 1));
    const beforeTarget = unique.filter(index => index < targetIndex).length;
    const adjustedTarget = Math.max(0, Math.min(this.comments.length, targetIndex - beforeTarget));
    this.comments.splice(adjustedTarget, 0, ...moving);
  }
}

context.MNNote = {
  new(noteIdOrUrl) {
    const noteId = KBT.extractNoteIdFromLinkUrl(String(noteIdOrUrl || '')) || String(noteIdOrUrl || '');
    return notesById.get(noteId.toUpperCase()) || null;
  },
};

function addField(note, fieldName) {
  note.comments.push({ type: 'HtmlComment', text: fieldName });
}

function linkMarkdown(note, display, targetNote) {
  note.appendMarkdownComment(`- [${display}](${targetNote.noteURL})`);
}

function linkNative(note, targetNote) {
  note.appendNoteLink(targetNote);
}

KBT.getNoteType = (note) => note && note._type;
KBT.isNSNullLike = value => value === null || typeof value === 'undefined';
KBT.parseNoteTitle = (note) => {
  const title = note ? (note.noteTitle || note.title || '') : '';
  return {
    type: KBT.getNoteType(note),
    content: title,
    titleLinkWordsArr: title ? [title] : [],
  };
};
KBT.moveCommentsArrToField = function(note, indexArr, fieldName, toBottom = true) {
  const fieldObj = this.findFieldObjectByNormalizedName(note, fieldName);
  assert(fieldObj, `missing field ${fieldName}`);
  const resolvedIndexArr = Array.isArray(indexArr)
    ? indexArr
    : String(indexArr).split(',').map(value => {
      const token = value.trim();
      if (token === 'Z') return note.comments.length - 1;
      if (token === 'Y') return note.comments.length - 2;
      return Number(token);
    }).filter(Number.isFinite);
  const targetIndex = toBottom
    ? (fieldObj.excludingFieldBlockIndexArr[fieldObj.excludingFieldBlockIndexArr.length - 1] ?? fieldObj.index) + 1
    : fieldObj.index + 1;
  note.moveCommentsByIndexArr(resolvedIndexArr, targetIndex);
};
KBT.removeLinkToNote = function(note, targetNoteId) {
  return this.removeLinksToNoteInField(note, '相关链接', targetNoteId) +
    this.removeLinksToNoteInField(note, '包含', targetNoteId) +
    this.removeLinksToNoteInField(note, '所属', targetNoteId);
};

function assertFieldTexts(note, fieldName, expected) {
  const field = KBT.findFieldObjectByNormalizedName(note, fieldName);
  assert(field, `missing field ${fieldName}`);
  const actual = field.excludingFieldBlockIndexArr.map(index => note.comments[index].text);
  assert.deepStrictEqual(actual, expected);
}

function assertRelatedTexts(note, expected) {
  assertFieldTexts(note, '相关链接', expected);
}

function run() {
  const templateMergedCardMakeStart = source.indexOf('static templateMergedCardMake(note');
  const applicationLinkMoveCall = source.indexOf(
    'this.moveClassificationLinksFromApplicationToRelatedField(note)',
    templateMergedCardMakeStart,
  );
  const linkParentCall = source.indexOf('this.linkParentNote(note', templateMergedCardMakeStart);
  assert(templateMergedCardMakeStart !== -1, 'templateMergedCardMake must exist');
  assert(applicationLinkMoveCall !== -1, 'formal make-card must move application classification links');
  assert(
    applicationLinkMoveCall < linkParentCall,
    'application classification links must move before parent-link synchronization',
  );
  const classificationModeStart = source.indexOf('if (KnowledgeBaseConfig.config.classificationMode)');
  const preProcessModeStart = source.indexOf('if (KnowledgeBaseConfig.config.preProcessMode)');
  const classificationModeMoveCall = source.indexOf(
    'this.moveClassificationLinksFromApplicationToRelatedField(note)',
    classificationModeStart,
  );
  const classificationModeLinkParentCall = source.indexOf(
    'this.linkParentNote(note, false, false, noteType)',
    classificationModeStart,
  );
  const preProcessModeMoveCall = source.indexOf(
    'this.moveClassificationLinksFromApplicationToRelatedField(processedNote)',
    preProcessModeStart,
  );
  const preProcessModeLinkParentCall = source.indexOf(
    'this.linkParentNote(processedNote, false, false, lockedNoteType)',
    preProcessModeStart,
  );
  assert(
    classificationModeMoveCall > classificationModeStart &&
      classificationModeMoveCall < classificationModeLinkParentCall,
    'classification mode must move application classification links before parent-link synchronization',
  );
  assert(
    preProcessModeMoveCall > preProcessModeStart && preProcessModeMoveCall < preProcessModeLinkParentCall,
    'pre-process mode must move application classification links before parent-link synchronization',
  );

  const nativeBacklinkParent = new FakeNote('普通父卡', '命题');
  const nativeBacklinkChild = new FakeNote('普通子卡', '思路');
  addField(nativeBacklinkChild, '相关链接');
  linkMarkdown(nativeBacklinkChild, '普通父卡', nativeBacklinkParent);
  linkNative(nativeBacklinkChild, nativeBacklinkParent);

  const nativeBacklinkResult = KBT.upsertNoteNativeLinkInField(
    nativeBacklinkChild,
    nativeBacklinkParent,
    '相关链接',
  );
  assert.strictEqual(nativeBacklinkResult.removedDuplicates, 1);
  assertRelatedTexts(nativeBacklinkChild, [nativeBacklinkParent.noteURL]);
  const repeatedNativeBacklinkResult = KBT.upsertNoteNativeLinkInField(
    nativeBacklinkChild,
    nativeBacklinkParent,
    '相关链接',
  );
  assert.strictEqual(repeatedNativeBacklinkResult.removedDuplicates, 0);
  assertRelatedTexts(nativeBacklinkChild, [nativeBacklinkParent.noteURL]);

  const currentParent = new FakeNote('当前父归类', '归类');
  addField(currentParent, '包含');
  const oldParentWithReverse = new FakeNote('旧父归类', '归类');
  addField(oldParentWithReverse, '包含');
  const manualRelated = new FakeNote('手动相关归类', '归类');
  addField(manualRelated, '包含');
  const definition = new FakeNote('定义卡', '定义');
  addField(definition, '相关思考');
  addField(definition, '相关链接');

  oldParentWithReverse.appendMarkdownComment(`- [定义卡](${definition.noteURL})`);
  linkMarkdown(definition, '旧父归类', oldParentWithReverse);
  linkNative(definition, currentParent);
  linkMarkdown(definition, '手动相关归类', manualRelated);
  definition.parentNote = currentParent;

  const cleanup = KBT.cleanupLeadingStaleClassificationParentLinks(definition, currentParent);
  assert.strictEqual(cleanup.removed, 1);
  assertRelatedTexts(definition, [
    currentParent.noteURL,
    `- [手动相关归类](${manualRelated.noteURL})`,
  ]);

  const sync = KBT.syncChildRelatedClassificationNativeLinksForNote(definition);
  assert.strictEqual(sync.checked, 1);
  assertRelatedTexts(definition, [
    currentParent.noteURL,
    `- [手动相关归类](${manualRelated.noteURL})`,
  ]);

  const makeCleanup = KBT.cleanupMakeCardClassificationLinkFields(definition);
  assert.strictEqual(makeCleanup.relatedChecked, 0);
  assertRelatedTexts(definition, [
    currentParent.noteURL,
    `- [手动相关归类](${manualRelated.noteURL})`,
  ]);

  const definitionGrandparent = new FakeNote('归类卡 A', '归类');
  addField(definitionGrandparent, '包含');
  const definitionOwner = new FakeNote('定义卡 B', '定义');
  addField(definitionOwner, '相关链接');
  definitionOwner.parentNote = definitionGrandparent;
  definitionGrandparent.childNotes.push(definitionOwner);
  const ownedClassification = new FakeNote('归类卡 C', '归类');
  addField(ownedClassification, '所属');
  addField(ownedClassification, '相关思考');
  addField(ownedClassification, '包含');
  ownedClassification.parentNote = definitionOwner;
  definitionOwner.childNotes.push(ownedClassification);

  KBT.linkParentNote(ownedClassification);

  assertFieldTexts(ownedClassification, '所属', [definitionOwner.noteURL]);
  assertFieldTexts(definitionOwner, '相关链接', [
    `- [【归类】 归类卡 C](${ownedClassification.noteURL})`,
  ]);

  KBT.syncClassificationContainInlineLinksForNote(definitionOwner, definitionGrandparent);

  assertFieldTexts(
    ownedClassification,
    '所属',
    [definitionOwner.noteURL],
    'making definition B must preserve its owned classification C belonging link',
  );
  assertFieldTexts(ownedClassification, '包含', []);

  const upwardParent = new FakeNote('向上新增父归类', '归类');
  addField(upwardParent, '包含');
  const oldDefinitionParent = new FakeNote('旧定义父卡', '定义');
  const oldClassificationParent = new FakeNote('旧归类父卡', '归类');
  const classification = new FakeNote('待向上制卡的归类卡', '归类');
  addField(classification, '所属：');
  linkNative(classification, oldDefinitionParent);
  linkMarkdown(classification, '旧归类父卡', oldClassificationParent);
  classification.comments.push({
    type: 'linkComment',
    text: 'marginnote4app://note/MISSING-OLD-PARENT',
  });
  addField(classification, '相关链接：');
  linkMarkdown(classification, '保留的普通关联', oldDefinitionParent);
  addField(classification, '包含：');
  classification.parentNote = upwardParent;

  KBT.cleanupOldParentLinks(classification, upwardParent);
  assertFieldTexts(classification, '所属', []);
  assertFieldTexts(classification, '相关链接', [
    `- [保留的普通关联](${oldDefinitionParent.noteURL})`,
  ]);

  const propositionParent = new FakeNote('命题父归类 B', '归类');
  addField(propositionParent, '包含');
  const manualRelatedClassification = new FakeNote('手动相关归类 C', '归类');
  addField(manualRelatedClassification, '包含');
  const proposition = new FakeNote('命题卡 A', '命题');
  addField(proposition, '相关链接');
  linkNative(proposition, propositionParent);
  linkNative(proposition, manualRelatedClassification);
  linkNative(manualRelatedClassification, proposition);
  proposition.parentNote = propositionParent;

  const propositionCleanup = KBT.cleanupLeadingStaleClassificationParentLinks(
    proposition,
    propositionParent,
  );
  assert.strictEqual(propositionCleanup.removed, 0);
  assertRelatedTexts(proposition, [
    propositionParent.noteURL,
    manualRelatedClassification.noteURL,
  ]);
  assertFieldTexts(manualRelatedClassification, '包含', [proposition.noteURL]);

  KBT.linkParentNote(proposition);
  KBT.cleanupMakeCardClassificationLinkFields(proposition);
  assertRelatedTexts(proposition, [
    propositionParent.noteURL,
    manualRelatedClassification.noteURL,
  ]);
  assertFieldTexts(manualRelatedClassification, '包含', [
    `- [命题卡 A](${proposition.noteURL})`,
  ]);

  const movedFrom = new FakeNote('移动前归类 A', '归类');
  const movedTo = new FakeNote('移动后归类 B', '归类');
  const movedKnowledge = new FakeNote('被移动的知识点 C', '命题');
  addField(movedFrom, '包含');
  addField(movedTo, '包含');
  addField(movedKnowledge, '相关链接');
  addField(movedKnowledge, '应用');
  movedKnowledge.parentNote = movedFrom;
  movedFrom.childNotes.push(movedKnowledge);
  KBT.upsertNoteNativeLinkInField(movedKnowledge, movedFrom, '相关链接');
  KBT.upsertNoteInlineLinkInField(movedFrom, movedKnowledge, '包含');
  assert.strictEqual(KBT.getFirstClassificationParentNote(movedKnowledge), movedFrom);

  movedFrom.childNotes = movedFrom.childNotes.filter(note => note !== movedKnowledge);
  movedTo.childNotes.push(movedKnowledge);
  movedKnowledge.parentNote = movedTo;
  KBT.linkParentNote(movedKnowledge);

  assert.strictEqual(
    KBT.getFirstClassificationParentNote(movedKnowledge),
    movedTo,
    'a cached classification parent must not survive a manual structural move',
  );
  assertRelatedTexts(movedKnowledge, [movedTo.noteURL]);
  assertFieldTexts(movedFrom, '包含', []);
  assertFieldTexts(movedTo, '包含', [
    `- [被移动的知识点 C](${movedKnowledge.noteURL})`,
  ]);

  const stackParent = new FakeNote('结构父归类 A', '归类');
  const manuallyRelated = new FakeNote('手动关联归类 B', '归类');
  const stackedKnowledge = new FakeNote('保留关联的知识点 C', '命题');
  addField(stackParent, '包含');
  addField(manuallyRelated, '相关链接');
  addField(manuallyRelated, '包含');
  addField(stackedKnowledge, '相关链接');
  addField(stackedKnowledge, '应用');
  stackedKnowledge.parentNote = stackParent;
  stackParent.childNotes.push(stackedKnowledge);
  KBT.upsertNoteNativeLinkInField(stackedKnowledge, stackParent, '相关链接');
  KBT.upsertNoteInlineLinkInField(stackParent, stackedKnowledge, '包含');
  linkNative(stackedKnowledge, manuallyRelated);
  linkNative(manuallyRelated, stackedKnowledge);
  KBT.moveCommentsArrToField(stackedKnowledge, 'Z', '相关链接');
  KBT.moveCommentsArrToField(manuallyRelated, 'Z', '相关链接');

  KBT.linkParentNote(stackedKnowledge);

  assertRelatedTexts(stackedKnowledge, [
    stackParent.noteURL,
    manuallyRelated.noteURL,
  ]);
  assertFieldTexts(stackParent, '包含', [
    `- [保留关联的知识点 C](${stackedKnowledge.noteURL})`,
  ]);
  assertFieldTexts(manuallyRelated, '包含', [
    `- [保留关联的知识点 C](${stackedKnowledge.noteURL})`,
  ]);

  const oneWayParent = new FakeNote('单向测试结构父 A', '归类');
  const oneWayRelated = new FakeNote('只有 C 指向的归类 B', '归类');
  const oneWayKnowledge = new FakeNote('单向相关知识点 C', '命题');
  addField(oneWayParent, '包含');
  addField(oneWayRelated, '包含');
  addField(oneWayKnowledge, '相关链接');
  addField(oneWayKnowledge, '应用');
  oneWayKnowledge.parentNote = oneWayParent;
  oneWayParent.childNotes.push(oneWayKnowledge);
  KBT.upsertNoteNativeLinkInField(oneWayKnowledge, oneWayParent, '相关链接');
  KBT.upsertNoteInlineLinkInField(oneWayParent, oneWayKnowledge, '包含');
  linkNative(oneWayKnowledge, oneWayRelated);
  KBT.moveCommentsArrToField(oneWayKnowledge, 'Z', '相关链接');

  KBT.linkParentNote(oneWayKnowledge);

  assertRelatedTexts(oneWayKnowledge, [
    oneWayParent.noteURL,
    oneWayRelated.noteURL,
  ]);
  assertFieldTexts(oneWayRelated, '包含', []);

  const applicationParent = new FakeNote('应用迁移结构父 A', '归类');
  const applicationRelated = new FakeNote('应用迁移关联归类 B', '归类');
  const applicationOneWay = new FakeNote('应用迁移单向归类 D', '归类');
  const applicationOrdinary = new FakeNote('应用中的普通知识点 E', '命题');
  const applicationKnowledge = new FakeNote('应用迁移知识点 C', '命题');
  addField(applicationParent, '包含');
  addField(applicationRelated, '包含');
  addField(applicationOneWay, '包含');
  addField(applicationKnowledge, '相关链接');
  addField(applicationKnowledge, '应用');
  applicationKnowledge.parentNote = applicationParent;
  applicationParent.childNotes.push(applicationKnowledge);
  KBT.upsertNoteNativeLinkInField(applicationKnowledge, applicationParent, '相关链接');
  KBT.upsertNoteInlineLinkInField(applicationParent, applicationKnowledge, '包含');
  linkNative(applicationKnowledge, applicationRelated);
  KBT.moveCommentsArrToField(applicationKnowledge, 'Z', '应用');
  linkMarkdown(applicationKnowledge, applicationOneWay.noteTitle, applicationOneWay);
  KBT.moveCommentsArrToField(applicationKnowledge, 'Z', '应用');
  linkNative(applicationKnowledge, applicationOrdinary);
  KBT.moveCommentsArrToField(applicationKnowledge, 'Z', '应用');
  linkNative(applicationRelated, applicationKnowledge);

  const applicationMoveResult = KBT.moveClassificationLinksFromApplicationToRelatedField(
    applicationKnowledge,
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(applicationMoveResult)),
    { checked: 3, matched: 2, moved: 2 },
  );
  assertRelatedTexts(applicationKnowledge, [
    applicationParent.noteURL,
    applicationRelated.noteURL,
    `- [${applicationOneWay.noteTitle}](${applicationOneWay.noteURL})`,
  ]);
  assertFieldTexts(applicationKnowledge, '应用', [applicationOrdinary.noteURL]);

  KBT.linkParentNote(applicationKnowledge);
  assertFieldTexts(applicationParent, '包含', [
    `- [知识点 C](${applicationKnowledge.noteURL})`,
  ]);
  assertFieldTexts(applicationRelated, '包含', [
    `- [应用迁移知识点 C](${applicationKnowledge.noteURL})`,
  ]);
  assertFieldTexts(applicationOneWay, '包含', []);

  const literatureRoot = new FakeNote('文献 A', '文献');
  literatureRoot.comments.push({ type: 'HtmlComment', text: '文献元数据' });
  const readingClassification = new FakeNote('“文献 A”相关定义', '归类');
  addField(readingClassification, '所属');
  linkNative(readingClassification, literatureRoot);
  addField(readingClassification, '包含');

  const malformedReadingTitle = new FakeNote('文献 A 的普通归类', '归类');
  addField(malformedReadingTitle, '所属');
  linkNative(malformedReadingTitle, literatureRoot);
  assert.strictEqual(
    KBT.isReadingClassificationNote(malformedReadingTitle),
    false,
    'a literature-owned classification without the fixed reading title must remain ordinary',
  );

  const nestedReadingClassification = new FakeNote('“论文集”：“文献 A”相关命题', '归类');
  addField(nestedReadingClassification, '所属');
  linkNative(nestedReadingClassification, literatureRoot);
  assert.strictEqual(KBT.isReadingClassificationNote(nestedReadingClassification), true);

  const readingKnowledge = new FakeNote('阅读知识点 D', '命题');
  readingKnowledge.colorIndex = 10;
  addField(readingKnowledge, '相关链接');
  addField(readingKnowledge, '应用');
  readingKnowledge.parentNote = readingClassification;
  readingClassification.childNotes.push(readingKnowledge);

  assert.strictEqual(KBT.isReadingClassificationNote(readingClassification), true);
  assert.strictEqual(KBT.getReadingClassificationParentNote(readingKnowledge), readingClassification);
  const readingPolicy = KBT.getQuickReadingMakeCardPolicy(readingKnowledge);
  assert.strictEqual(readingPolicy.mode, 'rough', 'reading classification children stay rough even when quick reading is off');
  assert.strictEqual(readingPolicy.readingClassificationParent, true);

  KBT.changeTitle(readingKnowledge, false, '命题', {
    syncContainLinks: false,
    syncIndex: false,
  });
  assert.strictEqual(readingKnowledge.title, '阅读知识点 D', 'reading classification children must not gain a title prefix');

  KBT.linkParentNote(readingKnowledge);
  assertRelatedTexts(readingKnowledge, []);
  assertFieldTexts(readingClassification, '包含', [
    readingKnowledge.noteURL,
  ]);
  assert.strictEqual(
    KBT.hasNoteLinkInField(readingKnowledge, '相关链接', readingClassification.noteId),
    false,
    'a reading-classification child must not keep a backlink to A',
  );
  assert.strictEqual(
    KBT.hasNoteLinkInField(readingClassification, '包含', readingKnowledge.noteId),
    true,
    'reading classification A must contain-link its child',
  );

  const propositionB = new FakeNote('命题 B', '命题');
  propositionB.parentNote = readingClassification;
  readingClassification.childNotes.push(propositionB);
  const normalClassificationC = new FakeNote('“内部知识库”相关命题', '归类');
  addField(normalClassificationC, '所属');
  linkNative(normalClassificationC, propositionB);
  addField(normalClassificationC, '包含');
  normalClassificationC.parentNote = propositionB;
  propositionB.childNotes.push(normalClassificationC);

  readingClassification.childNotes = readingClassification.childNotes.filter(note => note !== readingKnowledge);
  normalClassificationC.childNotes.push(readingKnowledge);
  readingKnowledge.parentNote = normalClassificationC;

  assert.strictEqual(KBT.isReadingClassificationNote(normalClassificationC), false);
  assert.strictEqual(
    KBT.getReadingClassificationParentNote(readingKnowledge),
    null,
    'a normal nearest classification C must hide the farther reading classification A',
  );
  context.KnowledgeBaseConfig = { config: { readingFollowMode: true } };
  const normalClassificationPolicy = KBT.getQuickReadingMakeCardPolicy(readingKnowledge);
  assert.strictEqual(normalClassificationPolicy.mode, 'normal');
  KBT.changeTitle(readingKnowledge, false, '命题', {
    syncContainLinks: false,
    syncIndex: false,
  });
  assert.match(readingKnowledge.title, /^【命题 >> /);
  delete context.KnowledgeBaseConfig;

  KBT.linkParentNote(readingKnowledge);
  assertRelatedTexts(readingKnowledge, [normalClassificationC.noteURL]);
  assert.strictEqual(
    KBT.hasNoteLinkInField(normalClassificationC, '包含', readingKnowledge.noteId),
    true,
    'D under normal classification C must restore the normal C -> D contain link',
  );
  assertFieldTexts(readingClassification, '包含', [
    readingKnowledge.noteURL,
  ]);

  const staleContainLink = 'marginnote4app://note/MISSING-CONTAIN-CHILD';
  const staleRelatedLink = 'marginnote4app://note/MISSING-RELATED-CHILD';
  const stalePlainInlineLink = 'marginnote4app://note/MISSING-PLAIN-INLINE';
  const validContainChild = new FakeNote('有效包含子卡', '命题');
  const classificationWithStaleContain = new FakeNote('待清理包含的归类卡', '归类');
  addField(classificationWithStaleContain, '包含');
  classificationWithStaleContain.appendMarkdownComment(`- [已删除子卡](${staleContainLink})`);
  classificationWithStaleContain.appendMarkdownComment(`- [有效包含子卡](${validContainChild.noteURL})`);
  classificationWithStaleContain.appendMarkdownComment(`[保留的普通行内链接](${stalePlainInlineLink})`);
  classificationWithStaleContain.appendMarkdownComment(`说明 - [保留的正文链接](${stalePlainInlineLink})`);
  addField(classificationWithStaleContain, '相关链接');
  classificationWithStaleContain.appendMarkdownComment(`- [保留的相关链接](${staleRelatedLink})`);

  const staleContainCleanup = KBT.cleanupMakeCardClassificationLinkFields(classificationWithStaleContain);
  assert.strictEqual(staleContainCleanup.removed, 1);
  assertFieldTexts(classificationWithStaleContain, '包含', [
    `- [有效包含子卡](${validContainChild.noteURL})`,
    `[保留的普通行内链接](${stalePlainInlineLink})`,
    `说明 - [保留的正文链接](${stalePlainInlineLink})`,
  ]);
  assertRelatedTexts(classificationWithStaleContain, [
    `- [保留的相关链接](${staleRelatedLink})`,
  ]);

  const ordinaryWithStaleContain = new FakeNote('非归类卡', '命题');
  addField(ordinaryWithStaleContain, '包含');
  ordinaryWithStaleContain.appendMarkdownComment(`- [非归类卡中的失效链接](${staleContainLink})`);
  KBT.cleanupClassificationLinkFields(ordinaryWithStaleContain);
  assertFieldTexts(ordinaryWithStaleContain, '包含', [
    `- [非归类卡中的失效链接](${staleContainLink})`,
  ]);
}

run();
console.log('definition related links regression ok');
