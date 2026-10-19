const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const html = read('search.html');
const css = read('styles/search.css');
const core = read('scripts/search/app-core.js');
const app = read('scripts/search/app.js');
const bridge = read('scripts/search/bridge.js');
const events = read('scripts/search/app-runtime-events.js');
const layout = read('scripts/search/app-runtime-layout.js');
const ui = read('scripts/search/app-ui.js');
const controller = read('knowledgebaseWebController.js');

const quickActionsStart = html.indexOf('<div class="quick-action-grid"');
const quickActionsEnd = html.indexOf('</div>', quickActionsStart);
assert.notStrictEqual(quickActionsStart, -1, 'search topbar must expose a left quick-action grid');
assert.notStrictEqual(quickActionsEnd, -1, 'search quick-action grid must be closed');
const quickActions = html.slice(quickActionsStart, quickActionsEnd);
assert.match(quickActions, /id="locateMNSelectionBtn"[^>]*>📍</, 'quick actions must contain the current-card locate pin');
assert.match(quickActions, /id="toggleFiltersBtn"/, 'quick actions must keep the filter toggle');
assert.match(quickActions, /id="refreshBtn"[^>]*>🔄</, 'quick actions must keep refresh');
assert.match(quickActions, /id="clearBtn"[^>]*>🗑️</, 'quick actions must keep clear');
assert.match(app, /dom\.refreshBtn\.textContent\s*=\s*'🔄'/, 'refresh state changes must keep the button icon-only');
assert.doesNotMatch(app, /dom\.refreshBtn\.textContent[^;]*(?:刷新中|🔄 刷新)/, 'refresh button must never restore visible label text');
assert.match(app, /setAttribute\('aria-busy',\s*state\.isRefreshReloading\s*\?\s*'true'\s*:\s*'false'\)/);
assert.match(app, /setAttribute\('aria-label',\s*state\.isRefreshReloading\s*\?\s*'正在刷新搜索列表'\s*:\s*'刷新搜索列表'\)/);

assert.match(core, /locateMNSelectionBtn:\s*document\.getElementById\('locateMNSelectionBtn'\)/);
assert.match(bridge, /requestLocateCurrentMNSelectedCard:\s*function\(\)[\s\S]*postToAddon\('locateCurrentMNSelectedCard',\s*\{\}\)/);
assert.match(bridge, /notifyLocateCurrentMNSelectedCard:\s*function\(payload\s*=\s*\{\}\)/);
assert.match(events, /dom\.locateMNSelectionBtn\?\.addEventListener\('click',\s*handleLocateMNSelectionClick\)/);
assert.match(events, /status === 'multiple-selection'/);
assert.match(events, /status === 'not-found'/);
assert.match(layout, /isQuickButton[\s\S]*dom\.toggleFiltersBtn\.textContent/);
assert.match(css, /\.quick-action-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
assert.match(css, /\.quick-btn\s*\{[\s\S]*width:\s*34px/);
const topbarMainRule = css.match(/\.topbar-main\s*\{([\s\S]*?)\}/);
assert.ok(topbarMainRule, 'search topbar main layout rule must exist');
assert.match(topbarMainRule[1], /flex-wrap:\s*nowrap/, 'quick actions and search input must never wrap into separate rows');
const narrowTopbarRule = css.match(/@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.topbar-main\s*\{([\s\S]*?)\}/);
assert.ok(narrowTopbarRule, 'narrow search topbar layout rule must exist');
assert.match(narrowTopbarRule[1], /flex-direction:\s*row/, 'narrow layout must keep quick actions beside the search input');
assert.match(narrowTopbarRule[1], /flex-wrap:\s*nowrap/, 'narrow layout must not move quick actions above the search input');

const missingCardStart = ui.indexOf('const exists = !!getCardById(targetId);');
const missingCardEnd = ui.indexOf('const cardAlreadyVisible', missingCardStart);
assert.notStrictEqual(missingCardStart, -1, 'locateCardById must validate index membership');
assert.notStrictEqual(missingCardEnd, -1, 'locateCardById missing-card branch must remain bounded');
const missingCardBranch = ui.slice(missingCardStart, missingCardEnd);
assert.match(missingCardBranch, /options\.preserveOnMissing !== true/);
assert.match(missingCardBranch, /options\.missingMessage \|\| '未找到卡片'/);

assert.match(controller, /"locatecurrentmnselectedcard"/i, 'locate action must prevent auto-close');
assert.match(
  controller,
  /"locateCurrentMNSelectedCard"[\s\S]*"locatecurrentmnselectedcard"/,
  'locate action must bypass the target-note guard',
);
assert.match(controller, /case "locateCurrentMNSelectedCard":\s*case "locatecurrentmnselectedcard":/);
assert.match(controller, /selectedViews\.length > 1[\s\S]*status: "multiple-selection"/);
assert.match(controller, /selectedViews\[0\][\s\S]*MNNote\.new\(selectedView\.note\.note\)/);
assert.match(controller, /selectedNote = MNNote\.getFocusNote\(\)/, 'focus note remains the single-selection fallback');
assert.match(controller, /preserveOnMissing: true/);
assert.match(controller, /window\.Bridge\.locateCardById\(payload\.noteId/);
assert.match(controller, /window\.Bridge\.notifyLocateCurrentMNSelectedCard/);

console.log('search locate current MarginNote selection regression ok');
