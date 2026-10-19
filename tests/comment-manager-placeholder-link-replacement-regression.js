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

assert(rendererSource.includes('class="placeholder-replace-btn"'));
assert(rendererSource.includes('aria-label="占位替换并删除旧卡片"'));
assert(eventSource.includes("target.closest('.placeholder-replace-btn')"));
assert(eventSource.includes('handlePlaceholderReplaceSingleLink(commentIndex, linkIndex)'));
assert(actionSource.includes('Bridge.replacePlaceholderLink(noteId, [normalizedCommentIndex], normalizedLinkIndex)'));
assert(bridgeSource.includes("'replacePlaceholderLink'"));
assert(bridgeSource.includes("replacePlaceholderLink: createIndexedBridgeMethod('replacePlaceholderLink'"));
assert(controllerSource.includes('"replaceplaceholderlink"'));
assert(controllerSource.includes('case "replacePlaceholderLink":'));
assert(controllerSource.includes('success = replacementResult.success === true'));
assert(controllerSource.includes('knowledgebaseWebController.prototype.replacePlaceholderLink'));
assert(controllerSource.includes('MNUtil.confirm('));
assert(controllerSource.includes('["取消", "替换并删除"]'));
assert(controllerSource.includes('oldTargetNote._delete(false)'));
assert(controllerSource.includes('delete MNNote.noteCache[oldTargetNoteId]'));
assert(controllerSource.includes('removeSearchCardIndex(oldTargetNoteId'));
assert(controllerSource.includes('placeholder-replace-rollback'));
assert(cssSource.includes('.placeholder-replace-btn'));

const helperStart = controllerSource.indexOf(
  'function buildKnowledgeBasePlaceholderReplacementPlan',
);
const helperEnd = controllerSource.indexOf(
  '\nfunction knowledgeBaseNoteHasApplicationLink',
  helperStart,
);
assert.notStrictEqual(helperStart, -1, 'Cannot locate placeholder replacement plan helper');
assert.notStrictEqual(helperEnd, -1, 'Cannot locate placeholder replacement plan helper boundary');

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
    getStandaloneNoteLinkInfoFromComment(comment) {
      const links = this.parseMarkdownLinksFromText(comment.text);
      if (links.length !== 1) return null;
      return links[0];
    },
  },
  buildKnowledgeBaseMarkdownLinkReplacement(originalText, linkIndex, displayText, newUrl) {
    const links = context.KnowledgeBaseTemplate.parseMarkdownLinksFromText(originalText);
    const targetLink = links[linkIndex];
    if (!targetLink) return { error: '链接索引无效' };
    const markdown = `[${displayText}](${newUrl})`;
    return {
      error: '',
      targetLink,
      newText: originalText.slice(0, targetLink.start) + markdown + originalText.slice(targetLink.end),
    };
  },
  makeKnowledgeBaseMarkdownLink(displayText, url, options = {}) {
    const markdown = `[${displayText}](${url})`;
    return options.listItem ? `- ${markdown}` : markdown;
  },
};
vm.createContext(context);
vm.runInContext(
  `${controllerSource.slice(helperStart, helperEnd)}\n`
    + 'this.buildPlan = buildKnowledgeBasePlaceholderReplacementPlan;',
  context,
);

const sourceText = '前文 [第一条](marginnote4app://note/OLD-1) 中段 [占位知识点](marginnote4app://note/OLD-2) 后文';
const plan = context.buildPlan(
  { type: 'markdownComment', text: sourceText },
  1,
  'marginnote4app://note/NEW',
);
assert.strictEqual(plan.error, '');
assert.strictEqual(plan.oldUrl, 'marginnote4app://note/OLD-2');
assert.strictEqual(
  plan.nextText,
  '前文 [第一条](marginnote4app://note/OLD-1) 中段 [占位知识点](marginnote4app://note/NEW) 后文',
  'placeholder replacement must preserve display text, surrounding text, and adjacent links',
);

const directPlan = context.buildPlan(
  { type: 'linkComment', text: 'marginnote4app://note/OLD-DIRECT' },
  undefined,
  'marginnote4app://note/NEW-DIRECT',
);
assert.strictEqual(directPlan.error, '');
assert.strictEqual(directPlan.oldUrl, 'marginnote4app://note/OLD-DIRECT');
assert.strictEqual(directPlan.nextText, 'marginnote4app://note/NEW-DIRECT');

console.log('comment manager placeholder link replacement regression ok');
