const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(rootDir, 'utils.js'), 'utf8');
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');

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
const title = '伴随算子 T* 与 S**；区间 [0,1]；路径 \\root';
const encodedTitle = '伴随算子 T&#42; 与 S&#42;&#42;；区间 &#91;0,1&#93;；路径 \\\\root';
const noteUrl = 'marginnote4app://note/STAR-NOTE';

assert.strictEqual(
  KBT.escapeMarkdownLinkText(title),
  encodedTitle,
  'all ASCII asterisks must be encoded without changing brackets or backslashes',
);
assert.strictEqual(
  KBT.unescapeMarkdownLinkText(encodedTitle),
  title,
  'encoded link display text must round-trip to the original title',
);

const markdownLink = KBT.makeMarkdownInlineNoteLink(title, noteUrl, { listItem: true });
assert.strictEqual(markdownLink, `- [${encodedTitle}](${noteUrl})`);

const parsedLinks = KBT.parseMarkdownLinksFromText(markdownLink, { marginNoteOnly: true });
assert.strictEqual(parsedLinks.length, 1);
assert.strictEqual(parsedLinks[0].displayText, title);
assert.strictEqual(parsedLinks[0].noteId, 'STAR-NOTE');

const webControllerSource = fs.readFileSync(
  path.join(rootDir, 'knowledgebaseWebController.js'),
  'utf8',
);
assert(
  webControllerSource.includes('.replace(/\\*/g, "&#42;")'),
  'WebController fallback must use the same asterisk entity encoding',
);

const commentManagerSource = fs.readFileSync(
  path.join(rootDir, 'scripts', 'comment-manager', 'actions-merge.js'),
  'utf8',
);
assert(
  commentManagerSource.includes(".replace(/\\*/g, '&#42;')"),
  'comment-manager link generation must use the same asterisk entity encoding',
);

console.log('markdown link escaping regression ok');
