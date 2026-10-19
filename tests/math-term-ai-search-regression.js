const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runtimePath = path.join(root, 'resources', 'search', 'math-term-corpus.runtime.json');
const runtimeScriptPath = path.join(root, 'resources', 'search', 'math-term-corpus.runtime.js');
const corePath = path.join(root, 'scripts', 'search', 'math-term-search-core.js');
const searchHTMLPath = path.join(root, 'search.html');
const aiUIPath = path.join(root, 'scripts', 'search', 'app-ai-search.js');
const appCorePath = path.join(root, 'scripts', 'search', 'app-core.js');
const runtimeEventsPath = path.join(root, 'scripts', 'search', 'app-runtime-events.js');
const queryPath = path.join(root, 'scripts', 'search', 'app-filters-query.js');
const resultsPath = path.join(root, 'scripts', 'search', 'app-ui-results.js');
const buildPath = path.join(root, 'build/payload.json');

const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
const runtimeFromScript = require(runtimeScriptPath);
const core = require(corePath);
// Source-evidence ranking uses synthetic bindings; the shipped corpus has none.
const boundFixture = JSON.parse(JSON.stringify(runtime));
boundFixture.concepts.forEach((concept, conceptIndex) => {
  concept.senses.forEach((sense, senseIndex) => {
    sense.sourceNoteIds = [`fixture-${conceptIndex}-${senseIndex}-a`, `fixture-${conceptIndex}-${senseIndex}-b`];
  });
});
const engine = core.createRuntimeEngine(boundFixture);

function candidateFor(analysis, canonical) {
  return analysis.candidates.find((candidate) => candidate.canonical === canonical);
}

function assertRuntimeQuerySemantics() {
  const operatorQuery = core.queryRuntime(engine, '强算子拓扑收敛');
  const strongConvergence = candidateFor(operatorQuery, '强算子收敛');
  const strongTopology = candidateFor(operatorQuery, '强算子拓扑');
  assert.ok(strongConvergence?.resolved, 'topology + convergence must resolve strong operator convergence');
  assert.strictEqual(strongConvergence.matchedRelation, 'convergenceOf');
  assert.ok(strongTopology?.resolved, 'the strong operator topology concept must remain visible');

  const sotQuery = core.queryRuntime(engine, 'SOT 收敛');
  const sotConvergence = candidateFor(sotQuery, '强算子收敛');
  assert.ok(sotConvergence?.resolved, 'SOT with a convergence cue must resolve the convergence sense');
  assert.strictEqual(sotConvergence.direction, 'queryToCanonical');
  assert.ok(sotConvergence.expansionTerms.includes('强算子收敛'));
  assert.ok(!sotConvergence.expansionTerms.includes('SOT'), 'query-only aliases must not be emitted as reverse expansions');

  const pointwiseQuery = core.queryRuntime(engine, '点态收敛');
  assert.ok(candidateFor(pointwiseQuery, '点态收敛')?.resolved);
  assert.strictEqual(candidateFor(pointwiseQuery, '强算子收敛')?.expandable, false);

  const ambiguousQuery = core.queryRuntime(engine, '强收敛');
  assert.strictEqual(candidateFor(ambiguousQuery, '强算子收敛')?.resolved, false);
  assert.strictEqual(candidateFor(ambiguousQuery, '依范数收敛')?.resolved, false);

  const latinBoundaryQuery = core.queryRuntime(engine, 'Banach-Steinhaus 定理');
  assert.ok(candidateFor(latinBoundaryQuery, '一致有界原理')?.resolved);
  assert.ok(!latinBoundaryQuery.matches.some((match) => match.normalized === 'c'));
}

function assertRankingSemantics() {
  const operatorAnalysis = core.queryRuntime(engine, '强算子拓扑收敛');
  const strongConvergence = candidateFor(operatorAnalysis, '强算子收敛');
  const strongTopology = candidateFor(operatorAnalysis, '强算子拓扑');
  const exactConvergenceId = strongConvergence.sourceNoteIds[0];
  const exactTopologyId = strongTopology.sourceNoteIds[0];
  const cards = [
    {
      id: exactConvergenceId,
      type: '定义',
      title: '强算子收敛',
      titleLinkWords: ['强算子收敛', 'SOT'],
      prefix: '有界线性算子列的收敛性',
    },
    {
      id: exactTopologyId,
      type: '定义',
      title: '强算子拓扑',
      titleLinkWords: ['强算子拓扑', 'strong operator topology'],
    },
    {
      id: 'classification-1',
      type: '归类',
      title: '强算子拓扑下的网',
      content: '强算子拓扑下的网的收敛性',
    },
    {
      id: 'weak-related',
      type: '定义',
      title: '弱算子拓扑',
      titleLinkWords: ['弱算子拓扑'],
    },
  ];
  const ranked = core.rankKnowledgeCards(cards, operatorAnalysis, '强算子拓扑收敛');
  assert.deepStrictEqual(
    ranked.cards.slice(0, 2).map((card) => card.id),
    [exactConvergenceId, exactTopologyId],
    'corpus source cards must outrank field-only matches',
  );
  assert.ok(
    ranked.cards.findIndex((card) => card.id === 'classification-1')
      < ranked.cards.findIndex((card) => card.id === 'weak-related'),
    'directly related classifications must outrank weak structural neighbors',
  );

  const pointwiseAnalysis = core.queryRuntime(engine, '点态收敛');
  const pointwise = candidateFor(pointwiseAnalysis, '点态收敛');
  const strong = candidateFor(pointwiseAnalysis, '强算子收敛');
  const pointwiseCards = [
    {
      id: pointwise.sourceNoteIds[0],
      type: '命题',
      title: '函数列点态收敛的基本性质',
      prefix: '点态收敛',
    },
    {
      id: strong.sourceNoteIds[0],
      type: '定义',
      title: '强算子收敛',
      titleLinkWords: ['强算子收敛', '点态收敛'],
    },
  ];
  const pointwiseRanked = core.rankKnowledgeCards(pointwiseCards, pointwiseAnalysis, '点态收敛');
  assert.strictEqual(pointwiseRanked.cards[0].id, pointwise.sourceNoteIds[0]);
  assert.strictEqual(
    pointwiseRanked.cards.find((card) => card.id === strong.sourceNoteIds[0]).__mnkbAISearch.exactSource,
    false,
    'an unresolved contextual synonym must not become exact source evidence',
  );

  const ubtAnalysis = core.queryRuntime(engine, 'Banach-Steinhaus 定理');
  const falseSubstring = core.rankKnowledgeCards([
    {
      id: 'false-ubt-substring',
      type: '定义',
      title: 'subtraction',
      titleLinkWords: ['subtraction'],
      searchText: 'subtraction',
    },
  ], ubtAnalysis, 'Banach-Steinhaus 定理');
  assert.strictEqual(falseSubstring.cards.length, 0, 'UBT must not match inside subtraction');
}

function assertCorpusPresentationClean() {
  assert.deepStrictEqual(
    runtimeFromScript,
    runtime,
    'the UIWebView script resource must contain the exact canonical runtime corpus',
  );
  const concepts = runtime.concepts || [];
  const canonicals = new Set(concepts.map((concept) => concept.canonical));
  [
    '利用 Parseval 等式证明 Liouville 定理',
    '利用凸级数概念和 Baire 纲定理证明开映射定理',
    '给出了逆算子定理证明开映射定理的另一个方法',
  ].forEach((sentence) => assert.ok(!canonicals.has(sentence), `${sentence} must not be a concept`));

  const miljutin = concepts.find((concept) => concept.canonical === 'Miljutin 定理');
  assert.ok(miljutin);
  assert.strictEqual(miljutin.senses.length, 1);
  assert.strictEqual(miljutin.senses[0].sourceNoteIds.length, 0, 'public terminology must not pre-bind local notebook cards');

  concepts.forEach((concept) => {
    (concept.aliases || []).forEach((alias) => {
      const expected = ['ambiguousSurface', 'contextualSynonym'].includes(alias.relation)
        ? 'queryToCanonical'
        : 'bidirectional';
      assert.strictEqual(alias.direction, expected, `${concept.canonical}: ${alias.text}`);
    });
  });
}

function assertUIContract() {
  const html = fs.readFileSync(searchHTMLPath, 'utf8');
  const ui = fs.readFileSync(aiUIPath, 'utf8');
  const appCore = fs.readFileSync(appCorePath, 'utf8');
  const runtimeEvents = fs.readFileSync(runtimeEventsPath, 'utf8');
  const querySource = fs.readFileSync(queryPath, 'utf8');
  const resultsSource = fs.readFileSync(resultsPath, 'utf8');
  const buildSource = fs.readFileSync(buildPath, 'utf8');

  assert.match(html, /id="aiCardSearchBtn"[^>]*>AI 找卡片<\/button>/);
  assert.match(html, /id="aiCardSearchPanel"/);
  assert.ok(
    html.indexOf('math-term-search-core.js') < html.indexOf('app-ai-search.js'),
    'the pure runtime engine must load before the UI controller',
  );
  assert.match(ui, /MNKB_MATH_TERM_CORPUS_URL = '\.\/resources\/search\/math-term-corpus\.runtime\.js'/);
  assert.match(ui, /document\.head\.appendChild\(script\)/);
  assert.doesNotMatch(ui, /fetch\(MNKB_MATH_TERM_CORPUS_URL/);
  assert.doesNotMatch(ui, /XMLHttpRequest/);
  assert.match(ui, /rankKnowledgeCards\(/);
  assert.match(ui, /state\.aiCardSearch\.requestId !== requestId/);
  assert.match(appCore, /aiCardSearch:\s*\{/);
  assert.match(runtimeEvents, /attachAICardSearchListeners\(\)/);
  assert.match(runtimeEvents, /nextInput === state\.aiCardSearch\.query/);
  assert.match(querySource, /options\.preserveAICardSearch !== true/);
  assert.match(resultsSource, /card\.__mnkbAISearch\?\.roleLabel/);
  assert.match(buildSource, /scripts\/search\/math-term-search-core\.js/);
  assert.match(buildSource, /resources\/search\/math-term-corpus\.runtime\.js/);
  assert.doesNotMatch(buildSource, /docs\/prototypes\/math-term-corpus\.runtime\.json/);
  const payload = JSON.parse(buildSource);
  assert.ok(payload.includes('main.js'));
  assert.ok(payload.includes('resources/search/math-term-corpus.runtime.js'));
  assert.ok(payload.every(file => fs.existsSync(path.join(root, file))), 'declared runtime files must exist');
}

assertRuntimeQuerySemantics();
assertRankingSemantics();
assertCorpusPresentationClean();
assertUIContract();
console.log('math-term-ai-search-regression: ok');
