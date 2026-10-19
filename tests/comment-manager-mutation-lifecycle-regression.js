const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'bridge-api.js'),
  'utf8',
);
const closeSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'bridge-utils.js'),
  'utf8',
);
const controllerSource = fs.readFileSync(
  path.join(root, 'knowledgebaseWebController.js'),
  'utf8',
);
const renderSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'render-list.js'),
  'utf8',
);
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const dataSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'data-native.js'),
  'utf8',
);

assert.match(bridgeSource, /baseRevision:\s*state\.revision/);
assert.match(bridgeSource, /const requestId = `cm-\$\{Date\.now\(\)\}/);
assert.match(bridgeSource, /state\.pendingMutations\.set\(requestId, record\)/);
assert.match(bridgeSource, /completeAction\(result\)/);
assert.match(bridgeSource, /restoreCommentMutationDraft\(record\.draft\)/);
assert.match(controllerSource, /KB_COMMENT_MUTATION_ACTIONS\.has\(actionLower\)/);
assert.match(controllerSource, /baseRevision !== currentRevision/);
assert.match(controllerSource, /notifyCommentMutationComplete/);
assert.match(controllerSource, /window\.Bridge\.completeAction/);

assert.match(closeSource, /state\.pendingMutations[\s\S]*mutation-pending/);
assert.match(closeSource, /hasUnsavedCommentManagerDraft/);
assert.match(closeSource, /reason:\s*'draft-confirmation'/);
assert.match(controllerSource, /closeButtonTapped:\s*async function[\s\S]*requestCloseCommentManager\("native"\)/);
assert.match(controllerSource, /case "closecommentmanager"/);

assert.match(renderSource, /COMMENT_RENDER_FRAME_BUDGET_MS/);
assert.match(renderSource, /performance\.now/);
assert.doesNotMatch(renderSource, /renderedCount < COMMENT_RENDER_BATCH_SIZE/);
assert.match(mainSource, /getCommentManagerMediaBase64/);
assert.match(mainSource, /_commentManagerMediaCache/);
assert.match(mainSource, /maxCacheCharacters/);
assert.match(dataSource, /function buildCommentPatchPlan/);
assert.match(dataSource, /function patchChangedCommentCards/);
assert.match(dataSource, /oldCard\.parentNode\.replaceChild\(nextCard, oldCard\)/);
assert.match(dataSource, /isCommentStructureSensitive/);

console.log('comment manager mutation lifecycle regression ok');
