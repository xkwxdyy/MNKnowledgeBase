const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(root, 'scripts/comment-manager/data-native.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'scripts/comment-manager/render-cards.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles/comment-manager.css'), 'utf8');

assert.match(mainSource, /getCommentManagerDrawingPreview/);
assert.match(mainSource, /KnowledgeBaseHandwritingOCR\.renderDrawingDataURI\(drawingBase64\)/);
assert.match(mainSource, /rawComment\.drawing[\s\S]*?drawingPreviewDataURI/);
assert.match(mainSource, /rawComment\.q_hpic\.drawing[\s\S]*?drawingPreviewDataURI/);
assert.match(mainSource, /_commentManagerDrawingPreviewCache/);
assert.match(controllerSource, /drawingHash:/);
assert.match(controllerSource, /drawingPreview:/);
assert.match(controllerSource, /coordinateHandwritingPreviewRefresh/);
assert.match(controllerSource, /handwriting-preview-retry/);
assert.match(controllerSource, /手写内容转换完成，当前页面已自动刷新/);

assert.match(dataSource, /sourceComment\.drawingHash/);
assert.match(dataSource, /sourceComment\.drawingPreviewDataURI/);
assert.match(dataSource, /sourceComment\.drawingPreviewPending/);
assert.match(dataSource, /drawingIdentity/);
assert.match(rendererSource, /function getCommentMediaSources/);
assert.match(rendererSource, /function createCommentMediaPreviewHTML/);
assert.match(rendererSource, /media-preview-\$\{media\.kind\}/);
assert.match(cssSource, /\.media-preview-grid/);
assert.match(cssSource, /\.media-converting/);

const context = vm.createContext({
  COMMENT_MEDIA_ERROR_ATTR: 'data-media-error',
  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
});
vm.runInContext(
  `${rendererSource}\nthis.createCommentMediaPreviewHTML = createCommentMediaPreviewHTML;`,
  context,
  { filename: 'render-cards.js' },
);

const drawingOnly = context.createCommentMediaPreviewHTML({
  drawingPreviewDataURI: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
}, { alt: '手写内容' });
assert.match(drawingOnly, /media-count-1/);
assert.match(drawingOnly, /media-preview-drawing/);
assert.doesNotMatch(drawingOnly, /媒体数据缺失/);

const imageAndDrawing = context.createCommentMediaPreviewHTML({
  imageBase64: 'aW1hZ2U=',
  imageMimeType: 'image/jpeg',
  drawingPreviewDataURI: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
}, { alt: '图片和手写内容' });
assert.match(imageAndDrawing, /media-count-2/);
assert.match(imageAndDrawing, /media-preview-image/);
assert.match(imageAndDrawing, /media-preview-drawing/);

const pendingDrawing = context.createCommentMediaPreviewHTML({
  drawingPreviewPending: true,
}, { alt: '手写内容' });
assert.match(pendingDrawing, /手写内容正在转换，完成后将自动刷新/);
assert.doesNotMatch(pendingDrawing, /手写数据缺失/);

const retryStart = controllerSource.indexOf('knowledgebaseWebController.prototype.coordinateHandwritingPreviewRefresh');
const retryEnd = controllerSource.indexOf('knowledgebaseWebController.prototype.getCommentDataRevision', retryStart);
assert.notStrictEqual(retryStart, -1);
assert.notStrictEqual(retryEnd, -1);
const retryTimers = [];
const retryHUD = [];
const retryLoads = [];
const retryContext = vm.createContext({
  KB_HANDWRITING_RETRY_INTERVAL: 1,
  KB_HANDWRITING_RETRY_LIMIT: 60,
  MNUtil: { showHUD(message) { retryHUD.push(String(message)); } },
  NSTimer: {
    scheduledTimerWithTimeInterval(seconds, repeats, callback) {
      retryTimers.push({ seconds, repeats, callback });
    },
  },
  knowledgebaseWebController: function () {},
});
vm.runInContext(controllerSource.slice(retryStart, retryEnd), retryContext);
const retryController = Object.create(retryContext.knowledgebaseWebController.prototype);
retryController.currentHTMLType = 'comment-manager';
retryController.loadCommentData = (noteId, options) => retryLoads.push({ noteId, options });
retryController.coordinateHandwritingPreviewRefresh('NOTE-1', { handwritingPendingCount: 1 });
assert.deepStrictEqual(retryHUD, ['手写内容正在转换，请稍候']);
assert.strictEqual(retryTimers.length, 1);
assert.strictEqual(retryTimers[0].seconds, 1);
retryTimers[0].callback();
assert.strictEqual(retryLoads.length, 1);
assert.strictEqual(retryLoads[0].noteId, 'NOTE-1');
assert.strictEqual(retryLoads[0].options.force, true);
assert.strictEqual(retryLoads[0].options.reason, 'handwriting-preview-retry');
retryController.coordinateHandwritingPreviewRefresh('NOTE-1', { handwritingPendingCount: 0 });
assert.strictEqual(retryController._handwritingPreviewRetry, null);
assert.strictEqual(retryHUD[1], '手写内容转换完成，当前页面已自动刷新');
retryController.coordinateHandwritingPreviewRefresh('NOTE-1', { handwritingPendingCount: 1 });
const staleRetryTimer = retryTimers[1];
retryController.coordinateHandwritingPreviewRefresh('NOTE-2', { handwritingPendingCount: 0 });
staleRetryTimer.callback();
assert.strictEqual(retryLoads.length, 1, 'switching cards must cancel the previous handwriting retry');

console.log('comment manager handwriting preview regression ok');
