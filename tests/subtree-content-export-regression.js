const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');

const addonRoot = path.join(__dirname, '..');
const repoRoot = path.join(addonRoot, '..');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const actionSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);
const menuSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_menu_registry.js'),
  'utf8',
);

function extractFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '`' || character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`cannot extract ${name}`);
}

const stringFunction = extractFunction(mainSource, 'subtreeExportString');
const budgetFunction = extractFunction(mainSource, 'subtreeExportApplyMediaBudget');
const context = {
  SUBTREE_EXPORT_MAX_MEDIA_CHARS: 4 * 1024 * 1024,
  SUBTREE_EXPORT_MAX_TOTAL_MEDIA_CHARS: 32 * 1024 * 1024,
};
context.subtreeExportString = eval(`(${stringFunction})`);
context.subtreeExportApplyMediaBudget = new Function(
  'subtreeExportString',
  'SUBTREE_EXPORT_MAX_MEDIA_CHARS',
  'SUBTREE_EXPORT_MAX_TOTAL_MEDIA_CHARS',
  `return (${budgetFunction});`,
)(
  context.subtreeExportString,
  context.SUBTREE_EXPORT_MAX_MEDIA_CHARS,
  context.SUBTREE_EXPORT_MAX_TOTAL_MEDIA_CHARS,
);

const oneImage = `data:image/jpeg;base64,${'A'.repeat(160)}`;
const warnings = [];
const budget = { usedMediaChars: 0, includedMediaCount: 0 };
const bounded = context.subtreeExportApplyMediaBudget(
  `[image](${oneImage})`,
  budget,
  warnings,
);
assert.ok(bounded.includes(oneImage), 'media within budget should remain embedded');
assert.strictEqual(warnings.length, 0);
assert.strictEqual(budget.includedMediaCount, 1);

const rawBase64 = 'C'.repeat(160);
const rawWarnings = [];
const rawBudget = { usedMediaChars: 0, includedMediaCount: 0 };
const normalizedRaw = context.subtreeExportApplyMediaBudget(
  `[image](${rawBase64})`,
  rawBudget,
  rawWarnings,
);
assert.match(normalizedRaw, /data:image\/jpeg;base64,/);
assert.strictEqual(rawWarnings.length, 0);
assert.strictEqual(rawBudget.includedMediaCount, 1);

const oversized = `data:image/jpeg;base64,${'B'.repeat(4 * 1024 * 1024)}`;
const oversizedWarnings = [];
const oversizedResult = context.subtreeExportApplyMediaBudget(
  `[image](${oversized})`,
  { usedMediaChars: 0, includedMediaCount: 0 },
  oversizedWarnings,
);
assert.match(oversizedResult, /图片已省略/);
assert.strictEqual(oversizedWarnings.length, 1);

assert.match(mainSource, /mnknowledgebase\.subtree-export\.v1/);
assert.match(mainSource, /exportSubtreeContext/);
assert.match(mainSource, /KnowledgeBaseUtils\.writeTextFile\(exportPath, content\)/);
assert.match(mainSource, /MNUtil\.copy\(content\)/);
assert.match(mainSource, /objectAtIndex/);
assert.match(actionSource, /exportSubtreeMarkdown/);
assert.match(actionSource, /format=markdown/);
assert.match(actionSource, /exportSubtreeJSON/);
assert.match(actionSource, /format=json/);
assert.match(menuSource, /子树内容导出/);
assert.match(menuSource, /exportSubtreeMarkdown/);
assert.match(menuSource, /exportSubtreeJSON/);

console.log('subtree content export regression ok');
