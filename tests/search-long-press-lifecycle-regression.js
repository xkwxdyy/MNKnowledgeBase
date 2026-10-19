const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/search/app-ui-interactions.js'), 'utf8');
function harness() {
  const timers = new Map(); let timerId = 0;
  const requests = []; const listeners = {};
  const emitter = scope => ({ addEventListener(type, fn) { (listeners[`${scope}:${type}`] ||= []).push(fn); } });
  const document = { ...emitter('document'), hidden: false };
  const context = vm.createContext({ document, window: emitter('window'), dom: { results: emitter('results') },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    postBridge(action, params) { requests.push({ action, params }); return true; },
    withSearchUsageParams: (params, id, tier) => ({ ...params, usageTier: tier }),
    SEARCH_USAGE_TIER_POINTS: { locate: 2, auxiliary: 1 }, showToast() {}, showMinorSuccessToast() {},
  });
  vm.runInContext(source, context); context.setupDelegation();
  function icon(action) {
    const classes = new Set(); const card = { dataset: { id: 'stable-card-id' } };
    const target = { dataset: { action }, disabled: false, isConnected: true,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
      setAttribute() {}, removeAttribute() {},
      closest(selector) { if (selector === '.card') return card; return selector.includes(action) || selector === '.card-action-icon' ? target : null; },
    };
    return target;
  }
  function emit(scope, type, overrides = {}) {
    const event = { type, button: 0, clientX: 10, clientY: 10, ...overrides };
    (listeners[`${scope}:${type}`] || []).forEach(fn => fn(event));
  }
  function flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }
  return { context, document, requests, icon, emit, flush };
}
const failures = [];
function check(name, fn) { try { fn(); console.log(`ok: ${name}`); } catch(e) { failures.push(`${name}: ${e.message}`); } }
for (const action of ['focus-mindmap', 'pin-card']) {
  const expected = action === 'pin-card' ? 'pinCard' : 'focusCardInFloatMindMap';
  check(`${action}: normal hold dispatches once and suppresses follow-up click`, () => {
    const h = harness(); const target = h.icon(action);
    h.emit('results', 'mousedown', { target }); h.flush(); h.emit('results', 'mouseup', { target });
    assert.strictEqual(h.requests.length, 1); assert.strictEqual(h.requests[0].action, expected);
    assert.strictEqual(h.requests[0].params.id, 'stable-card-id');
    assert.strictEqual(h.context.shouldSuppressLongPressClick(target), true);
    assert.strictEqual(h.context.shouldSuppressLongPressClick(target), false);
  });
  for (const cancel of ['mousemove', 'mouseup', 'mouseleave', 'blur', 'pagehide', 'hidden', 'touchmove', 'touchcancel']) {
    check(`${action}: ${cancel} cancels pending request and visual state`, () => {
      const h = harness(); const target = h.icon(action);
      const touch = cancel.startsWith('touch') ? { touches: [{ clientX: 10, clientY: 10 }] } : {};
      h.emit('results', cancel.startsWith('touch') ? 'touchstart' : 'mousedown', { target, ...touch });
      if (cancel === 'hidden') { h.document.hidden = true; h.emit('document', 'visibilitychange'); }
      else h.emit(['blur','pagehide'].includes(cancel) ? 'window' : 'results', cancel,
        { target, clientX: 60, clientY: 10, ...(cancel.startsWith('touch') ? { touches: [{ clientX: 60, clientY: 10 }] } : {}) });
      h.flush(); assert.strictEqual(h.requests.length, 0);
      assert.strictEqual(target.classList.contains('long-press-pending'), false);
    });
  }
  for (const invalid of ['disabled', 'detached']) {
    check(`${action}: becoming ${invalid} before timeout blocks dispatch`, () => {
      const h = harness(); const target = h.icon(action);
      h.emit('results', 'mousedown', { target });
      if (invalid === 'disabled') target.disabled = true; else target.isConnected = false;
      h.flush(); assert.strictEqual(h.requests.length, 0);
      assert.strictEqual(target.classList.contains('long-press-pending'), false);
    });
  }
  check(`${action}: small movement preserves hold`, () => {
    const h = harness(); const target = h.icon(action);
    h.emit('results','mousedown',{target}); h.emit('results','mousemove',{target,clientX:15}); h.flush();
    assert.strictEqual(h.requests.length,1);
  });
  check(`${action}: visible visibilitychange preserves hold`, () => {
    const h = harness(); const target = h.icon(action);
    h.emit('results','mousedown',{target}); h.emit('document','visibilitychange'); h.flush();
    assert.strictEqual(h.requests.length,1);
  });
  check(`${action}: disabled button never arms`, () => {
    const h = harness(); const target = h.icon(action); target.disabled = true;
    h.emit('results','mousedown',{target}); assert.strictEqual(target.classList.contains('long-press-pending'),false);
    h.flush(); assert.strictEqual(h.requests.length,0);
  });
}
check('window blur disarms double-click confirmation', () => {
  const h = harness(); const target = h.icon('bi-link');
  h.context.armCardActionIcon(target); h.emit('window','blur');
  assert.strictEqual(target.classList.contains('confirm-pending'),false);
});
assert.deepStrictEqual(failures, []);
console.log('search long press lifecycle regression ok');
