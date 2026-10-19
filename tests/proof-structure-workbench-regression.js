const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const Core = require(path.join(root, 'scripts/proof-structure-workbench/core.js'));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const payload = {
  noteId: 'note-proof',
  noteTitle: '测试命题',
  field: {
    name: '证明',
    text: '<b>证明：</b>',
    index: 4,
    startIndex: 5,
    endIndex: 14,
    commentIndices: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  },
  comments: [
    { index: 5, originalType: 'TextNote', detailedType: 'markdownComment', htmlMarkdownType: 'goal', htmlMarkdownContent: '总目标', text: '<span id="goal">🎯 总目标</span>' },
    { index: 6, originalType: 'TextNote', detailedType: 'textComment', text: '目标的说明' },
    { index: 7, originalType: 'TextNote', detailedType: 'markdownComment', htmlMarkdownType: 'level1', htmlMarkdownContent: '第一层' },
    { index: 8, originalType: 'TextNote', detailedType: 'markdownComment', htmlMarkdownType: 'step', htmlMarkdownContent: '步骤一' },
    { index: 9, originalType: 'LinkNote', detailedType: 'mergedTextComment', text: '步骤一的依据' },
    { index: 10, originalType: 'TextNote', detailedType: 'markdownComment', htmlMarkdownType: 'step', htmlMarkdownContent: '步骤二' },
    { index: 11, originalType: 'PaintNote', detailedType: 'drawingComment' },
    { index: 12, originalType: 'TextNote', detailedType: 'markdownComment', htmlMarkdownType: 'level3', htmlMarkdownContent: '跳级层' },
    { index: 13, originalType: 'TextNote', detailedType: 'markdownComment', htmlMarkdownType: 'claim', htmlMarkdownContent: '未知类型' },
    { index: 14, originalType: 'AudioNote', detailedType: 'audioComment', text: '(音频评论)' },
  ],
};

const parsed = Core.parsePayload(payload);
assert.strictEqual(parsed.structuralCount, 5, 'goal/level/step 应成为结构节点');
assert.strictEqual(parsed.tree.children[0].htmlMDType, 'goal');
assert.strictEqual(parsed.tree.children[0].evidence[0].sourceIndex, 6, 'goal 后普通内容应归入 goal');

const level1 = parsed.tree.children[0].children[0];
assert.strictEqual(level1.htmlMDType, 'level1');
assert.deepStrictEqual(level1.children.slice(0, 2).map((node) => node.htmlMDType), ['step', 'step']);
assert.strictEqual(level1.children[0].evidence[0].sourceIndex, 9, '普通内容应归入最近 step');
assert.strictEqual(level1.children[1].evidence[0].sourceIndex, 11, '媒体应保持内容身份');

const level3 = level1.children[2];
assert.strictEqual(level3.htmlMDType, 'level3');
assert(level3.diagnostics.includes('LEVEL_GAP'), '跳级应产生 LEVEL_GAP');
assert(level3.evidence.some((item) => item.diagnostics.includes('UNKNOWN_HTMLMD_TYPE')));
assert(level3.evidence.some((item) => item.diagnostics.includes('AUDIO_TEXT_UNAVAILABLE')));

const stepWithoutLevel = Core.parsePayload({
  noteId: 'step-only',
  field: { name: '原理', index: 0 },
  comments: [{ index: 1, detailedType: 'markdownComment', htmlMarkdownType: 'step', htmlMarkdownContent: '孤立步骤' }],
});
assert(stepWithoutLevel.tree.children[0].diagnostics.includes('STEP_WITHOUT_LEVEL'));

const empty = Core.parsePayload({ noteId: 'empty', field: { name: '反例', index: 0 }, comments: [] });
assert.strictEqual(empty.tree.children.length, 0);
assert.strictEqual(empty.structuralCount, 0);

const multipleGoals = Core.parsePayload({
  noteId: 'multiple-goals',
  field: { name: '证明', index: 0 },
  comments: [
    { index: 1, detailedType: 'markdownComment', htmlMarkdownType: 'goal', htmlMarkdownContent: '目标一' },
    { index: 2, detailedType: 'textComment', text: '目标一内容' },
    { index: 3, detailedType: 'markdownComment', htmlMarkdownType: 'goal', htmlMarkdownContent: '目标二' },
    { index: 4, detailedType: 'textComment', text: '目标二内容' },
  ],
});
assert.deepStrictEqual(multipleGoals.tree.children.map((node) => node.title), ['目标一', '目标二']);
assert.strictEqual(multipleGoals.tree.children[1].evidence[0].sourceIndex, 4);

const renderList = read('scripts/comment-manager/render-list.js');
const eventsList = read('scripts/comment-manager/events-list.js');
const bridgeApi = read('scripts/comment-manager/bridge-api.js');
const controller = read('knowledgebaseWebController.js');
const main = read('main.js');
const html = read('proof-structure-workbench.html');
const app = read('scripts/proof-structure-workbench/app.js');
const css = read('styles/proof-structure-workbench.css');
const build = read('build/payload.json');

assert(renderList.includes("['证明', '反例', '原理'].includes(normalizedFieldName)"));
assert(renderList.includes('proof-structure-open-btn'));
assert(eventsList.includes("target.closest('.field-checkbox, .proof-structure-open-btn')"));
assert(eventsList.includes('Bridge.openProofStructureWorkbench(state.noteId, fieldName)'));
assert(bridgeApi.includes("createPayloadBridgeMethod('openProofStructureWorkbench'"));

[
  'openproofstructureworkbench',
  'returntocommentmanager',
  'openproofstructurehtmlmdstudio',
  'closeproofstructureworkbench',
].forEach((action) => assert(controller.includes(`"${action}"`), `${action} 必须进入 Native allowlist`));
assert(controller.includes('loadProofStructureWorkbenchHTML'));
assert(controller.includes('loadProofStructureWorkbenchData'));
assert(controller.includes('requestCloseProofStructureWorkbench'));

assert(main.includes('prepareProofStructureWorkbenchData'));
assert(main.includes('fieldObject.excludingFieldBlockIndexArr'));
assert(main.includes('KnowledgeBaseTemplate.resolveFieldName("证明", noteType)'));
assert(main.includes('proofFieldNames.has(requestedFieldName)'));
assert(main.includes('currentCommentManagerFocusIndex'));

assert(html.includes('./scripts/proof-structure-workbench/core.js'));
assert(html.includes('./scripts/proof-structure-workbench/app.js'));
assert(!html.includes('proposition-proof-structure-workbench.js'), '生产页面不能加载原型 fixture');
assert(app.includes('global.loadProofStructureWorkbenchData'));
assert(app.includes("postToNative('ready', {})"));
assert(css.includes('[hidden] { display: none !important; }'), '生产样式不能覆盖 hidden 状态');
assert(build.includes('proof-structure-workbench.html'));
assert(build.includes('scripts/proof-structure-workbench/core.js'));

console.log('proof-structure-workbench regression passed');
