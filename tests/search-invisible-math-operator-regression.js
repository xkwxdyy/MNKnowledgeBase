const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const searchScriptsDir = path.join(__dirname, '..', 'scripts', 'search');
const querySource = fs.readFileSync(path.join(searchScriptsDir, 'app-filters-query.js'), 'utf8');
const scoreSource = fs.readFileSync(path.join(searchScriptsDir, 'app-filters-score.js'), 'utf8');

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
  `${querySource}\nthis.deriveTokensForTest = deriveTokens;`,
  context,
);
vm.runInContext(
  `let normalizedCardFieldCache = new WeakMap();\n${scoreSource}\nthis.normalizeSearchFieldTextForTest = normalizeSearchFieldText; this.evaluateCardForTest = evaluateCardWithNormalizedType;`,
  context,
);

const input = '不可约 𝒱*\u2062(T)';
const expectedTokens = ['不可约', '𝒱*(T)'];
const tokens = Array.from(context.deriveTokensForTest(input, []));
assert.deepStrictEqual(tokens, expectedTokens, 'query tokens must remove U+2062 INVISIBLE TIMES');
assert.strictEqual(
  context.normalizeSearchFieldTextForTest('𝒱*\u2062(T)'),
  '𝒱*(t)',
  'indexed fields must remove U+2062 INVISIBLE TIMES too',
);

const card = {
  id: 'proposition-irreducible-operator',
  type: '命题',
  title: '【命题 >> 复 Hilbert 空间 H 到自身的不可约的有界线性算子 T∈B(H) 的基本性质】𝒱*(T)=ℂI',
};
const evaluation = context.evaluateCardForTest(
  card,
  tokens.map((token) => token.toLowerCase()),
  card.type,
  {
    tokenGroupsLower: tokens.map((token) => [token.toLowerCase()]),
  },
);
assert.strictEqual(evaluation.matchCount, 2, 'the reported proposition must match both query tokens');

console.log('search invisible math operator regression ok');
