const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const layoutSource = fs.readFileSync(path.join(rootDir, 'scripts', 'search', 'app-runtime-layout.js'), 'utf8');
const eventsSource = fs.readFileSync(path.join(rootDir, 'scripts', 'search', 'app-runtime-events.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(rootDir, 'search.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(rootDir, 'styles', 'search.css'), 'utf8');

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    toggle(value, force) {
      if (typeof force === 'boolean') {
        if (force) values.add(value);
        else values.delete(value);
        return force;
      }
      if (values.has(value)) {
        values.delete(value);
        return false;
      }
      values.add(value);
      return true;
    },
    contains(value) {
      return values.has(value);
    },
  };
}

function createElement(options = {}) {
  return {
    classList: createClassList(),
    dataset: {},
    offsetHeight: options.height || 0,
    textContent: '',
    focusCount: 0,
    attributes: {},
    getBoundingClientRect() {
      return { height: options.height || 0 };
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    contains(target) {
      return target === this;
    },
    focus() {
      this.focusCount += 1;
    },
  };
}

const cssVariables = {};
const storedValues = {};
const topbar = createElement({ height: 145 });
const filtersPanel = createElement();
const filtersBackdrop = createElement();
const toggleFiltersBtn = createElement();
const searchInput = createElement();
const excludeInput = createElement();
const body = { classList: createClassList() };

const context = {
  console,
  Array,
  Boolean,
  Date,
  JSON,
  Map,
  Math,
  Number,
  Object,
  RegExp,
  Set,
  String,
  WeakMap,
  document: {
    body,
    getElementById() {
      return null;
    },
    documentElement: {
      style: {
        setProperty(name, value) {
          cssVariables[name] = value;
        },
      },
    },
    querySelectorAll() {
      return [];
    },
  },
  window: {
    innerWidth: 420,
    addEventListener() {},
  },
  localStorage: {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(storedValues, key) ? storedValues[key] : null;
    },
    setItem(key, value) {
      storedValues[key] = String(value);
    },
  },
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  setTimeout,
  clearTimeout,
  dom: {
    topbar,
    filtersPanel,
    filtersBackdrop,
    toggleFiltersBtn,
    searchInput,
    excludeInput,
  },
  state: {},
};
context.global = context;
context.globalThis = context;
vm.createContext(context);

vm.runInContext(
  'let isFilterPanelCollapsed = true; '
    + 'let isFilterPanelManuallySet = false; '
    + 'let updateMainPaddingRafId = null; '
    + 'let topbarResizeObserver = null; '
    + 'const isCompactLayout = () => true; '
    + `${layoutSource}\n`
    + 'this.syncActualTopbarHeightForTest = syncActualTopbarHeight; '
    + 'this.applyFilterPanelStateForTest = applyFilterPanelState; '
    + 'this.handleFilterPanelOutsideClickForTest = handleFilterPanelOutsideClick; '
    + 'this.handleFilterPanelEscapeForTest = handleFilterPanelEscape; '
    + 'this.isFilterPanelCollapsedForTest = () => isFilterPanelCollapsed;',
  context,
);

assert.strictEqual(context.syncActualTopbarHeightForTest(), 145, 'actual topbar height must be measured');
assert.strictEqual(
  cssVariables['--topbar-actual-height'],
  '145px',
  'the measured topbar height must be exposed to fixed compact UI',
);

context.applyFilterPanelStateForTest(false, { skipSave: true });
assert.strictEqual(context.isFilterPanelCollapsedForTest(), false, 'filter panel must be open for interaction tests');
assert.strictEqual(filtersPanel.attributes['aria-hidden'], 'false', 'expanded panel must be exposed to accessibility');
assert.strictEqual(filtersBackdrop.attributes['aria-hidden'], 'false', 'compact backdrop must track expanded state');

context.handleFilterPanelOutsideClickForTest({
  target: filtersPanel,
  composedPath() {
    return [filtersPanel];
  },
});
assert.strictEqual(
  context.isFilterPanelCollapsedForTest(),
  false,
  'clicking inside the filter panel must preserve multi-select flow',
);

context.handleFilterPanelOutsideClickForTest({
  target: {},
  composedPath() {
    return [];
  },
});
assert.strictEqual(
  context.isFilterPanelCollapsedForTest(),
  true,
  'clicking outside the filter interaction area must dismiss the panel',
);
assert.strictEqual(
  storedValues.mnkb_filter_panel_collapsed,
  'true',
  'outside dismissal must persist the user-visible collapsed state',
);

context.applyFilterPanelStateForTest(false, { skipSave: true });
for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) {
  context.handleFilterPanelEscapeForTest({ key: 'Escape', ...guard, preventDefault() {} });
  assert.strictEqual(context.isFilterPanelCollapsedForTest(), false, 'IME/held/handled Escape must preserve the filter panel');
}
let escapePrevented = false;
context.handleFilterPanelEscapeForTest({
  key: 'Escape',
  preventDefault() {
    escapePrevented = true;
  },
});
assert.strictEqual(context.isFilterPanelCollapsedForTest(), true, 'Escape must dismiss the panel');
assert.strictEqual(escapePrevented, true, 'Escape dismissal must consume the key event');
assert.strictEqual(toggleFiltersBtn.focusCount, 1, 'Escape must return focus to the filter toggle');

context.dom.sidebar = createElement();
context.dom.sidebar.classList.add('show');
let sidebarCloses = 0;
context.closeSidebar = () => { sidebarCloses += 1; };
for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) {
  context.handleSidebarEscape({ key: 'Escape', ...guard, preventDefault() {} });
}
assert.strictEqual(sidebarCloses, 0, 'guarded Escape must not close the operation drawer');
context.handleSidebarEscape({ key: 'Escape', preventDefault() {} });
assert.strictEqual(sidebarCloses, 1, 'normal Escape still closes the drawer');

assert.match(htmlSource, /id="filtersBackdrop"/, 'compact filters need a dedicated dismiss backdrop');
assert.match(cssSource, /--topbar-actual-height:\s*92px/, 'CSS needs a safe pre-JS actual-height fallback');
assert.match(cssSource, /top:\s*calc\(var\(--topbar-actual-height\) \+ 8px\)/, 'filter panel must use actual topbar height');
assert.match(cssSource, /top:\s*var\(--topbar-actual-height\)[\s\S]*height:\s*calc\(100vh - var\(--topbar-actual-height\)\)/, 'compact sidebar must use actual topbar height too');
assert.match(cssSource, /body\.filters-overlay:not\(\.filters-collapsed\) \.filters-backdrop/, 'expanded compact filters must expose the backdrop');
assert.match(eventsSource, /document\.addEventListener\('click', handleFilterPanelOutsideClick, \{ capture: true \}\)/, 'outside dismissal must observe clicks before filter pills rerender');
assert.match(eventsSource, /document\.addEventListener\('keydown', handleFilterPanelEscape\)/, 'filter panel must support Escape dismissal');

console.log('search filter panel interaction regression ok');
