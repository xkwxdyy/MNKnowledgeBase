const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const rendererSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'render-cards.js'),
  'utf8',
);
const eventSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'events-list.js'),
  'utf8',
);
const actionSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'actions-danger.js'),
  'utf8',
);
const bridgeSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'bridge-api.js'),
  'utf8',
);
const controllerSource = fs.readFileSync(
  path.join(root, 'knowledgebaseWebController.js'),
  'utf8',
);
const cssSource = fs.readFileSync(
  path.join(root, 'styles', 'comment-manager.css'),
  'utf8',
);

assert(rendererSource.includes('class="link-update-btn"'));
assert(rendererSource.includes('data-comment-index="${comment.index}"'));
assert(rendererSource.includes('data-link-index="${idx}"'));
assert(rendererSource.includes('const updateButton = linkedNoteId'));
assert(rendererSource.includes('<div class="link-actions">${linkButton}${updateButton}${placeholderReplaceButton}</div>'));
assert(eventSource.includes("target.closest('.link-update-btn')"));
assert(eventSource.includes('handleUpdateSingleLink(commentIndex, linkIndex)'));
assert(actionSource.includes('Bridge.updateCommentLink(noteId, [normalizedCommentIndex], normalizedLinkIndex)'));
assert(actionSource.includes("normalizedLinkIndex ?? 'comment'"));
assert(bridgeSource.includes("updateCommentLink: createIndexedBridgeMethod('updateCommentLink', '更新', (linkIndex) =>"));
assert(bridgeSource.includes('return { linkIndex: parseInt(linkIndex, 10) };'));
assert(controllerSource.includes('const rawLinkIndex = config.params.linkIndex'));
assert(controllerSource.includes('success = await this.updateCommentLink(updateNoteId, updateIndexArr, updateLinkIndex)'));
assert(controllerSource.includes('knowledgebaseWebController.prototype.updateCommentLink = async function(noteId, indexArr, linkIndex)'));
assert(controllerSource.includes('const targetMarkdownLink = parsedLinks[linkIndex]'));
assert(controllerSource.includes('targetMarkdownLink.displayText'));
assert(cssSource.includes('.link-update-btn'));

const helperStart = controllerSource.indexOf(
  'function parseKnowledgeBaseStandaloneMarkdownLink',
);
const helperEnd = controllerSource.indexOf(
  '\nfunction updateKnowledgeBaseLinkBackrefs',
  helperStart,
);
assert.notStrictEqual(helperStart, -1, 'Cannot locate Markdown replacement helper');
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

const original = '前文 [第一条](mn://first) 中段 [保留标题](mn://old) 后文';
const target = context.KnowledgeBaseTemplate.parseMarkdownLinksFromText(original)[1];
const result = context.buildReplacement(
  original,
  1,
  target.displayText,
  'marginnote4app://note/NEW-ID',
  '',
);

assert.strictEqual(result.error, '');
assert.strictEqual(result.newDisplayText, '保留标题');
assert.strictEqual(result.newUrl, 'marginnote4app://note/NEW-ID');
assert.strictEqual(
  result.newText,
  '前文 [第一条](mn://first) 中段 [保留标题](marginnote4app://note/NEW-ID) 后文',
  'per-link update must preserve display text, surrounding text, and adjacent links',
);

console.log('comment manager per-link update action regression ok');
