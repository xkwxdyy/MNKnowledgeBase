const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const start = source.indexOf('      case "executeDefinitionMerge":');
const end = source.indexOf('      case "closeDefinitionMergeWorkbench":', start);
assert(start >= 0 && end > start);
const route = source.slice(start, end);

function runtime() {
  const calls = { apply: 0, responses: [], loads: [], hud: [] };
  const instance = {
    currentDefinitionMergeContext: { sourceNoteId: 'SOURCE', targetNoteId: 'TARGET' },
    currentManagedNote: { noteId: 'TARGET' },
    prepareDefinitionMergeWorkbenchData(sourceId) {
      return { canExecute: sourceId !== 'TARGET', errors: ['cannot reverse parent merge'] };
    },
    async applyDefinitionMergePlan() { calls.apply++; return { success: true }; },
  };
  const sandbox = {
    MNNote: { new: noteId => ({ noteId }) },
    MNUtil: { showHUD: message => calls.hud.push(message) },
    KnowledgeBaseUtils: { addErrorLog() {} },
    parseMaybeJSONParam: value => typeof value === 'string' ? JSON.parse(value) : value,
    normalizeNoteIdValue: value => String(value || ''),
    MNKnowledgeBaseInstance: instance,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`this.dispatch = async function(action, params) {
    const actionLower = action.toLowerCase();
    const config = { params }; let success = false;
    switch (action) { ${route} }
    return success;
  };`, sandbox);
  const controller = {
    async notifyDefinitionMergeActionComplete(response) { calls.responses.push(response); },
    async loadDefinitionMergeWorkbenchData(a, b) { calls.loads.push([a, b]); return { success: true }; },
  };
  return { calls, instance, controller, dispatch: (action, params) => sandbox.dispatch.call(controller, action, params) };
}

(async () => {
  const r = runtime();
  let release;
  r.instance.applyDefinitionMergePlan = async () => {
    r.calls.apply++;
    await new Promise(resolve => { release = resolve; });
    return { success: true, targetDefinitionId: 'TARGET' };
  };
  const params = { requestId: 'same-request', plan: '{}' };
  const first = r.dispatch('executeDefinitionMerge', params);
  const repeated = r.dispatch('executedefinitionmerge', params);
  assert.equal(r.calls.apply, 1, 'concurrent duplicate request must share the in-flight transaction');
  release();
  assert.deepEqual(await Promise.all([first, repeated]), [true, true]);
  assert.equal(r.calls.responses.length, 2);
  assert.equal(r.calls.responses[0], r.calls.responses[1], 'duplicates must acknowledge the same result');
  await r.dispatch('executeDefinitionMerge', params);
  assert.equal(r.calls.apply, 1, 'completed request must not execute again');
  await r.dispatch('executeDefinitionMerge', { plan: '{}' });
  assert.equal(r.calls.apply, 1, 'missing request identity must not mutate');
  assert.equal(r.calls.responses.at(-1).success, false);

  const reverse = runtime();
  const before = JSON.stringify(reverse.instance.currentDefinitionMergeContext);
  assert.equal(await reverse.dispatch('swapDefinitionMergeWorkbench', { sourceNoteId: 'TARGET', targetNoteId: 'SOURCE' }), false);
  assert.equal(reverse.calls.loads.length, 0, 'rejected swap must preserve the current valid page');
  assert.equal(JSON.stringify(reverse.instance.currentDefinitionMergeContext), before);
  assert.equal(reverse.instance.currentManagedNote.noteId, 'TARGET');

  reverse.controller.loadDefinitionMergeWorkbenchData = async () => ({ success: false });
  await reverse.dispatch('refreshDefinitionMergeWorkbench', { sourceNoteId: 'NEXT', targetNoteId: 'OTHER' });
  assert.equal(JSON.stringify(reverse.instance.currentDefinitionMergeContext), before, 'rejected browser payload must not change native context');
  reverse.controller.loadDefinitionMergeWorkbenchData = async () => ({ success: true });
  assert.equal(await reverse.dispatch('refreshDefinitionMergeWorkbench', { sourceNoteId: 'NEXT', targetNoteId: 'OTHER' }), true);
  assert.equal(reverse.instance.currentDefinitionMergeContext.targetNoteId, 'OTHER');
  assert.equal(reverse.instance.currentManagedNote.noteId, 'OTHER');
  console.log('definition merge bridge regression: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
