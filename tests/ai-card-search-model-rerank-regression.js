const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const core = require(path.join(root, 'scripts', 'search', 'math-term-search-core.js'));
const benchmark = require(path.join(root, 'tests', 'support', 'benchmarks', 'benchmark_ai_search_models.js'));
const tournament = require(path.join(root, 'tests', 'support', 'benchmarks', 'benchmark_ai_search_tournament.js'));
const controllerSource = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'scripts', 'search', 'bridge.js'), 'utf8');
const aiUISource = fs.readFileSync(path.join(root, 'scripts', 'search', 'app-ai-search.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'search.html'), 'utf8');
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
const mnaiUtilsSource = fs.readFileSync(path.join(root, '..', 'mnai', 'mnchatglm', 'utils.js'), 'utf8');
const mnaiNotificationSource = fs.readFileSync(
  path.join(root, '..', 'mnai', 'mnchatglm', 'notificationController.js'),
  'utf8',
);
const mnaiPatchSource = fs.readFileSync(path.join(root, '..', 'mnai', 'update-mnchatglm.py'), 'utf8');
const fetchLatestAddonsSource = fs.readFileSync(
  path.join(root, '..', 'batch_fetch_latest_addons.sh'),
  'utf8',
);

function loadKnowledgeBaseNetwork(overrides = {}) {
  const start = utilsSource.indexOf('class KnowledgeBaseNetwork {');
  const end = utilsSource.indexOf('  /**\n   * OCR 常见识别错误纠正规则', start);
  assert.ok(start >= 0 && end > start, 'KnowledgeBaseNetwork source must be extractable');
  const context = {
    console,
    Set,
    Map,
    Promise,
    JSON,
    String,
    Number,
    Math,
    Array,
    Object,
    Date,
    KnowledgeBaseUtils: {
      addErrorLog(error) {
        throw error;
      },
      log() {},
      createErrorNotification() {},
      createNotification() {},
    },
    KnowledgeBaseConfig: {
      config: {
        aiSearchModelSource: 'Subscription',
        aiSearchModel: 'missing-model',
      },
      getConfig(key) {
        return this.config[key];
      },
      save() {
        this.saved = true;
      },
    },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(
    `${utilsSource.slice(start, end)}\n}\nthis.KnowledgeBaseNetwork = KnowledgeBaseNetwork;`,
    context,
  );
  return context;
}

function loadMNAICallNetwork(overrides = {}) {
  const start = utilsSource.indexOf('  static async callMNAIWithNotification(text, options = {}) {');
  const end = utilsSource.indexOf('\n  }\n}\n\nclass KnowledgeBaseConfig', start);
  assert.ok(start >= 0 && end > start, 'MNAI call method source must be extractable');
  const context = {
    console,
    Promise,
    String,
    Number,
    Math,
    setTimeout,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(
    `class TestNetwork {\n${utilsSource.slice(start, end + 4)}\n}\nthis.KnowledgeBaseNetwork = TestNetwork;`,
    context,
  );
  return context;
}

function assertPureRerankContract() {
  const cards = [
    {
      id: 'exact-definition',
      type: '定义',
      prefix: '算子拓扑 > 强算子拓扑',
      title: '强算子收敛',
      titleLinkWords: ['强算子收敛', 'SOT 收敛'],
      __mnkbAISearch: { exactSource: true, reason: '术语库来源' },
    },
    {
      id: 'related-proposition',
      type: '命题',
      prefix: '算子拓扑',
      title: '强收敛蕴含弱收敛',
      __mnkbAISearch: { exactSource: false, reason: '知识主题相关' },
    },
    {
      id: 'related-classification',
      type: '归类',
      content: '强算子拓扑的基本性质',
      __mnkbAISearch: { exactSource: false, reason: '相关归类' },
    },
  ];

  const summaries = core.buildAIRerankCandidates(cards, { limit: 2 });
  assert.strictEqual(summaries.length, 2);
  assert.strictEqual(summaries[0].exactSource, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(summaries[0], 'parentId'));
  assert.ok(summaries[0].prefix.includes('强算子拓扑'));

  const reranked = core.applyAIRerank(cards, {
    ranked: [
      { id: 'outside-index', relevance: 100, reason: '伪造卡片' },
      { id: 'related-proposition', relevance: 99, reason: '直接回答查询' },
      { id: 'exact-definition', relevance: 80, reason: '准确术语定义' },
    ],
  }, { modelLabel: 'Subscription: test-model' });
  assert.deepStrictEqual(
    reranked.map((card) => card.id),
    ['related-proposition', 'exact-definition', 'related-classification'],
    'the answer model must be able to put a proposition ahead of an exact-source definition',
  );
  assert.strictEqual(reranked[0].__mnkbAISearch.modelReranked, true);
  assert.strictEqual(reranked[0].__mnkbAISearch.modelReason, '直接回答查询');

  const queryPlan = core.buildAnswerQueryPlan('范数收敛是否推出范数一致有界', {});
  assert.strictEqual(queryPlan.intent, 'verify_implication');
  assert.deepStrictEqual(queryPlan.preferredCardTypes, ['命题', '反例']);

  const definitionHeavyCards = Array.from({ length: 12 }, (_, index) => ({
    id: `definition-${index}`,
    type: '定义',
    title: `定义 ${index}`,
  })).concat([
    { id: 'late-proposition', type: '命题', title: '范数收敛序列范数一致有界' },
    { id: 'late-counterexample', type: '反例', title: '逆命题不成立' },
  ]);
  const diverse = core.buildAIRerankCandidates(definitionHeavyCards, { limit: 8, queryPlan });
  assert.ok(diverse.some((card) => card.id === 'late-proposition'), 'late propositions must enter the model candidate set');
  assert.ok(diverse.some((card) => card.id === 'late-counterexample'), 'late counterexamples must enter the model candidate set');
}

async function assertNativeModelContract() {
  let refreshCalled = false;
  const chatAIConfig = {
    config: { source: 'Subscription' },
    modelConfig: { refreshTime: 123 },
    allSource() {
      return ['Subscription', 'ChatGPT'];
    },
    modelNames(source) {
      if (source === 'Subscription') {
        return [
          'gpt-5.6-luna',
          'gpt-5.5',
          'deepseek-chat',
          'claude-haiku-4-5',
          'gemini-3-flash-minimal',
          'doubao-seed-2-0-mini-nothinking',
        ];
      }
      return ['gpt-5.6'];
    },
    getDefaultModel() {
      return 'gpt-5.5';
    },
  };
  const context = loadKnowledgeBaseNetwork({
    chatAIConfig,
    chatAINetwork: {
      async updateModelConfig(force) {
        refreshCalled = force === true;
        return { success: true };
      },
    },
  });
  const Network = context.KnowledgeBaseNetwork;
  const catalog = await Network.getMNAIModelCatalog({ refresh: true });
  assert.strictEqual(refreshCalled, true);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(catalog.selected)),
    { source: 'Subscription', model: 'deepseek-chat' },
    'the benchmark winner should be selected when no explicit valid choice exists',
  );
  assert.strictEqual(context.KnowledgeBaseConfig.saved, true);

  context.KnowledgeBaseConfig.config.aiSearchModelSource = 'Subscription';
  context.KnowledgeBaseConfig.config.aiSearchModel = 'gpt-5.6-luna';
  context.KnowledgeBaseConfig.config.aiSearchModelExplicitlySelected = true;
  const explicitCatalog = await Network.getMNAIModelCatalog();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(explicitCatalog.selected)),
    { source: 'Subscription', model: 'gpt-5.6-luna' },
    'an explicit user model selection must override the benchmark default',
  );

  const candidateIds = ['card-a', 'card-b'];
  const parsed = Network.parseKnowledgeAnswerCardRerankResponse(
    '```json\n{"ranked":[{"id":"outside","relevance":100},{"id":"card-b","relevance":130,"answerRole":"direct","reason":" 相关  "},{"id":"card-b","relevance":20},{"id":"card-a","relevance":88,"answerRole":"counterexample"}]}\n```',
    candidateIds,
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(parsed.ranked)),
    [
      { id: 'card-b', relevance: 100, answerRole: 'direct', reason: '相关' },
      { id: 'card-a', relevance: 88, answerRole: 'counterexample', reason: '' },
    ],
  );

  const prompt = Network.buildKnowledgeAnswerCardRerankPrompt({
    query: '强算子收敛是否推出弱算子收敛',
    queryPlan: { intent: 'verify_implication', subject: '强算子收敛', preferredCardTypes: ['命题', '反例'] },
    candidates: [{ id: 'card-a', prefix: '算子拓扑', parentId: 'must-not-leak' }],
  });
  assert.ok(prompt.includes('强算子收敛'));
  assert.ok(prompt.includes('verify_implication'));
  assert.ok(prompt.includes('性质真假、蕴含和判定问题优先直接陈述结论的命题'));
  assert.ok(prompt.includes('算子拓扑'));
  assert.ok(!prompt.includes('must-not-leak'));
}

async function assertAINotificationSettlementContract() {
  const events = [];
  const notifyController = {
    lastResponse: '',
    response: '',
    connection: null,
    async hide() {
      events.push('hide-start');
      await Promise.resolve();
      events.push('hide-end');
    },
    checkAutoClose() {
      events.push('delayed-close');
    },
  };
  const context = loadMNAICallNetwork({
    chatAIUtils: {
      notifyController,
      checkCouldAsk() {
        return true;
      },
    },
    chatAIConfig: {
      config: { source: 'Subscription' },
      getDefaultModel() { return this.config.model || 'existing-model'; },
      setDefaultModel(source, model) { this.config.source = source; this.config.model = model; },
    },
    KnowledgeBaseConfig: {
      config: {},
    },
    KnowledgeBaseUtils: {
      log() {},
      addErrorLog(error) {
        throw error;
      },
      createErrorNotification() {
        events.push('error-notification');
      },
      createNotification() {
        events.push('notification');
      },
    },
    MNUtil: {
      showHUD() {
        events.push('hud');
      },
      delay(seconds) {
        return Number(seconds) === 3 ? new Promise(() => {}) : Promise.resolve();
      },
      postNotification(name, payload) {
        if (name === 'MNKnowledgeBaseAISearchRequestState') {
          events.push(`state:${payload.active}`);
          assert.strictEqual(payload.sourceAddon, 'mnknowledgebase');
          assert.strictEqual(payload.requestId, 'request-42');
          return;
        }
        events.push('request');
        assert.strictEqual(name, 'customChat');
        assert.strictEqual(payload.sourceAddon, 'mnknowledgebase');
        assert.strictEqual(payload.requestId, 'request-42');
        assert.strictEqual(payload.suppressFinishBroadcast, 1);
        notifyController.lastResponse = '{"ranked":[]}';
      },
    },
  });

  const result = await context.KnowledgeBaseNetwork.callMNAIWithNotification('rank', {
    source: 'Subscription',
    model: 'test-model',
    awaitNotificationClose: true,
    suppressMNUtilsNotification: true,
    suppressFinishBroadcast: true,
    sourceAddon: 'mnknowledgebase',
    requestId: 'request-42',
  });
  assert.strictEqual(result, '{"ranked":[]}');
  assert.deepStrictEqual(events, ['state:1', 'request', 'hide-start', 'hide-end', 'state:0']);
}

async function assertStuckMNAIControllerRecoveryContract() {
  const oldController = {
    view: { hidden: false },
    onChat: false,
    onAnimate: true,
    connection: null,
    lastResponse: '',
    response: '',
  };
  const freshController = {
    view: { hidden: true },
    onChat: false,
    onAnimate: false,
    connection: null,
    lastResponse: '',
    response: '',
    async hide() {
      this.view.hidden = true;
    },
  };
  const chatAIUtils = {
    notifyController: oldController,
    ensureNotifyController() {
      this.notifyController = freshController;
    },
    checkCouldAsk() {
      return true;
    },
  };
  const context = loadMNAICallNetwork({
    chatAIUtils,
    chatAIConfig: {
      config: { source: 'Subscription' },
      getDefaultModel() { return this.config.model || 'existing-model'; },
      setDefaultModel(source, model) { this.config.source = source; this.config.model = model; },
    },
    KnowledgeBaseConfig: { config: {} },
    KnowledgeBaseUtils: {
      log() {},
      addErrorLog(error) { throw error; },
      createErrorNotification() {},
      createNotification() {},
    },
    MNUtil: {
      showHUD() {},
      delay() { return Promise.resolve(); },
      postNotification(name) {
        if (name === 'customChat') freshController.lastResponse = '{"ranked":[]}';
      },
    },
  });

  const result = await context.KnowledgeBaseNetwork.callMNAIWithNotification('rank', {
    source: 'Subscription',
    model: 'test-model',
    suppressMNUtilsNotification: true,
    sourceAddon: 'mnknowledgebase',
    requestId: 'request-after-stuck-hide',
  });
  assert.strictEqual(result, '{"ranked":[]}');
  assert.strictEqual(oldController.view.hidden, true);
  assert.strictEqual(oldController.onAnimate, false);
  assert.strictEqual(chatAIUtils.notifyController, freshController);
}

async function assertManualMNAICloseStopsPollingContract() {
  const controller = {
    view: { hidden: false },
    onChat: true,
    onAnimate: false,
    connection: null,
    lastResponse: '',
    response: '',
  };
  let delayCount = 0;
  const context = loadMNAICallNetwork({
    chatAIUtils: {
      notifyController: controller,
      checkCouldAsk() { return true; },
    },
    chatAIConfig: {
      config: { source: 'Subscription' },
      getDefaultModel() { return this.config.model || 'existing-model'; },
      setDefaultModel(source, model) { this.config.source = source; this.config.model = model; },
    },
    KnowledgeBaseConfig: { config: {} },
    KnowledgeBaseUtils: {
      log() {},
      addErrorLog(error) { throw error; },
      createErrorNotification() {},
      createNotification() {},
    },
    MNUtil: {
      showHUD() {},
      postNotification(name) {
        if (name === 'customChat') controller.connection = { cancel() {} };
      },
      delay() {
        delayCount += 1;
        if (delayCount === 1) {
          controller.view.hidden = true;
          controller.onChat = false;
          controller.connection = null;
        }
        return Promise.resolve();
      },
    },
  });

  const result = await context.KnowledgeBaseNetwork.callMNAIWithNotification('rank', {
    source: 'Subscription',
    model: 'test-model',
    timeoutSeconds: 120,
    suppressMNUtilsNotification: true,
    sourceAddon: 'mnknowledgebase',
    requestId: 'request-manual-close',
  });
  assert.strictEqual(result, null);
  assert.ok(delayCount < 10, 'manual close must stop polling without waiting for the full timeout');
}

function assertBridgeWiring() {
  ['aisearchgetmodels', 'aisearchsetmodel', 'aisearchrerank'].forEach((action) => {
    assert.ok(controllerSource.includes(`"${action}"`), `${action} must be allowlisted`);
  });
  assert.match(controllerSource, /case "aiSearchGetModels"/);
  assert.match(controllerSource, /case "aiSearchSetModel"/);
  assert.match(controllerSource, /aiSearchModelExplicitlySelected = true/);
  assert.match(controllerSource, /case "aiSearchRerank"/);
  assert.match(controllerSource, /KnowledgeBaseNetwork\.activeAISearchRerankRequestId = requestId/);
  assert.match(controllerSource, /已有 AI 精排正在进行，请等待完成后重试/);
  assert.match(controllerSource, /finally \{[\s\S]*?activeAISearchRerankRequestId = ""/);
  assert.match(controllerSource, /buildKnowledgeCardSearchRerankPrompt\(payload\)/);
  assert.match(controllerSource, /parseKnowledgeCardSearchRerankResponse\(queryResponse, candidateIds\)/);
  assert.match(controllerSource, /buildKnowledgeAnswerCardRerankPrompt\(answerPayload\)/);
  assert.match(controllerSource, /parseKnowledgeAnswerCardRerankResponse\(response, candidateIds\)/);
  assert.match(controllerSource, /timeoutSeconds: 20,[\s\S]*?requestId: `\$\{requestId\}:query`/);
  assert.match(controllerSource, /timeoutSeconds: 45,[\s\S]*?requestId: `\$\{requestId\}:answer`/);
  assert.ok(
    controllerSource.indexOf('buildKnowledgeCardSearchRerankPrompt(payload)')
      < controllerSource.indexOf('buildKnowledgeAnswerCardRerankPrompt(answerPayload)'),
    'the answer-card model must run after the fast query-stage model',
  );
  assert.match(controllerSource, /takeAICardSearchRerankPayload/);
  assert.match(controllerSource, /completeAICardSearchRerank/);
  assert.doesNotMatch(controllerSource, /const prompt = KnowledgeBaseNetwork\.buildKnowledgeCardSearchRerankPrompt\(payload\)/);
  assert.match(bridgeSource, /requestAICardSearchModels: function/);
  assert.match(bridgeSource, /setAICardSearchModel: function/);
  assert.match(bridgeSource, /requestAICardSearchRerank: function/);
  assert.match(bridgeSource, /completeAICardSearchRerank: function/);
  assert.match(aiUISource, /AI_CARD_SEARCH_RERANK_TIMEOUT_MS = 120000/);
  assert.match(aiUISource, /state\.aiCardSearch\.requestId !== requestId/);
  assert.match(aiUISource, /buildAIRerankCandidates\(ranked\.cards/);
  assert.match(aiUISource, /buildAnswerQueryPlan\(query, analysis\)/);
  assert.match(aiUISource, /queryPlan,/);
  assert.match(aiUISource, /applyAIRerank\(ranked\.cards/);
  assert.match(utilsSource, /options\.awaitNotificationClose === true[\s\S]*?controller\.hide\(\)/);
  assert.match(utilsSource, /resetStuckMNAINotifyController\(controller, "hide_timeout"\)/);
  assert.match(utilsSource, /controller\.view\.hidden === true[\s\S]*?controller\.onChat !== true/);
  assert.match(htmlSource, /id="aiCardSearchModelSelect"/);
  assert.match(htmlSource, /id="aiCardSearchRefreshModelsBtn"/);
  assert.match(mnaiUtilsSource, /this\.notifyController\.customRequestMetadata = customRequestMetadata/);
  assert.match(mnaiUtilsSource, /suppressFinishBroadcastValue === 1/);
  assert.match(mnaiNotificationSource, /customRequestMetadata\.suppressFinishBroadcast !== true/);
  assert.match(mnaiNotificationSource, /sourceAddon: customRequestMetadata\.sourceAddon/);
  assert.match(utilsSource, /MNKnowledgeBaseAISearchRequestState/);
  assert.match(mnaiPatchSource, /def patch_custom_chat_response_metadata/);
}

function assertBenchmarkContract() {
  assert.strictEqual(
    benchmark.MNUTILS_DEFAULT_ENDPOINT,
    'https://api.feliks.top',
    'the benchmark must reuse the MNUtils Subscription endpoint by default',
  );
  assert.strictEqual(
    benchmark.resolveChatCompletionsUrl('https://api.example.com'),
    'https://api.example.com/v1/chat/completions',
  );
  assert.strictEqual(
    benchmark.resolveChatCompletionsUrl('https://api.example.com/v1'),
    'https://api.example.com/v1/chat/completions',
  );
  assert.strictEqual(
    benchmark.resolveChatCompletionsUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/chat/completions',
  );

  const rawRankedIds = benchmark.readRawRankedIds(
    '```json\n{"ranked":[{"id":"card-a"},{"id":"outside"}]}\n```',
  );
  const metrics = benchmark.scoreCase(
    { ranked: [{ id: 'card-a' }] },
    ['card-a'],
    rawRankedIds,
    ['card-a', 'card-b'],
  );
  assert.strictEqual(metrics.top1, true);
  assert.strictEqual(metrics.candidateIdSafe, false);
  assert.deepStrictEqual(metrics.outsideCandidateIds, ['outside']);

  const summary = benchmark.summarizeModel('unstable-model', [
    { metrics },
    { error: 'timeout' },
  ]);
  assert.strictEqual(summary.completed, 1);
  assert.strictEqual(summary.failed, 1);
  assert.strictEqual(summary.top1Rate, 0.5, 'failed calls must remain in the quality denominator');
  assert.strictEqual(summary.candidateIdSafeRate, 0);
  assert.ok(summary.overallScore < summary.qualityScore, 'slow or failed calls must reduce the final score');

  assert.deepStrictEqual(
    tournament.filterTextModels(['gpt-5.5', 'gemini-image-preview', 'gpt-5.5', ' qwen3.5 ']),
    ['gpt-5.5', 'qwen3.5'],
  );
  assert.deepStrictEqual(
    tournament.stableModelOrder(['a', 'b', 'c']),
    tournament.stableModelOrder(['a', 'b', 'c']),
    'tournament order must be reproducible',
  );
  const stageSelection = tournament.selectStageModels({
    models: [
      { summary: { model: 'fast', completionRate: 1 } },
      { summary: { model: 'fallback', completionRate: 0 } },
    ],
  }, 2, (item) => item.completionRate === 1);
  assert.deepStrictEqual(stageSelection, ['fast', 'fallback']);
}

function assertMNAIFetchBuildContract() {
  const start = fetchLatestAddonsSource.indexOf('run_mnchatglm_pipeline() {');
  const end = fetchLatestAddonsSource.indexOf('\n}\n\nsync_secondary_plugin_from_addon()', start);
  assert.ok(start >= 0 && end > start, 'mnchatglm fetch pipeline must be extractable');

  const pipeline = fetchLatestAddonsSource.slice(start, end);
  const updateIndex = pipeline.indexOf('update-mnchatglm.py');
  const buildIndex = pipeline.indexOf('$BUILD_SCRIPT" --plugin "$SPECIAL_MNCHATGLM_ID"');
  assert.ok(updateIndex >= 0, 'mnchatglm fetch pipeline must apply the local update script');
  assert.ok(buildIndex > updateIndex, 'mnchatglm must be rebuilt after official sync and local patches');
  assert.match(pipeline, /POST_PROCESS_FAILED\+=\("mnchatglm:build-failed"\)/);
}

(async () => {
  assertPureRerankContract();
  await assertNativeModelContract();
  await assertAINotificationSettlementContract();
  await assertStuckMNAIControllerRecoveryContract();
  await assertManualMNAICloseStopsPollingContract();
  assertBridgeWiring();
  assertBenchmarkContract();
  assertMNAIFetchBuildContract();
  console.log('ai-card-search-model-rerank-regression: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
