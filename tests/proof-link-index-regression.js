const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');

function extractStaticMethod(name) {
  const marker = `  static ${name}`;
  const start = utilsSource.indexOf(marker);
  assert.ok(start >= 0, `Cannot locate ${name}`);
  const signatureEnd = utilsSource.indexOf(') {', start);
  const bodyStart = signatureEnd + 2;
  assert.ok(bodyStart >= 0, `Cannot locate body of ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < utilsSource.length; index += 1) {
    if (utilsSource[index] === '{') depth += 1;
    if (utilsSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return utilsSource.slice(start, index + 1);
    }
  }
  throw new Error(`Cannot locate end of ${name}`);
}

const context = {
  console,
  Array,
  Set,
  String,
  Number,
  Boolean,
  RegExp,
  Math,
  KnowledgeBaseUtils: {
    log() {},
    addErrorLog(error) {
      throw error;
    },
  },
  KnowledgeBaseTemplate: {
    getNoteType(note) {
      return note.type;
    },
    parseNoteTitle(note) {
      return note.parsedTitle || {};
    },
    getKeywordsFromNote(note) {
      return note.keywords || '';
    },
    parseNoteComments(note) {
      return note.commentsObj || { htmlCommentsObjArr: [] };
    },
    getSafeComments(note) {
      return Array.isArray(note.comments) ? note.comments : [];
    },
    resolveFieldName(fieldName, type) {
      return fieldName === '证明' ? ({ 反例: '反例', 思想方法: '原理' }[type] || fieldName) : fieldName;
    },
    normalizeFieldName(value) {
      return String(value || '').replace(/[：:]/g, '').trim();
    },
    getSafeCommentType(comment) {
      return comment?.type || '';
    },
    getSafeCommentText(comment) {
      return comment?.text || '';
    },
  },
};
vm.createContext(context);

const templateMethods = [
  'isMarginNoteLink', 'getHtmlFieldObjectByName', 'extractNoteLinkUrlsFromField',
  'extractMarginNoteLinkUrlsFromText', 'extractNoteIdFromLinkUrl',
].map(extractStaticMethod);
vm.runInContext(`
  class LinkTemplate { ${templateMethods.join('\n')} }
  Object.setPrototypeOf(LinkTemplate, KnowledgeBaseTemplate);
  this.KnowledgeBaseTemplate = LinkTemplate;
`, context);

const methods = [
  extractStaticMethod('normalizeSupplementalSearchText'),
  extractStaticMethod('cleanHighlightMarkers'),
  extractStaticMethod('decodeHtmlEntities'),
  extractStaticMethod('extractSearchableTextFromComment'),
  extractStaticMethod('extractSupplementalSearchText'),
  extractStaticMethod('extractProofLinks'),
  extractStaticMethod('extractExcerptAreaText'),
  extractStaticMethod('truncateSearchEvidenceText'),
  extractStaticMethod('buildSearchEvidence'),
  extractStaticMethod('buildIndexEntry'),
  extractStaticMethod('upsertIncrementalIndexEntry'),
];

vm.runInContext(`
  class TestIndexer {
    static supplementalSearchFieldConfig = { 命题: ['证明', '相关思考'] };
    static normalizeUsageScore() { return 0; }
    static buildSearchText(parsedTitle, noteType, keywords) {
      return [noteType, parsedTitle.content, keywords].filter(Boolean).join(' ').toLowerCase();
    }
    static expandSearchTextWithSynonyms(value) { return value; }
    static analyzeExclusionGroups() { return []; }
    ${methods.join('\n')}
  }
  this.TestIndexer = TestIndexer;
`, context);

const plain = value => JSON.parse(JSON.stringify(value));
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const urlA = `marginnote4app://note/${a}`;
const urlB = `marginnote3app://note/${b}`;
const note = {
  noteId: 'SOURCE', type: '命题', title: '命题; 原命题',
  parsedTitle: { content: '原命题', prefixContent: '命题' },
  commentsObj: { htmlCommentsObjArr: [
    { text: '证明', excludingFieldBlockIndexArr: [1, 2, 3, 4, 5, 6, 7] },
    { text: '相关思考', excludingFieldBlockIndexArr: [8] },
    { text: '相关链接', excludingFieldBlockIndexArr: [9] },
  ] },
  comments: [
    { type: 'HtmlComment', text: urlB },
    { type: 'linkComment', text: urlA },
    { type: 'markdownComment', text: `- [内嵌引用](${urlB})` },
    { type: 'linkComment', text: urlA.toLowerCase() },
    { type: 'linkComment', text: 'https://example.com/' },
    { type: 'linkComment', text: 'marginnote4app://note/' },
    { type: 'textComment', text: '证明正文' },
    { type: 'imageComment', text: 'marginnote4app://note/IMAGE' },
    { type: 'linkComment', text: 'marginnote4app://note/THOUGHT' },
    { type: 'linkComment', text: 'marginnote4app://note/RELATED' },
  ],
};
// The runtime context deliberately provides no MNNote/MNUtil target lookup.
const expected = [{ noteId: a, url: urlA }, { noteId: b, url: urlB }];
for (const [type, field] of [['命题', '证明'], ['例子', '证明'], ['反例', '反例'], ['思想方法', '原理']]) {
  note.type = type;
  note.commentsObj.htmlCommentsObjArr[0].text = field;
  for (const mode of ['light', 'full']) {
    const entry = context.TestIndexer.buildIndexEntry(note, mode);
    assert.ok(entry, `${type}/${mode} must build`);
    assert.deepStrictEqual(plain(entry.proofLinks), expected);
    assert.ok(!entry.searchText.includes(a.toLowerCase()), 'link identity must not pollute keyword search');
    assert.ok(!JSON.stringify(entry.searchEvidence).includes(a), 'links must not become AI text evidence');
    assert.deepStrictEqual(plain(context.TestIndexer.buildIndexEntry(note, mode).proofLinks), expected);
  }
}
note.type = '定义';
assert.deepStrictEqual(plain(context.TestIndexer.buildIndexEntry(note).proofLinks), []);
note.type = '命题';
note.commentsObj.htmlCommentsObjArr[0].text = '证明';
note.comments[1] = { type: 'linkComment', text: urlB };
assert.deepStrictEqual(plain(context.TestIndexer.buildIndexEntry(note).proofLinks), [expected[1], { noteId: a, url: urlA.toLowerCase() }]);
note.commentsObj.htmlCommentsObjArr[0].excludingFieldBlockIndexArr = [];
assert.deepStrictEqual(plain(context.TestIndexer.buildIndexEntry(note).proofLinks), [], 'removed references must clear on rebuild');
note.commentsObj.htmlCommentsObjArr = [];
assert.deepStrictEqual(plain(context.TestIndexer.buildIndexEntry(note).proofLinks), []);
assert.deepStrictEqual(plain(context.TestIndexer.extractProofLinks(null, '命题')), []);
// Exercise production incremental writes, including replacement, removal and failure.
Object.assign(context.KnowledgeBaseTemplate, {
  _beginMakeCardPerf() {}, _makeCardPerfNow() { return 0; },
  _recordMakeCardPerf() {}, _finishMakeCardPerf() {},
});
context.KnowledgeBaseUtils.emitRuntimeLog = () => {};
let stored = { metadata: {}, cards: [] };
let failSave = false;
Object.assign(context.TestIndexer, {
  loadIncrementalIndex() { return plain(stored); },
  saveIncrementalIndex(value) {
    if (failSave) return false;
    stored = plain(value);
    return true;
  },
  getStaleIndexIdsForNote() { return []; },
  updateIncrementalRemovedIds() {},
});
note.commentsObj.htmlCommentsObjArr = [{ text: '证明', excludingFieldBlockIndexArr: [1, 2] }];
note.comments[1] = { type: 'linkComment', text: urlA };
for (let i = 0; i < 2; i += 1) {
  assert.strictEqual(context.TestIndexer.upsertIncrementalIndexEntry(note, 'light').success, true);
  assert.strictEqual(stored.cards.length, 1);
  assert.deepStrictEqual(stored.cards[0].proofLinks, expected);
}
note.commentsObj.htmlCommentsObjArr[0].excludingFieldBlockIndexArr = [];
assert.strictEqual(context.TestIndexer.upsertIncrementalIndexEntry(note, 'light').success, true);
assert.deepStrictEqual(stored.cards[0].proofLinks, []);
failSave = true;
note.commentsObj.htmlCommentsObjArr[0].excludingFieldBlockIndexArr = [1];
assert.strictEqual(context.TestIndexer.upsertIncrementalIndexEntry(note, 'light').success, false);
assert.deepStrictEqual(stored.cards[0].proofLinks, [], 'failed writes must not claim persisted links');
console.log('proof-link index regression passed');
