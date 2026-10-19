const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const labels = { type: '类型筛选', classification: '归类子类型', preset: '搜索预设', negative: '排除关键词' };
let activeElement = null;
function element(section, label) {
  const classes = new Set();
  return {
    dataset: { toggle: section }, attributes: {},
    classList: { add: (s) => classes.add(s), remove: (s) => classes.delete(s), contains: (s) => classes.has(s), toggle: (s, value) => value ? classes.add(s) : classes.delete(s) },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    closest() { return { querySelector: () => ({ textContent: label }) }; },
    contains(target) { return target === this.child; },
    focus() { activeElement = this; },
  };
}
const contents = Object.fromEntries(Object.keys(labels).map((name) => [name, element(name, labels[name])]));
const buttons = Object.fromEntries(Object.keys(labels).map((name) => [name, element(name, labels[name])]));
let saved = '{}';
const warnings = [];
const context = vm.createContext({
  console: { warn: (...args) => warnings.push(args) },
  document: {
    get activeElement() { return activeElement; },
    querySelector(selector) {
      const match = selector.match(/\[data-(content|toggle)="([\w-]+)"\]/);
      return match ? (match[1] === 'content' ? contents : buttons)[match[2]] : null;
    },
    querySelectorAll: () => Object.values(buttons),
  },
  localStorage: { getItem: () => saved, setItem(key, value) { saved = value; } },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/search/app-runtime-layout.js'), 'utf8'), context);
context.updateMainPaddingTop = () => {};

function expectState(name, collapsed) {
  assert.strictEqual(contents[name].classList.contains('collapsed'), collapsed);
  assert.strictEqual(contents[name].attributes['aria-hidden'], String(collapsed));
  assert.strictEqual(buttons[name].attributes['aria-expanded'], String(!collapsed));
  assert.strictEqual(buttons[name].attributes['aria-label'], `${collapsed ? '展开' : '收起'}${labels[name]}`);
}
context.loadToolbarStates();
expectState('type', false); expectState('classification', false);
expectState('preset', true); expectState('negative', true);
context.handleToolbarToggle({ currentTarget: buttons.preset });
expectState('preset', false);
contents.preset.child = {}; activeElement = contents.preset.child;
context.handleToolbarToggle({ currentTarget: buttons.preset });
expectState('preset', true);
assert.strictEqual(activeElement, buttons.preset, 'closing a section returns hidden content focus to its toggle');

// Reload must honor saved false values, even if the old DOM was collapsed.
saved = JSON.stringify({ preset: false, negative: false, type: true, 'bad"]': true });
context.loadToolbarStates();
expectState('preset', false); expectState('negative', false); expectState('type', true);
for (const invalid of ['null', '[]', '{broken', '{"preset":"false"}']) {
  saved = invalid;
  context.loadToolbarStates();
  expectState('preset', true); expectState('negative', true); expectState('type', false);
  context.handleToolbarToggle({ currentTarget: buttons.preset });
  assert.strictEqual(JSON.parse(saved).preset, false, 'the next explicit toggle must recover usable persistence');
}
assert.strictEqual(warnings.length, 2, 'invalid JSON is reported on read and recovery without breaking the UI');
console.log('search toolbar persistence, labels and hidden focus regression ok');
