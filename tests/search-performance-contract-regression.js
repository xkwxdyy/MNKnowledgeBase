const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, 'search.html'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'styles', 'search.css'), 'utf8');
const scriptsDir = path.join(rootDir, 'scripts', 'search');
const core = fs.readFileSync(path.join(scriptsDir, 'app-core.js'), 'utf8');
const bridge = fs.readFileSync(path.join(scriptsDir, 'bridge.js'), 'utf8');
const query = fs.readFileSync(path.join(scriptsDir, 'app-filters-query.js'), 'utf8');
const score = fs.readFileSync(path.join(scriptsDir, 'app-filters-score.js'), 'utf8');
const data = fs.readFileSync(path.join(scriptsDir, 'app-runtime-data.js'), 'utf8');
const layout = fs.readFileSync(path.join(scriptsDir, 'app-runtime-layout.js'), 'utf8');
const pagination = fs.readFileSync(path.join(scriptsDir, 'app-runtime-pagination.js'), 'utf8');
const results = fs.readFileSync(path.join(scriptsDir, 'app-ui-results.js'), 'utf8');

assert.match(
  html,
  /__MNKB_STARTUP_PERF_LOG__\s*=\s*window\.__MNKB_STARTUP_PERF_LOG__\s*===\s*true/,
  'startup diagnostics must be opt-in in production',
);
assert.match(
  bridge,
  /function isBridgeInfoLogEnabled\([\s\S]*__MNKB_BRIDGE_DEBUG__\s*===\s*true/,
  'routine Bridge info logs must be opt-in',
);
assert.match(
  core,
  /function isSearchDebugEnabled\(\)\s*\{\s*return window\.__MNKB_SEARCH_DEBUG__\s*===\s*true/,
  'search ranking diagnostics must be opt-in',
);

const createCardStart = results.indexOf('function createCardElement(card)');
const createCardEnd = results.indexOf('function resolveTypeColor', createCardStart);
const createCardSource = results.slice(createCardStart, createCardEnd);
assert.doesNotMatch(
  createCardSource,
  /appendChild\(createCardActionsContainer\(card\)\)/,
  'unselected cards must not eagerly allocate their action controls',
);
assert.match(results, /function setCardActionsVisible\(/, 'selected cards need lazy action mounting');
assert.match(core, /setCardActionsVisible\(selectedCardElement, true\)/, 'selection must mount actions');
assert.match(core, /setCardActionsVisible\(selectedCardElement, false\)/, 'deselection must unmount actions');
assert.match(css, /\.card\.has-card-actions \.card-title/, 'only selected cards reserve title space for actions');

assert.match(score, /function createCachedSearchField\(/, 'normalized search variants must be cached per card');
assert.match(score, /fieldEntries:\s*Object\.entries\(fields\)/, 'field entries must be cached instead of rebuilt per query');
assert.match(score, /options\.tokenGroupsAreNormalized === true/, 'token groups must be normalized once per query, not once per card');
assert.match(score, /if \(tokenGroup\.length === 1\)/, 'single-variant tokens must avoid trial Map copies');
assert.match(query, /context\.tokenGroupsLower\.length === 0[\s\S]*score:\s*card\.score \|\| 0/, 'empty queries need a zero-allocation score path');
assert.doesNotMatch(query, /const prepared = \{ \.\.\.card/, 'matched cards must not spread every indexed field');
assert.match(query, /classificationSubtype:\s*card\.classificationSubtype/, 'matched cards must use a compact render projection');
assert.match(results, /highlightTextWithTokens\(rawTitle, highlightTokens\)/, 'title highlighting must be deferred until visible-card rendering');
assert.match(data, /function scheduleSearchFieldCachePrewarm\(/, 'large indexes must prewarm normalized fields off the input path');
assert.match(data, /queueIdleFrame\(runChunk\)/, 'cache prewarming must yield to UI work');
assert.doesNotMatch(
  data.slice(data.indexOf('function resetCardCachesAfterPatch'), data.indexOf('function syncSelectionAfterPatch')),
  /normalizedCardFieldCache\s*=\s*new WeakMap/,
  'single-card patches must retain normalized caches for unchanged card objects',
);

assert.match(core, /function getResultWindowMaxCards\(/, 'large result sets need a bounded DOM window');
assert.match(core, /return 240;/, 'the default rendered-card ceiling must remain explicit');
assert.match(pagination, /restoreNextResultWindowSegment\(\)/, 'forward scrolling must restore windowed cards before loading new data');
assert.match(results, /function restorePreviousResultWindowSegment\(/, 'windowing must support scrolling back to earlier results');
assert.match(results, /function restoreNextResultWindowSegment\(/, 'windowing must support scrolling forward through retained data');
assert.match(results, /resultWindowTopSpacerHeight/, 'windowing must preserve scroll geometry with spacers');
assert.match(results, /function getResultGridRowGap\(/, 'window geometry must include responsive grid row gaps');
assert.match(
  results,
  /resultWindowTopSegments\.length > 0[\s\S]*getResultGridRowGap\(\)/,
  'merged top segments must retain the row gaps between separately trimmed ranges',
);
assert.match(css, /\.result-window-spacer\s*\{[\s\S]*grid-column:\s*1 \/ -1/, 'window spacers must span the responsive result grid');
assert.match(
  pagination,
  /function handleResultWindowViewportChange\([\s\S]*resetPaginationState\(state\.filteredCards \|\| \[\]\)[\s\S]*renderResults\(initialCards\)/,
  'viewport width changes must rebuild window geometry instead of reusing stale spacer heights',
);
assert.match(
  layout,
  /widthChanged[\s\S]*handleResultWindowViewportChange\(\)/,
  'responsive resize handling must trigger result-window geometry rebuilding',
);
assert.match(
  layout,
  /function handleResultWindowScrollFallback\([\s\S]*IntersectionObserver[\s\S]*restorePreviousResultWindowSegment\([\s\S]*loadMore\(\)/,
  'UIWebView without IntersectionObserver needs scroll-based backward and forward restoration',
);

console.log('search performance contract regression ok');
