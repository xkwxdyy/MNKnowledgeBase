'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.MNKB_TEST_ROOT || path.resolve(__dirname, '..');
const Core = require(path.join(root, 'KnowledgeBaseOrganization'));
function node(id, children = [], type = '归类') { return { id, title: id, path: id, type, children, fields: [], revision: id }; }
const model = { revision: 'v1', sourceId: 'B', targetId: 'A',
  sourceNodes: [node('B', ['B1', 'BX']), node('B1', ['B2']), node('B2', ['K']), node('K', [], '命题'), node('BX')],
  targetNodes: [node('A', ['A1']), node('A1', ['A2']), node('A2')] };
assert.deepEqual(Core.review(model).pending.map(row => row.source.id), ['B1', 'BX']);
assert.deepEqual(Core.review(model, { B1: 'A1', BX: 'move' }).pending.map(row => row.source.id), ['B2']);
const choices = { B1: 'A1', B2: 'A2', BX: 'move' };
const plan = Core.buildPlan(model, 'classification', choices);
assert.deepEqual(plan.merges.map(p => p.sourceId), ['B2', 'B1', 'B']);
assert.ok(plan.moves.some(p => p.sourceId === 'K' && p.targetId === 'A2'));
assert.ok(plan.moves.some(p => p.sourceId === 'BX' && p.targetId === 'A'));
assert.throws(() => Core.buildPlan(model, 'classification', {}), /尚未确认/);
assert.throws(() => Core.review(model, { B1: 'move', B2: 'A2' }), /失效/);
assert.throws(() => Core.review(model, { B1: 'B2' }), /超出/);
assert.throws(() => Core.buildPlan({ ...model, targetId: 'B1' }, 'move'), /子孙/);
assert.throws(() => Core.buildPlan({ ...model, targetId: 'B' }, 'merge'), /不同/);
assert.equal(Core.buildPlan(model, 'classification', { B1: 'A1', BX: 'A1', B2: 'A2' }).merges.length, 4, 'many sources may share a retained target');
assert.deepEqual(Core.parseRelations('{"ranked":[]}', [], 'equivalent'), []);
assert.equal(Core.parseRelations('{"ranked":[{"id":"A","relation":"container","reason":"上级主题"}]}', [node('A')], 'container').length, 1);
for (const rows of [[{ id: 'outside', relation: 'equivalent' }], [{ id: 'A', relation: 'delete' }], [{ id: 'A', relation: 'equivalent' }, { id: 'A', relation: 'equivalent' }]]) {
  assert.throws(() => Core.parseRelations({ ranked: rows }, [node('A')], 'equivalent'));
}
assert.throws(() => Core.parseRelations({ ranked: [{ id: 'K', relation: 'container' }] }, [node('K', [], '命题')], 'container'));
assert.match(Core.prompt(node('B'), [node('A')], 'equivalent'), /逆命题/);

function runtime() {
  const notes = new Map(), events = [], payloads = new Map(), replies = new Map(); let focused;
  const context = vm.createContext({ console, KnowledgeBaseOrganization: Core,
    KnowledgeBaseConfig: { config: {} }, HtmlMarkdownUtils: { isHtmlMDComment: () => false },
    KnowledgeBaseUtils: { log() {}, addErrorLog(e) { throw e; } },
    MNUtil: { getNoteById: id => notes.get(id), undoGrouping(fn) { events.push('undo'); fn(); }, showHUD(message) { throw Error(message); } },
    MNNote: { new: id => notes.get(id), getFocusNote: () => focused },
    MNKnowledgeBaseInstance: {
      async refreshSearchCardIndex(id, options) { assert.equal(options.allowCardMutation, false); events.push(['index', id]); return { success: true }; },
      async removeSearchCardIndex(id) { events.push(['unindex', id]); return { success: true }; },
    },
    KnowledgeBaseNetwork: { isMNAIModelAvailable: () => true, async callMNAIWithNotification(prompt) { events.push(['ai', prompt]); return '{"ranked":[]}'; } },
  });
  const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('\nclass KnowledgeBaseIndexer')) + '\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;', context);
  const T = context.KnowledgeBaseTemplate;
  class Note {
    constructor(id, type = '归类', comments = []) { this.noteId = id; this.type = type; this.title = this.noteTitle = id; this.colorIndex = type === '归类' ? 0 : 10; this.comments = comments; this.childNotes = []; this.noteURL = 'marginnote4app://note/' + id; notes.set(id, this); }
    get MNComments() { return this.comments; }
    addChild(child) { if (child.failMove) return; if (child.parentNote) child.removeFromParent(); child.parentNote = this; this.childNotes.push(child); }
    removeFromParent() { if (this.parentNote) this.parentNote.childNotes = this.parentNote.childNotes.filter(n => n !== this); this.parentNote = null; }
    refresh() { events.push(['localRefresh', this.noteId]); }
    appendTags() { throw new Error('Organization must not add workflow tags'); }
    removeTags() { throw new Error('Organization must not remove workflow tags'); }
    removeCommentsByIndexArr(indices) { [...indices].sort((a,b) => b-a).forEach(i => this.comments.splice(i,1)); }
    clone() { return new Note(this.noteId + '-copy-' + notes.size, this.type, structuredClone(this.comments)); }
    mergeInto(target) { target.pendingStart = target.comments.length; target.comments.push(...this.comments); this.comments = []; this.removeFromParent(); notes.delete(this.noteId); }
    delete() { assert.equal(this.childNotes.length, 0); assert.equal(this.comments.length, 0); this.removeFromParent(); notes.delete(this.noteId); }
  }
  Object.assign(T, {
    async prepareCardMigrationSelection() { events.push('selectionGuard'); },
    getSafeComments: n => n.comments, getSafeCommentType: c => c?.type, getSafeCommentText: c => c?.text || '',
    getNoteType: n => n.type, getFirstClassificationParentNote: n => n.parentNote,
    toNoExcerptVersion: n => n,
    cleanupClassificationContainLink() {}, changeTitle() {}, linkParentNote(n) { events.push(['linkParent', n.noteId]); },
    mergeTitleLinkWords(target, source) { target.aliases = [...(target.aliases || []), source.noteTitle]; },
    updateAllIncomingLinks(source, target, options = {}) { assert.equal(options.refresh, false); events.push(['incoming', source, target]); for (const n of notes.values()) n.comments.forEach(c => { if (c.text) c.text = c.text.replaceAll(source, target); }); },
    getStandaloneNoteLinkInfoFromComment(c) { return c?.type === 'linkComment' ? { noteId: c.text } : null; },
    extractComments(n, indices) { const copy = new Note('extracted-' + notes.size, n.type, indices.map(i => structuredClone(n.comments[i]))); n.addChild(copy); return copy; },
    autoMoveNewContentToField(target, field) {
      const content = target.comments.splice(target.pendingStart); delete target.pendingStart;
      if (field === '摘录') { target.comments.unshift(...content); return; }
      const begin = target.comments.findIndex(c => c.type === 'HtmlComment' && c.text === field);
      assert.ok(begin >= 0, 'destination field must exist');
      let end = target.comments.findIndex((c,i) => i > begin && c.type === 'HtmlComment');
      if (end < 0) end = target.comments.length;
      target.comments.splice(end, 0, ...content);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'KnowledgeBaseMergeTransaction.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'KnowledgeBaseOrganizationRuntime.js'), 'utf8'), context);
  const R = context.KnowledgeBaseOrganizationRuntime;
  const controller = { currentHTMLType: 'search', async runJavaScript(code) { return vm.runInNewContext(code, { window: { MNKBOrganizationUI: {
    takePayload(id) { return JSON.stringify(payloads.get(id)); }, complete(result) { replies.set(result.requestId, result); }
  } } }); } };
  let seq = 0;
  async function call(action, payload = {}) { const requestId = 'test-' + (++seq); payloads.set(requestId, { ...payload, requestId }); await R.handle(controller, action, { requestId }); return replies.get(requestId); }
  async function prepare(source, target, intent = 'classification', choices = {}) {
    focused = source; const ctx = await call('organizationcontext'); assert.equal(ctx.success, true);
    const base = { sourceId: source.noteId, sourceRevision: ctx.source.revision, targetId: target.noteId };
    const data = await call('organizationmodel', base); assert.equal(data.success, true, data.error);
    const before = JSON.stringify([...notes].map(([id,n]) => [id,n.comments,n.childNotes.map(c => c.noteId)]));
    const preview = await call('organizationpreview', { ...base, revision: data.model.revision, intent, choices });
    assert.equal(preview.success, true, preview.error);
    assert.equal(JSON.stringify([...notes].map(([id,n]) => [id,n.comments,n.childNotes.map(c => c.noteId)])), before, 'preview is read-only');
    return { ...base, previewToken: preview.previewToken, executionId: 'execute-' + seq };
  }
  return { T, R, notes, events, Note, call, prepare, context };
}
const field = text => ({ type: 'HtmlComment', text });
const text = text => ({ type: 'markdownComment', text });
(async () => {
  const r = runtime(), { Note } = r;
  const colorConflict = new Note('COLOR','命题'); colorConflict.colorIndex = 2;
  assert.equal(r.R.describe(colorConflict).type,'定义','organization follows source color before a stale title');
  const a = new Note('A', '归类', [field('相关思考'), text('target thought'), field('包含'), text('target structural annotation')]);
  const b = new Note('B', '归类', [text('excerpt'), field('相关思考'), text('source thought'), field('自定义 HTML'), { type: 'drawingComment', paint: 'proof-media' }, field('所属'), text('annotation'), field('包含'), text('source structural annotation')]);
  const ac = new Note('AC'), bc = new Note('BC'), leaf = new Note('LEAF', '命题'), independent = new Note('KEEP');
  a.addChild(ac); b.addChild(bc); bc.addChild(leaf); b.addChild(independent);
  const p = await r.prepare(b, a, 'classification', { BC: 'AC', KEEP: 'move' });
  const outcome = await r.call('organizationexecute', p);
  assert.equal(outcome.success, true, outcome.error);
  assert.equal(r.events.filter(e => e === 'undo').length, 1);
  assert.equal(r.events.some(e => e[0] === 'localRefresh'), false, 'semantic execution must not create undo entries by refreshing comments');
  assert.deepEqual(r.events.filter(e => e[0] === 'unindex').map(e => e[1]).sort(), ['B','BC']);
  assert.equal(r.events.some(e => e[0] === 'index' && ['B','BC'].includes(e[1])), false, 'retired backing sources are removed from search, never converted again');
  assert.equal(leaf.parentNote, ac); assert.equal(independent.parentNote, a);
  assert.ok(!r.notes.has('B') && !r.notes.has('BC'));
  for (const value of ['excerpt', 'source thought', 'target thought', '自定义 HTML']) assert.ok(a.comments.some(c => c.text === value));
  assert.ok(a.comments.some(c => c.paint === 'proof-media'));
  assert.ok(a.childNotes.some(n => n.comments.some(c => c.text === 'annotation')));
  const thoughtField = r.T.findFieldObjectByNormalizedName(a, '相关思考');
  const thoughtTexts = thoughtField.excludingFieldBlockIndexArr.map(i => a.comments[i].text);
  assert.ok(thoughtTexts.includes('source thought') && thoughtTexts.includes('target thought'), 'thoughts must remain within their field, not merely somewhere on the target');
  const structuralArchives = a.childNotes.filter(n => n.title === '历史内容：包含');
  assert.equal(structuralArchives.length, 1);
  assert.ok(structuralArchives[0].comments.some(c => c.text === 'source structural annotation'), 'text appended after the contains header is structural-field content and is preserved in a named archive');
  assert.ok(a.comments.some(c => c.text === 'target structural annotation'), 'target structural annotations remain unchanged');
  assert.equal(a.noteTitle, 'A');
  await r.call('organizationexecute', p); assert.equal(r.events.filter(e => e === 'undo').length, 1, 'duplicate delivery does not execute again');

  const stale = runtime(); const sa = new stale.Note('SA'), sb = new stale.Note('SB');
  const sp = await stale.prepare(sb, sa); sb.comments.push(text('edited during review'));
  const denied = await stale.call('organizationexecute', sp); assert.equal(denied.success, false); assert.equal(stale.events.includes('undo'), false);

  const fail = runtime(); const fa = new fail.Note('FA'), fb = new fail.Note('FB'), child = new fail.Note('FAIL', '命题'); fb.addChild(child); child.failMove = true;
  const fp = await fail.prepare(fb, fa); const failure = await fail.call('organizationexecute', fp);
  assert.equal(failure.requiresUndo, true); assert.ok(fail.notes.has('FB')); assert.ok(fail.notes.has('FAIL'));
  await fail.call('organizationexecute', fp); assert.equal(fail.events.filter(e => e === 'undo').length, 1);

  for (const mode of ['swallow', 'defer']) {
    const guarded = runtime();
    const ga = new guarded.Note('GA'), gb = new guarded.Note('GB'), gc = new guarded.Note('GC','命题');
    gb.addChild(gc); gc.failMove = true;
    let deferred;
    guarded.context.MNUtil.undoGrouping = fn => {
      guarded.events.push('undo');
      if (mode === 'defer') { deferred = fn; return; }
      try { fn(); } catch (_) { /* Native JSC callback exceptions can be swallowed. */ }
    };
    const gp = await guarded.prepare(gb,ga);
    const gr = await guarded.call('organizationexecute',gp);
    assert.equal(gr.success,false,mode + ' must not return success');
    assert.equal(gr.requiresUndo,mode === 'swallow');
    if (deferred) { gc.failMove = false; deferred(); }
    assert.equal(gc.parentNote,gb,'late callback must not mutate after a failed receipt');
    assert.ok(guarded.notes.has('GB'));
    await guarded.call('organizationexecute',gp);
    assert.equal(guarded.events.filter(e=>e==='undo').length,1,'failed delivery must not execute again');
  }

  for (const mode of ['selection-failed', 'target-changed']) {
    const guarded = runtime(), a = new guarded.Note('A'), b = new guarded.Note('B');
    const p = await guarded.prepare(b, a);
    guarded.T.prepareCardMigrationSelection = async () => {
      if (mode === 'selection-failed') throw Error('selection unavailable');
      a.comments.push(text('changed during selection'));
    };
    const result = await guarded.call('organizationexecute', p);
    assert.equal(result.success, false); assert.equal(result.requiresUndo, false);
    assert.equal(guarded.events.includes('undo'), false);
    assert(guarded.notes.has('B'));
  }

  const old = runtime(); const card = new old.Note('OLD', '命题', [text('excerpt'), field('证明'), { type:'drawingComment', paint:'proof' }, field('应用'), text('application'), field('所需知识'), text('needed'), field('相关思考'), { type:'HtmlComment', text:'<span>remark is content</span>' }, field('remark'), text('archive')]);
  const processed = old.T.processOldTemplateCard(card);
  for (const value of ['excerpt', 'application', 'needed', '<span>remark is content</span>']) assert.ok(processed.comments.some(c => c.text === value));
  assert.ok(processed.comments.some(c => c.paint === 'proof'));
  assert.ok(processed.childNotes.some(n => n.comments.some(c => c.text === 'archive')));
  const length = processed.childNotes.length; old.T.processOldTemplateCard(processed); assert.equal(processed.childNotes.length, length);
  assert.equal(old.T.isOldTemplateCard(new old.Note('HTML', '命题', [field('<span>remark is content</span>')])), false);

  const ai = runtime(), ba = new ai.Note('BA', '命题'), aa = new ai.Note('AA', '命题');
  const ap = await ai.prepare(ba, aa, 'merge');
  const ar = await ai.call('organizationsearch', { ...ap, stage:'equivalent', candidateIds:['AA'], modelSource:'fixture', model:'fixture' });
  assert.equal(ar.success, true); assert.equal(ai.events.filter(e => e[0] === 'ai').length, 1, 'one candidate still needs semantic verification');
  const replacement = runtime();
  const original = new replacement.Note('PRIMARY', '命题'); original.excerptText = 'native primary excerpt';
  const destination = new replacement.Note('DEST', '命题', [field('证明'), text('existing proof')]);
  replacement.T.toNoExcerptVersion = function(n) {
    if (!n.excerptText) return n;
    const converted = new replacement.Note('CONVERTED', n.type, [{type:'mergedImageComment', text:n.excerptText, document:'doc', page:3}]);
    replacement.notes.delete(n.noteId); return converted;
  };
  const rp = await replacement.prepare(original, destination, 'merge');
  const rr = await replacement.call('organizationexecute', rp);
  assert.equal(rr.success, true, rr.error);
  assert.ok(destination.comments.some(c => c.text === 'native primary excerpt' && c.document === 'doc' && c.page === 3));
  assert.ok(rr.deletedIds.includes('PRIMARY') && rr.deletedIds.includes('CONVERTED'));

  const direct = runtime();
  const before = new direct.Note('BEFORE', '命题'), after = new direct.Note('AFTER', '命题');
  const identityCalls = [];
  direct.T.requireMakeCardTemplate = () => {};
  direct.T.processOldTemplateCard = n => { identityCalls.push(['migrate', n.noteId]); return after; };
  direct.T.ensureLegacyCardTemplate = n => identityCalls.push(['template', n.noteId]);
  direct.T.templateMergedCardMake = (n,t) => identityCalls.push(['finish', n.noteId, t]);
  direct.T.syncFinalMakeCardIndex = (n,o) => { identityCalls.push(['index', n.noteId, o.staleIds[0]]); return {success:true}; };
  assert.equal(direct.T.makeLegacyCard(before, {noteType:'命题'}), after);
  assert.deepEqual(identityCalls, [['migrate','BEFORE'],['template','AFTER'],['finish','AFTER','命题'],['index','AFTER','BEFORE']]);
  direct.T.requireMakeCardTemplate = () => { throw Error('missing template'); };
  assert.throws(() => direct.T.makeLegacyCard(before, {noteType:'命题'}), /missing template/);
  assert.equal(identityCalls.length,4);

  const mapped = runtime();
  const mappedSource = new mapped.Note('RAW', '命题', [text('raw only'), field('remark'), text('archive'), field('应用'), text('keep')]);
  mapped.T.getSafeComments = (n, manager) => manager && n === mappedSource ? n.comments.slice(1) : n.comments;
  const originalMapping = mapped.T.getRawCommentIndicesForManagerIndices;
  mapped.T.getRawCommentIndicesForManagerIndices = function(n, indices) { return n === mappedSource ? indices.map(i => i + 1) : originalMapping.call(this,n,indices); };
  mapped.T.processOldTemplateCard(mappedSource);
  assert.deepEqual(mappedSource.comments.map(c => c.text), ['raw only','应用','keep']);
  assert.deepEqual(mappedSource.childNotes[0].comments.map(c => c.text), ['remark','archive']);

  const silent = runtime();
  const silentA = new silent.Note('SILENT-A','命题'), silentB = new silent.Note('SILENT-B','命题',[text('must preserve')]);
  const realMerge = silent.Note.prototype.mergeInto;
  silent.Note.prototype.mergeInto = function(target) { if (this.noteId.startsWith('extracted-')) return; return realMerge.call(this,target); };
  const silentPlan = await silent.prepare(silentB,silentA,'merge');
  const silentResult = await silent.call('organizationexecute',silentPlan);
  assert.equal(silentResult.requiresUndo,true);
  assert.equal(silentB.comments[0].text,'must preserve','silent native copy failure must not remove original content');

  const cancelled = runtime();
  const cancelSource = new cancelled.Note('CANCEL-B','命题'), cancelTarget = new cancelled.Note('CANCEL-A','命题');
  const cancelPlan = await cancelled.prepare(cancelSource,cancelTarget,'merge');
  let finish;
  cancelled.context.KnowledgeBaseNetwork.callMNAIWithNotification = () => new Promise(resolve => { finish = resolve; });
  const inFlight = cancelled.call('organizationsearch',{ ...cancelPlan,stage:'equivalent',candidateIds:['CANCEL-A'],modelSource:'fixture',model:'fixture' });
  await Promise.resolve(); await Promise.resolve();
  await cancelled.call('organizationcancel');
  finish('{"ranked":[]}');
  assert.equal((await inFlight).success,false,'cancelled model reply cannot be accepted');
  for (const pinFailure of ['', 'apply', 'verify', 'native-after-request']) {
    const pinned = runtime();
    const pa = new pinned.Note('PIN-A','命题'), pb = new pinned.Note('PIN-B','命题',[text('pinned body')]);
    let pinId = 'PIN-B'; const receipts = [], operations = [];
    pinned.context.mnpinnerPublicApi = { prepareCardPinsNoteIdMigration(from,to) { return {
      apply() { operations.push('apply'); if (pinFailure === 'apply') throw Error('persist failed'); pinId = to; return {success:true}; },
      verify() { if (pinFailure === 'verify') return {success:false}; return {success:pinId === to}; },
      rollback() { operations.push('rollback'); pinId = from; return {success:true}; },
      commit() { operations.push('commit'); return {success:true}; },
    }; } };
    pinned.context.KnowledgeBaseMergeTransaction = { resolvePinMigrationAPI: pinned.context.KnowledgeBaseMergeTransaction.resolvePinMigrationAPI, registerExternalUndoReceipt(r) { receipts.push(r); }, forgetUndoReceipt(r) { const i=receipts.indexOf(r); if(i>=0)receipts.splice(i,1); } };
    assert.equal(typeof pinned.context.pinnerUtils,'undefined');
    assert.equal(typeof pinned.context.pinnerConfig,'undefined');
    if (pinFailure === 'native-after-request') pb.mergeInto = () => { throw new Error('native retirement buffered'); };
    const pp = await pinned.prepare(pb,pa,'merge');
    const pr = await pinned.call('organizationexecute',pp);
    if (pinFailure === 'native-after-request') {
      assert.equal(pr.success,false); assert.equal(pr.requiresUndo,true); assert.equal(pinId,'PIN-A');
      assert.equal(operations.includes('rollback'),false,'buffered native retirement must not reverse Pins to the visible source');
      assert.equal(receipts[0].nativeRetirementRequested,true);
    }
    else if (pinFailure) { assert.equal(pr.requiresUndo,true); assert.equal(pinId,'PIN-B'); assert.ok(pinned.notes.has('PIN-B')); }
    else { assert.equal(pr.success,true,pr.error); assert.equal(pinId,'PIN-A'); assert.equal(receipts.length,1); assert.equal(receipts[0].isSourceActive({noteid:'PIN-B',groupNoteId:'PIN-A'}),false); assert.equal(receipts[0].isSourceActive({noteid:'PIN-B'}),true); }
  }
  const unsupportedPin = runtime();
  const upa = new unsupportedPin.Note('UPA','命题'), upb = new unsupportedPin.Note('UPB','命题');
  unsupportedPin.context.mnpinnerPublicApi = {};
  const upp = await unsupportedPin.prepare(upb,upa,'merge');
  assert.equal((await unsupportedPin.call('organizationexecute',upp)).success,false);
  assert.equal(unsupportedPin.events.includes('undo'),false,'unsupported Pin API must fail before mutation');

  const intermediate = runtime();
  const ia = new intermediate.Note('IA','命题',[field('证明'),text('target proof'),field('应用')]);
  const ib = new intermediate.Note('IB','命题',[text('excerpt'),{type:'linkComment',text:'usage'},text('inline citation remains')]);
  const required = new intermediate.Note('REQUIRED','归类');
  required.title = required.noteTitle = '“所需命题”相关命题';
  required.addChild(ib);
  assert.equal(intermediate.T.isRequiredPropositionsClassification(required),true);
  assert.equal(intermediate.T.isIntermediateKnowledge(ib),true);
  assert.equal(intermediate.T.isIntermediateKnowledge(ia),false,'a card outside required-proposition ancestry is not intermediate');
  const branch = new intermediate.Note('DEPENDENCY-BRANCH','命题');
  const nested = new intermediate.Note('NESTED-DEPENDENCY','命题');
  const completed = new intermediate.Note('COMPLETE-DEPENDENCY','命题',[field('证明'),field('应用')]);
  required.addChild(branch); branch.addChild(nested); required.addChild(completed);
  assert.equal(intermediate.T.isIntermediateKnowledge(nested),true,'required ancestry is recognized through an intermediate branch');
  assert.equal(intermediate.T.isIntermediateKnowledge(completed),false,'template-completed dependency is not intermediate');
  const ip = await intermediate.prepare(ib,ia,'merge');
  const ir = await intermediate.call('organizationexecute',ip);
  assert.equal(ir.success,true,ir.error);
  const appIndex = ia.comments.findIndex(c => c.text === '应用');
  assert.ok(ia.comments.findIndex(c => c.text === 'usage') > appIndex);
  assert.ok(ia.comments.findIndex(c => c.text === 'inline citation remains') < appIndex);
  assert.equal(ia.aliases,undefined,'temporary intermediate title is not collected as an alias');
  assert.equal(required.tags,undefined); assert.equal(ib.tags,undefined); assert.equal(ia.tags,undefined);

  console.log('organization: semantic validation, recursive review, native plan execution, preservation, stale revisions, single undo, replay and AI boundaries passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
