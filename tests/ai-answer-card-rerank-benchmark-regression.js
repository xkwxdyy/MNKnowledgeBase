const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const benchmark = require(path.join(root, 'tests', 'support', 'benchmarks', 'benchmark_ai_answer_rerank_models.js'));
const tournament = require(path.join(root, 'tests', 'support', 'benchmarks', 'benchmark_ai_answer_rerank_tournament.js'));
const resumeTournament = require(path.join(root, 'tests', 'support', 'benchmarks', 'resume_ai_answer_rerank_tournament.js'));
const gold = require(path.join(root, 'tests', 'support', 'benchmarks', 'ai-answer-card-rerank-gold.json'));
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');

function loadKnowledgeBaseNetwork() {
  const start = utilsSource.indexOf('class KnowledgeBaseNetwork {');
  const end = utilsSource.indexOf('  /**\n   * OCR 常见识别错误纠正规则', start);
  assert.ok(start >= 0 && end > start, 'KnowledgeBaseNetwork source must be extractable');
  const context = {
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
    KnowledgeBaseUtils: { addErrorLog() {} },
    KnowledgeBaseConfig: { config: {}, getConfig() { return ''; }, save() {} },
  };
  vm.createContext(context);
  vm.runInContext(
    `${utilsSource.slice(start, end)}\n}\nthis.KnowledgeBaseNetwork = KnowledgeBaseNetwork;`,
    context,
  );
  return context.KnowledgeBaseNetwork;
}

function assertAnswerCardContract() {
  const Network = loadKnowledgeBaseNetwork();
  const prompt = Network.buildKnowledgeAnswerCardRerankPrompt({
    query: '强算子收敛的算子列是否范数一致有界？',
    queryPlan: {
      intent: 'verify_property',
      subject: '强算子收敛的算子列',
      predicate: '范数一致有界',
      preferredCardTypes: ['命题', '反例'],
    },
    candidates: [
      {
        id: 'definition',
        type: '定义',
        title: '强算子收敛',
        parentId: 'must-not-leak',
      },
      {
        id: 'proposition',
        type: '命题',
        title: 'SOT 收敛序列的范数一致有界性',
      },
    ],
  });
  assert.ok(prompt.includes('用户要找的卡片形态'), 'answer ranking must identify the requested card shape');
  assert.ok(prompt.includes('性质真假'));
  assert.ok(prompt.includes('范数一致有界'));
  assert.ok(prompt.includes('定义卡和归类卡没有不可逾越的优先权'));
  assert.ok(!prompt.includes('must-not-leak'));

  const parsed = Network.parseKnowledgeAnswerCardRerankResponse(
    '```json\n{"ranked":[{"id":"outside","answerRole":"direct"},{"id":"proposition","relevance":120,"answerRole":"direct","reason":" 直接陈述结论 "},{"id":"proposition","relevance":10},{"id":"definition","relevance":80,"answerRole":"invented"}]}\n```',
    ['definition', 'proposition'],
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.ranked)), [
    {
      id: 'proposition',
      relevance: 100,
      answerRole: 'direct',
      reason: '直接陈述结论',
    },
    {
      id: 'definition',
      relevance: 80,
      answerRole: 'related',
      reason: '',
    },
  ]);
}

function assertCandidateConstruction() {
  const cards = [
    { id: 'definition', type: '定义', title: '强算子收敛' },
    { id: 'distractor', type: '命题', title: '范数收敛推出强算子收敛' },
    { id: 'gold', type: '命题', title: '不含召回词但属于金标准' },
  ];
  const testCase = {
    id: 'case',
    query: '强算子收敛是否范数一致有界？',
    queryPlan: { preferredCardTypes: ['命题', '反例'] },
    recallTerms: ['强算子收敛', '范数收敛'],
    expectedIds: ['gold'],
  };
  const candidates = benchmark.buildCandidates(
    cards,
    new Map(cards.map((card) => [card.id, card])),
    testCase,
    3,
  );
  assert.ok(candidates.some((candidate) => candidate.id === 'gold'));
  assert.ok(candidates.some((candidate) => candidate.type === '定义'));
  assert.ok(candidates.every((candidate) => !Object.prototype.hasOwnProperty.call(candidate, 'searchText')));
}

function assertDatasetAndTournament() {
  assert.strictEqual(gold.$schema, 'mnkb.ai-answer-card-rerank-gold.v1');
  assert.strictEqual(gold.cases.length, 14);
  assert.strictEqual(gold.cases[0].labelSource, 'synthetic-contract-fixture');
  assert.ok(gold.cases.some((item) => item.expectedTop1Types.includes('反例')));
  assert.ok(gold.cases.some((item) => item.queryPlan.intent === 'find_definition'));
  assert.deepStrictEqual(
    tournament.filterTextModels(['text-model', 'image-model', 'text-model']),
    ['text-model'],
  );
  assert.strictEqual(tournament.finalEligible({
    completionRate: 1,
    jsonValidRate: 1,
    candidateIdSafeRate: 1,
    top1Rate: 0.9,
    top3Rate: 1,
    p95LatencyMs: 59000,
  }), true);
  assert.ok(!benchmark.sanitizeErrorMessage('Bearer secret sk-abc***xyz').includes('sk-'));
  assert.strictEqual(resumeTournament.providerExhausted({
    models: [{ cases: [{ error: '401: 该令牌额度已用尽' }] }],
  }), true);
}

assertAnswerCardContract();
assertCandidateConstruction();
assertDatasetAndTournament();
console.log('ai-answer-card-rerank-benchmark-regression: ok');
