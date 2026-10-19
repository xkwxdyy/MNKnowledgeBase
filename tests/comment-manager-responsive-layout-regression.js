const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'comment-manager.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles', 'comment-manager.css'), 'utf8');
const core = fs.readFileSync(path.join(root, 'scripts', 'comment-manager', 'core.js'), 'utf8');

['selection', 'organize', 'fields'].forEach((panel) => {
  assert.match(html, new RegExp(`data-compact-panel="${panel}"`));
});
assert.match(html, /id="selectionToolsPanel"/);
assert.match(html, /id="organizeToolsPanel"/);
assert.match(html, /id="compactPanelBackdrop"/);

assert.match(css, /@media \(max-width: 999px\)/);
assert.match(css, /@media \(max-width: 639px\)/);
assert.match(css, /\.sidebar\.compact-open/);
assert.match(css, /transform:\s*translateY\(105%\)/);
assert.doesNotMatch(css, /@media \(max-width: 640px\)[\s\S]*\.sidebar, \.right-sidebar \{ display: none; \}/);

assert.match(core, /function openCompactToolsPanel/);
assert.match(core, /function closeCompactToolsPanel/);
assert.match(core, /function setCompactPanelTitle/);
assert.match(core, /setCompactPanelTitle\(\);/);
assert.match(core, /replaceChildren\(index, document\.createTextNode\(label\)\)/);
assert.match(core, /window\.innerWidth >= 1000/);
assert.match(core, /aria-expanded/);
assert.match(core, /function trapFocusInTopModal/);

console.log('comment manager responsive layout regression ok');
