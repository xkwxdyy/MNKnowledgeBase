const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(rootDir, 'scripts', 'search', 'app-core.js'), 'utf8');
const resultsSource = fs.readFileSync(path.join(rootDir, 'scripts', 'search', 'app-ui-results.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(rootDir, 'styles', 'search.css'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0, `missing source marker: ${startMarker}`);
  assert(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const cards = new Map([
  ['legacy', {
    id: 'legacy',
    title: '',
    type: '中间知识',
    searchText: '中间知识：弱收敛序列的范数未必收敛',
  }],
  ['current', {
    id: 'current',
    title: '',
    type: '历史卡片',
    isTemplated: false,
    searchText: '历史卡片  紧算子的像具有相对紧性',
  }],
  ['inferred', {
    id: 'inferred',
    title: '',
    type: '问题',
    isTemplated: false,
    searchText: '问题 为什么弱收敛不推出范数收敛',
  }],
  ['titled', {
    id: 'titled',
    title: '已有标题',
    type: '历史卡片',
    isTemplated: false,
    searchText: '正文不应替换已有标题',
  }],
  ['templated', {
    id: 'templated',
    title: '',
    type: '命题',
    isTemplated: true,
    searchText: '已制卡条目不属于本次降级范围',
  }],
  ['empty', {
    id: 'empty',
    title: '',
    type: '历史卡片',
    isTemplated: false,
    searchText: '',
  }],
  ['mixed-label', {
    id: 'mixed-label',
    title: '',
    type: '历史卡片',
    isTemplated: false,
    searchText: '中间知识：旧索引正文仍需兼容',
  }],
]);

const context = {
  Map,
  String,
  state: { cardLookup: cards },
  normalizeCardId(value) {
    return value == null ? '' : String(value).trim();
  },
};
context.global = context;
context.globalThis = context;
vm.createContext(context);

const coreHelpers = sourceBetween(
  coreSource,
  'function getCardRenderSource(card)',
  'function buildCardRenderSignature(card)',
);
const previewNormalizer = sourceBetween(
  resultsSource,
  'function normalizeUntitledCardPreviewText(card)',
  'function createUntitledCardPreviewElement(card)',
);
vm.runInContext(
  `${coreHelpers}\n${previewNormalizer}\n`
    + 'this.isUntemplatedCardForTest = isUntemplatedCard;\n'
    + 'this.shouldShowPreviewForTest = shouldShowUntitledCardPreview;\n'
    + 'this.getPreviewSourceForTest = getUntitledCardPreviewSource;\n'
    + 'this.normalizePreviewForTest = normalizeUntitledCardPreviewText;',
  context,
);

assert.strictEqual(context.isUntemplatedCardForTest({ id: 'legacy' }), true);
assert.strictEqual(context.isUntemplatedCardForTest({ id: 'current' }), true);
assert.strictEqual(context.isUntemplatedCardForTest({ id: 'inferred' }), true);
assert.strictEqual(context.isUntemplatedCardForTest({ id: 'templated' }), false);
assert.strictEqual(
  context.shouldShowPreviewForTest({ id: 'empty', title: '' }),
  true,
  'an empty legacy payload must render the explicit no-content fallback instead of a blank card',
);

assert.strictEqual(
  context.normalizePreviewForTest({ id: 'legacy', type: '中间知识' }),
  '弱收敛序列的范数未必收敛',
  'legacy type labels must not leak into the body preview',
);
assert.strictEqual(
  context.normalizePreviewForTest({ id: 'current', type: '历史卡片' }),
  '紧算子的像具有相对紧性',
  'current history-card labels must not leak into the body preview',
);
assert.strictEqual(
  context.normalizePreviewForTest({ id: 'inferred', type: '问题' }),
  '为什么弱收敛不推出范数收敛',
  'inferred types on untemplated cards must be hidden from the preview',
);
assert.strictEqual(
  context.normalizePreviewForTest({ id: 'mixed-label', type: '历史卡片' }),
  '旧索引正文仍需兼容',
  'legacy labels must be stripped even when the current entry type has changed',
);
assert.strictEqual(
  context.getPreviewSourceForTest({ id: 'titled', title: '已有标题' }),
  '',
  'an existing title must remain the primary card content',
);
assert.strictEqual(
  context.getPreviewSourceForTest({ id: 'templated', title: '' }),
  '',
  'untitled templated cards must keep their existing rendering contract',
);

assert.match(
  resultsSource,
  /function createCardMetaElement\(card, color\)\s*\{\s*const intermediate = isUntemplatedCard\(card\);/,
  'card metadata must preserve intermediate-card state',
);
assert.match(
  resultsSource,
  /stateBadge\.textContent = '中间卡片';/,
  'intermediate cards must expose their state in search results',
);
assert.match(
  resultsSource,
  /applyTrustedMarkedText\(preview, trustedHtml, displayText\)/,
  'preview text must use the existing sanitized marked-text renderer',
);
assert.match(
  coreSource,
  /getUntitledCardPreviewSource\(card\)[\s\S]*\.join\('\\u0001'\)/,
  'preview content must participate in card render signatures',
);
assert.match(
  cssSource,
  /\.card-untitled-preview\s*\{[\s\S]*-webkit-line-clamp:\s*3;/,
  'untitled previews must remain compact in the result grid',
);

console.log('search untitled intermediate preview regression ok');
