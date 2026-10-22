const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.resolve(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const configStart = utilsSource.indexOf('const kbOCRConfig = {');
const configEnd = utilsSource.indexOf('\nclass KnowledgeBaseTemplate', configStart);
const networkStart = utilsSource.indexOf('class KnowledgeBaseNetwork');
const networkEnd = utilsSource.indexOf('\nclass KnowledgeBaseConfig', networkStart);

assert.notStrictEqual(configStart, -1, 'Cannot locate kbOCRConfig');
assert.notStrictEqual(configEnd, -1, 'Cannot locate kbOCRConfig end');
assert.notStrictEqual(networkStart, -1, 'Cannot locate KnowledgeBaseNetwork');
assert.notStrictEqual(networkEnd, -1, 'Cannot locate KnowledgeBaseNetwork end');

const context = {
  console,
  Array,
  Boolean,
  Date,
  Map,
  Math,
  Number,
  Object,
  Promise,
  KnowledgeBaseDefinitionConcept: require('../KnowledgeBaseDefinitionConcept'),
  MNUtil: { currentNotebookId: 'study' },
  RegExp,
  Set,
  String,
  KnowledgeBaseTemplate: {
    types: {
      定义: { colorIndex: 2 },
      研究进展: { colorIndex: 3 },
    },
    runUndoGroupingWithoutGlobalDBRefresh(block) {
      return block();
    },
    refreshNoteLocally(note) {
      if (note && typeof note.refresh === 'function') note.refresh();
    },
  },
};
context.global = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  `${utilsSource.slice(configStart, configEnd)}\n${utilsSource.slice(networkStart, networkEnd)}\nthis.KnowledgeBaseNetwork = KnowledgeBaseNetwork;`,
  context,
);

const Network = context.KnowledgeBaseNetwork;
const originalOCR = Network.OCR.bind(Network);
context.KnowledgeBaseConfig = {
  config: {
    excerptOCRModel: 'default-model',
    excerptOCRModelForMode1: 'mode-1-model',
    excerptOCRTranslateModel: 'translation-model',
    quickReadingOCRModel: '',
    quickReadingOCRFallbackModel: 'fallback-model',
    quickReadingOCRTimeoutSeconds: 12,
  },
  getConfig(key) {
    return this.config[key];
  },
};
const latexFormula = String.raw`\mathcal{P}=\bigoplus_{m=0}^{\infty} \overline{\operatorname {span}}\{ z_1^k q(z'): k\geq0, q\in E_m \}`;
const normalizedFormula = Network.normalizeQuickReadingPlainOCRResult(latexFormula);

assert.strictEqual(
  normalizedFormula,
  '𝒫=⨁ₘ₌₀∞ s̄p̄ān̄{z₁ᵏ q(z′): k≥0, q∈Eₘ}',
  'quick reading must convert the reported LaTeX formula into Unicode-only plain text',
);
assert.doesNotMatch(
  normalizedFormula,
  /[\\_$^]/,
  'quick reading output must not retain LaTeX commands, delimiters, or script syntax',
);
assert.match(normalizedFormula, /s̄p̄ān̄\{z₁ᵏ q\(z′\): k≥0, q∈Eₘ\}/, 'set braces must preserve the source formula semantics');
assert.doesNotMatch(normalizedFormula, /\{\s|\s\}/, 'set braces must not retain interior edge whitespace');

const plainOperatorSpan = Network.normalizeQuickReadingPlainOCRResult(
  String.raw`\operatorname {span}\{ z \}`,
);
assert.strictEqual(
  plainOperatorSpan,
  'span{z}',
  'operatorname span must remain plain unless the OCR explicitly represents a closure',
);
assert.doesNotMatch(
  plainOperatorSpan,
  /\u0304/,
  'operatorname span must not gain a combining overline by inference',
);

assert.strictEqual(
  Network.normalizeQuickReadingPlainOCRResult('span{z}'),
  'span{z}',
  'a plain span must not gain a combining overline by inference',
);

assert.strictEqual(
  Network.normalizeQuickReadingPlainOCRResult(String.raw`\closure{\operatorname {span}}\{ z \}`),
  's̄p̄ān̄{z}',
  'an explicit closure wrapper must preserve the span closure with combining overlines',
);
assert.strictEqual(
  Network.normalizeQuickReadingPlainOCRResult(String.raw`\closure \operatorname {span}\{ z \}`),
  's̄p̄ān̄{z}',
  'an unbraced closure command before operatorname span must preserve the span closure',
);

assert.strictEqual(
  Network.normalizeOCRTitleMarkdownResult('算子 $A * B × C$'),
  '算子 $A * B × C$',
  'ASCII asterisks in OCR titles are not multiplication operators and must preserve surrounding spaces',
);

const theoremOptions = Network.buildOCRPostProcessOptions({ colorIndex: 0 }, {
  forceTheoremHeadingCleanup: true,
});
theoremOptions.quickReadingPlainText = true;
const theoremResult = Network.postProcessOCRResult(
  String.raw`定理 8.1 (M_{z_1} 的完整换位子). 在上述识别下，\mathcal{P}=\bigoplus_{m=0}^{\infty} \overline{\operatorname {span}}\{ z_1^k q(z'): k\geq0, q\in E_m \}`,
  theoremOptions,
);

assert.ok(!theoremResult.startsWith('。'), 'theorem cleanup must not leave a leading full stop');
assert.ok(!theoremResult.startsWith('.'), 'theorem cleanup must not leave a leading period');
assert.doesNotMatch(theoremResult, /定理\s*8\.1/, 'quick reading must remove theorem numbering regardless of card color');
assert.doesNotMatch(theoremResult, /[\\_$^]/, 'theorem result must receive the same Unicode-only normalization');

async function captureQuickReadingOCRRequest(needTranslation) {
  let request = null;
  Network.resolveOCRImageInput = async () => ({ data: 'image-data' });
  Network.prepareOCRImageData = input => input.data;
  Network.OCR = async (imageData, model, prompt, requestOptions) => {
    request = { imageData, model, prompt, requestOptions };
    return '';
  };

  await Network.OCRToTitle(
    { colorIndex: 0 },
    1,
    needTranslation,
    'all',
    { quickReadingPlainText: true },
  );
  return request;
}

(async () => {
  const defaultQuickReadingRequest = await captureQuickReadingOCRRequest(false);
  assert.strictEqual(
    defaultQuickReadingRequest.prompt,
    Network.OCRDirectlyNoTransPrompt,
    'quick reading must restore its default complete-translation prompt',
  );
  assert.match(
    defaultQuickReadingRequest.prompt,
    /完整翻译为中文/,
    'the default quick-reading prompt must translate source text into Chinese',
  );
  assert.strictEqual(
    defaultQuickReadingRequest.model,
    'mode-1-model',
    'the default quick-reading translation must retain the historical mode-1 model',
  );

  const preExcerptQuickReadingRequest = await captureQuickReadingOCRRequest(true);
  assert.strictEqual(
    preExcerptQuickReadingRequest.prompt,
    Network.OCRDirectlyPrompt,
    'quick reading must retain the pre-excerpt translated-original prompt variant',
  );
  assert.match(
    preExcerptQuickReadingRequest.prompt,
    /专业的中文数学翻译/,
    'the pre-excerpt quick-reading prompt must still translate source text',
  );
  assert.strictEqual(
    preExcerptQuickReadingRequest.model,
    'translation-model',
    'the pre-excerpt quick-reading translation must retain the dedicated translation model override',
  );

  context.KnowledgeBaseConfig.config.quickReadingOCRModel = 'quick-reading-model';
  const dedicatedQuickReadingRequest = await captureQuickReadingOCRRequest(false);
  assert.strictEqual(
    dedicatedQuickReadingRequest.model,
    'quick-reading-model',
    'a dedicated quick-reading model must override the historical fallback chain',
  );
  assert.strictEqual(
    dedicatedQuickReadingRequest.requestOptions.timeoutSeconds,
    12,
    'quick reading must cap each provider request at twelve seconds',
  );
  assert.strictEqual(
    dedicatedQuickReadingRequest.requestOptions.fallbackSource,
    'fallback-model',
    'quick reading must pass its dedicated fallback model to the OCR request',
  );

  const originalChatGPTVision = Network.ChatGPTVision.bind(Network);
  Network.OCR = originalOCR;
  let requestTimeoutSeconds = 0;
  context.subscriptionConfig = {
    config: {
      apikey: 'test-key',
      url: 'https://example.invalid',
    },
  };
  context.ocrConfig = {
    config: {},
    modelSource(source) {
      return { isFree: false, model: `provider-${source}` };
    },
    inModelSource() {
      return true;
    },
  };
  context.ocrNetwork = {
    history: [],
    OCRBuffer: {},
    initRequestForChatGPT() {
      return {
        setTimeoutInterval(value) {
          requestTimeoutSeconds = value;
        },
      };
    },
    async sendRequest() {
      return { choices: [{ message: { content: '识别成功' } }] };
    },
  };
  context.MNConnection = {
    async sendRequest() {
      return { choices: [{ message: { content: '识别成功' } }] };
    },
  };
  context.MNUtil = {
    delay() { return new Promise(() => {}); },
    MD5(value) {
      return `md5-${String(value).length}`;
    },
    showHUD() {},
    waitHUD() {},
    stopHUD() {},
  };
  context.KnowledgeBaseUtils = {
    emitRuntimeLog() {},
    addErrorLog(error) {
      throw error;
    },
  };
  context.ocrUtils = {
    action(source, result) {
      return result;
    },
  };

  const requestDiagnostic = {};
  const directVisionResult = await originalChatGPTVision(
    'image-data',
    'vision-model',
    'prompt',
    false,
    {
      requestTimeoutSeconds: 12,
      attemptDiagnosticTarget: requestDiagnostic,
    },
  );
  assert.strictEqual(directVisionResult, '识别成功');
  assert.strictEqual(requestTimeoutSeconds, 12, 'native request timeout must be reduced from the MNOCR 60s default');
  assert.strictEqual(requestDiagnostic.providerModel, 'provider-vision-model');
  assert.strictEqual(requestDiagnostic.success, true);

  let normalOCRRequestCalls = 0;
  let timedOCRRequestCalls = 0;
  context.ocrNetwork.sendRequest = async () => {
    normalOCRRequestCalls += 1;
    return { choices: [{ message: { content: '普通识别成功' } }] };
  };
  context.MNConnection.sendRequest = async () => {
    timedOCRRequestCalls += 1;
    return { choices: [{ message: { content: '限时识别成功' } }] };
  };
  const normalVisionResult = await originalChatGPTVision(
    'image-data',
    'vision-model',
    'prompt',
    false,
  );
  assert.strictEqual(normalVisionResult, '普通识别成功');
  assert.strictEqual(normalOCRRequestCalls, 1, 'ordinary OCR must retain the existing MNOCR request path');
  assert.strictEqual(timedOCRRequestCalls, 0, 'ordinary OCR must not use the quick-reading timed request path');

  delete context.ocrNetwork.sendRequest;
  const currentMNOCRVisionResult = await originalChatGPTVision(
    'image-data',
    'vision-model',
    'prompt',
    false,
  );
  assert.strictEqual(currentMNOCRVisionResult, '限时识别成功');
  assert.strictEqual(timedOCRRequestCalls, 1, 'MNOCR without its legacy sender must use MNUtils JSON transport even without a timeout option');

  context.MNConnection.sendRequest = async () => ({ error: 'The request timed out.' });
  const timeoutDiagnostic = {};
  const timedOutVisionResult = await originalChatGPTVision(
    'image-data',
    'vision-model',
    'prompt',
    false,
    {
      requestTimeoutSeconds: 12,
      attemptDiagnosticTarget: timeoutDiagnostic,
    },
  );
  assert.strictEqual(timedOutVisionResult, undefined);
  assert.strictEqual(timeoutDiagnostic.timedOut, true);
  assert.strictEqual(timeoutDiagnostic.errorCategory, 'timeout');

  const attemptedModels = [];
  Network.ChatGPTVision = async (imageData, source, prompt, showProgressHUD, requestOptions) => {
    attemptedModels.push(source);
    if (source === 'slow-model') {
      Object.assign(requestOptions.attemptDiagnosticTarget, {
        timedOut: true,
        errorCategory: 'timeout',
      });
      return undefined;
    }
    Object.assign(requestOptions.attemptDiagnosticTarget, {
      success: true,
      providerModel: `provider-${source}`,
    });
    return '回退识别成功';
  };
  const fallbackDiagnostic = {};
  const fallbackResult = await Network.OCR('image-data', 'slow-model', 'prompt', {
    timeoutSeconds: 12,
    fallbackSource: 'fast-model',
    ocrDiagnosticTarget: fallbackDiagnostic,
  });
  assert.strictEqual(fallbackResult, '回退识别成功');
  assert.deepStrictEqual(attemptedModels, ['slow-model', 'fast-model']);
  assert.strictEqual(fallbackDiagnostic.primaryModel, 'slow-model');
  assert.strictEqual(fallbackDiagnostic.finalModel, 'fast-model');
  assert.strictEqual(fallbackDiagnostic.fallbackUsed, true);
  assert.strictEqual(fallbackDiagnostic.success, true);
  assert.strictEqual(fallbackDiagnostic.attempts.length, 2);

  attemptedModels.length = 0;
  Network.ChatGPTVision = async (imageData, source, prompt, showProgressHUD, requestOptions) => {
    attemptedModels.push(source);
    Object.assign(requestOptions.attemptDiagnosticTarget, {
      timedOut: false,
      errorCategory: 'provider-error',
    });
    return undefined;
  };
  const nonTimeoutDiagnostic = {};
  const nonTimeoutResult = await Network.OCR('image-data', 'broken-model', 'prompt', {
    timeoutSeconds: 12,
    fallbackSource: 'fast-model',
    ocrDiagnosticTarget: nonTimeoutDiagnostic,
  });
  assert.strictEqual(nonTimeoutResult, undefined);
  assert.deepStrictEqual(attemptedModels, ['broken-model'], 'non-timeout failures must not spend a second provider request');
  assert.strictEqual(nonTimeoutDiagnostic.fallbackUsed, false);

  assert.match(
    mainSource,
    /applyQuickReadingOCRToTitle[\s\S]*?applyOCRToTitleWithMode\(note, 1, \{\s*\.\.\.options,\s*quickReadingPlainText: true,/,
    'quick reading must explicitly select the Unicode-only post-processing profile',
  );
  assert.match(
    mainSource,
    /processReadingFollowNote[\s\S]*?applyQuickReadingOCRToTitle\(note,\s*\{\s*ocrDiagnosticTarget:/,
    'quick reading follow flow must retain its dedicated OCR entry point',
  );
  assert.match(
    mainSource,
    /refreshAfterQuickReadingOCR[\s\S]*?xdyyRefreshAfterDBChangedNow[\s\S]*?app\.refreshAfterDBChanged[\s\S]*?refreshAfterDBChanged/,
    'quick reading must use an immediate post-OCR DB refresh with compatible fallbacks',
  );
  assert.match(
    mainSource,
    /ocrSuccess = !!await this\.applyQuickReadingOCRToTitle[\s\S]*?this\.refreshAfterQuickReadingOCR\(processedNote \|\| note, 'afterConversion'\)/,
    'quick reading must refresh only after successful OCR and conversion complete',
  );
  assert.match(
    utilsSource,
    /OCRToTitle[\s\S]*?const applyTitle = \(\) => \{[\s\S]*?refreshNoteLocally\(note, false[\s\S]*?await KnowledgeBaseTemplate\.runUndoGroupingWithoutGlobalDBRefreshAsync\(applyTitle/,
    'OCR title writes and target-card redraw must share the official async no-global-refresh group',
  );
  assert.match(
    mainSource,
    /convertQuickReadingExcerptWithoutGlobalRefresh[\s\S]*?createChildUndoGrouping: false[\s\S]*?refreshNoteLocally\(parentNote, false[\s\S]*?refreshNoteLocally\(processedNote, false/,
    'quick-reading conversion must avoid a second full database refresh after OCR',
  );
  assert.match(
    mainSource,
    /quickReadingOCRModelSetting[\s\S]*?setQuickReadingOCRModel:/,
    'the model settings menu must expose a dedicated quick-reading model selector',
  );
  assert.match(
    mainSource,
    /follow\.slow[\s\S]*?ocr:\s*ocrDiagnostic/,
    'the retained slow summary must include the per-request OCR diagnostic payload',
  );

  console.log('quick reading OCR regression ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
