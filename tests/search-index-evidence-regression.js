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
    extractNoteLinkUrlsFromField() { return []; },
    extractNoteIdFromLinkUrl() { return ''; },
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
    resolveFieldName(fieldName) {
      return fieldName;
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

const note = {
  noteId: 'CARD-EVIDENCE-1',
  type: '命题',
  title: '命题; SOT 收敛判定',
  parentNoteId: null,
  parsedTitle: { content: 'SOT 收敛判定', prefixContent: '命题' },
  excerptText: '若对每个 h ∈ H，都有 ‖Aᵢh − Ah‖ → 0。',
  excerptPic: { paint: 'image-paint-must-not-be-indexed' },
  keywords: 'SOT; 强算子收敛',
  commentsObj: {
    htmlCommentsObjArr: [{ text: '证明', excludingFieldBlockIndexArr: [0] }],
  },
  comments: [{ type: 'textComment', text: '由一致有界性得到结论。' }],
};

const entry = context.TestIndexer.buildIndexEntry(note, 'light');
assert.ok(entry, 'a text-bearing card should be indexed');
assert.ok(entry.searchText.includes('aᵢh'), 'excerpt text must enter the legacy searchText recall field');
assert.strictEqual(entry.excerptArea, note.excerptText);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(entry.searchEvidence)),
  [
    { field: 'title', text: note.title },
    { field: 'excerptArea', text: note.excerptText },
    { field: 'keywords', text: note.keywords },
    { field: 'supportingFields', text: '由一致有界性得到结论。', fieldNames: ['证明', '相关思考'] },
  ],
  'AI rerank evidence must retain title, excerpt, keywords, and existing text proof fields',
);
assert.ok(!JSON.stringify(entry).includes('image-paint-must-not-be-indexed'));

const mediaOnlyNote = {
  noteId: 'CARD-EVIDENCE-2',
  type: '命题',
  title: '命题; 仅图片摘录',
  parsedTitle: { content: '仅图片摘录' },
  excerptPic: { paint: 'image-only' },
  comments: [{ type: 'drawingComment', text: '手写内容不应被当作文本' }],
  commentsObj: { htmlCommentsObjArr: [] },
};
const mediaEntry = context.TestIndexer.buildIndexEntry(mediaOnlyNote, 'light');
assert.ok(mediaEntry);
assert.deepStrictEqual(JSON.parse(JSON.stringify(mediaEntry.searchEvidence)), [
  { field: 'title', text: mediaOnlyNote.title },
]);
assert.ok(!JSON.stringify(mediaEntry).includes('image-only'));
assert.ok(!JSON.stringify(mediaEntry).includes('手写内容'));

console.log('search index evidence regression: ok');
