const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'htmlmd-studio.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'scripts/htmlmd-studio/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/htmlmd-studio.css'), 'utf8');

function collectQuotedValues(source) {
  return Array.from(source.matchAll(/'([^']+)'/g), (match) => match[1]);
}

const htmlIds = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.strictEqual(new Set(htmlIds).size, htmlIds.length, 'HTML 不应包含重复 id');

const setupBlockMatch = app.match(/function setupDom\(\) \{\s*\[([\s\S]*?)\]\.forEach/);
assert(setupBlockMatch, '应能找到 setupDom 的 id 列表');
const setupIds = new Set(collectQuotedValues(setupBlockMatch[1]));
const domReferences = new Set(Array.from(app.matchAll(/\bdom\.([A-Za-z0-9_]+)/g), (match) => match[1]));

domReferences.forEach((id) => {
  assert(setupIds.has(id), `dom.${id} 必须在 setupDom 中注册`);
});
setupIds.forEach((id) => {
  assert(htmlIds.includes(id), `setupDom 引用的 #${id} 必须存在于 HTML`);
});

const primaryBlockMatch = app.match(/const PRIMARY_TYPE_IDS = \[([\s\S]*?)\];/);
assert(primaryBlockMatch, '应定义常驻语义类型');
assert.deepStrictEqual(collectQuotedValues(primaryBlockMatch[1]), [
  'remark',
  'key',
  'question',
  'idea',
  'method',
  'sketch',
  'alert',
  'case',
  'step',
]);

assert.match(html, /<nav class="mode-switch" aria-label="工作模式">/);
assert.match(html, /<fieldset class="type-picker"/);
assert.match(html, /<details class="appearance-details"/);
assert.match(html, /<textarea[\s\S]*id="sourceTextarea"/);
assert.match(app, /data-role="candidate-select"/);
assert.match(app, /aria-pressed=/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /\.appearance-details:not\(\[open\]\) > \.appearance-panel/);
assert.match(css, /\.type-more:not\(\[open\]\) > \.secondary-type-groups/);

[
  'mnkb_htmlmd_studio_presets',
  'mnkb_htmlmd_studio_custom_types',
  'localStorage',
  'saveCurrentPreset',
  'saveCustomType',
  'importLibraryFromTextarea',
].forEach((removedFeature) => {
  assert(!`${html}\n${app}`.includes(removedFeature), `主界面不应保留 ${removedFeature}`);
});

[
  'applyHtmlMDCommentUpdates',
  'appendHtmlMDComment',
  'copyText',
  "postToNative('ready'",
  'window.loadDataFromNative',
].forEach((bridgeContract) => {
  assert(app.includes(bridgeContract), `必须保留 Bridge 契约 ${bridgeContract}`);
});

console.log('HtmlMD Studio UX regression checks passed.');
