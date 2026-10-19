const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'bridge-api.js'),
  'utf8',
);
const coreSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'core.js'),
  'utf8',
);
const eventSource = fs.readFileSync(
  path.join(root, 'scripts', 'comment-manager', 'events-list.js'),
  'utf8',
);
const controllerSource = fs.readFileSync(
  path.join(root, 'knowledgebaseWebController.js'),
  'utf8',
);

function collectMatches(source, regex) {
  return Array.from(source.matchAll(regex), (match) => String(match[1] || '').toLowerCase())
    .filter(Boolean);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notStrictEqual(start, -1, `Cannot locate ${startMarker}`);
  assert.notStrictEqual(end, -1, `Cannot locate ${endMarker}`);
  return source.slice(start, end);
}

const frontendActions = new Set([
  ...collectMatches(bridgeSource, /createIndexedBridgeMethod\('([^']+)'/g),
  ...collectMatches(bridgeSource, /createPayloadBridgeMethod\('([^']+)'/g),
  ...collectMatches(bridgeSource, /bridgeInvoke\('([^']+)'/g),
  ...collectMatches(bridgeSource, /sendURLToNative\('([^']+)'/g),
  ...collectMatches(coreSource, /sendURLToNative\('([^']+)'/g),
  ...collectMatches(eventSource, /sendURLToNative\('([^']+)'/g),
]);

const allowlistSource = sliceBetween(
  controllerSource,
  'const allowedCommentActions = new Set([',
  '])',
);
const allowedActions = new Set(collectMatches(allowlistSource, /["']([^"'\r\n]+)["']/g));
const noteFreeSource = sliceBetween(
  controllerSource,
  'const allowActionsWithoutNote = new Set([',
  '])',
);
const noteFreeActions = new Set(collectMatches(noteFreeSource, /["']([^"'\r\n]+)["']/g));
const routedActions = new Set(collectMatches(controllerSource, /case ["']([^"']+)["']:/g));

const intentionallyFrontendOnly = new Set([]);
const missingFromAllowlist = [];
const missingFromRoutes = [];

frontendActions.forEach((action) => {
  if (intentionallyFrontendOnly.has(action)) return;
  if (!allowedActions.has(action)) missingFromAllowlist.push(action);
  if (!routedActions.has(action)) missingFromRoutes.push(action);
});

assert.deepStrictEqual(
  missingFromAllowlist,
  [],
  `comment-manager actions missing from Native allowlist: ${missingFromAllowlist.join(', ')}`,
);
assert.deepStrictEqual(
  missingFromRoutes,
  [],
  `comment-manager actions missing from Native switch routes: ${missingFromRoutes.join(', ')}`,
);

const targetlessFrontendActions = [
  'closecommentmanager',
  'copytext',
  'requestclipboardtext',
];
const missingFromNoteFreeActions = targetlessFrontendActions.filter(
  (action) => !noteFreeActions.has(action),
);
assert.deepStrictEqual(
  missingFromNoteFreeActions,
  [],
  `targetless comment-manager actions blocked by target-note guard: ${missingFromNoteFreeActions.join(', ')}`,
);

console.log('comment manager bridge wiring regression ok');
