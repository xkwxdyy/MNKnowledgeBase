const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
if (end === -1) throw new Error('Cannot locate KnowledgeBaseTemplate in utils.js');

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
vm.runInContext(`${source.slice(0, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`, context);

const KBT = context.KnowledgeBaseTemplate;
KBT.getNoteType = note => note && note._type;

function makeNote(type, comments) {
  return {
    _type: type,
    comments,
    get MNComments() {
      return this.comments;
    },
  };
}

const listLinkBefore = '- [前置归类](marginnote4app://note/CLASSIFICATION-BEFORE)';
const listLinkAfter = '- [后置归类](marginnote4app://note/CLASSIFICATION-AFTER)';
const plainLinkAfter = '[后置纯链接](marginnote4app://note/CLASSIFICATION-PLAIN)';
const inlineLinkBody = '普通正文 [参考卡片](marginnote4app://note/REFERENCE) 仍然属于正文';

const definition = makeNote('定义', [
  { type: 'HtmlComment', text: '相关链接' },
  { type: 'markdownComment', text: listLinkBefore },
  { type: 'mergedTextComment', text: '本次新合并的摘录' },
  { type: 'markdownComment', text: listLinkAfter },
  { type: 'markdownComment', text: plainLinkAfter },
  { type: 'linkComment', text: 'marginnote4app://note/NATIVE-LINK-AFTER' },
  { type: 'markdownComment', text: inlineLinkBody },
]);

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(definition)),
  [2, 3, 4, 5, 6],
  'default new-content detection must preserve the complete batch used by initial make-card',
);

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(definition, null, {
    excludeBoundaryLinks: true,
  })),
  [2, 6],
  'field organization must keep the new excerpt and ordinary Markdown body but exclude structural links on both sides',
);

const classification = makeNote('归类', [
  { type: 'HtmlComment', text: '包含' },
  { type: 'mergedTextComment', text: '归类卡新增正文' },
  { type: 'markdownComment', text: listLinkAfter },
  { type: 'linkComment', text: 'marginnote4app://note/NATIVE-CLASSIFICATION-LINK' },
]);

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(classification, null, {
    excludeBoundaryLinks: true,
  })),
  [1],
  'classification field organization must exclude trailing Markdown and native structural links',
);

const definitionWithoutFields = makeNote('定义', [
  { type: 'mergedTextComment', text: '无字段定义卡新增正文' },
  { type: 'markdownComment', text: listLinkAfter },
]);

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(definitionWithoutFields, null, {
    excludeBoundaryLinks: true,
  })),
  [0],
  'explicit definition field organization must filter structural Markdown links even without an HTML field boundary',
);

const proposition = makeNote('命题', [
  { type: 'HtmlComment', text: '应用' },
  { type: 'mergedTextComment', text: '命题新增正文' },
  { type: 'markdownComment', text: listLinkAfter },
]);

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(proposition)),
  [1, 2],
  'non-definition/classification cards must preserve the existing complete Markdown comment batch policy',
);

const originalLink = {
  type: 'linkComment',
  text: 'marginnote4app://note/SINGLE-NATIVE-LINK',
};
const singleNativeLinkNote = makeNote('命题', [originalLink]);
let bottomMove = null;
singleNativeLinkNote.moveCommentsByIndexArr = (indices, targetIndex) => {
  bottomMove = {
    indices: Array.from(indices),
    targetIndex,
  };
};

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(singleNativeLinkNote, '命题')),
  [0],
  'a single native link must remain in the initial make-card batch',
);

KBT._beginMakeCardPerf = () => ({});
KBT._makeCardPerfNow = () => 0;
KBT._recordMakeCardPerf = () => {};
KBT._finishMakeCardPerf = () => {};
KBT.sanitizeNoteCommentsForMake = () => {};
KBT.extractMarginNoteLinksFromComments = () => [];
KBT.mergeTemplate = (note) => {
  note.comments.push(
    { type: 'HtmlComment', text: '证明' },
    { type: 'HtmlComment', text: '应用' },
  );
  return false;
};

KBT.mergeTemplateAndAutoMoveNoteContent(singleNativeLinkNote, false, {
  noteType: '命题',
});

assert.deepStrictEqual(bottomMove, {
  indices: [0],
  targetIndex: 3,
}, 'initial make-card must move the single native link below the final application field');

console.log('auto-move structural link regression ok');
