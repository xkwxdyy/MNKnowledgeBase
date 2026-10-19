const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
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
    copy() {},
    delay() {
      return {
        then(callback) {
          callback();
        },
      };
    },
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
  UIAlertView: {
    showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
      _title,
      _message,
      _style,
      _cancelTitle,
      _options,
      tap,
    ) {
      tap({ textFieldAtIndex: () => ({ text: '' }) }, 2);
    },
  },
};
context.global = context;
vm.createContext(context);
vm.runInContext(`${source.slice(0, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`, context);

const KBT = context.KnowledgeBaseTemplate;
const parent = {
  noteTitle: '父卡',
  noteURL: 'marginnote4app://note/PARENT',
};
const child = { noteTitle: '子卡', parentNote: parent };

KBT.normalizeTitleSpaces = text => String(text || '').trim();
KBT.getNoteType = note => (note === parent ? '定义' : '命题');
KBT.parseNoteTitle = note => {
  if (note === parent) {
    return {
      prefixContent: '紧性',
      content: '紧空间的连续像是紧的',
      titleLinkWordsArr: ['紧空间的连续像是紧的'],
    };
  }
  return {};
};

assert.strictEqual(
  KBT.getFirstTitleLinkWord(parent),
  '紧空间的连续像是紧的',
  'default title-link word must exclude the prefix',
);
assert.strictEqual(
  KBT.getFirstTitleLinkWord(parent, { includePrefix: true }),
  '紧性｜紧空间的连续像是紧的',
  'context-sensitive callers may explicitly retain the prefix',
);
let copied = '';
context.MNUtil.copy = text => {
  copied = text;
};
KBT.copyMarkdownLinkWithQuickPhrases(parent);
assert.strictEqual(
  copied,
  '[紧空间的连续像是紧的](marginnote4app://note/PARENT)',
  'menu_card uses the prefix-free first title-link word',
);
assert.strictEqual(
  KBT.getDefaultClassificationTitleContent(child),
  '紧性｜紧空间的连续像是紧的｜子卡',
  'classification title construction must retain its parent context',
);
assert.strictEqual(
  KBT.getTemplateChainBaseTitle(parent),
  '紧性｜紧空间的连续像是紧的',
  'template-chain base titles must retain their parent context',
);

assert.strictEqual(
  KBT.getAddTemplateDefaultTitle(parent),
  '紧性｜紧空间的连续像是紧的',
  'AddTemplate must keep the separator when both title parts exist',
);
KBT.parseNoteTitle = () => ({
  prefixContent: undefined,
  titleLinkWordsArr: ['紧空间的连续像是紧的'],
});
assert.strictEqual(
  KBT.getAddTemplateDefaultTitle(parent),
  '紧空间的连续像是紧的',
  'AddTemplate must omit an undefined prefix and its separator',
);
KBT.parseNoteTitle = () => ({
  prefixContent: '紧性',
  titleLinkWordsArr: [],
});
assert.strictEqual(
  KBT.getAddTemplateDefaultTitle(parent),
  '紧性',
  'AddTemplate must omit a missing title-link word and its separator',
);

console.log('title link word prefix regression ok');
