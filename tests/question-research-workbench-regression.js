'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'question-research-workbench.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/question-research-workbench.css'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'scripts/question-research-workbench/core.js'), 'utf8');
const batchBuild = fs.readFileSync(path.join(root, 'build/payload.json'), 'utf8');

assert(html.includes('正在读取问题研究上下文'), 'formal page must wait for Native data');
assert(html.includes('./scripts/question-research-workbench/core.js'), 'formal page must load core contract');
assert(html.includes('./scripts/question-research-workbench/app.js'), 'formal page must load app contract');
assert(!html.includes('i-new-'), 'formal page must not contain prototype fake IDs');
assert(
  /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/.test(css),
  'author display rules must not override the hidden loading/workbench states',
);
assert(
  /\.topbar\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;[^}]*\}/.test(css),
  'research toolbar must remain constrained to the WebView width',
);
assert(
  /\.heading\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*\}/.test(css),
  'long research titles must shrink instead of pushing toolbar actions outside the WebView',
);

[
  'researchWorkbenchSave',
  'researchWorkbenchCreateNode',
  'refreshResearchWorkbench',
  'closeResearchWorkbench',
].forEach((action) => {
  assert(controller.includes(action), `Native controller missing ${action}`);
});
assert(controller.includes('KB_QuestionResearchWorkbenchFrame'), 'research workbench needs independent frame storage');
assert(controller.includes('canReplaceContext'), 'Native surface replacement must ask the page dirty guard');
assert(main.includes("currentType !== 'TextNote'"), 'only TextNote comments may be edited');
assert(main.includes('rawComment.markdown'), 'save must preserve the raw comment markdown mode');
assert(main.includes('appendMarkdownComment(text, index)'), 'markdown comments must be replaced through appendMarkdownComment');
assert(main.includes('appendTextComment(text, index)'), 'text comments must be replaced through appendTextComment');
assert(main.includes('createResearchWorkbenchNode'), 'Native create path missing');
assert(
  main.includes("KnowledgeBaseTemplate.upsertNoteNativeLinkInField(childNote, parentNote, '相关链接')"),
  'research workbench child cards must keep one native parent backlink',
);
assert(
  !main.includes('childNote.appendMarkdownComment(backlink)'),
  'research workbench must not add a second inline backlink to child related links',
);
[
  'question-research-workbench.html',
  'styles/question-research-workbench.css',
  'scripts/question-research-workbench/core.js',
  'scripts/question-research-workbench/app.js',
].forEach((runtimeFile) => {
  assert(batchBuild.includes(runtimeFile), `batch builder missing ${runtimeFile}`);
});
assert(JSON.parse(batchBuild).includes('question-research-workbench.html'), 'standalone package must include the question research workbench HTML entry');

const context = { window: {}, Math, Date };
context.window = context;
vm.runInNewContext(coreSource, context, { filename: 'core.js' });
const Core = context.ResearchWorkbenchCore;

const model = {
  entry: { noteId: 'q-1' },
  rootQuestion: {
    noteId: 'q-1',
    revision: 'q-rev-1',
    fields: [{ name: '问题详情', comments: [{ index: 1, type: 'TextNote', editable: true, text: '原问题' }] }],
  },
  ideas: [{
    noteId: 'i-1',
    revision: 'i-rev-1',
    fields: [{ name: '思路详情', comments: [{ index: 2, type: 'TextNote', editable: true, text: '原思路' }] }],
  }],
  summaries: [],
};
const drafts = new Map([
  [Core.commentKey('q-1', 1), '新问题'],
  [Core.commentKey('i-1', 2), '原思路'],
]);
const updates = Core.collectUpdates(model, drafts);
assert.strictEqual(JSON.stringify(updates), JSON.stringify([{
  noteId: 'q-1',
  index: 1,
  baseRevision: 'q-rev-1',
  baseText: '原问题',
  text: '新问题',
  markdown: false,
}]));

console.log('question research workbench regression ok');
