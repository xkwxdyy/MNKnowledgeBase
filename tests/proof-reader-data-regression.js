const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../scripts/proof-structure-workbench/core');

const multiline = Core.describeComment({ index: 0, detailedType: 'markdownComment', htmlMarkdownType: 'goal', text: '<span id="goal">🎯 **总目标**\n\n$$x_1+x_2$$</span>' });
assert.equal(multiline.body, '**总目标**\n\n$$x_1+x_2$$', '多行 HtmlMD 必须从原始 span 恢复完整正文');
const drawing = 'data:image/svg+xml;base64,PHN2Zy8+';
const parsed = Core.parsePayload({
  field: { name: '证明', index: 0 },
  comments: [
    { index: 1, detailedType: 'markdownComment', htmlMarkdownType: 'level1', htmlMarkdownContent: '第一层\n\n$$a^2+b^2=c^2$$' },
    { index: 2, detailedType: 'drawingComment', drawingPreviewDataURI: drawing },
    { index: 3, detailedType: 'mergedImageCommentWithDrawing', imageBase64: 'aW1hZ2U=', imageMimeType: 'image/png', drawingPreviewDataURI: drawing, linkedNoteId: 'SOURCE-NOTE' },
    { index: 4, detailedType: 'drawingComment', drawingPreviewPending: true },
    { index: 5, detailedType: 'mergedMarkdownComment', markdown: true, text: '第一段\n\n第二段 $x_i$' },
    { index: 6, detailedType: 'markdownComment', htmlMarkdownType: 'level3', htmlMarkdownContent: '跳级' },
  ],
});
assert.equal(parsed.items[0].body, '第一层\n\n$$a^2+b^2=c^2$$', '正文换行与公式不得被标题清理吞掉');
assert.equal(parsed.items[1].drawingPreviewDataURI, drawing);
assert.equal(parsed.items[2].role, 'media', '带回源 ID 的合并图片仍是媒体');
assert.equal(parsed.items[2].imageMimeType, 'image/png');
assert.equal(parsed.items[2].drawingPreviewDataURI, drawing);
assert.equal(parsed.items[3].drawingPreviewPending, true);
assert.equal(parsed.items[4].markdown, true);
assert.equal(parsed.items[4].body, '第一段\n\n第二段 $x_i$');
assert.equal(parsed.items[1].parentId, 'comment-1');
assert.equal(parsed.items[5].parentId, 'comment-1');
assert.equal(parsed.diagnosticCount, 1, '结构诊断须计入节点回执');
const ordinary = Core.parsePayload({ field: { name: '原理', index: 0 }, comments: Array.from({ length: 100 }, (_, i) => ({ index: i + 1, detailedType: 'textComment', text: `原文 ${i + 1}` })) });
assert.equal(ordinary.items.length, 100);
assert.equal(ordinary.structuralCount, 0, '普通评论不能被伪造为数学推导步骤');

const source = fs.readFileSync(require.resolve('../knowledgebaseWebController.js'), 'utf8');
const start = source.indexOf('knowledgebaseWebController.prototype.loadProofStructureWorkbenchData =');
const end = source.indexOf('knowledgebaseWebController.prototype.applyHtmlMDCommentUpdates', start);
const timers = [];
const injected = [];
let pending = true;
let accept = true;
const instance = {
  currentProofStructureContext: { noteId: 'NOTE', fieldName: '证明' },
  prepareProofStructureWorkbenchData(noteId, fieldName) {
    return { noteId, field: { name: fieldName }, comments: [{ index: 1, drawingPreviewPending: pending, drawingPreviewDataURI: pending ? '' : drawing }] };
  },
};
const context = vm.createContext({
  global: { MNKnowledgeBaseInstance: instance },
  knowledgebaseWebController: function() {},
  KnowledgeBaseUtils: { addErrorLog() {} },
  KB_HANDWRITING_RETRY_INTERVAL: 1,
  KB_HANDWRITING_RETRY_LIMIT: 2,
  NSTimer: { scheduledTimerWithTimeInterval(seconds, repeats, callback) { timers.push(callback); } },
});
vm.runInContext(source.slice(start, end), context);
const controller = new context.knowledgebaseWebController();
controller.currentHTMLType = 'proof-structure-workbench';
controller.webViewLoaded = true;
controller.view = { hidden: false };
controller.runJavaScript = async script => { injected.push(script); return accept; };

(async () => {
  let result = await controller.loadProofStructureWorkbenchData('NOTE', '证明');
  assert.equal(result.success, true);
  assert.equal(timers.length, 1);
  assert.equal(result.payload.requestId, 1);
  pending = false;
  timers.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller._proofHandwritingRetry, null);
  assert.match(injected[1], /data:image\/svg/);
  pending = true;
  await controller.loadProofStructureWorkbenchData('NOTE', '证明');
  const stale = timers.shift();
  instance.currentProofStructureContext = { noteId: 'OTHER', fieldName: '证明' };
  const before = injected.length;
  stale();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(injected.length, before, '切卡后不得注入旧手写');
  assert.equal((await controller.loadProofStructureWorkbenchData('NOTE', '证明')).reason, 'stale-proof-context');
  instance.currentProofStructureContext = { noteId: 'NOTE', fieldName: '证明' };
  await controller.loadProofStructureWorkbenchData('NOTE', '证明');
  timers.shift()();
  await new Promise(resolve => setImmediate(resolve));
  timers.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 0, '转换超时必须停止轮询');
  assert.equal(controller._proofHandwritingRetry, null);
  assert.match(injected.at(-1), /handwritingRetryExhausted/);
  assert.match(injected.at(-1), /conversion-timeout/);
  accept = false;
  assert.equal((await controller.loadProofStructureWorkbenchData('NOTE', '证明')).reason, 'webview-rejected-payload');
  assert.equal(timers.length, 0, '拒绝注入不得继续刷新');
  controller.runJavaScript = async () => { instance.currentProofStructureContext = { noteId: 'NEXT', fieldName: '证明' }; return true; };
  assert.equal((await controller.loadProofStructureWorkbenchData('NOTE', '证明')).reason, 'stale-proof-response');
  const main = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  const from = main.indexOf('  MNKnowledgeBaseClass.prototype.returnFromProofStructureWorkbench =');
  const to = main.indexOf('  MNKnowledgeBaseClass.prototype.refreshOpenCommentManagerForNote', from);
  const notices = [];
  const mainContext = vm.createContext({
    MNKnowledgeBaseClass: function() {},
    MNNote: { new: noteId => ({ noteId }) },
    MNUtil: { showHUD: message => notices.push(message) },
    self: {},
  });
  vm.runInContext(main.slice(from, to), mainContext);
  const addon = new mainContext.MNKnowledgeBaseClass();
  let opens = 0;
  addon.prepareProofStructureWorkbenchData = () => ({ revision: 'new', field: { commentIndices: [7] }, comments: [{ index: 7, detailedType: 'markdownComment' }] });
  addon.openCommentManager = async () => { opens++; return true; };
  addon.openHtmlMDStudio = async () => { opens++; };
  assert.equal(await addon.returnFromProofStructureWorkbench('NOTE', '证明', 7, 'old'), false);
  assert.equal(await addon.openProofStructureHtmlMDStudio('NOTE', '证明', 7, 'old'), false);
  assert.equal(opens, 0, '原文改变时禁止按旧索引定位或编辑');
  assert.equal(await addon.returnFromProofStructureWorkbench('NOTE', '证明', 99, 'new'), false);
  assert.equal(await addon.returnFromProofStructureWorkbench('NOTE', '证明', 7, 'new'), true);
  assert.equal(mainContext.self.currentCommentManagerFocusIndex, 7);
  assert.equal(await addon.openProofStructureHtmlMDStudio('NOTE', '证明', 7, 'new'), true);
  assert.equal(opens, 2);
  console.log('proof reader data and native lifecycle regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
