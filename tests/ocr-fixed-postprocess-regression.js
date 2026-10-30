'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
const context = vm.createContext({ console: { log() {} }, Promise, Date, JSON });
vm.runInContext(
  fs.readFileSync(path.join(root, 'KnowledgeBaseDefinitionConcept.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'KnowledgeBaseOCRPostprocess.js'), 'utf8') + '\n' +
  source.slice(source.indexOf('const kbOCRConfig = {'), source.indexOf('\nclass KnowledgeBaseTemplate')) + '\n' +
  source.slice(source.indexOf('class KnowledgeBaseNetwork'), source.indexOf('\nclass KnowledgeBaseConfig')) + '\n' +
  'this.Network = KnowledgeBaseNetwork; this.Definition = KnowledgeBaseDefinitionConcept; this.Fixed = KnowledgeBaseOCRPostprocess;', context,
);
const { Network, Definition, Fixed } = context;
context.KnowledgeBaseConfig = { getConfig: key => key === 'ocrFixedPostprocessEnabled' };
context.MNUtil = { MD5: () => 'fixture', currentNotebookId: 'study', delay: () => new Promise(() => {}), showHUD() {} };
context.KnowledgeBaseUtils = { log() {}, emitRuntimeLog() {}, addErrorLog(error) { throw error; } };
context.ocrConfig = { config: {} };
context.ocrNetwork = { OCRBuffer: {} };
context.ocrUtils = { action: (_, value) => value };
const normalize = value => Fixed.normalizeScripts(value, Network.normalizeQuickReadingScript.bind(Network));
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

(async () => {
  assert.equal(normalize('A_{α}^{p} a_{n} T^{*k}T^{k} X_{n≠0}'), 'A_{α}ᵖ aₙ T^{*k}Tᵏ X_{n≠0}');
  assert.equal(normalize('A_{B_{n}} x^{m_{j}}'), 'A_{B_{n}} x^{m_{j}}', 'nested indices must retain grouping');
  assert.equal(normalize('$a_{n}^{2}$\n原文'), '$a_{n}^{2}$ 原文', 'Markdown formula syntax must remain untouched');
  assert.equal(normalize('x2 x_{n'), 'x2 x_{n', 'formatting must never guess scripts or repair an incomplete group');
  const structureCases = [
    ['x_{i_j} x_{ij}', 'x_{i_j} xᵢⱼ'],
    ['V_{B_{r_{K^c}}}', 'V_{B_{r_{K^c}}}'],
    ['M_{z_1}^{*}', 'M_{z_1}^{*}'],
    ['Ũ_{σ,act}^{(a)}', 'Ũ_{σ,act}⁽ᵃ⁾'],
    ['f^{(k)} f^{k}', 'f⁽ᵏ⁾ fᵏ'],
    ['(R^{*})^{m} (R^{m})^{*}', '(R^{*})ᵐ (Rᵐ)^{*}'],
    ['w^{r^{s}}', 'w^{r^{s}}'],
    ['∑_{0<|α|≤m}c_{β-α}', '∑_{0<|α|≤m}c_{β-α}'],
    ['sup_{z_0∈Ω}∫_{a_n}^{b_{n+1}}F(z)', 'sup_{z_0∈Ω}∫_{a_n}^{b_{n+1}}F(z)'],
    [String.raw`\hat{\bar{f}}(k)`, String.raw`\hat{\bar{f}}(k)`],
    [String.raw`\overline{uv}_{n}`, String.raw`\overline{uv}ₙ`],
    ['[[a_{11},a_{12}],[a_{21},a_{22}]]', '[[a₁₁,a₁₂],[a₂₁,a₂₂]]'],
    ['‖Sx‖_{p}^{q} x^{-1}', '‖Sx‖ₚ^{q} x⁻¹'],
  ];
  for (const [input, expected] of structureCases) assert.equal(normalize(input), expected, 'general script conversion must preserve base, grouping and operator scope: ' + input);
  assert.equal(Network.postProcessOCRResult('Φ=φ≠ϕ, Lᵃ², iff ⇨', { disableTheoremHeadingCleanup: true }), 'Φ=φ≠ϕ, Lᵃ², iff ⇨');
  for (const value of ['{"readable":false,"text":"□"}', '{"readable":true,"text":""}', '{"readable":true,"text":"a□"}', '{"text":"draft"}']) assert.throws(() => Fixed.parse(value));

  async function correctionCase(responses, options = {}) {
    const requests = [];
    Definition.requestOfficial = async (body, remaining) => {
      requests.push({ body, remaining });
      const response = responses[requests.length - 1];
      if (response instanceof Error) throw response;
      assert.notEqual(response, undefined, 'correction must not exceed the supplied response count');
      return typeof response === 'string' ? JSON.stringify({ readable: true, text: response }) : JSON.stringify(response);
    };
    const text = await Fixed.correct('same-original-image', 'original draft P_inv U_σ^J P_inv^2', 'same mode rules', options);
    return { text, requests };
  }
  const bareScripts = 'P_inv U_σ^J P_inv^2';
  const preserved = await correctionCase([bareScripts], { mode: 1 });
  assert.equal(preserved.text, bareScripts, 'script typography must not reject readable image-corrected semantics');
  assert.equal(preserved.requests.length, 1, 'typography alone must not add another service request');
  assert.equal(preserved.requests[0].body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,same-original-image');
  assert.equal(preserved.requests[0].body.messages[1].content[1].text, '识别稿（可能有错）：\noriginal draft P_inv U_σ^J P_inv^2');
  assert.match(preserved.requests[0].body.messages[1].content.at(-1).text, /same mode rules/);
  assert.match(preserved.requests[0].body.messages[0].content, /尽量减少 _ 和 \^/);
  assert.match(preserved.requests[0].body.messages[0].content, /允许保留/);
  for (const phrase of ['下标内部的上下标', '带括号的导数阶数', '求积', '上确界和下确界', '嵌套重音', '矩阵行列', '公式编号']) {
    assert.ok(Fixed.visionPrompt.includes(phrase), 'faithful vision must cover general mathematical structure: ' + phrase);
    assert.ok(preserved.requests[0].body.messages[0].content.includes(phrase), 'independent correction must cover the same structure: ' + phrase);
  }
  for (const [formula] of structureCases) {
    const corrected = await correctionCase([formula]);
    assert.equal(corrected.text, formula, 'readable structures must not be rewritten by the correction transport');
    assert.equal(corrected.requests.length, 1, 'format preferences must never create per-structure retries');
  }
  const alreadyGrouped = await correctionCase(['A_{B_{n}} x^{m_{j}} P_{α} α β Φ x2']);
  assert.equal(alreadyGrouped.text, 'A_{B_{n}} x^{m_{j}} P_{α} α β Φ x2');
  assert.equal(alreadyGrouped.requests.length, 1);
  for (const formula of ['A_{B_n}', 'U_σ^J', String.raw`T^{*k}\frac{A_{B_n}}{\sum_{j=0}^{m_n}a_j}`]) {
    const complex = await correctionCase([formula]);
    assert.equal(complex.text, formula, 'necessary complex formula notation must pass without being flattened or guessed');
    assert.equal(complex.requests.length, 1);
  }
  const greekExponent = await correctionCase(['(1−z)²⁺ᵅ']);
  assert.equal(greekExponent.text, '(1−z)²⁺ᵅ', 'the user-approved superscript alpha representation must pass unchanged');
  assert.equal(greekExponent.requests.length, 1, 'a valid superscript alpha must not trigger an extra correction');
  assert.match(greekExponent.requests[0].body.messages[0].content, /允许使用 ᵅ/);
  const markdown = await correctionCase(['$P_α U_σ^J$'], { mode: 2 });
  assert.equal(markdown.text, '$P_α U_σ^J$');
  assert.equal(markdown.requests.length, 1, 'Markdown must keep its existing single-correction path');
  for (const failure of [{ readable: false, text: 'P_inv' }, { text: 'P_inv' }, { readable: true, text: '□' }, new Error('http-503')]) {
    const failedCorrection = await correctionCase([failure]);
    assert.equal(failedCorrection.text, '');
    assert.equal(failedCorrection.requests.length, 1, 'unreadable and provider failures must not retry');
  }
  const realNow = Date.now;
  let fakeNow = 1000;
  Date.now = () => fakeNow;
  try {
    const deadlineCalls = [], deadlineDelays = [];
    context.MNUtil.delay = seconds => { deadlineDelays.push(seconds); return new Promise(() => {}); };
    Definition.requestOfficial = async (body, remaining) => {
      deadlineCalls.push(remaining);
      fakeNow += 60;
      return '{"readable":true,"text":"P_inv"}';
    };
    assert.equal(await Fixed.correct('image', 'draft', 'rules', { remainingMs: 100 }), 'P_inv');
    assert.deepEqual(deadlineCalls, [100], 'image correction must retain the original time budget without a typography retry');
    assert.deepEqual(deadlineDelays, [0.1]);
    let exhaustedCalls = 0;
    Definition.requestOfficial = async () => { exhaustedCalls++; fakeNow += 100; return '{"readable":true,"text":"P_inv"}'; };
    assert.equal(await Fixed.correct('image', 'draft', 'rules', { remainingMs: 100 }), '');
    assert.equal(exhaustedCalls, 1, 'a response that arrives at the deadline must be rejected without another request');
  } finally {
    Date.now = realNow;
    context.MNUtil.delay = () => new Promise(() => {});
  }

  const officialCalls = [], providerLookups = [], delays = [];
  context.ocrConfig.modelSource = source => { providerLookups.push(source); throw new Error('Flash must not query broker credentials'); };
  context.subscriptionConfig = { get config() { throw new Error('Flash must not read subscription credentials'); } };
  context.MNUtil.delay = seconds => { delays.push(seconds); return new Promise(() => {}); };
  Definition.requestOfficial = async (body, remaining) => {
    officialCalls.push({ body, remaining });
    return officialCalls.length === 1 ? 'T^{*k}T^{k}' : '{"readable":true,"text":"T^{*k}T^{k}"}';
  };
  const officialDiagnostic = {};
  assert.equal(await Network.OCR('flash-image', 'deepseek-flash', 'original mode rules', {
    originalImageData: 'original-flash-image', mode: 1, timeoutSeconds: 4.5, ocrDiagnosticTarget: officialDiagnostic,
  }), 'T^{*k}T^{k}');
  assert.equal(officialCalls.length, 2, 'Flash transcription must still precede independent image correction');
  assert.equal(officialCalls[0].body.model, 'deepseek-flash');
  assert.equal(officialCalls[0].body.thinking.type, 'disabled');
  assert.equal(officialCalls[0].body.messages[0].content, Fixed.visionPrompt);
  assert.equal(officialCalls[0].body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,flash-image');
  assert.equal(officialCalls[0].remaining, 4500);
  assert.equal(delays[0], 4.5);
  assert.equal(officialCalls[1].body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,original-flash-image');
  assert.match(officialCalls[1].body.messages[1].content.at(-1).text, /original mode rules/);
  assert.equal(officialDiagnostic.attempts[0].providerModel, 'deepseek-flash');
  assert.equal(officialDiagnostic.attempts[0].success, true);
  assert.deepEqual(providerLookups, []);

  const directDiagnostic = {};
  Definition.requestOfficial = async (body, remaining) => { officialCalls.push({ body, remaining }); return 'faithful draft'; };
  assert.equal(await Network.ChatGPTVision('data:image/png;base64,png-image', 'deepseek-flash', 'keep this exact prompt', false, {
    requestTimeoutSeconds: 2, attemptDiagnosticTarget: directDiagnostic,
  }), 'faithful draft');
  assert.equal(officialCalls.at(-1).body.messages[0].content, 'keep this exact prompt');
  assert.equal(officialCalls.at(-1).body.messages[1].content[0].image_url.url, 'data:image/png;base64,png-image');
  assert.equal(officialCalls.at(-1).remaining, 2000);
  assert.equal(directDiagnostic.providerModel, 'deepseek-flash');
  Definition.requestOfficial = () => new Promise(() => {});
  context.MNUtil.delay = seconds => { assert.equal(seconds, 0.25); return Promise.resolve(); };
  const timeoutDiagnostic = {};
  assert.equal(await Network.ChatGPTVision('image', 'deepseek-flash', 'rules', false, {
    requestTimeoutSeconds: 0.25, attemptDiagnosticTarget: timeoutDiagnostic,
  }), undefined);
  assert.equal(timeoutDiagnostic.timedOut, true);
  assert.equal(timeoutDiagnostic.errorCategory, 'timeout');
  assert.deepEqual(providerLookups, []);

  context.MNUtil.delay = () => new Promise(() => {});
  context.subscriptionConfig = { config: {} };
  context.ocrConfig.modelSource = source => {
    providerLookups.push(source);
    return { model: 'qwen-legacy-vision', url: 'https://ocr.example', apiKey: 'fixture-ocr-key' };
  };
  const brokerRequests = [];
  context.ocrNetwork.initRequestForChatGPT = (key, url, model) => { brokerRequests.push({ key, url, model }); return {}; };
  context.ocrNetwork.sendRequest = async () => ({ choices: [{ message: { content: 'Qwen \\(x_{n}\\)' } }] });
  const qwenDiagnostic = {};
  assert.equal(await Network.ChatGPTVision('qwen-image', 'qwen3.5-nothinking', 'legacy rules', false, {
    attemptDiagnosticTarget: qwenDiagnostic,
  }), 'Qwen $x_{n}$');
  assert.deepEqual(brokerRequests, [{ key: 'fixture-ocr-key', url: 'https://ocr.example/v1/chat/completions', model: 'qwen-legacy-vision' }]);
  assert.ok(providerLookups.every(source => source === 'qwen3.5-nothinking'));
  assert.equal(context.ocrNetwork.history[0].content, 'legacy rules');
  assert.equal(context.ocrNetwork.history[1].content[0].image_url.url, 'data:image/jpeg;base64,qwen-image');
  assert.equal(qwenDiagnostic.providerModel, 'qwen-legacy-vision');

  const calls = [];
  Network.ChatGPTVision = async (image, model, prompt) => { calls.push({ stage: 'vision', image, model, prompt }); return 'draft with wrong indices'; };
  Definition.requestOfficial = async (body, remaining) => { calls.push({ stage: 'correction', body, remaining }); return '{"readable":true,"text":"T^{*k}T^{k}"}'; };
  const diagnostic = {};
  const result = await Network.OCR('compressed-image', 'gpt-4.1', 'current-mode-rules', { originalImageData: 'original-image', mode: 2, ocrDiagnosticTarget: diagnostic });
  assert.equal(result, 'T^{*k}T^{k}');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].prompt, Fixed.visionPrompt);
  assert.equal(calls[1].body.model, 'deepseek-flash');
  assert.equal(diagnostic.correctionModel, 'deepseek-flash');
  assert.equal(calls[1].body.thinking.type, 'disabled');
  assert.equal(calls[1].body.messages[1].content[0].image_url.url, 'data:image/jpeg;base64,original-image');
  assert.match(calls[1].body.messages[0].content, /Markdown/);
  assert.match(calls[1].body.messages[1].content.at(-1).text, /current-mode-rules/);
  assert.equal(await Fixed.correct('image', 'draft', 'rules', { remainingMs: 0 }), '');
  Definition.requestOfficial = async () => '{"readable":false,"text":"□"}';
  assert.equal(await Network.OCR('image', 'gpt-4.1', 'rules'), 'draft with wrong indices');
  assert.equal(context.ocrNetwork.OCRBuffer.fixture, 'draft with wrong indices', 'optional correction failure must preserve the successfully recognized draft');

  async function definitionCase(response) {
    const note = { noteId: 'new', title: 'excerpt', noteTitle: 'excerpt', colorIndex: 2, comments: [] };
    const records = [], requests = [], made = [];
    const manager = Definition.create({ capture: () => ({ image: 'data:image/jpeg;base64,original' }), getNote: () => note, context: () => 'study', delay: ms => ms === 0 ? Promise.resolve() : new Promise(() => {}), request: async body => { requests.push(body); return requests.length === 1 ? 'The Bergman kernel is defined by a formula.' : response; }, save: value => records.push(value), apply: async fn => fn(), setTitle: (n, title) => { n.title = n.noteTitle = title; } });
    const job = manager.begin(note);
    manager.deferMakeCard(note, n => { made.push(n.title); n.title = '【定义 >> 校对验收】; ' + n.title; });
    manager.finish(job); await flush();
    return { note, records, requests, made };
  }
  const success = await definitionCase(JSON.stringify({ readable: true, text: 'The corrected definition.', titles: [{ zh: 'Bergman 核', en: 'Bergman kernel' }] }));
  assert.equal(success.requests.length, 2);
  assert.equal(success.requests[0].model, 'deepseek-flash');
  assert.equal(success.requests[0].messages[0].content, Fixed.visionPrompt, 'definition and ordinary first-stage vision must share the generalized structure rules');
  assert.equal(success.requests[1].model, 'deepseek-flash');
  assert.match(success.requests[1].messages[1].content[0].image_url.url, /original/);
  assert.deepEqual(success.made, ['Bergman 核; Bergman kernel']);
  assert.equal(success.note.title, '【定义 >> 校对验收】; Bergman 核; Bergman kernel');
  const failed = await definitionCase('{"readable":false,"text":"□","titles":[{"zh":"Bergman 核","en":"Bergman kernel"}]}');
  assert.equal(failed.note.title, 'excerpt');
  assert.equal(failed.made.length, 0);
  const edited = { noteId: 'edited', title: 'original', noteTitle: 'original', colorIndex: 3, comments: [] };
  context.KnowledgeBaseConfig.config = { excerptOCRModelForMode1: 'gpt-4.1' };
  context.KnowledgeBaseTemplate = { types: { '定义': { colorIndex: 2 } }, parseNoteTitle: () => ({}), runUndoGroupingWithoutGlobalDBRefreshAsync: async fn => fn() };
  Network.resolveOCRImageInput = async () => ({ data: 'image' });
  Network.prepareOCRImageData = value => value.data;
  for (const response of ['{"readable":false,"text":"U_σ^J"}', '{"text":"U_σ^J"}']) {
    Definition.requestOfficial = async () => response;
    assert.equal(await Network.OCRToTitle(edited, 1), true);
    assert.equal(edited.title, 'draft with wrong indices', 'unreadable or invalid-schema correction must preserve the successfully recognized draft');
    assert.equal(edited.noteTitle, 'draft with wrong indices');
  }
  Definition.requestOfficial = () => new Promise(() => {});
  context.MNUtil.delay = () => Promise.resolve();
  assert.equal(await Network.OCRToTitle(edited, 1), true);
  assert.equal(edited.title, 'draft with wrong indices', 'a timed-out optional correction must preserve the recognized draft');
  context.MNUtil.delay = () => new Promise(() => {});
  Network.OCR = async () => { edited.title = edited.noteTitle = 'changed while reading'; return 'corrected'; };
  assert.equal(await Network.OCRToTitle(edited, 1), false);
  assert.equal(edited.title, 'changed while reading', 'late correction must preserve a title edited during reading');
  console.log('Fixed image correction, grouped scripts, mode contract, failure gate and definition/card order: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
