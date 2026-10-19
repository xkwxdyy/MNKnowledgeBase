const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.join(__dirname, '..');
const repositoryRoot = path.resolve(addonRoot, '..');
const handwritingSource = fs.readFileSync(path.join(addonRoot, 'KnowledgeBaseHandwritingOCR.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(repositoryRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

function encodeVarint(value) {
  const bytes = [];
  let current = value;
  do {
    let byte = current & 0x7f;
    current = Math.floor(current / 128);
    if (current > 0) byte |= 0x80;
    bytes.push(byte);
  } while (current > 0);
  return Buffer.from(bytes);
}

function bytesField(number, payload) {
  return Buffer.concat([encodeVarint(number * 8 + 2), encodeVarint(payload.length), payload]);
}

function varintField(number, value) {
  return Buffer.concat([encodeVarint(number * 8), encodeVarint(value)]);
}

function floatField(number, value) {
  const payload = Buffer.alloc(4);
  payload.writeFloatLE(value);
  return Buffer.concat([encodeVarint(number * 8 + 5), payload]);
}

function doubleField(number, value) {
  const payload = Buffer.alloc(8);
  payload.writeDoubleLE(value);
  return Buffer.concat([encodeVarint(number * 8 + 1), payload]);
}

function createInkArchive(pointStride = 12) {
  const pointData = Buffer.alloc(pointStride * 2);
  pointData.writeFloatLE(1, 0);
  pointData.writeFloatLE(2, 4);
  pointData.writeFloatLE(0, 8);
  pointData.writeFloatLE(3, pointStride);
  pointData.writeFloatLE(4, pointStride + 4);
  pointData.writeFloatLE(0.5, pointStride + 8);
  const strokeData = Buffer.concat([varintField(3, 2), bytesField(7, pointData)]);
  const transform = Buffer.concat([floatField(5, 10), floatField(6, 20)]);
  const stroke = Buffer.concat([bytesField(5, strokeData), bytesField(7, transform)]);
  const metadata = doubleField(8, 3);
  const protobuf = Buffer.concat([bytesField(4, metadata), bytesField(5, stroke)]);
  return Buffer.concat([Buffer.from([119, 114, 100, 0, 0, 0]), protobuf]).toString('base64');
}

function loadHandwritingService(mediaById = {}, runtime = {}) {
  const contextValues = {
    console,
    Uint8Array,
    DataView,
    ArrayBuffer,
    Promise,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    MNUtil: Object.assign({
      getMediaByHash(mediaId) {
        return mediaById[mediaId];
      },
    }, runtime.MNUtil || {}),
  };
  Object.assign(contextValues, runtime.globals || {});
  const context = vm.createContext(contextValues);
  vm.runInContext(`${handwritingSource}\nthis.service = KnowledgeBaseHandwritingOCR;`, context, {
    filename: path.join(addonRoot, 'KnowledgeBaseHandwritingOCR.js'),
  });
  return context.service;
}

function loadKnowledgeBaseNetwork(runtime = {}) {
  const start = utilsSource.indexOf('class KnowledgeBaseNetwork');
  const end = utilsSource.indexOf('\nclass KnowledgeBaseConfig', start);
  assert.notStrictEqual(start, -1, 'Cannot locate KnowledgeBaseNetwork');
  assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseNetwork end');
  const hudMessages = [];
  const hudCalls = [];
  const hudEvents = [];
  const copied = [];
  const localRefreshCalls = [];
  let undoGroupingDepth = 0;
  const context = vm.createContext({
    console,
    Promise,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Map,
    Set,
    kbOCRConfig: {
      postProcessingRules: [],
      theoremCleanupEnabledTypes: [],
    },
    ocrUtils: runtime.ocrUtils,
    ocrConfig: runtime.ocrConfig || {
      config: {},
      getConfig() {
        return '';
      },
      modelSource(source) {
        return { model: source, isFree: false };
      },
    },
    ocrNetwork: runtime.ocrNetwork || {},
    subscriptionConfig: runtime.subscriptionConfig || { config: {} },
    KnowledgeBaseHandwritingOCR: runtime.handwriting,
    UIImage: {
      imageWithData(data) {
        return { jpegData: quality => `jpeg:${quality}:${data}` };
      },
    },
    KnowledgeBaseConfig: {
      config: {
        excerptOCRModel: 'default-model',
        excerptOCRModelForMode1: 'mode-1-model',
        excerptOCRModelForMode2: 'mode-2-model',
        excerptOCRModelForMode3: 'mode-3-model',
      },
      getConfig() {
        return false;
      },
    },
    KnowledgeBaseTemplate: {
      types: {
        定义: { colorIndex: 1 },
        研究进展: { colorIndex: 2 },
      },
      runUndoGroupingWithoutGlobalDBRefresh(block) {
        undoGroupingDepth += 1;
        try {
          return block();
        } finally {
          undoGroupingDepth -= 1;
        }
      },
      refreshNoteLocally(note, useRefreshAll) {
        localRefreshCalls.push({ note, useRefreshAll, undoGroupingDepth });
        if (useRefreshAll && note && typeof note.refreshAll === 'function') {
          note.refreshAll();
        } else if (note && typeof note.refresh === 'function') {
          note.refresh();
        }
      },
      parseNoteTitle(note) {
        return { type: '', prefixContent: '', content: note.title || '' };
      },
      normalizeTitleSpaces(title) {
        return String(title || '')
          .replace(/\s*([=+\-−×÷])\s*/gu, '$1')
          .replace(/ {2,}/g, ' ');
      },
    },
    KnowledgeBaseUtils: {
      log() {},
      addErrorLog(error) {
        throw error;
      },
    },
    MNUtil: {
      getCurrentSelection: runtime.getCurrentSelection || (() => null),
      getDocImage: runtime.getDocImage || (() => null),
      showHUD(message, duration) {
        hudMessages.push(String(message));
        hudCalls.push({ message: String(message), duration });
        hudEvents.push(`show:${String(message)}`);
      },
      waitHUD(message) {
        hudEvents.push(`wait:${String(message)}`);
      },
      async stopHUD() {
        await Promise.resolve();
        hudEvents.push('stop');
      },
      confirm() {},
      copy(value) {
        copied.push(value);
      },
      undoGrouping(block) {
        return block();
      },
      MD5() {
        return 'md5';
      },
      log() {},
    },
    MNNote: {
      getFocusNote() {
        return null;
      },
    },
    Pangu: { spacing: value => value },
  });
  vm.runInContext(`${utilsSource.slice(start, end)}\nthis.KnowledgeBaseNetwork = KnowledgeBaseNetwork;`, context);
  context.KnowledgeBaseNetwork.postProcessOCRResult = value => value;
  context.KnowledgeBaseNetwork.buildOCRPostProcessOptions = () => ({});
  context.KnowledgeBaseNetwork.normalizeOCRTitlePrefixNumberSpacing = value => value;
  return {
    Network: context.KnowledgeBaseNetwork,
    hudMessages,
    hudCalls,
    hudEvents,
    copied,
    localRefreshCalls,
  };
}

async function run() {
  const validDrawing = createInkArchive(48);
  const service = loadHandwritingService({
    excerpt: { id: 'excerpt-data' },
    firstPaint: { id: 'first-paint-data' },
    drawing: { base64Encoding: () => validDrawing },
  });

  const rendered = service.renderDrawingDataURI(validDrawing);
  const svg = Buffer.from(rendered.dataURI.split(',')[1], 'base64').toString('utf8');
  assert.strictEqual(rendered.strokeCount, 1, 'valid Apple Ink data must render one stroke');
  assert.strictEqual(rendered.pointCount, 2, 'declared point count must support 48-byte point records');
  assert.match(svg, /d="M 11\.00 22\.00 L 13\.00 24\.00"/, 'transformed points must be preserved in SVG');
  assert.match(svg, /fill="white"/, 'SVG must include a white OCR background');
  assert.match(handwritingSource, /RASTER_TARGET_LONG_EDGE = 2048/, 'handwriting rasterization must cap the long edge at 2048 px');
  assert.match(handwritingSource, /RASTER_MAX_PIXELS = 4 \* 1024 \* 1024/, 'handwriting rasterization must stay near 4 MP');
  assert.match(
    handwritingSource,
    /canvas\.toDataURL\("image\/jpeg",jpegQuality\)/,
    'handwriting rasterization must use high-quality JPEG instead of oversized PNG',
  );
  assert.match(handwritingSource, /RASTER_JPEG_QUALITY = 0\.9/, 'handwriting JPEG quality must preserve thin strokes');
  assert.match(
    handwritingSource,
    /getCachedRaster\(selected\.mediaId\)/,
    'repeated OCR of the same drawing hash must reuse the session raster cache',
  );
  assert.match(
    handwritingSource,
    /MNKB Handwriting OCR Performance/,
    'drawing parsing and rasterization must emit phase timings',
  );
  assert.match(utilsSource, /MNKB OCR Performance/, 'network/provider OCR must emit a separate timing');
  assert.throws(
    () => service.renderDrawingDataURI('%%%'),
    /Base64|base64/,
    'malformed drawing data must fail explicitly',
  );

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(service.selectManualInput({
      excerptPic: { paint: 'excerpt' },
      comments: [{ type: 'PaintNote', paint: 'firstPaint', drawing: 'drawing' }],
    }))),
    { kind: 'paint', mediaId: 'excerpt', source: 'excerpt' },
    'excerpt image must win over the first comment',
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(service.selectManualInput({
      comments: [{ type: 'PaintNote', paint: 'firstPaint', drawing: 'drawing' }],
    }))),
    { kind: 'paint', mediaId: 'firstPaint', source: 'firstComment' },
    'paint must win when the first comment also contains drawing data',
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(service.selectManualInput({
      comments: [{ type: 'PaintNote', drawing: 'drawing' }],
    }))),
    { kind: 'drawing', mediaId: 'drawing', source: 'firstComment' },
    'a drawing-only first comment must enter handwriting conversion',
  );
  assert.strictEqual(
    service.selectManualInput({
      comments: [{ type: 'TextNote', text: 'first' }, { type: 'PaintNote', drawing: 'drawing' }],
    }),
    null,
    'the resolver must never scan the second comment',
  );
  const paintInput = await service.resolveManualImageInput({
    comments: [{ type: 'PaintNote', paint: 'firstPaint' }],
  });
  assert.strictEqual(paintInput.data.id, 'first-paint-data', 'first-comment paint must use the existing image path');
  assert.strictEqual(paintInput.isHandwriting, false, 'paint must retain normal image compression behavior');

  let webViewCreates = 0;
  function FakeUIWebView() {
    webViewCreates += 1;
    this.status = 'ready';
    this.result = '';
  }
  FakeUIWebView.prototype.loadHTMLStringBaseURL = function loadHTMLStringBaseURL() {};
  FakeUIWebView.prototype.stopLoading = function stopLoading() {};
  FakeUIWebView.prototype.removeFromSuperview = function removeFromSuperview() {};
  FakeUIWebView.prototype.evaluateJavaScript = function evaluateJavaScript(script, callback) {
    if (script.includes('window.__MNKBInkRasterize(')) {
      this.status = 'done';
      this.result = 'data:image/jpeg;base64,ZmFrZQ==';
      callback(true);
      return;
    }
    callback(JSON.stringify({
      status: this.status,
      error: '',
      result: this.result,
      width: 640,
      height: 480,
    }));
  };
  const rasterService = loadHandwritingService(
    { drawing: { base64Encoding: () => validDrawing } },
    {
      MNUtil: {
        studyView: { addSubview() {} },
      },
      globals: {
        UIWebView: FakeUIWebView,
        NSURL: { URLWithString: value => value },
        NSData: { dataWithContentsOfURL: value => ({ encodedURL: value }) },
        NSTimer: {
          scheduledTimerWithTimeInterval(interval, repeats, callback) {
            const id = setInterval(callback, 1);
            return {
              isValid: true,
              invalidate() {
                clearInterval(id);
                this.isValid = false;
              },
            };
          },
        },
      },
    },
  );
  const firstRaster = await rasterService.resolveManualImageInput({
    comments: [{ type: 'PaintNote', drawing: 'drawing' }],
  });
  const cachedRaster = await rasterService.resolveManualImageInput({
    comments: [{ type: 'PaintNote', drawing: 'drawing' }],
  });
  assert.strictEqual(firstRaster.mimeType, 'image/jpeg', 'drawing rasterization must return a JPEG');
  assert.strictEqual(firstRaster.width, 640, 'raster dimensions must be retained for diagnostics');
  assert.strictEqual(cachedRaster.cacheHit, true, 'the second OCR of the same drawing must hit the cache');
  assert.strictEqual(cachedRaster.data, firstRaster.data, 'the cached native JPEG must be reused');
  assert.strictEqual(webViewCreates, 1, 'a cache hit must not create another UIWebView');

  let legacyImageCalls = 0;
  let handwritingCalls = 0;
  let ocrInput = null;
  const runtime = loadKnowledgeBaseNetwork({
    ocrUtils: {
      getImageFromNote() {
        legacyImageCalls += 1;
        return 'legacy-image';
      },
    },
    handwriting: {
      async resolveManualImageInput() {
        handwritingCalls += 1;
        return { data: 'handwriting-jpeg', source: 'firstComment', isHandwriting: true };
      },
    },
  });
  runtime.Network.OCR = async imageData => {
    ocrInput = imageData;
    return '识别结果';
  };

  const automaticNote = { title: '旧标题', colorIndex: 0 };
  await runtime.Network.OCRToTitle(automaticNote, 1, false, 'all');
  assert.strictEqual(legacyImageCalls, 1, 'calls without a manual policy must keep the legacy image resolver');
  assert.strictEqual(handwritingCalls, 0, 'automatic/legacy calls must not inspect handwriting');
  assert.strictEqual(ocrInput, 'jpeg:0.1:legacy-image', 'legacy images must keep JPEG 0.1 compatibility');

  let manualRefreshCount = 0;
  const manualNote = {
    title: '旧标题',
    noteTitle: '旧标题',
    colorIndex: 0,
    refresh() { manualRefreshCount += 1; },
  };
  await runtime.Network.OCRToTitle(manualNote, 1, false, 'all', {
    ignoreDefinitionSkip: true,
    manualInputPolicy: 'excerptThenFirstComment',
  });
  assert.strictEqual(handwritingCalls, 1, 'manual policy must use the handwriting-aware resolver');
  assert.strictEqual(legacyImageCalls, 1, 'manual policy must not fall back to the legacy image scan');
  assert.strictEqual(ocrInput, 'handwriting-jpeg', 'prepared handwriting JPEG must bypass destructive JPEG 0.1 recompression');
  assert.strictEqual(manualNote.title, '识别结果', 'successful manual OCR must preserve replace-title semantics');
  assert.strictEqual(manualNote.noteTitle, '识别结果', 'successful manual OCR must synchronize the native title field before redraw');
  assert.strictEqual(manualRefreshCount, 1, 'manual OCR must redraw only the mutated card after writing its title');
  assert.strictEqual(runtime.localRefreshCalls.length, 2, 'each successful title write must request one local refresh');
  assert.strictEqual(runtime.localRefreshCalls[1].note, manualNote, 'manual OCR must refresh the mutated card only');
  assert.strictEqual(runtime.localRefreshCalls[1].useRefreshAll, false, 'title OCR must not refresh the card ancestry or descendants');
  assert.strictEqual(runtime.localRefreshCalls[1].undoGroupingDepth, 1, 'title OCR must redraw inside the title-write undo group');

  runtime.Network.OCR = async imageData => {
    ocrInput = imageData;
    return 'A + B = C |x| 后文';
  };
  const spacingNote = {
    title: '旧标题',
    noteTitle: '旧标题',
    colorIndex: 0,
  };
  await runtime.Network.OCRToTitle(spacingNote, 1, false, 'all', {
    ignoreDefinitionSkip: true,
    manualInputPolicy: 'excerptThenFirstComment',
  });
  assert.strictEqual(
    spacingNote.title,
    'A+B=C |x| 后文',
    'OCR title writes must compact math operators immediately while preserving delimiter word spaces',
  );

  runtime.Network.OCR = async imageData => {
    ocrInput = imageData;
    return '识别结果';
  };

  manualNote.title = '原标题';
  await runtime.Network.OCRToTitle(manualNote, 1, false, 'firstTitleLinkWord', {
    ignoreDefinitionSkip: true,
    manualInputPolicy: 'excerptThenFirstComment',
  });
  assert.strictEqual(manualNote.title, '识别结果; 原标题', 'first title-link-word placement must stay unchanged');
  await runtime.Network.OCRToTitle(manualNote, 1, false, 'lastTitleLinkWord', {
    ignoreDefinitionSkip: true,
    manualInputPolicy: 'excerptThenFirstComment',
  });
  assert.strictEqual(manualNote.title, '识别结果; 原标题; 识别结果', 'last title-link-word placement must stay unchanged');

  let selectionCalls = 0;
  let documentImageCalls = 0;
  const clipboardRuntime = loadKnowledgeBaseNetwork({
    ocrUtils: { getImageFromNote: () => 'legacy-image' },
    handwriting: {
      async resolveManualImageInput() {
        return { data: 'clipboard-handwriting', source: 'firstComment', isHandwriting: true };
      },
    },
    getCurrentSelection() {
      selectionCalls += 1;
      return { image: 'selection-image' };
    },
    getDocImage() {
      documentImageCalls += 1;
      return 'document-image';
    },
  });
  clipboardRuntime.Network.OCR = async imageData => {
    assert.strictEqual(imageData, 'clipboard-handwriting');
    clipboardRuntime.hudEvents.push('wait:OCR By Doc2X');
    return '剪贴板结果';
  };
  await clipboardRuntime.Network.OCRDirectlyToClipboard({
    note: { colorIndex: 0 },
    mode: 1,
    manualInputPolicy: 'excerptThenFirstComment',
  });
  assert.strictEqual(selectionCalls, 0, 'strict manual policy must not replace card input with a document selection');
  assert.strictEqual(documentImageCalls, 0, 'strict manual policy must not replace card input with a document screenshot');
  assert.deepStrictEqual(clipboardRuntime.copied, ['剪贴板结果'], 'clipboard action must keep its output semantics');
  assert.deepStrictEqual(
    clipboardRuntime.hudEvents.slice(-3),
    ['wait:OCR By Doc2X', 'stop', 'show:✅ 已复制到剪贴板\n\n剪贴板结果'],
    'clipboard OCR must fully dismiss the progress HUD before showing its success HUD',
  );
  assert.deepStrictEqual(
    clipboardRuntime.hudCalls.at(-1),
    { message: '✅ 已复制到剪贴板\n\n剪贴板结果', duration: 1 },
    'clipboard OCR HUD must dismiss after one second',
  );

  let failedOCRCalls = 0;
  const failureRuntime = loadKnowledgeBaseNetwork({
    ocrUtils: { getImageFromNote: () => 'must-not-fallback' },
    handwriting: {
      async resolveManualImageInput() {
        throw new Error('drawing parse failed');
      },
    },
  });
  failureRuntime.Network.OCR = async () => {
    failedOCRCalls += 1;
    return '不应写入';
  };
  const failedNote = { title: '保留标题', colorIndex: 0 };
  const failedResult = await failureRuntime.Network.OCRToTitle(failedNote, 1, false, 'all', {
    ignoreDefinitionSkip: true,
    manualInputPolicy: 'excerptThenFirstComment',
  });
  assert.strictEqual(failedResult, false, 'drawing conversion failure must stop the action');
  assert.strictEqual(failedOCRCalls, 0, 'drawing conversion failure must not call OCR or fall back');
  assert.strictEqual(failedNote.title, '保留标题', 'drawing conversion failure must not modify the title');
  assert.ok(
    failureRuntime.hudMessages.some(message => message.includes('手写') && message.includes('drawing parse failed')),
    'drawing conversion failure must surface a clear HUD message',
  );

  const requestedModels = [];
  const modelFallbackRuntime = loadKnowledgeBaseNetwork({
    ocrUtils: {},
    ocrConfig: {
      config: {},
      getConfig() {
        return '';
      },
      modelSource(source) {
        return { model: source, isFree: false };
      },
    },
    subscriptionConfig: {
      config: { apikey: 'test-key', url: 'https://example.invalid' },
    },
    ocrNetwork: {
      initRequestForChatGPT(key, url, model) {
        requestedModels.push(model);
        return { model };
      },
      async sendRequest(request) {
        if (request.model === 'doubao-seed-1-8-nothinking') {
          return { error: { code: 'model_not_found', message: 'The model was not found' } };
        }
        return { choices: [{ message: { content: '回退成功' } }] };
      },
    },
  });
  const fallbackResult = await modelFallbackRuntime.Network.ChatGPTVision(
    'image-base64',
    'doubao-seed-1-8-nothinking',
    'prompt',
    false,
  );
  assert.strictEqual(fallbackResult, '回退成功', 'model_not_found must transparently retry with an active model');
  assert.deepStrictEqual(
    requestedModels,
    ['doubao-seed-1-8-nothinking', 'doubao-seed-2-0-mini-nothinking'],
    'Doubao 1.8 model_not_found must retry exactly once with the tested Mini fallback',
  );

  assert.match(mainSource, /JSB\.require\(['"]KnowledgeBaseHandwritingOCR['"]\)/, 'main.js must load the handwriting module');
  assert.match(
    mainSource,
    /KnowledgeBaseNetwork\.OCRToTitle\(note, excerptOCRMode, self\.preExcerptMode\)/,
    'ProcessNewExcerpt must keep calling OCRToTitle without the manual input policy',
  );
  assert.match(
    toolbarSource,
    /manualInputPolicy:\s*["']excerptThenFirstComment["']/,
    'MNToolbar manual OCR options must explicitly opt into the strict input policy',
  );
  assert.match(
    toolbarSource,
    /OCRDirectlyToClipboard\([\s\S]*?\.\.\._xdyy_ocrManualOptions\(\)/,
    'manual OCR-to-clipboard must use the same card input policy',
  );
  assert.match(
    toolbarSource,
    /ocrAllUntitledDescendants[\s\S]*?OCRToTitle\(note, 1, false, "all", \{\s*ignoreDefinitionSkip: true,\s*\}\)/,
    'batch descendant OCR must retain its legacy image-only policy',
  );

  console.log('direct OCR handwriting regression ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
