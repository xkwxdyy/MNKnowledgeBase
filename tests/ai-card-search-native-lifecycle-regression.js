const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
const nativeSource = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');

function loadMNAI(scenario = {}) {
  const events = [];
  const logs = [];
  const models = { Original: 'user-original', Subscription: 'user-subscription', Other: 'user-other' };
  const controller = {
    view: { hidden: false }, onChat: false, onAnimate: false, connection: null,
    lastResponse: '', response: '',
    async hide() { events.push('hide'); this.view.hidden = true; },
  };
  const chatAIUtils = {
    notifyController: controller,
    checkCouldAsk() { return true; },
    ensureNotifyController() { this.notifyController = controller; },
  };
  const chatAIConfig = {
    config: { source: 'Original' },
    getDefaultModel(source) { return models[source]; },
    setDefaultModel(source, model) {
      this.config.source = source;
      if (model) models[source] = model;
      events.push(`model:${source}:${model}`);
      if (scenario.setModel) scenario.setModel(source, model);
    },
  };
  let delayCount = 0;
  const env = {
    console, setTimeout, clearTimeout, Promise,
    chatAIUtils, chatAIConfig,
    KnowledgeBaseConfig: { config: {} },
    KnowledgeBaseUtils: {
      log(...args) { logs.push(args); },
      addErrorLog(error) { throw error; },
      createNotification() {}, createErrorNotification() {},
    },
    MNUtil: {
      showHUD() {},
      postNotification(name, payload) {
        events.push(name === 'customChat' ? 'dispatch' : `state:${payload.active}`);
        if (name === 'customChat') {
          controller.customRequestMetadata = { requestId: payload.requestId, sourceAddon: payload.sourceAddon };
          controller.onChat = true;
          controller.connection = { cancel() { events.push('cancel'); } };
          if (scenario.dispatch) scenario.dispatch({ env, controller, payload, events, models });
        }
      },
      async delay(seconds) {
        if (seconds === 3) return new Promise(() => {});
        delayCount += 1;
        if (scenario.delay) await scenario.delay({ env, controller, delayCount, events, models });
      },
    },
  };
  const start = utilsSource.indexOf('  static async callMNAIWithNotification(text, options = {}) {');
  const end = utilsSource.indexOf('\n  }\n}\n\nclass KnowledgeBaseConfig', start);
  vm.createContext(env);
  vm.runInContext(`class Network {\n${utilsSource.slice(start, end + 4)}\n}\nthis.Network = Network;`, env);
  const options = {
    sourceAddon: 'mnknowledgebase', requestId: 'native-test:query',
    source: 'Subscription', model: 'ranking-model', timeoutSeconds: 10,
    suppressMNUtilsNotification: true, suppressFinishBroadcast: true, awaitNotificationClose: true,
  };
  return { env, events, logs, controller, models, options };
}

function complete(controller, value = '{"ranked":[]}') {
  controller.lastResponse = value;
  controller.connection = null;
  controller.onChat = false;
  controller.customRequestMetadata = null;
}

async function testModelRestoreAndPrivacy() {
  const h = loadMNAI({ delay({ controller }) { complete(controller, 'PRIVATE_RESPONSE_CONTENT'); } });
  assert.strictEqual(await h.env.Network.callMNAIWithNotification('PRIVATE_INPUT', h.options), 'PRIVATE_RESPONSE_CONTENT');
  assert.strictEqual(h.env.chatAIConfig.config.source, 'Original');
  assert.deepStrictEqual(h.models, { Original: 'user-original', Subscription: 'user-subscription', Other: 'user-other' });
  assert.ok(!JSON.stringify(h.logs).includes('PRIVATE_'), 'diagnostics must not contain request/response content');
  assert.ok(h.events.indexOf('hide') < h.events.indexOf('state:0'), 'close must finish before interop release');
  assert.strictEqual(h.env.Network.activeMNAINotificationRequest, null);
}

async function testUserModelChangesSurvive() {
  for (const changedSource of ['Other', 'Subscription']) {
    const h = loadMNAI({ delay({ env, controller }) {
      env.chatAIConfig.setDefaultModel(changedSource, 'user-new-selection');
      complete(controller);
    } });
    await h.env.Network.callMNAIWithNotification('rank', h.options);
    assert.strictEqual(h.env.chatAIConfig.config.source, changedSource);
    assert.strictEqual(h.models[changedSource], 'user-new-selection');
    if (changedSource === 'Other') assert.strictEqual(h.models.Subscription, 'user-subscription');
  }
}

async function testTimeoutAndCancel() {
  for (const cancel of [false, true]) {
    let cancelled = false;
    const h = loadMNAI({ delay() { if (cancel) cancelled = true; } });
    assert.strictEqual(await h.env.Network.callMNAIWithNotification('rank', {
      ...h.options, shouldCancel: () => cancelled,
    }), null);
    assert.strictEqual(h.events.filter((event) => event === 'cancel').length, 1);
    assert.strictEqual(h.env.chatAIUtils.notifyController, null);
    assert.strictEqual(h.env.Network.activeMNAINotificationRequest, null);
    assert.strictEqual(h.env.chatAIConfig.config.source, 'Original');
    assert.strictEqual(h.models.Subscription, 'user-subscription');
    assert.ok(h.events.indexOf('cancel') < h.events.indexOf('state:0'));
  }
}

async function testForeignResponseIsolation() {
  const h = loadMNAI({ delay({ env }) {
    env.chatAIUtils.notifyController = { lastResponse: 'FOREIGN_RESPONSE', connection: { cancel() { throw new Error('foreign request cancelled'); } } };
  } });
  assert.strictEqual(await h.env.Network.callMNAIWithNotification('rank', h.options), null);
  assert.strictEqual(h.env.chatAIUtils.notifyController.lastResponse, 'FOREIGN_RESPONSE');
  assert.ok(!h.events.includes('cancel'));
  const other = loadMNAI({ delay({ controller }) {
    controller.customRequestMetadata = { sourceAddon: 'another-addon', requestId: 'foreign-request' };
    controller.lastResponse = 'FOREIGN_RESPONSE';
  } });
  assert.strictEqual(await other.env.Network.callMNAIWithNotification('rank', other.options), null);
  assert.strictEqual(other.controller.lastResponse, 'FOREIGN_RESPONSE');
  assert.ok(!other.events.includes('cancel'));
}

async function testConcurrentCallsAndBusyController() {
  let release;
  let firstDelay = true;
  const h = loadMNAI({ async delay({ controller }) {
    if (firstDelay) {
      firstDelay = false;
      await new Promise((resolve) => { release = resolve; });
    }
    complete(controller);
  } });
  const first = h.env.Network.callMNAIWithNotification('first', h.options);
  assert.strictEqual(await h.env.Network.callMNAIWithNotification('second', { ...h.options, requestId: 'second' }), null);
  assert.strictEqual(h.events.filter((event) => event === 'dispatch').length, 1);
  release();
  assert.strictEqual(await first, '{"ranked":[]}');
  const busy = loadMNAI();
  busy.controller.view.hidden = true;
  busy.controller.connection = { cancel() { throw new Error('busy controller must be untouched'); } };
  assert.strictEqual(await busy.env.Network.callMNAIWithNotification('rank', busy.options), null);
  assert.ok(!busy.events.includes('dispatch'));
  assert.strictEqual(busy.env.Network.activeMNAINotificationRequest, null);
}

async function testModelFailureBeforeDispatch() {
  let failedOnce = false;
  const h = loadMNAI({ setModel(source, model) {
    if (source === 'Subscription' && model === 'ranking-model' && !failedOnce) {
      failedOnce = true;
      throw new Error('model switch failed after mutation');
    }
  } });
  assert.strictEqual(await h.env.Network.callMNAIWithNotification('rank', h.options), null);
  assert.ok(!h.events.includes('dispatch'));
  assert.strictEqual(h.env.chatAIConfig.config.source, 'Original');
  assert.strictEqual(h.models.Subscription, 'user-subscription');
}

async function testCleanupFailuresStillRelease() {
  let cancelled = false;
  const h = loadMNAI({ delay() { cancelled = true; } });
  h.env.KnowledgeBaseUtils.log = (message) => { if (message.includes('重置')) throw new Error('logger offline'); };
  const postNotification = h.env.MNUtil.postNotification;
  h.env.MNUtil.postNotification = (name, payload) => {
    if (name !== 'customChat' && payload.active === 0) throw new Error('interop offline');
    postNotification(name, payload);
  };
  try { await h.env.Network.callMNAIWithNotification('rank', { ...h.options, shouldCancel: () => cancelled }); } catch (_) {}
  assert.strictEqual(h.env.Network.activeMNAINotificationRequest, null);
  assert.strictEqual(h.env.chatAIConfig.config.source, 'Original');
  assert.strictEqual(h.models.Subscription, 'user-subscription');
  const callback = loadMNAI();
  assert.strictEqual(await callback.env.Network.callMNAIWithNotification('rank', {
    ...callback.options, shouldCancel() { throw new Error('disposed view'); },
  }), null);
  assert.strictEqual(callback.env.Network.activeMNAINotificationRequest, null);
  assert.ok(!callback.events.includes('dispatch'));
}

async function testHideReplacementDropsResult() {
  const h = loadMNAI({ delay({ controller }) { complete(controller, 'OLD_RESPONSE'); } });
  h.controller.hide = async () => {
    h.env.chatAIUtils.notifyController = { lastResponse: 'NEW_RESPONSE' };
  };
  assert.strictEqual(await h.env.Network.callMNAIWithNotification('rank', h.options), null);
  assert.strictEqual(h.env.chatAIUtils.notifyController.lastResponse, 'NEW_RESPONSE');
}

function loadNative(scenario = {}) {
  const completions = [];
  const catalogs = [];
  const calls = [];
  let native;
  const env = {
    console, Set, Map, JSON, Date,
    KnowledgeBaseConfig: { config: {}, save() {} },
    KnowledgeBaseUtils: { log() {}, addErrorLog(error) { throw error; } },
    MNUtil: { showHUD() {} },
    window: { Bridge: {
      completeAICardSearchRerank(payload) { completions.push(payload); return true; },
      setAICardSearchModelOptions(payload) { catalogs.push(payload); return true; },
    } },
    KnowledgeBaseNetwork: {
      AI_SEARCH_QUERY_MODEL_PREFERENCES: [{ source: 'Subscription', model: 'query-model' }],
      isMNAIModelAvailable(source, model) { return model !== 'missing'; },
      async getMNAIModelCatalog() { return { sources: [], selected: {} }; },
      buildKnowledgeCardSearchRerankPrompt(payload) { return JSON.stringify(payload); },
      buildKnowledgeAnswerCardRerankPrompt(payload) { return JSON.stringify(payload); },
      parseKnowledgeCardSearchRerankResponse() { return { ranked: [{ id: 'a' }] }; },
      parseKnowledgeAnswerCardRerankResponse() { return { ranked: [{ id: 'a', relevance: 90 }] }; },
      async callMNAIWithNotification(prompt, options) {
        calls.push(options);
        return scenario.call ? scenario.call({ prompt, options, native, env }) : '{"ranked":[]}';
      },
    },
  };
  vm.createContext(env);
  const start = nativeSource.indexOf('      case "aiSearchGetModels":');
  const end = nativeSource.indexOf('      case "locateCurrentMNSelectedCard":', start);
  vm.runInContext(`this.executeAIAction = async function(config) {
    let success = false;
    const parseBooleanParam = (value) => value === true || value === 'true';
    switch (config.host) {${nativeSource.slice(start, end)}}
    return success;
  };`, env);
  const payload = { requestId: 'request-1', query: 'query', candidates: [{ id: 'a' }, { id: 'b' }] };
  native = {
    currentHTMLType: 'search', view: { hidden: false },
    async runAICardSearchJavaScript(script) {
      if (script.includes('takeAICardSearchRerankPayload')) return JSON.stringify(scenario.payload || payload);
      return vm.runInContext(script, env);
    },
  };
  const run = (host = 'aiSearchRerank', params = {}) => env.executeAIAction.call(native, {
    host, params: { requestId: 'request-1', source: 'Subscription', model: 'answer-model', ...params },
  });
  return { native, env, run, payload, calls, completions, catalogs };
}

async function testNativePayloadAndLifecycle() {
  for (const payload of [
    { requestId: 'request-1', query: 'q'.repeat(501), candidates: [{ id: 'a' }, { id: 'b' }] },
    { requestId: 'request-1', query: '', candidates: [{ id: 'a' }, { id: 'b' }] },
    { requestId: 'request-1', query: 'query', candidates: [{ id: 'a' }, { id: 'a' }] },
    { requestId: 'request-1', query: 'query', candidates: [null, { id: 'b' }] },
    { requestId: 'request-1', query: 'query', candidates: [{ id: ' a' }, { id: 'b' }] },
    { requestId: 'wrong', query: 'query', candidates: [{ id: 'a' }, { id: 'b' }] },
  ]) {
    const h = loadNative({ payload });
    assert.strictEqual(await h.run(), false);
    assert.strictEqual(h.calls.length, 0);
    assert.strictEqual(h.completions.length, 1);
    assert.strictEqual(h.completions[0].success, false);
    assert.strictEqual(h.env.KnowledgeBaseNetwork.activeAISearchRerankRequestId, '');
  }
  const valid = loadNative();
  assert.strictEqual(await valid.run(), true);
  assert.deepStrictEqual(valid.calls.map((call) => call.requestId), ['request-1:query', 'request-1:answer']);
  assert.strictEqual(valid.completions[0].success, true);
  assert.strictEqual(valid.native._aiSearchRerankRequest, null);
  const failed = loadNative({ call() { return null; } });
  await failed.run();
  assert.strictEqual(failed.calls.length, 1, 'failed query stage must not dispatch the answer stage');
  assert.strictEqual(failed.completions[0].success, false);
}

async function testNativeDuplicateAndCancel() {
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const h = loadNative({ call() {
    markStarted();
    return new Promise((resolve) => { release = resolve; });
  } });
  const first = h.run();
  await started;
  assert.strictEqual(h.calls.length, 1);
  await h.run();
  assert.strictEqual(h.completions.length, 0, 'duplicate delivery must not fail the original pending request');
  await h.run('aiSearchCancelRerank', { requestId: 'wrong-request' });
  assert.strictEqual(h.native._aiSearchRerankRequest.cancelled, false);
  await h.run('aiSearchCancelRerank');
  assert.strictEqual(h.calls[0].shouldCancel(), true);
  release('{"ranked":[]}');
  await first;
  assert.strictEqual(h.calls.length, 1);
  assert.strictEqual(h.completions.length, 0, 'cancelled request must not publish late results');
  assert.strictEqual(h.native._aiSearchRerankRequest, null);
  assert.strictEqual(h.env.KnowledgeBaseNetwork.activeAISearchRerankRequestId, '');
}

async function testNativeHideAndCatalogReceipts() {
  const hidden = loadNative({ call({ native }) { native.view.hidden = true; return '{"ranked":[]}'; } });
  await hidden.run();
  assert.strictEqual(hidden.calls.length, 1);
  assert.strictEqual(hidden.completions.length, 0);
  assert.strictEqual(hidden.native._aiSearchRerankRequest, null);
  const catalog = loadNative();
  await catalog.run('aiSearchGetModels', { requestId: 'catalog-1' });
  await catalog.run('aiSearchSetModel', { requestId: 'catalog-2' });
  await catalog.run('aiSearchSetModel', { requestId: 'catalog-3', model: 'missing' });
  assert.deepStrictEqual(catalog.catalogs.map((item) => item.requestId), ['catalog-1', 'catalog-2', 'catalog-3']);
  assert.ok(catalog.catalogs[2].error);
  assert.strictEqual(catalog.env.KnowledgeBaseConfig.config.aiSearchModelExplicitlySelected, true);
  const allowlistStart = nativeSource.indexOf('const allowActionsWithoutNote');
  const allowlistEnd = nativeSource.indexOf('switch (action)', allowlistStart);
  assert.ok(nativeSource.slice(allowlistStart, allowlistEnd).includes('"aisearchcancelrerank"'));
  assert.ok(nativeSource.slice(0, nativeSource.indexOf('const KB_COMMENT_MUTATION_ACTIONS')).includes('"aisearchcancelrerank"'));
}

async function testNativeViewDismissalClearsFrontendPending() {
  const env = { Promise, state: { aiCardSearch: { requestId: 'dismiss-1' } }, window: {}, controller: { currentHTMLType: 'search' } };
  let deactivated = 0;
  env.window.deactivateAICardSearch = () => { deactivated += 1; };
  vm.createContext(env);
  const start = nativeSource.indexOf('knowledgebaseWebController.prototype.cancelActiveAICardSearchRequest = function() {');
  const end = nativeSource.indexOf('\n}\n', start) + 2;
  vm.runInContext(nativeSource.slice(start, end).replace('knowledgebaseWebController.prototype', 'controller'), env);
  env.controller._aiSearchRerankRequest = { requestId: 'dismiss-1', cancelled: false };
  env.controller.runAICardSearchJavaScript = (script) => vm.runInContext(script, env);
  env.controller.cancelActiveAICardSearchRequest();
  assert.strictEqual(env.controller._aiSearchRerankRequest.cancelled, true);
  assert.strictEqual(deactivated, 1);
  env.state.aiCardSearch.requestId = 'new-search';
  env.controller.cancelActiveAICardSearchRequest();
  assert.strictEqual(deactivated, 1, 'closing the previous request must not deactivate a new page request');
  env.controller._aiSearchRerankRequest = null;
  env.controller.cancelActiveAICardSearchRequest();
  assert.strictEqual(deactivated, 2, 'closing while local corpus loads must release the frontend request too');
  assert.ok(nativeSource.includes('self.cancelActiveAICardSearchRequest()'));
  assert.ok(nativeSource.includes('knowledgebaseWebController.prototype.hide = function(frame) {\n  this.cancelActiveAICardSearchRequest()'));
}

async function testPrivateBoundedWebViewRunner() {
  let expired;
  let callback;
  const env = {
    Promise, controller: { webView: { window: {}, evaluateJavaScript(script, cb) { callback = cb; } } },
    MNUtil: { isNSNull: (value) => value === null, delay: () => new Promise((resolve) => { expired = resolve; }) },
  };
  vm.createContext(env);
  const start = nativeSource.indexOf('knowledgebaseWebController.prototype.runAICardSearchJavaScript = async function(script) {');
  const end = nativeSource.indexOf('\n}\n', start) + 2;
  vm.runInContext(nativeSource.slice(start, end).replace('knowledgebaseWebController.prototype', 'controller'), env);
  const pending = env.controller.runAICardSearchJavaScript('private-payload');
  expired();
  assert.strictEqual(await pending, undefined);
  callback('late-private-payload');
  assert.strictEqual(await pending, undefined);
  const ready = env.controller.runAICardSearchJavaScript('private-payload');
  callback('private-result');
  assert.strictEqual(await ready, 'private-result');
  env.controller.webView.evaluateJavaScript = () => { throw new Error('webview disposed'); };
  assert.strictEqual(await env.controller.runAICardSearchJavaScript('private-payload'), undefined);
  const aiStart = nativeSource.indexOf('      case "aiSearchGetModels":');
  const aiEnd = nativeSource.indexOf('      case "locateCurrentMNSelectedCard":', aiStart);
  assert.ok(!nativeSource.slice(aiStart, aiEnd).includes('this.runJavaScript('));
}

(async () => {
  await testModelRestoreAndPrivacy();
  await testUserModelChangesSurvive();
  await testTimeoutAndCancel();
  await testForeignResponseIsolation();
  await testConcurrentCallsAndBusyController();
  await testModelFailureBeforeDispatch();
  await testCleanupFailuresStillRelease();
  await testHideReplacementDropsResult();
  await testNativePayloadAndLifecycle();
  await testNativeDuplicateAndCancel();
  await testNativeHideAndCatalogReceipts();
  await testNativeViewDismissalClearsFrontendPending();
  await testPrivateBoundedWebViewRunner();
  console.log('ai-card-search-native-lifecycle-regression: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
