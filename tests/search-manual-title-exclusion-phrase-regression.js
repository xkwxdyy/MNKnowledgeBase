const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const searchScriptsDir = path.join(rootDir, 'scripts', 'search');
const querySource = fs.readFileSync(path.join(searchScriptsDir, 'app-filters-query.js'), 'utf8');
const scoreSource = fs.readFileSync(path.join(searchScriptsDir, 'app-filters-score.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(rootDir, 'search.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(rootDir, 'styles', 'search.css'), 'utf8');
const coreSource = fs.readFileSync(path.join(searchScriptsDir, 'app-core.js'), 'utf8');
const eventsSource = fs.readFileSync(path.join(searchScriptsDir, 'app-runtime-events.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(searchScriptsDir, 'app-ui.js'), 'utf8');

const context = {
  console,
  Array,
  Boolean,
  Date,
  Map,
  Math,
  Number,
  Object,
  RegExp,
  Set,
  String,
  WeakMap,
};
context.global = context;
context.globalThis = context;
vm.createContext(context);

vm.runInContext(
  `${querySource}\n`
    + 'this.parseQueryTermsForTest = parseQueryTerms; '
    + 'this.deriveQueryTermsForTest = deriveQueryTerms; '
    + 'this.passesManualTitleExclusionForTest = passesManualTitleExclusion;',
  context,
);
vm.runInContext(
  `let normalizedCardFieldCache = new WeakMap();\n${scoreSource}\n`
    + 'this.evaluateCardForTest = evaluateCardWithNormalizedType;',
  context,
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.deepStrictEqual(
  plain(context.parseQueryTermsForTest('Hilbert "T ∈ B ( H )" 紧算子')),
  [
    { value: 'Hilbert', quoted: false },
    { value: 'T ∈ B ( H )', quoted: true },
    { value: '紧算子', quoted: false },
  ],
  'ASCII double quotes must keep a mathematical expression as one query term',
);

assert.deepStrictEqual(
  plain(context.parseQueryTermsForTest('“Hilbert 空间” 紧算子')),
  [
    { value: 'Hilbert 空间', quoted: true },
    { value: '紧算子', quoted: false },
  ],
  'Chinese double quotes must use the same phrase syntax',
);

assert.deepStrictEqual(
  plain(context.deriveQueryTermsForTest('Hilbert 空间  紧算子', [])),
  [
    { value: 'Hilbert 空间', quoted: false },
    { value: '紧算子', quoted: false },
  ],
  'the existing double-space grouping behavior must remain compatible in the search box',
);

assert.deepStrictEqual(
  plain(context.parseQueryTermsForTest('Hilbert  空间')),
  [
    { value: 'Hilbert', quoted: false },
    { value: '空间', quoted: false },
  ],
  'manual exclusion parsing must treat any unquoted whitespace as a separator',
);

assert.deepStrictEqual(
  plain(context.parseQueryTermsForTest('"Hilbert 空间')),
  [
    { value: 'Hilbert', quoted: false },
    { value: '空间', quoted: false },
  ],
  'an unfinished quote must degrade to ordinary live-search terms',
);

const mathPhrase = context.parseQueryTermsForTest('"T ∈ B ( H )"')[0];
const matchingCard = {
  id: 'matching-card',
  type: '命题',
  title: '【命题】有界算子 T∈B(H) 的谱',
};
const matchingEvaluation = context.evaluateCardForTest(
  matchingCard,
  [mathPhrase.value.toLowerCase()],
  matchingCard.type,
  {
    tokenGroupsLower: [[mathPhrase.value.toLowerCase()]],
    phraseTokenGroupIndexes: [0],
  },
);
assert.strictEqual(
  matchingEvaluation.matchCount,
  1,
  'quoted search phrases must ignore whitespace while preserving character order and symbols',
);

const reorderedCard = {
  id: 'reordered-card',
  type: '命题',
  title: '【命题】B(H)∋T 的谱',
};
const reorderedEvaluation = context.evaluateCardForTest(
  reorderedCard,
  [mathPhrase.value.toLowerCase()],
  reorderedCard.type,
  {
    tokenGroupsLower: [[mathPhrase.value.toLowerCase()]],
    phraseTokenGroupIndexes: [0],
  },
);
assert.strictEqual(
  reorderedEvaluation.matchCount,
  0,
  'whitespace-insensitive phrase matching must not reorder characters or replace symbols',
);

assert.strictEqual(
  context.passesManualTitleExclusionForTest(
    { title: '普通标题', searchText: '复 Hilbert 空间' },
    [{ value: '复', quoted: false }],
  ),
  true,
  'manual exclusions must not inspect searchText or content fields',
);
assert.strictEqual(
  context.passesManualTitleExclusionForTest(
    { title: '复 Hilbert 空间上的算子' },
    [{ value: '实', quoted: false }, { value: '复', quoted: false }],
  ),
  false,
  'matching any manual exclusion term must remove the card',
);
assert.strictEqual(
  context.passesManualTitleExclusionForTest(
    { title: '有界算子 T∈B(H) 的谱' },
    [{ value: 'T ∈ B ( H )', quoted: true }],
  ),
  false,
  'quoted manual exclusions must use the same whitespace-insensitive phrase semantics',
);

assert.match(htmlSource, /id="searchInput"/, 'search page must keep the primary search input');
assert.match(htmlSource, /id="excludeInput"/, 'search page must render the manual title exclusion input');
assert.match(htmlSource, /排除标题：空格分词，双引号保持整体/, 'exclude input must explain the phrase syntax');
assert.match(cssSource, /\.exclude-input\s*\{[\s\S]*background:\s*#fff8fb/, 'exclude input needs a distinct visual treatment');
assert.match(coreSource, /manualExclusionInput:\s*''/, 'manual exclusion input must have explicit transient state');
assert.match(coreSource, /manualExclusionInput:\s*payload\?\.manualExclusionInput/, 'search fingerprint must include manual exclusions');
assert.match(eventsSource, /function handleManualExclusionInputChange\(/, 'manual exclusion input needs its own debounced handler');
assert.match(eventsSource, /state\.manualExclusionInput\s*=\s*''/, 'global and exclusion clears must reset manual exclusions');
assert.match(uiSource, /dom\.excludeInput\.value\s*=\s*''/, 'locate reset must clear manual exclusions');

console.log('search manual title exclusion and phrase regression ok');
