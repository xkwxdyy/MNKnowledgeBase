const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');

const root = path.resolve(__dirname, '..');
const controller = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'scripts/search/bridge.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'scripts/search/app-core.js'), 'utf8');
const aiSearch = fs.readFileSync(path.join(root, 'scripts/search/app-ai-search.js'), 'utf8');
const toolbar = fs.readFileSync(path.join(root, '..', 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'), 'utf8');

assert.match(toolbar, /AddonBroadcast/);
assert.match(toolbar, /openSearchWebViewWithLocalRoot/);
const actionRegistrationStart = toolbar.indexOf('global.registerCustomAction("openKnowledgeBaseLocalSearch"');
const registerFunctionStart = toolbar.indexOf('function registerAllCustomActions');
const registerFunctionEnd = toolbar.indexOf('\n}\n\n// 立即注册', registerFunctionStart);
assert(actionRegistrationStart > registerFunctionStart && actionRegistrationStart < registerFunctionEnd, 'local-search action must be registered inside registerAllCustomActions scope');
assert.match(toolbar, /_xdyy_getSafeFocusNotesFromContext\(context\)/);
assert.doesNotMatch(toolbar, /let note = context && context\.note;/);
assert.match(toolbar, /rootId=\$\{encodeURIComponent\(noteId\)\}/);
assert.doesNotMatch(toolbar, /__MNKB_pendingLocalSearch\s*=/);

assert.match(main, /case ["']openSearchWebViewWithLocalRoot["']/);
assert.match(main, /openSearchWebViewWithLocalRoot\s*=\s*async function/);
assert.match(controller, /"getdescendantcardids"/);
assert.match(controller, /"activatependinglocalsearch"/);
assert.match(controller, /requestId/);

assert.match(bridge, /requestDescendantCardIds: function\(rootId, options = \{\}\)/);
assert.match(bridge, /const params = \{[\s\S]*?id,[\s\S]*?requestId,[\s\S]*?usageTier:[\s\S]*?usageRoundId:[\s\S]*?indexSource:/);
assert.match(bridge, /getDescendantCardIds', params/);
assert.match(core, /responseRequestId/);
assert.match(core, /过期局部搜索响应/);
assert.match(aiSearch, /candidateCards = state\.localSearchRootId/);
assert.match(aiSearch, /eligibleCards = applyCurrentNegativeFilters\(candidateCards/);
assert.match(aiSearch, /rankKnowledgeCards\(\s*eligibleCards/);

console.log('local search bridge regression ok');
