const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../utils.js'), 'utf8');
const start = source.indexOf('  static async ChatGPTVision(');
const end = source.indexOf('\n  /**', start);
assert(start >= 0 && end > start);
async function check(modelConfig, subscription, expected) {
  const sent = [];
  const messages = [];
  const context = {
    ocrConfig: { modelSource: () => ({ model: 'fixture-model', isFree: true, ...modelConfig }) },
    subscriptionConfig: { config: subscription },
    MNUtil: { showHUD(message) { messages.push(message); }, waitHUD() {} },
    KnowledgeBaseUtils: { addErrorLog(error) { throw error; } },
    ocrNetwork: { initRequestForChatGPT(key, url) { sent.push({ key, url }); return {}; }, async sendRequest() { return { choices: [{ message: { content: 'recognized text' } }] }; } },
  };
  vm.createContext(context);
  vm.runInContext('class Network {\n' + source.slice(start, end) + '\n}; this.Network = Network;', context);
  const diagnostic = {};
  const result = await context.Network.ChatGPTVision('image', 'fixture-source', 'prompt', false, { attemptDiagnosticTarget: diagnostic });
  if (expected) {
    assert.equal(result, 'recognized text');
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), [expected]);
    assert.equal(messages.length, 0);
  } else {
    assert.equal(result, undefined);
    assert.equal(sent.length, 0, 'missing or mismatched credentials must not send any request');
    assert.equal(diagnostic.errorCategory, 'missing-api-key');
    assert.match(messages[0], /当前 OCR 模型/);
  }
}
(async () => {
  await check({ url: 'https://ocr.example/v1', apiKey: 'fixture-model-key' }, { url: 'https://subscription.example', apikey: 'fixture-subscription-key' }, { key: 'fixture-model-key', url: 'https://ocr.example/v1/chat/completions' });
  await check({ url: 'https://ocr.example/v1/chat/completions' }, { url: 'https://ocr.example/', apikey: 'fixture-subscription-key' }, { key: 'fixture-subscription-key', url: 'https://ocr.example/v1/chat/completions' });
  await check({}, { url: 'https://ocr.example', apikey: 'fixture-subscription-key' }, { key: 'fixture-subscription-key', url: 'https://ocr.example/v1/chat/completions' });
  await check({}, {});
  await check({ url: 'https://other.example' }, { url: 'https://ocr.example', apikey: 'fixture-subscription-key' });
  console.log('OCR explicit credentials and endpoint isolation: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
