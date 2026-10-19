const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const moveSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'actions-move.js'),
  'utf8',
);
const eventSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'actions-move.js'),
  'utf8',
);

function getFunctionSource(source, functionName, nextMarker) {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(nextMarker, start);
  assert.notStrictEqual(start, -1, `Cannot locate ${functionName}`);
  assert.notStrictEqual(end, -1, `Cannot locate end of ${functionName}`);
  return source.slice(start, end);
}

const renderInsertPointsSource = getFunctionSource(
  moveSource,
  'renderInsertPoints',
  '\n    function createInsertPoint',
);
assert.doesNotMatch(
  renderInsertPointsSource,
  /fieldCommentsContainer\.innerHTML\s*=\s*['"]{2}/,
  'move mode must not destroy HtmlMD group DOM while inserting move targets',
);
assert.match(
  renderInsertPointsSource,
  /appendFieldInsertPoints/,
  'move mode must delegate to non-destructive insertion target placement',
);
assert.match(moveSource, /card\.parentNode\.insertBefore\(insertPoint, card\)/);
const insertMoveTargetSource = getFunctionSource(
  moveSource,
  'insertMoveTargetBeforeCard',
  '\n    function appendMoveTargetToField',
);
assert.match(
  insertMoveTargetSource,
  /commentsContainer\.classList\.contains\('htmlmd-group-comments'\)/,
  'move mode must recognize a comment at the start of an HtmlMD group',
);
assert.match(
  insertMoveTargetSource,
  /card === commentsContainer\.firstElementChild/,
  'only the first comment boundary should be lifted outside its HtmlMD group',
);
assert.match(
  insertMoveTargetSource,
  /groupNode\.parentNode\.insertBefore\(insertPoint, groupNode\)/,
  'the HtmlMD leading boundary must render before the whole group',
);

const closeTopLayerSource = getFunctionSource(
  eventSource,
  'closeTopLayerOnEscape',
  '\n    function shouldIgnoreGlobalHotkeys',
);
assert.match(closeTopLayerSource, /mergeTextModal/, 'Escape must close the text merge modal');
assert.match(closeTopLayerSource, /batchDeleteModal/, 'Escape must close the batch delete modal');

console.log('comment manager structure lifecycle regression ok');
