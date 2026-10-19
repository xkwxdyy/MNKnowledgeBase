const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal DOM for the production render and delegated keyboard paths.
const document = { activeElement: null };
class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
      toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  set className(value) { this.classes = new Set(value.split(' ')); }
  set innerHTML(value) {
    assert.strictEqual(value, '');
    if (this.contains(document.activeElement)) document.activeElement = null;
    this.children = [];
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
  }
  appendChild(child) {
    if (child.fragment) child.children.forEach((item) => this.appendChild(item));
    else { child.parent = this; this.children.push(child); }
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    const classes = Array.from(selector.matchAll(/\.([\w-]+)/g), (match) => match[1]);
    const data = selector.match(/\[data-([\w-]+)\]/);
    return classes.every((name) => this.classes.has(name)) && (!data || this.dataset[data[1]] !== undefined);
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { document.activeElement = this; }
}
document.createElement = () => new Element();
document.createDocumentFragment = () => Object.assign(new Element(), { fragment: true });
document.body = new Element();
document.body.classList.add('filters-collapsed');
const dom = Object.fromEntries(['presetBar', 'negativeBar', 'typeBar', 'classificationBar', 'classificationSection'].map((name) => [name, new Element()]));
const groups = [{ name: '分类', presets: [{ value: '性质', children: ['基本性质'] }, '紧致'] }];
const state = {
  activePresets: new Set(), expandedPresets: new Set(), activeNegativePresets: new Set(),
  currentTypeKey: 'all', currentClassificationSubtype: 'all', classificationOptions: ['主题'],
  config: { typeFilters: [{ key: 'all', label: '全部类型' }, { key: 'classifications', label: '归类' }], negativePresets: ['实', '复'] },
};
let searches = 0;
const context = vm.createContext({
  document, dom, state,
  getPerfNow: () => 0, logPerfMetric() {}, updateMainPaddingTop() {},
  updateClearPresetsButton() {}, updateClearNegativesButton() {},
  getPresetGroupsWithRecent: () => groups,
  getCurrentTypePreset: () => ({ types: ['归类'] }),
  bumpSearchExecutionRevision() {}, scheduleSearch() { searches += 1; },
});
vm.runInContext('let presetBarStructureKey, negativeBarStructureKey, typeBarStructureKey, classificationBarStructureKey;\n'
  + fs.readFileSync(path.join(__dirname, '../scripts/search/app-filters-presets.js'), 'utf8'), context);

function selected(pill, value) {
  assert.strictEqual(pill.attributes.role, 'button');
  assert.strictEqual(pill.attributes['aria-pressed'], String(value));
  assert.strictEqual(pill.classList.contains('active'), value);
  assert.strictEqual(pill.tabIndex, 0);
}
function pills(bar) { return dom[bar].querySelectorAll('.pill'); }
function key(handler, target, keyValue) {
  let prevented = false;
  context[handler]({ target, key: keyValue, preventDefault() { prevented = true; } });
  assert(prevented);
}

context.renderTypeBar();
selected(pills('typeBar')[0], true);
selected(pills('typeBar')[1], false);
key('handleTypeBarKeydown', pills('typeBar')[1], 'Enter');
selected(pills('typeBar')[0], false);
selected(pills('typeBar')[1], true);
key('handleClassificationBarKeydown', pills('classificationBar')[1], ' ');
selected(pills('classificationBar')[0], false);
selected(pills('classificationBar')[1], true);

context.renderNegativeBar();
key('handleNegativeBarKeydown', pills('negativeBar')[0], ' ');
selected(pills('negativeBar')[0], true);
key('handleNegativeBarKeydown', pills('negativeBar')[0], 'Enter');
selected(pills('negativeBar')[0], false);

context.renderPresetBar();
let parent = pills('presetBar')[0];
selected(parent, false);
assert.strictEqual(parent.attributes['aria-expanded'], 'false');
assert.strictEqual(parent.attributes['aria-label'], '性质');
parent.focus();
key('handlePresetBarKeydown', parent, 'Enter');
parent = pills('presetBar')[0];
selected(parent, true);
assert.strictEqual(document.activeElement, parent, 'selection rebuild must retain keyboard focus');
key('handlePresetBarKeydown', parent, 'ArrowRight');
parent = pills('presetBar')[0];
assert.strictEqual(parent.attributes['aria-expanded'], 'true');
assert.strictEqual(pills('presetBar').length, 3);
assert.strictEqual(document.activeElement, parent);
key('handlePresetBarKeydown', parent, 'ArrowLeft');
parent = pills('presetBar')[0];
assert.strictEqual(parent.attributes['aria-expanded'], 'false');
assert.strictEqual(pills('presetBar').length, 2);
assert.strictEqual(document.activeElement, parent);
assert.strictEqual(pills('presetBar')[1].attributes['aria-expanded'], undefined, 'leaf presets must not claim children');

// Clear/reset uses the same production render functions, including cached patch paths.
state.activePresets.clear(); state.activeNegativePresets.clear();
state.currentTypeKey = 'all'; state.currentClassificationSubtype = 'all';
const externalInput = new Element(); externalInput.focus();
context.renderPresetBar(); context.renderPresetBar(); context.renderNegativeBar(); context.renderTypeBar();
selected(pills('presetBar')[0], false);
selected(pills('negativeBar')[0], false);
selected(pills('typeBar')[0], true);
selected(pills('classificationBar')[0], true);
assert.strictEqual(document.activeElement, externalInput, 'background renders must not steal input focus');
assert.strictEqual(searches, 5, 'ARIA synchronization must not dispatch extra searches');

for (const [handler, bar, index] of [
  ['handlePresetBarKeydown', 'presetBar', 0],
  ['handleNegativeBarKeydown', 'negativeBar', 0],
  ['handleTypeBarKeydown', 'typeBar', 1],
  ['handleClassificationBarKeydown', 'classificationBar', 1],
]) {
  for (const ignored of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { repeat: true }]) {
    for (const keyValue of ['Enter', ' ']) {
      const before = searches;
      let prevented = false;
      context[handler]({ target: pills(bar)[index], key: keyValue, ...ignored, preventDefault() { prevented = true; } });
      assert.strictEqual(searches, before, `${handler} must ignore composition, handled and held keys`);
      assert.strictEqual(prevented, ignored.repeat === true, 'held activation must suppress scrolling; IME/handled keys stay untouched');
    }
  }
}
console.log('search filter accessibility and keyboard focus regression ok');
