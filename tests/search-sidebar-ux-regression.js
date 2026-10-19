const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, 'search.html'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'styles', 'search.css'), 'utf8');
const layout = fs.readFileSync(path.join(rootDir, 'scripts', 'search', 'app-runtime-layout.js'), 'utf8');
const events = fs.readFileSync(path.join(rootDir, 'scripts', 'search', 'app-runtime-events.js'), 'utf8');

assert.match(html, /id="sidebarWorkflowHint"/, 'sidebar must provide a next-step hint');
assert.match(html, /id="sidebarEmptyGuide"/, 'empty selection must explain the first action');
assert.strictEqual(
  (html.match(/data-operation-group="(?:merge|move|template)"/g) || []).length,
  3,
  'sidebar must expose exactly three operation groups',
);
assert.match(html, /data-operation-toggle="merge"[\s\S]*aria-controls="mergeOperationBody"/, 'merge group must be collapsible');
assert.match(html, /<div class="filter-input-row filter-input-row--negative">[\s\S]*id="excludeInput"/, 'manual exclusion input belongs to the negative filter section');
assert.doesNotMatch(html.slice(0, html.indexOf('<div class="filters-backdrop"')), /id="excludeInput"/, 'manual exclusion input must not compete with the primary search input');
assert.match(css, /\.sidebar-merge-action-card\s*\{[\s\S]*position:\s*static/, 'action cards must not cover their settings with sticky positioning');
assert.match(css, /\.sidebar-btn-group\.is-open \.sidebar-operation-body/, 'only the active operation body should be visible');
assert.match(css, /\.sidebar-last-action\.is-empty\s*\{[\s\S]*display:\s*none/, 'empty last-action placeholders must not add noise');
assert.match(layout, /SIDEBAR_OPERATION_KEY/, 'active operation must be persisted');
assert.match(layout, /setSidebarOperation\(state\.sidebarActiveOperation/, 'selection must restore the active operation');
assert.match(layout, /function scrollSidebarToOperation/, 'selected operations must support automatic main-action positioning');
assert.match(layout, /group\?\.querySelector\('\.sidebar-btn--merge-primary'\)/, 'automatic positioning must target the primary action');
assert.match(layout, /scroll:\s*true/, 'selection must request automatic operation positioning');
assert.match(layout, /function openSidebar\(\)[\s\S]*scrollSidebarToOperation\(state\.sidebarActiveOperation/, 'opening the compact drawer must restore the active action position');
assert.match(layout, /if \(!hidden && state\.selectedCardId\)[\s\S]*scrollSidebarToOperation\(state\.sidebarActiveOperation/, 'reopening the desktop panel must restore the active action position');
assert.match(layout, /function updateFilterToggleLabel/, 'filter toggle must surface active filter count');
assert.match(layout, /const defaultStates = \{ preset: true, negative: true \}/, 'secondary filter sections must have a low-noise default');
assert.match(layout, /btn\.setAttribute\('aria-expanded', collapsed \? 'false' : 'true'\)/, 'filter section toggles must expose their expanded state');
assert.doesNotMatch(layout.slice(layout.indexOf('function handleSearchInputFocus'), layout.indexOf('// 选中卡片后自动收起筛选面板')), /expandFiltersForSearchInput\(\)/, 'primary search focus must not open the full filter panel');
assert.match(events, /confirmWindowMs:\s*2600/, 'sidebar confirmation must allow a touch-friendly confirmation window');
assert.match(events, /再点一次确认执行/, 'confirmation must explain the next action in the button itself');

console.log('search sidebar UX regression ok');
