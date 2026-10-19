const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const knowledgeBaseSource = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

function getFunctionBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start !== -1, `missing start marker: ${startMarker}`);
  assert(end !== -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertEquivalenceBacklinkPolicy(block, label) {
  assert.match(block, /sufficiencyNote\.appendNoteLink\(note,\s*['"]To['"]\)/);
  assert.match(block, /neccessaryNote\.appendNoteLink\(note,\s*['"]To['"]\)/);
  assert.doesNotMatch(
    block,
    /moveCommentsArrToField\(sufficiencyNote,\s*['"]Z['"],\s*['"]相关链接['"]\)/,
    `${label} must keep the native backlink to the ordinary ontology note at the bottom`,
  );
  assert.doesNotMatch(
    block,
    /moveCommentsArrToField\(neccessaryNote,\s*['"]Z['"],\s*['"]相关链接['"]\)/,
    `${label} must keep the native backlink to the ordinary ontology note at the bottom`,
  );
}

assertEquivalenceBacklinkPolicy(
  getFunctionBlock(
    knowledgeBaseSource,
    'static createEquivalenceNotes(note)',
    'static getIdeaLinkMoveToField(note)',
  ),
  'MNKnowledgeBase equivalence creation',
);

assertEquivalenceBacklinkPolicy(
  getFunctionBlock(
    toolbarSource,
    'function _xdyy_createEquivalenceNotesWithoutPrefixTitle(note)',
    'global.registerCustomAction("createEquivalenceNotes"',
  ),
  'MNToolbar equivalence creation',
);

const classEnd = knowledgeBaseSource.indexOf('\nclass KnowledgeBaseIndexer');
assert(classEnd !== -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');
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
  MNUtil: { log() {}, showHUD() {} },
  KnowledgeBaseUtils: { log() {}, addErrorLog(error) { throw error; } },
  HtmlMarkdownUtils: { isHtmlMDComment() { return false; } },
};
context.global = context;
vm.createContext(context);
vm.runInContext(
  `${knowledgeBaseSource.slice(0, classEnd)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`,
  context,
);

const KBT = context.KnowledgeBaseTemplate;
KBT.getNoteType = note => note && note._type;
const ontologyBacklink = {
  _type: '命题',
  comments: [
    { type: 'HtmlComment', text: '证明' },
    { type: 'HtmlComment', text: '相关思考' },
    { type: 'HtmlComment', text: '关键词' },
    { type: 'HtmlComment', text: '相关链接' },
    { type: 'HtmlComment', text: '应用' },
    { type: 'linkComment', text: 'marginnote4app://note/ONTOLOGY-A' },
  ],
  get MNComments() {
    return this.comments;
  },
};

assert.deepStrictEqual(
  Array.from(KBT.autoGetNewContentToMoveIndexArr(ontologyBacklink, '命题')),
  [],
  'secondary make-card must leave a lone native ontology backlink below the final field',
);

console.log('equivalence native reference regression ok');
