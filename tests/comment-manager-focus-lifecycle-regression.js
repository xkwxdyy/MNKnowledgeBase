const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const core = fs.readFileSync(path.join(__dirname, '../scripts/comment-manager/core.js'), 'utf8');
const edit = fs.readFileSync(path.join(__dirname, '../scripts/comment-manager/actions-edit.js'), 'utf8');
const timers = [];
const focusLog = [];
const modals = [];
const document = { activeElement: null, querySelectorAll: () => modals.filter(m => m.classList.contains('show')) };
function node(name, parent = null) {
  const classes = new Set();
  const attrs = new Map();
  return {
    name, parent, dataset: {}, disabled: false, connected: true,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
    setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k),
    closest() { return attrs.get('aria-hidden') === 'true' ? this : parent?.closest() || null; },
    contains(target) { return target === this || (target?.parent ? this.contains(target.parent) : false); },
    focus() { document.activeElement = this; focusLog.push(name); },
    select() { this.focus(); focusLog.push(`${name}:select`); },
    querySelector() { return this.input; },
  };
}
document.documentElement = { contains: n => n.connected };
document.body = node('body');
const origin = node('origin');
const other = node('other');
const fallback = node('fallback'); fallback.dataset.compactPanel = 'selection';
function modal(name) { const m = node(name); m.input = node(`${name}-input`, m); modals.push(m); return m; }
const a = modal('A'); const b = modal('B');
const selection = node('selection'); selection.input = node('selection-close', selection);
const organize = node('organize'); organize.input = node('organize-close', organize);
const dom = { compactToolTabs: [fallback], selectionToolsPanel: selection, organizeToolsPanel: organize,
  editLinkModal: a, editDisplayText: a.input, editLinkUrl: node('url', a), editLinkPreview: {}, editLinkConfirmBtn: {} };
const state = { compactPanel: '' };
const context = vm.createContext({ document, dom, state, window: { innerWidth: 375 },
  setTimeout(fn) { timers.push(fn); return timers.length; },
  requireNoteId: () => 'NOTE', getCommentByIndex: () => ({ type: 'markdownComment', text: '[label](url)' }),
  decodeHtmlEntities: s => s, notifyCommentInteractionSettled() {},
});
vm.runInContext(core.slice(core.indexOf('    const managedModalFocusOrigins'), core.indexOf('    function setPrimaryActionButtonsDisabled')), context);
vm.runInContext(edit, context);
context.updateEditLinkModalState = () => {};
context.setEditReplacementMarkdownError = () => {};
function reset() { timers.length = 0; focusLog.length = 0; modals.forEach(m => { m.classList.remove('show'); m.setAttribute('aria-hidden', 'true'); }); document.activeElement = origin; state.compactPanel = ''; }
function flush() { while (timers.length) timers.shift()(); }
function test(name, run) { reset(); run(); console.log(`ok: ${name}`); }
const failures = [];
function check(name, run) { try { test(name, run); } catch (error) { failures.push(`${name}: ${error.message}`); } }
check('open then close never focuses hidden input', () => {
  context.showManagedModal(a); context.hideManagedModal(a); flush();
  assert(!focusLog.includes('A-input')); assert.strictEqual(document.activeElement, origin);
});
check('closing A then opening B cannot steal B focus', () => {
  context.showManagedModal(a); flush(); focusLog.length = 0;
  context.hideManagedModal(a); context.showManagedModal(b); flush();
  assert.deepStrictEqual(focusLog, ['B-input']);
});
check('a user focus change supersedes queued initial focus', () => {
  context.showManagedModal(a); other.focus(); flush(); assert.strictEqual(document.activeElement, other);
});
check('double open preserves original return target', () => {
  context.showManagedModal(a); flush(); context.showManagedModal(a); flush(); context.hideManagedModal(a); flush();
  assert.strictEqual(document.activeElement, origin);
});
check('duplicate close does not focus fallback', () => {
  context.showManagedModal(a); flush(); context.hideManagedModal(a); flush(); focusLog.length = 0;
  context.hideManagedModal(a); flush(); assert.deepStrictEqual(focusLog, []);
});
check('focus target becoming disabled or disconnected is ignored', () => {
  for (const prop of ['disabled', 'connected']) {
    a.input.disabled = false; a.input.connected = true;
    context.showManagedModal(a); a.input[prop] = prop === 'disabled'; flush();
    assert.strictEqual(document.activeElement, origin);
    context.hideManagedModal(a); flush();
  }
  a.input.disabled = false; a.input.connected = true;
});
check('closed compact drawer invalidates queued focus', () => {
  context.openCompactToolsPanel('selection'); context.closeCompactToolsPanel(); focusLog.length = 0; flush();
  assert.deepStrictEqual(focusLog, []); assert.strictEqual(document.activeElement, fallback);
});
check('switching compact drawers focuses only the current one', () => {
  context.openCompactToolsPanel('selection'); context.openCompactToolsPanel('organize'); flush();
  assert.deepStrictEqual(focusLog, ['organize-close']);
});
check('editor close cancels delayed selection', () => {
  context.showEditLinkModal(0, 0, 'text', 'url'); context.closeEditLinkModal(); flush();
  assert(!focusLog.some(n => n.startsWith('A-input')));
});
check('editor normal open selects once and normal close returns focus', () => {
  context.showEditLinkModal(0, 0, 'text', 'url'); flush();
  assert.strictEqual(focusLog.filter(n => n === 'A-input:select').length, 1);
  context.closeEditLinkModal(); flush(); assert.strictEqual(document.activeElement, origin);
});
assert.deepStrictEqual(failures, []);
console.log('comment manager focus lifecycle regression ok');
