const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'comment-manager.html'), 'utf8');
const actionsSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'actions-edit.js'),
  'utf8',
);
const bridgeSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'bridge-api.js'),
  'utf8',
);
const eventsSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'events-bind.js'),
  'utf8',
);
const closeSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'bridge-utils.js'),
  'utf8',
);
const controllerSource = fs.readFileSync(
  path.join(root, 'knowledgebaseWebController.js'),
  'utf8',
);

assert(html.includes('id="editReplacementMarkdown"'));
assert(html.includes('id="pasteReplacementMarkdownBtn"'));
assert(actionsSource.includes('replacementMarkdown: getEditReplacementMarkdownValue()'));
assert(actionsSource.includes('parseStandaloneMarkdownLinkInput'));
assert(eventsSource.includes("pasteClipboardToEditLinkField('replacementMarkdown')"));
assert(bridgeSource.includes('replacementMarkdown: dom.editReplacementMarkdown'));
assert(bridgeSource.includes('replacementMarkdown,'));
assert(closeSource.includes('draft.replacementMarkdown.length > 0'));
assert(controllerSource.includes('config.params.replacementMarkdown'));
assert(controllerSource.includes('success = await this.editMarkdownLink'));

const helperStart = controllerSource.indexOf(
  'function parseKnowledgeBaseStandaloneMarkdownLink',
);
const helperEnd = controllerSource.indexOf(
  '\nfunction updateKnowledgeBaseLinkBackrefs',
  helperStart,
);
assert.notStrictEqual(helperStart, -1, 'Cannot locate standalone Markdown link parser');
assert.notStrictEqual(helperEnd, -1, 'Cannot locate Markdown replacement helper boundary');

const context = {
  KnowledgeBaseTemplate: {
    parseMarkdownLinksFromText(text) {
      const source = String(text || '');
      const links = [];
      const matcher = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match = matcher.exec(source);
      while (match) {
        links.push({
          displayText: match[1],
          url: match[2],
          start: match.index,
          end: match.index + match[0].length,
        });
        match = matcher.exec(source);
      }
      return links;
    },
  },
  makeKnowledgeBaseMarkdownLink(displayText, url) {
    return `[${displayText}](${url})`;
  },
};
vm.createContext(context);
vm.runInContext(
  `${controllerSource.slice(helperStart, helperEnd)}\n`
    + 'this.buildReplacement = buildKnowledgeBaseMarkdownLinkReplacement;',
  context,
);

const sourceText = '前文 [旧链接](old://url) 中段 [保留链接](keep://url) 后文';
const replacement = context.buildReplacement(
  sourceText,
  0,
  '忽略的分字段文本',
  'ignored://url',
  '[新链接](new://url)',
);
assert.strictEqual(replacement.error, '');
assert.strictEqual(replacement.newDisplayText, '新链接');
assert.strictEqual(replacement.newUrl, 'new://url');
assert.strictEqual(
  replacement.newText,
  '前文 [新链接](new://url) 中段 [保留链接](keep://url) 后文',
  'direct Markdown input must replace only the selected link range',
);

const secondLinkReplacement = context.buildReplacement(
  sourceText,
  1,
  '忽略的分字段文本',
  'ignored://url',
  '[第二条新链接](second-new://url)',
);
assert.strictEqual(secondLinkReplacement.error, '');
assert.strictEqual(
  secondLinkReplacement.newText,
  '前文 [旧链接](old://url) 中段 [第二条新链接](second-new://url) 后文',
  'linkIndex must identify the clicked link without changing adjacent text or links',
);

const splitFieldFallback = context.buildReplacement(
  sourceText,
  0,
  '分字段新标题',
  'split://url',
  '',
);
assert.strictEqual(splitFieldFallback.error, '');
assert.strictEqual(
  splitFieldFallback.newText,
  '前文 [分字段新标题](split://url) 中段 [保留链接](keep://url) 后文',
);

[
  '前缀 [新链接](new://url)',
  '[新链接](new://url) 后缀',
  '[一](one://url) [二](two://url)',
  '[新链接](https://example.com/a(b))',
  '[](new://url)',
  '[新链接]()',
].forEach((invalidMarkdown) => {
  const result = context.buildReplacement(sourceText, 0, 'x', 'y', invalidMarkdown);
  assert.strictEqual(
    result.error,
    '请输入一条完整的 Markdown 链接',
    `must reject non-standalone Markdown input: ${invalidMarkdown}`,
  );
});

console.log('comment manager direct Markdown link replacement regression ok');
