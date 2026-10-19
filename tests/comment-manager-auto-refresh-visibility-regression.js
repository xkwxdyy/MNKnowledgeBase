const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const addonRoot = path.resolve(__dirname, '..');
const bootSource = fs.readFileSync(path.join(addonRoot, 'scripts/comment-manager/boot.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(addonRoot, 'scripts/comment-manager/bridge-api.js'), 'utf8');
const bridgeUtilsSource = fs.readFileSync(path.join(addonRoot, 'scripts/comment-manager/bridge-utils.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(addonRoot, 'knowledgebaseWebController.js'), 'utf8');

function loadRefreshTimerHarness() {
  const start = bootSource.indexOf('const MANAGED_COMMENT_AUTO_REFRESH_INTERVAL = 2500;');
  const end = bootSource.indexOf('\n    function init()', start);
  assert.notStrictEqual(start, -1, 'Cannot locate comment-manager refresh timer');
  assert.notStrictEqual(end, -1, 'Cannot locate comment-manager init');

  const timers = new Map();
  let nextTimerId = 1;
  let refreshCalls = 0;
  const context = {
    state: {
      noteId: 'NOTE-1',
      isCommentsRendering: false,
    },
    window: {
      Bridge: {
        refreshManagedCommentData(noteId) {
          refreshCalls += 1;
          assert.strictEqual(noteId, 'NOTE-1');
        },
      },
    },
    setInterval(callback, interval) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, interval });
      return timerId;
    },
    clearInterval(timerId) {
      timers.delete(timerId);
    },
    debugLog() {},
  };
  context.Bridge = context.window.Bridge;
  context.global = context;
  vm.createContext(context);
  vm.runInContext(
    `${bootSource.slice(start, end)}
     function shouldLoadTestData() { return false; }
     this.setAutoRefreshEnabled = setManagedCommentAutoRefreshEnabled;`,
    context,
  );

  return {
    context,
    timers,
    getRefreshCalls() {
      return refreshCalls;
    },
  };
}

function run() {
  const harness = loadRefreshTimerHarness();
  const { context, timers } = harness;

  assert.strictEqual(timers.size, 0, 'comment manager must not start polling before the Native view enables it');
  assert.strictEqual(context.setAutoRefreshEnabled(true), true, 'visible comment manager must start one timer');
  assert.strictEqual(timers.size, 1, 'visible comment manager must have exactly one timer');
  assert.strictEqual(Array.from(timers.values())[0].interval, 2500, 'refresh interval must stay unchanged while visible');

  Array.from(timers.values())[0].callback();
  assert.strictEqual(harness.getRefreshCalls(), 1, 'visible comment manager must still refresh managed data');

  context.setAutoRefreshEnabled(true);
  assert.strictEqual(timers.size, 1, 're-enabling must not create duplicate timers');
  context.setAutoRefreshEnabled(false);
  assert.strictEqual(timers.size, 0, 'hidden comment manager must clear its polling timer');

  context.setAutoRefreshEnabled(true);
  context.state.isCommentsRendering = true;
  Array.from(timers.values())[0].callback();
  assert.strictEqual(harness.getRefreshCalls(), 1, 'rendering guard must continue to suppress refresh requests');

  assert.match(
    bridgeSource,
    /setManagedCommentAutoRefreshEnabled\(enabled\)[\s\S]*window\.setManagedCommentAutoRefreshEnabled\(enabled === true\)/,
    'Native must be able to toggle the WebView timer through Bridge',
  );

  const showStart = controllerSource.indexOf('knowledgebaseWebController.prototype.show = async function');
  const hideStart = controllerSource.indexOf('knowledgebaseWebController.prototype.hide = function');
  const initStart = controllerSource.indexOf('knowledgebaseWebController.prototype.init = function');
  assert.notStrictEqual(showStart, -1, 'Cannot locate controller show');
  assert.notStrictEqual(hideStart, -1, 'Cannot locate controller hide');
  assert.notStrictEqual(initStart, -1, 'Cannot locate controller init');
  assert.match(
    controllerSource.slice(showStart, hideStart),
    /currentHTMLType === 'comment-manager'[\s\S]*setCommentManagerAutoRefreshEnabled\(true\)/,
    'showing the comment manager must enable polling',
  );
  const hideSource = controllerSource.slice(hideStart, initStart);
  assert.match(hideSource, /setCommentManagerAutoRefreshEnabled\(false\)/, 'hiding the comment manager must disable polling');
  assert.ok(
    hideSource.indexOf('setCommentManagerAutoRefreshEnabled(false)') < hideSource.indexOf('MNUtil.animate'),
    'hide must stop polling before its animation completes',
  );
  assert.match(
    controllerSource,
    /case "ready":[\s\S]*currentHTMLType === 'comment-manager'[\s\S]*setCommentManagerAutoRefreshEnabled\(!this\.view\.hidden\)/,
    'the initial page-ready handshake must restore the correct visibility state',
  );
  assert.match(
    controllerSource,
    /prototype\.toMinimode[\s\S]*currentHTMLType === 'comment-manager'[\s\S]*setCommentManagerAutoRefreshEnabled\(false\)/,
    'minimizing the comment manager must stop polling while its WebView is hidden',
  );
  assert.match(
    controllerSource,
    /prototype\.fromMinimode[\s\S]*currentHTMLType === 'comment-manager'[\s\S]*setCommentManagerAutoRefreshEnabled\(true\)/,
    'restoring the comment manager must resume polling',
  );
  assert.match(
    bridgeUtilsSource,
    /function performCommentManagerClose[\s\S]*window\.setManagedCommentAutoRefreshEnabled\(false\)[\s\S]*Bridge\.closeCommentManager\(source\)/,
    'the unified close action must stop polling before requesting Native close',
  );
  assert.doesNotMatch(
    bridgeUtilsSource,
    /window\.close\(\)/,
    'comment-manager close must not bypass Native lifecycle cleanup',
  );
}

run();
console.log('comment manager auto-refresh visibility regression ok');
