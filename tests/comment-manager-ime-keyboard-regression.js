const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const calls = [];
const context = vm.createContext({ dom: { editLinkConfirmBtn: { disabled: false } } });
for (const file of ['actions-edit.js', 'actions-move.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/comment-manager', file), 'utf8'), context);
}
context.confirmEditLink = () => calls.push('confirm');
context.closeEditLinkModal = () => calls.push('close-editor');
context.closeTopLayerOnEscape = () => { calls.push('close-top-layer'); return true; };
context.trapFocusInTopModal = () => { calls.push('trap-focus'); return false; };
context.shouldIgnoreGlobalHotkeys = () => false;
context.moveSelectionBySteps = (direction, count) => calls.push([direction, count]);

function dispatch(key, overrides = {}) {
  calls.length = 0;
  const event = {
    key,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
  context.handleEditLinkKeydown(event);
  // Model the real input -> window bubbling order.
  context.handleGlobalKeydown(event);
  return event;
}

for (const composing of [{ isComposing: true }, { keyCode: 229 }, { isComposing: true, keyCode: 229 }]) {
  for (const key of ['Enter', 'Escape', 'Tab']) {
    const event = dispatch(key, composing);
    assert.deepStrictEqual(calls, [], `${key} during composition must not submit, dismiss, or trap focus`);
    assert.strictEqual(event.defaultPrevented, false, 'leave the IME event unconsumed');
  }
  calls.length = 0;
  context.handleGlobalKeydown({ key: 'Escape', ...composing });
  assert.deepStrictEqual(calls, [], 'global-only composition cancellation must preserve other editors');
}

dispatch('Enter');
assert.deepStrictEqual(calls, ['confirm'], 'normal Enter submits once after composition ends');
dispatch('Escape');
assert.deepStrictEqual(calls, ['close-editor'], 'handled Escape must not dismiss another layer while bubbling');
const shifted = dispatch('Enter', { shiftKey: true });
assert.strictEqual(shifted.defaultPrevented, false, 'Shift+Enter retains the existing input behavior');
assert(!calls.includes('confirm'));
context.dom.editLinkConfirmBtn.disabled = true;
dispatch('Enter');
assert.deepStrictEqual(calls, [], 'disabled confirmation must remain blocked');

calls.length = 0;
let prevented = false;
context.handleGlobalKeydown({ key: 'Escape', preventDefault() { prevented = true; } });
assert.deepStrictEqual(calls, ['trap-focus', 'close-top-layer']);
assert.strictEqual(prevented, true, 'normal global Escape still closes one layer');
calls.length = 0;
context.handleGlobalKeydown({ key: 'ArrowDown', altKey: true, shiftKey: true, preventDefault() {} });
assert.deepStrictEqual(calls, ['trap-focus', ['down', 5]], 'existing move shortcut remains available');
console.log('comment manager IME and keyboard bubbling regression ok');
