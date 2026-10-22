const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'htmlmd-studio.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'scripts/htmlmd-studio/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/htmlmd-studio.css'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');

function extractStyleMap(source, markerRegex) {
  const match = source.match(markerRegex);
  assert(match, `应能找到样式表定义: ${markerRegex}`);
  const map = {};
  for (const entry of match[1].matchAll(/^\s*([a-z0-9]+):\s*(['"])(.*?)\2,/gm)) {
    map[entry[1]] = entry[3];
  }
  return map;
}

const studioStyles = extractStyleMap(app, /const BUILTIN_STYLE_MAP = \{([\s\S]*?)\n  \};/);
const runtimeStyles = extractStyleMap(utils, /class HtmlMarkdownUtils[\s\S]*?static styles = \{([\s\S]*?)\n  \};/);
assert.deepStrictEqual(
  studioStyles,
  runtimeStyles,
  'HtmlMD Studio BUILTIN_STYLE_MAP 必须与 utils.js HtmlMarkdownUtils.styles 完全一致'
);
assert.match(runtimeStyles.goal, /border-top:2px solid #1E3A8A;border-bottom:1\.5px solid #93C5FD/);
assert.match(runtimeStyles.level1, /linear-gradient\(90deg,rgba\(37,99,235,0\.11\)/);
assert.match(runtimeStyles.check, /border-radius:999px/);
assert.match(app, /LEGACY_BUILTIN_STYLE_MAPS/, 'HtmlMD Studio 应识别并剥离旧版内置默认样式');
assert.match(app, /refreshSelectedPresetStyles/, 'HtmlMD Studio 批量模式应支持按原类型刷新为新预设样式');

// 验证 HtmlMarkdownUtils 运行时方法（Check/Sketch 冒号处理与原位样式刷新）
{
  const hmdStart = utils.indexOf('class HtmlMarkdownUtils');
  const hmdEnd = utils.indexOf('\n// https://github.com/vinta/pangu.js', hmdStart);
  assert(hmdStart !== -1 && hmdEnd !== -1, '应能定位 HtmlMarkdownUtils 类定义');
  const hudMessages = [];
  const ctx = vm.createContext({
    Pangu: { spacing: (s) => String(s || '') },
    MNUtil: {
      typeOf: (v) => (typeof v === 'string' ? 'string' : 'MNComment'),
      undoGrouping: (fn) => fn(),
      showHUD: (msg) => hudMessages.push(msg),
    },
  });
  vm.runInContext(`${utils.slice(hmdStart, hmdEnd)}\nthis.HtmlMarkdownUtils = HtmlMarkdownUtils;`, ctx);
  const { HtmlMarkdownUtils } = ctx;

  const emptyCheck = HtmlMarkdownUtils.createHtmlMarkdownText('', 'check');
  assert.strictEqual(HtmlMarkdownUtils.getSpanContent(emptyCheck), '🔍 CHECK');
  const checkWithBody = HtmlMarkdownUtils.createHtmlMarkdownText('检验 n=1', 'check');
  assert.strictEqual(HtmlMarkdownUtils.getSpanContent(checkWithBody), '🔍 CHECK: 检验 n=1');
  assert.strictEqual(HtmlMarkdownUtils.getSpanTextContent(checkWithBody), '检验 n=1');

  const sketchWithBody = HtmlMarkdownUtils.createHtmlMarkdownText('几何直观', 'sketch');
  assert.strictEqual(HtmlMarkdownUtils.getSpanContent(sketchWithBody), '✏️ SKETCH: 几何直观');
  assert.strictEqual(HtmlMarkdownUtils.getSpanTextContent(sketchWithBody), '几何直观');

  const legacyComment = {
    text: '- <span id="goal" style="font-weight:900;font-size:0.7em;color:#8B2635;">🎯 证明总目标</span>',
  };
  const numberedCaseComment = {
    text: '<span id="case" style="font-weight:600;color:#2563EB;">📋 Case 1: 当 x > 0 时</span>',
  };
  const fakeNote = {
    MNComments: [legacyComment, numberedCaseComment],
    refreshed: false,
    refresh() { this.refreshed = true; },
  };
  const count = HtmlMarkdownUtils.refreshAllHtmlMDStyles(fakeNote);
  assert.strictEqual(count, 2);
  assert.strictEqual(fakeNote.refreshed, true);
  assert.match(legacyComment.text, /^-\s*<span id="goal" style="display:block;box-sizing:border-box;font-weight:700;font-size:1\.06em;/);
  assert.match(numberedCaseComment.text, /📋 Case 1: 当 x > 0 时<\/span>$/);
  assert.match(numberedCaseComment.text, /linear-gradient\(90deg,rgba\(234,88,12,0\.11\)/);
}

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

assert.match(html, /<meta name="color-scheme" content="light dark"/);
assert.match(html, /<nav class="mode-switch" aria-label="工作模式">/);
assert.match(html, /<fieldset class="type-picker"/);
assert.match(html, /<details class="appearance-details"/);
assert.match(html, /<textarea[\s\S]*id="sourceTextarea"/);
assert.match(app, /data-role="candidate-select"/);
assert.match(app, /aria-pressed=/);
assert.doesNotMatch(app, /\bcurrentMode\s*\(/, '快捷键提交不应调用未定义的 currentMode()');
assert.match(css, /@media \(prefers-color-scheme: dark\)/);
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
