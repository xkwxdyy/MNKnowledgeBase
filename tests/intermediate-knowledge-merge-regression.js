#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
const mergeSource = fs.readFileSync(path.join(root, 'KnowledgeBaseMergeTransaction.js'), 'utf8');
const cp = value => JSON.parse(JSON.stringify(value));
const txt = (text, options = {}) => ({ type: 'TextNote', text, ...options });
const md = text => txt(text, { markdown: true });
const field = text => ({ type: 'HtmlComment', text });
const link = noteid => ({ type: 'LinkNote', noteid });
const url = id => `marginnote4app://note/${id}`;

function harness(options = {}) {
  const registry = new Map();
  const deferredCommits = [];
  const calls = { indexes: [], pins: [], refreshed: [], clones: [], warnings: [], deletions: [], merges: [], replacements: [], parentLinks: [] };
  let insideNativeGroup = false;
  const pins = [{ identity: 'pin-a', noteId: 'A', title: 'custom' }, { identity: 'pin-b', noteId: 'B', title: 'original B' }];
  class Note {
    constructor(noteId, comments = [], config = {}) {
      this.noteId = noteId; this.comments = cp(comments); this.type = config.type || '命题';
      this.noteTitle = config.title || `【命题】${noteId}`; this.tags = config.tags || []; this.childNotes = [];
      this.excerptText = config.excerptText || ''; this.excerptPic = config.excerptPic || null;
      this.note = this; registry.set(noteId, this);
      Object.defineProperty(this, 'hidden', { get() { return false; } });
    }
    static new(value) {
      if (value instanceof Note) return value;
      return registry.get(String(value || '').replace(/^marginnote[34]app:\/\/note\//, ''));
    }
    get title() { return this.noteTitle; }
    set title(value) { this.noteTitle = value; }
    get noteURL() { return url(this.noteId); }
    get MNComments() {
      return this.comments.map((comment, index) => ({
        index,
        detail: comment,
        type: comment.type === 'TextNote' ? (options.rawURLAsLinkComment && /^marginnote[34]app:\/\/note\/[^\s]+$/.test(comment.text) ? 'linkComment' : options.managerTreatsProvenanceAsMerged && comment.noteid ? 'mergedMarkdownComment' : (comment.markdown ? 'markdownComment' : 'textComment'))
          : comment.type === 'LinkNote' ? (comment.q_htext || comment.q_hpic ? (comment.markdown ? 'mergedMarkdownComment' : 'mergedTextComment') : 'linkComment')
          : comment.type,
        get text() { return options.managerTreatsProvenanceAsMerged && comment.type === 'TextNote' && comment.noteid ? undefined : comment.type === 'LinkNote' ? comment.q_htext || (comment.q_hpic ? '' : url(comment.noteid)) : comment.text || ''; },
        get note() { return registry.get(comment.noteid); },
        set text(value) {
          if (!comment.q_htext) throw new Error('fixture setter only models merged excerpt text');
          const backing = registry.get(comment.noteid);
          if (!backing) throw new Error('missing backing');
          backing.excerptText = value;
          for (const note of registry.values()) for (const item of note.comments) if (item.noteid === backing.noteId && item.q_htext) item.q_htext = value;
        },
      }));
    }
    addChild(child) {
      if (child.parentNote) child.parentNote.childNotes.splice(child.parentNote.childNotes.indexOf(child), 1);
      this.childNotes.push(child); child.parentNote = this;
      if (options.failChildMove && this.noteId === 'B') { options.failChildMove = false; throw new Error('child move failed'); }
      return child;
    }
    removeFromParent() { if (this.parentNote) this.parentNote.childNotes.splice(this.parentNote.childNotes.indexOf(this), 1); this.parentNote = null; }
    clone(withDescendants) {
      calls.clones.push(this.noteId); throw new Error('native clone is forbidden in this merge path');
    }
    removeTags(tags) { this.tags = this.tags.filter(tag => !tags.includes(tag)); }
    appendTags(tags) { this.tags = [...new Set(this.tags.concat(tags))]; }
    merge(other) {
      calls.merges.push({ target: this.noteId, source: other.noteId, insideNativeGroup });
      other.nativeMergeAttempted = true;
      if (options.failMergeBefore) throw new Error('merge failed before append');
      if (!options.omitNativeExcerpt && (other.excerptText || other.excerptPic)) this.comments.push({ type: 'LinkNote', noteid: other.noteId, q_htext: other.excerptText, q_hpic: other.excerptPic });
      this.comments.push(...other.comments.map(comment => ({ ...cp(comment), ...(comment.type !== 'LinkNote' ? { noteid: other.noteId } : {}) })));
      const retire = () => {
        if (options.realGroupOnly) other.realGroupNoteIdForTopicId = () => this.noteId;
        else other.groupNoteId = this.noteId;
      };
      if (options.deferRetirement) deferredCommits.push(retire); else retire();
      if (options.nativeMergeChangesTitle) this.noteTitle += `;${other.noteTitle}`;
      if (options.mutateTargetOriginal) this.comments[0].text = 'unexpected native mutation';
      if (options.nativeMergeDropsTags) this.tags = [];
      if (options.nativeMergeAddsTags) this.tags.push('new native tag');
      if (options.nativeMergeRemovesSource) registry.delete('A');
      if (options.nativeRemovesSourceLinks) {
        other.removeFromParent(); registry.delete(other.noteId);
        for (const note of registry.values()) note.comments = note.comments.filter(comment =>
          !(comment.type === 'LinkNote' && comment.noteid === other.noteId && !comment.q_htext && !comment.q_hpic) &&
          !(options.rawURLAsLinkComment && comment.type === 'TextNote' && comment.text === url(other.noteId)));
      }
      if (options.autoRewriteIncoming) {
        for (const note of registry.values()) if (note !== this && note !== other) for (const comment of note.comments) {
          if (comment.type === 'TextNote' && comment.text) comment.text = comment.text.split(url(other.noteId)).join(url(this.noteId));
          else if (comment.type === 'LinkNote' && comment.noteid === other.noteId && !comment.q_htext && !comment.q_hpic) comment.noteid = this.noteId;
        }
      }
      if (options.nativeMergeBlocksSourceRead) options.failNextSourceRead = true;
      if (options.failMergeAfter) throw new Error('merge failed after append');
      if (options.badNativePayload) this.comments[this.comments.length - 1].text = 'corrupted copy';
      return this;
    }
    sortCommentsByNewIndices(destinations) {
      if (options.silentSortFailure) return;
      const sorted = [];
      destinations.forEach((destination, index) => { sorted[destination] = this.comments[index]; });
      this.comments = sorted;
      if (options.failSortAfter) throw new Error('sort failed after moving');
    }
    removeCommentByIndex(index) { this.comments.splice(index, 1); if (options.failRemoveSuffixAfter) throw new Error('suffix removal failed'); }
    replaceWithMarkdownComment(text, index) {
      calls.replacements.push({ noteId: this.noteId, index });
      if (options.failIncomingRemoved && this.noteId === 'C') { options.failIncomingRemoved = false; this.comments.splice(index, 1); throw new Error('incoming failed after removal'); }
      this.comments[index] = md(text);
      if (options.failIncomingOnce && this.noteId === 'C') { options.failIncomingOnce = false; throw new Error('incoming failed after replace'); }
    }
    replaceWithTextComment(text, index) { this.comments[index] = txt(text); }
    appendNoteLink(note) { this.comments.push(link(note.noteId)); }
    appendMarkdownComment(value) { this.comments.push(md(value)); }
    appendTextComment(value) { this.comments.push(txt(value)); }
    moveComment(from, to) { this.comments.splice(to, 0, this.comments.splice(from, 1)[0]); }
    _delete() {
      calls.deletions.push(this.noteId);
      throw new Error('physical deletion is forbidden in this merge path');
    }
    refresh() { calls.refreshed.push(this.noteId); }
    focusInMindMap() {}
  }
  const sandbox = {
    console, MNNote: Note, Map, Set, WeakMap,
    MNUtil: { currentNotebookId: 'TOPIC', getNoteById: value => { if (value === 'A' && options.failNextSourceRead) throw new Error('native read unavailable'); return registry.get(value); }, showHUD() {}, log() {} },
    KnowledgeBaseUtils: { log() {}, addErrorLog(error) { throw error; } },
    HtmlMarkdownUtils: { isHtmlMDComment() { return false; } },
  };
  if (options.pinner !== false) {
    sandbox.pinnerUtils = options.oldPinner ? {} : {
      prepareCardPinsNoteIdMigration(oldId, newId) {
        const selected = pins.filter(pin => pin.noteId === oldId);
        return {
          apply() { calls.pins.push('apply'); selected.forEach(pin => { pin.noteId = newId; }); if (options.failPin) throw new Error('pin persist failed'); return { success: true }; },
          verify() { calls.pins.push('verify'); assert.ok(selected.every(pin => pin.noteId === newId)); return { success: true }; },
          rollback() { calls.pins.push('rollback'); selected.forEach(pin => { pin.noteId = oldId; }); return { success: true }; },
          commit() { calls.pins.push('commit'); if (options.failPinCommit) throw new Error('pin UI failed'); return { success: true }; },
        };
      },
    };
  }
  sandbox.global = sandbox; sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`${source.slice(0, source.indexOf('\nclass KnowledgeBaseIndexer'))}\nthis.Template = KnowledgeBaseTemplate;`, context);
  vm.runInContext(`${mergeSource}\nthis.merge = KnowledgeBaseMergeTransaction;`, context);
  const Template = context.Template;
  Template.getNoteType = note => note.type;
  Template.mergeTitleLinkWords = (target, from) => { target.noteTitle += `;${from.noteTitle}`; };
  Template.syncFinalMakeCardIndex = (note, config) => {
    calls.indexes.push({ noteId: note.noteId, config: { ...config } });
    if (options.failIndexOnce) { options.failIndexOnce = false; return { success: false, error: 'index write failed' }; }
    return { success: true, entry: { id: note.noteId }, indexSource: 'main' };
  };
  Template.publishFinalMakeCardIndexPatch = () => {};
  Template.linkParentNote = note => {
    calls.parentLinks.push(note.noteId);
    const parentField = Template.findFieldObjectByNormalizedName(note, '所属');
    if (!parentField || !note.parentNote) throw new Error('parent-link fixture lacks field or native parent');
    const indices = Array.from(parentField.excludingFieldBlockIndexArr).sort((a, b) => b - a);
    for (const index of indices) if (note.comments[index].type === 'LinkNote') note.removeCommentByIndex(index);
    note.appendNoteLink(note.parentNote); note.moveComment(note.comments.length - 1, parentField.index + 1);
  };
  const run = (target, from, config = {}) => context.merge.run(Template, target, from, config, () => ({ legacy: true }));
  const merge = (target, from, config = {}) => context.merge.finalizeSourceRemoval(run(target, from, config));
  const flushNativeCommits = () => { while (deferredCommits.length) deferredCommits.shift()(); };
  const withNativeGroup = fn => {
    insideNativeGroup = true;
    try { return fn(); }
    finally { insideNativeGroup = false; flushNativeCommits(); }
  };
  return { Note, Template, merge, run, flushNativeCommits, withNativeGroup, api: context.merge, registry, calls, pins };
}
function base(h, config = {}) {
  const a = new h.Note('A', [txt('new excerpt'), link('C')], config);
  const required = new h.Note('REQUIRED', [], { type: '归类', title: '“所需命题”相关命题' });
  required.addChild(a);
  assert.equal(h.Template.isRequiredPropositionsClassification(required), true);
  assert.equal(h.Template.ifTemplateMerged(a), false);
  assert.equal(h.Template.isIntermediateKnowledge(a), true);
  const b = new h.Note('B', [txt('old excerpt'), field('证明'), md('old proof'), field('应用'), link('D')]);
  const c = new h.Note('C', [md(`using [A](${url('A')}) and [B](${url('B')})`), link('A')]);
  const d = new h.Note('D');
  return { a, b, c, d, required };
}
const cleanComments = note => cp(note.comments).map(comment => { if (comment.type !== 'LinkNote') delete comment.noteid; return comment; });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok ${passed} - ${name}`); }
function assertNoNativeCopyOrDelete(h) { assert.deepEqual(h.calls.clones, []); assert.deepEqual(h.calls.deletions, []); }

test('direct merge keeps A as backing, routes excerpt/application, updates incoming links and preserves B title', () => {
  const h = harness({ nativeMergeChangesTitle: true }); const { a, b, c } = base(h); const sourceBefore = cp(a.comments);
  const result = h.merge(b, a);
  assert.equal(result.success, true); assert.equal(h.registry.get('A'), a); assert.equal(a.groupNoteId, 'B'); assert.equal(a.parentNote, null);
  assert.equal(b.noteTitle, '【命题】B'); assert.deepEqual(a.comments, sourceBefore);
  assert.deepEqual(cleanComments(b), [txt('old excerpt'), txt('new excerpt'), field('证明'), md('old proof'), field('应用'), link('D'), link('C')]);
  assert.equal(c.MNComments[0].text, `using [A](${url('B')}) and [B](${url('B')})`); assert.equal(h.registry.get(c.comments[1].noteid).groupNoteId, 'B');
  assert.equal(h.pins[0].noteId, 'B'); assert.equal(h.pins[0].title, 'custom'); assert.equal(h.pins[1].noteId, 'B');
  assert.equal(h.api.getUndoReceipts().length, 1); assert.equal(result._undoReceipt.isSourceActive(), false);
  assert.deepEqual(cp(h.calls.indexes[0].config.staleIds), ['A']); assertNoNativeCopyOrDelete(h);
});
test('body inline references stay in excerpt and only incoming application duplicates are removed', () => {
  const h = harness(); const { a, b } = base(h); const oldD = b.comments.at(-1);
  a.comments.push(md(`body [C](${url('C')}) remains here`), md(`[C](${url('C')})`), link('D'));
  assert.equal(h.merge(b, a).success, true); assert.ok(b.comments.includes(oldD));
  const app = h.Template.findFieldObjectByNormalizedName(b, '应用');
  assert.deepEqual(cp(app.excludingFieldBlockIndexArr.map(index => b.MNComments[index].text)), [url('D'), url('C')]);
  assert.ok(b.comments.findIndex(comment => comment.text && comment.text.includes('body [C]')) < b.comments.findIndex(comment => comment.text === '证明'));
  assertNoNativeCopyOrDelete(h);
});
test('main image excerpt retains A identity, handwriting and descendant hierarchy', () => {
  const h = harness(); const { a, b } = base(h, { excerptPic: { paint: 'image-1', drawing: 'overlay' } });
  a.comments.push({ type: 'PaintNote', paint: 'drawing-1', drawing: true });
  const group = a.addChild(new h.Note('GROUP')); const leaf = group.addChild(new h.Note('LEAF')); a.addChild(new h.Note('OTHER'));
  b.addChild(new h.Note('OLD'));
  assert.equal(h.merge(b, a).success, true);
  assert.deepEqual(b.childNotes.map(note => note.noteId), ['OLD', 'GROUP', 'OTHER']); assert.equal(leaf.parentNote, group);
  const excerpt = b.comments.find(comment => comment.q_hpic); assert.equal(excerpt.noteid, 'A'); assert.equal(excerpt.q_hpic.paint, 'image-1');
  assert.equal(b.comments.filter(comment => comment.q_hpic).length, 1); assert.ok(h.registry.has('A'));
  assert.ok(b.comments.some(comment => comment.paint === 'drawing-1')); assertNoNativeCopyOrDelete(h);
});
test('field mapping removes only new field headers and skipped contents, never source or existing B fields', () => {
  const h = harness(); const { a, b } = base(h); const oldHeader = b.comments[1];
  a.type = '思想方法'; a.comments = [txt('excerpt'), field('原理'), md('new proof'), field('应用'), link('C'), field('相关链接'), link('D')];
  const sourceBefore = cp(a.comments); assert.equal(h.Template.isIntermediateKnowledge(a), false);
  assert.equal(h.merge(b, a, { removeTitle: true }).success, true);
  assert.deepEqual(cleanComments(b), [txt('old excerpt'), txt('excerpt'), field('证明'), md('old proof'), md('new proof'), field('应用'), link('D'), link('C')]);
  assert.equal(b.comments[2], oldHeader); assert.deepEqual(a.comments, sourceBefore); assertNoNativeCopyOrDelete(h);
});
test('ordinary simple merge retains legacy path without cloning', () => {
  const h = harness({ pinner: false }); const { a, b } = base(h); a.removeFromParent();
  assert.equal(h.api.prepareBeforeUndoGroup(h.Template, b, a), null); assert.equal(h.merge(b, a).legacy, true); assertNoNativeCopyOrDelete(h);
});
test('ordinary source with descendants migrates hierarchy and honors title option', () => {
  const h = harness({ pinner: false }); const { a, b } = base(h); a.removeFromParent(); a.addChild(new h.Note('CHILD'));
  assert.equal(h.merge(b, a).success, true); assert.match(b.noteTitle, /A/); assert.equal(b.childNotes[0].noteId, 'CHILD'); assertNoNativeCopyOrDelete(h);
});
test('required-proposition ancestors identify untemplated knowledge and user tags stay intact', () => {
  const h = harness(); const { a, b, required } = base(h, { tags: ['personal annotation'] });
  const step = required.addChild(new h.Note('STEP')); step.addChild(a); b.tags = ['original'];
  assert.equal(h.Template.isIntermediateKnowledge(a), true); assert.equal(h.merge(b, a).success, true);
  assert.deepEqual(a.tags, ['personal annotation']); assert.deepEqual(b.tags, ['original']);
});
for (const fault of ['failPin', 'failChildMove']) test(`${fault}: pre-native failure restores exact children and Pins`, () => {
  const h = harness({ [fault]: true }); const { a, b, c } = base(h); const child = a.addChild(new h.Note('CHILD'));
  const beforeB = cp(b.comments), beforeC = cp(c.comments);
  assert.throws(() => h.merge(b, a)); assert.equal(child.parentNote, a); assert.equal(h.registry.has('A'), true);
  assert.deepEqual(b.comments, beforeB); assert.deepEqual(c.comments, beforeC); assert.equal(h.pins[0].noteId, 'A'); assert.equal(h.pins[1].noteId, 'B');
  assert.equal(h.calls.merges.length, 0); assertNoNativeCopyOrDelete(h);
});
for (const fault of ['failMergeBefore', 'failMergeAfter', 'badNativePayload', 'silentSortFailure', 'failSortAfter', 'failIncomingOnce', 'failIncomingRemoved', 'failIndexOnce', 'mutateTargetOriginal']) {
  test(`${fault}: after native merge attempt retain target and Pins, require explicit native undo`, () => {
    const h = harness({ [fault]: true }); const { a, b } = base(h); const child = a.addChild(new h.Note('CHILD'));
    const result = h.merge(b, a);
    assert.equal(result.success, false); assert.equal(result.committed, true); assert.equal(result.requiresUndo, true); assert.match(result.error, /原生撤销/);
    assert.equal(child.parentNote, b); assert.equal(h.pins[0].noteId, 'B'); assert.equal(h.calls.pins.includes('rollback'), false);
    assert.equal(h.registry.has('A'), true); assertNoNativeCopyOrDelete(h);
  });
}
test('missing target field and native-owned skipped LinkNote reject before any mutation', () => {
  {
    const h = harness(); const { a, b } = base(h); b.comments = [txt('old excerpt'), field('证明')];
    assert.throws(() => h.merge(b, a), /缺少字段/); assert.equal(h.calls.pins.length, 0); assertNoNativeCopyOrDelete(h);
  }
  {
    const h = harness(); const { a, b } = base(h);
    a.comments.push(field('相关链接'), { type: 'LinkNote', noteid: 'E', q_htext: 'owned excerpt' });
    assert.throws(() => h.api.prepareBeforeUndoGroup(h.Template, b, a), /底层卡片/);
    assert.equal(h.calls.merges.length, 0); assert.equal(h.calls.pins.length, 0); assertNoNativeCopyOrDelete(h);
  }
});
test('partial suffix removal failure reports native undo without touching original target prefix', () => {
  const h = harness({ failRemoveSuffixAfter: true }); const { a, b } = base(h); const originals = b.comments.slice();
  a.comments.push(field('相关链接'), link('D'));
  const result = h.merge(b, a); assert.equal(result.requiresUndo, true);
  originals.forEach((comment, index) => assert.equal(b.comments[index], comment)); assert.equal(h.pins[0].noteId, 'B');
});
test('cycle, identical-source, installed old MNPinner and already-backed source fail closed', () => {
  const h = harness(); const { a, b } = base(h); a.addChild(b);
  assert.throws(() => h.merge(b, a), /子树/); assert.throws(() => h.merge(a, a), /不同/); assertNoNativeCopyOrDelete(h);
  const old = harness({ oldPinner: true }); const data = base(old);
  assert.throws(() => old.merge(data.b, data.a), /MNPinner/); assert.equal(old.calls.pins.length, 0);
  const backed = harness(); const cards = base(backed); cards.a.groupNoteId = 'C';
  assert.throws(() => backed.merge(cards.b, cards.a), /摘录保留/); assert.equal(backed.calls.merges.length, 0);
});
test('actual shared entry preserves keepOnlyExcerpt application routing', () => {
  const h = harness(); const { a, b, c } = base(h);
  const result = h.Template.renewKnowledgeNotesInTransaction(b, a, { keepOnlyExcerpt: true }); h.api.finalizeSourceRemoval(result);
  assert.equal(result.success, true); assert.equal(h.registry.has('A'), true);
  const app = h.Template.findFieldObjectByNormalizedName(b, '应用');
  assert.deepEqual(cp(app.excludingFieldBlockIndexArr.map(index => b.MNComments[index].text)), [url('D'), url('C')]); assert.equal(h.registry.get(c.comments[1].noteid).groupNoteId, 'B');
});
test('main excerpt without comments or field headers merges exactly once with A backing', () => {
  const h = harness({ pinner: false }); const { a } = base(h, { excerptText: 'source native excerpt' }); a.comments = [];
  const b = new h.Note('B', [txt('old text')]); assert.equal(h.merge(b, a).success, true);
  assert.equal(b.comments.length, 2); assert.equal(b.comments[1].noteid, 'A'); assert.equal(b.comments[1].q_htext, 'source native excerpt'); assertNoNativeCopyOrDelete(h);
});
test('missing native main excerpt requires undo and never deletes backing source', () => {
  const h = harness({ omitNativeExcerpt: true }); const { a, b } = base(h, { excerptText: 'source main' });
  const result = h.merge(b, a); assert.equal(result.requiresUndo, true); assert.match(result.error, /主摘录/); assert.equal(h.registry.has('A'), true); assertNoNativeCopyOrDelete(h);
});
test('merged Markdown incoming proof updates its existing backing excerpt', () => {
  const h = harness(); const { a, b, c } = base(h); const original = `merged proof uses [A](${url('A')})`;
  const backing = new h.Note('E', [], { excerptText: original }); c.comments.push({ type: 'LinkNote', noteid: 'E', q_htext: original, markdown: true });
  assert.equal(h.merge(b, a).success, true); assert.equal(backing.excerptText, `merged proof uses [A](${url('B')})`); assert.equal(c.comments.at(-1).noteid, 'E');
});
test('native loss of original target tags requires native undo and keeps Pins on B', () => {
  const h = harness({ nativeMergeDropsTags: true }); const { a, b } = base(h); b.tags = ['original'];
  const result = h.merge(b, a); assert.equal(result.requiresUndo, true); assert.match(result.error, /标签/); assert.equal(h.pins[0].noteId, 'B');
});
test('unreadable source keeps a safe history receipt but cannot pass retirement verification', () => {
  const h = harness({ nativeMergeBlocksSourceRead: true }); const { a, b } = base(h); const result = h.merge(b, a);
  assert.equal(result.success, false); assert.equal(result.pendingVerification, true); assert.equal(h.pins[0].noteId, 'B'); assert.equal(h.api.getUndoReceipts().length, 1);
  assert.throws(() => result._undoReceipt.isSourceActive(), /unavailable/); assertNoNativeCopyOrDelete(h);
});
test('pure preparation and deferred retirement finish after group commit without native clone or delete', () => {
  const h = harness({ deferRetirement: true }); const { a, b } = base(h); const group = a.addChild(new h.Note('GROUP')); const leaf = group.addChild(new h.Note('LEAF'));
  const beforeA = cp(a.comments), beforeB = cp(b.comments), count = h.registry.size;
  const prepared = h.api.prepareBeforeUndoGroup(h.Template, b, a);
  assert.equal(prepared.nativeMutationFree, true); assert.equal(h.registry.size, count); assert.deepEqual(a.comments, beforeA); assert.deepEqual(b.comments, beforeB); assert.equal(group.parentNote, a);
  const result = h.run(b, a, { _preparedMerge: prepared });
  assert.equal(result.pendingVerification, true); assert.equal(result.preparedBeforeUndoGroup, true); assert.equal(h.api.finalizeSourceRemoval(result).success, false);
  assert.equal(h.api.getUndoReceipts().length, 1); assert.equal(result._undoReceipt.isSourceActive(), false); assert.equal(h.pins[0].noteId, 'B');
  h.flushNativeCommits(); assert.equal(h.api.finalizeSourceRemoval(result).success, true); assert.equal(result.pendingVerification, false);
  assert.equal(h.api.getUndoReceipts().length, 1); h.api.finalizeSourceRemoval(result); assert.equal(h.api.getUndoReceipts().length, 1);
  assert.equal(group.parentNote, b); assert.equal(leaf.parentNote, group); assert.equal(h.registry.get('A'), a); assertNoNativeCopyOrDelete(h);
});
test('fresh realGroupNoteIdForTopicId alone verifies native retirement', () => {
  const h = harness({ realGroupOnly: true }); const { a, b } = base(h); const result = h.merge(b, a);
  assert.equal(a.groupNoteId, undefined); assert.equal(result.success, true); assert.equal(result._undoReceipt.isSourceActive(), false);
});
test('prepared merges reject changed root/nested content and child order before moving Pins', () => {
  for (const change of [({ a }) => { a.comments[0].text = 'edited'; }, ({ b }) => { b.comments[0].text = 'edited'; }, ({ leaf }) => { leaf.comments.push(txt('edit')); }, ({ a }) => { a.childNotes.reverse(); }]) {
    const h = harness(); const data = base(h); const group = data.a.addChild(new h.Note('GROUP')); const leaf = group.addChild(new h.Note('LEAF')); data.a.addChild(new h.Note('OTHER'));
    const prepared = h.api.prepareBeforeUndoGroup(h.Template, data.b, data.a); change({ ...data, leaf });
    assert.throws(() => h.run(data.b, data.a, { _preparedMerge: prepared }), /过期/); assert.equal(h.calls.pins.length, 0); assert.equal(group.parentNote, data.a);
    assert.throws(() => h.run(data.b, data.a, { _preparedMerge: prepared }), /已使用/); assertNoNativeCopyOrDelete(h);
  }
});
test('prepared plans bind card identity and field options', () => {
  const h = harness(); const { a, b } = base(h); const prepared = h.api.prepareBeforeUndoGroup(h.Template, b, a);
  assert.throws(() => h.run(new h.Note('OTHER'), a, { _preparedMerge: prepared }), /其他卡片/);
  assert.throws(() => h.run(b, a, { _preparedMerge: prepared, keepOnlyExcerpt: true }), /选项/); assert.equal(h.calls.pins.length, 0); assertNoNativeCopyOrDelete(h);
});
test('one native group contains direct merge and no native clone or physical deletion', () => {
  const h = harness({ deferRetirement: true }); const { a, b } = base(h); const prepared = h.api.prepareBeforeUndoGroup(h.Template, b, a);
  const result = h.withNativeGroup(() => h.run(b, a, { _preparedMerge: prepared })); assert.equal(h.api.finalizeSourceRemoval(result).success, true);
  assert.deepEqual(h.calls.merges, [{ target: 'B', source: 'A', insideNativeGroup: true }]); assertNoNativeCopyOrDelete(h);
});
test('history receipt distinguishes restored A from backing and refreshes restored/merged indexes', () => {
  const h = harness(); const { a, b, required } = base(h); const originalB = cp(b.comments); const result = h.merge(b, a); const receipt = result._undoReceipt;
  assert.equal(receipt.isSourceActive(), false);
  a.groupNoteId = undefined; required.addChild(a); b.comments = cp(originalB); assert.equal(receipt.isSourceActive(), true);
  receipt.pinMigration.rollback(); receipt.onStateReconciled('restored');
  assert.equal(h.pins[0].noteId, 'A'); assert.deepEqual(h.calls.indexes.slice(-3).map(call => call.noteId), ['A', 'B', 'C']);
  a.groupNoteId = 'B'; a.removeFromParent(); assert.equal(receipt.isSourceActive(), false);
  receipt.pinMigration.apply(); receipt.onStateReconciled('merged');
  assert.equal(h.pins[0].noteId, 'B'); assert.deepEqual(cp(h.calls.indexes.at(-2).config.staleIds), ['A']); assert.equal(h.calls.indexes.at(-1).noteId, 'C');
});
test('index-only receipts without MNPinner refresh modified proof indexes on merge and undo', () => {
  const h = harness({ pinner: false }); const { a, b } = base(h); const result = h.merge(b, a);
  assert.equal(result.success, true); assert.equal(result._undoReceipt.pinMigration, null); assert.equal(h.api.getUndoReceipts().length, 1);
  assert.deepEqual(h.calls.indexes.map(call => call.noteId), ['B', 'C']);
  a.groupNoteId = undefined; result._undoReceipt.onStateReconciled('restored');
  assert.deepEqual(h.calls.indexes.slice(-3).map(call => call.noteId), ['A', 'B', 'C']);
});
test('history index persistence failures propagate for retry', () => {
  const h = harness(); const { a, b } = base(h); const receipt = h.merge(b, a)._undoReceipt;
  h.Template.syncFinalMakeCardIndex = () => ({ success: false, error: 'disk unavailable' });
  assert.throws(() => receipt.onStateReconciled('merged'), /disk unavailable/);
});
test('native merge may consume plain A and remove parent LinkNotes; rebuild ownership without overwriting shifted headers', () => {
  const h = harness({ nativeRemovesSourceLinks: true }); const { a, b, c } = base(h);
  b.comments.splice(3, 0, field('相关链接'));
  const group = a.addChild(new h.Note('GROUP', [field('所属'), link('A'), field('相关思考'), field('包含')], { type: '归类', title: '“所需命题”相关命题' }));
  const thoughtHeader = group.comments[2], containsHeader = group.comments[3];
  const leaf = group.addChild(new h.Note('LEAF')); a.comments.push(link('GROUP'));
  const result = h.merge(b, a);
  assert.equal(result.success, true, result.error); assert.equal(h.registry.has('A'), false); assert.equal(result._undoReceipt.isSourceActive(), false);
  assert.equal(group.parentNote, b); assert.equal(leaf.parentNote, group); assert.deepEqual(h.calls.parentLinks, ['GROUP']);
  assert.deepEqual(group.comments, [field('所属'), link('B'), field('相关思考'), field('包含')]);
  assert.equal(group.comments[2], thoughtHeader); assert.equal(group.comments[3], containsHeader);
  assert.equal(c.comments[0].text, `using [A](${url('B')}) and [B](${url('B')})`); assert.equal(c.comments[1].noteid, 'B');
  const related = h.Template.findFieldObjectByNormalizedName(b, '相关链接');
  const app = h.Template.findFieldObjectByNormalizedName(b, '应用');
  assert.deepEqual(cp(related.excludingFieldBlockIndexArr.map(index => b.comments[index].noteid)), ['GROUP']);
  assert.deepEqual(cp(app.excludingFieldBlockIndexArr.map(index => b.comments[index].noteid)), ['D', 'C']);
  assertNoNativeCopyOrDelete(h);
});
test('raw TextNote with provenance remains a normal writable comment even when manager labels it mergedMarkdown', () => {
  const h = harness({ managerTreatsProvenanceAsMerged: true }); const { a, b, c } = base(h);
  c.comments = [{ ...md(`body [A](${url('A')})`), noteid: 'A' }];
  assert.equal(c.MNComments[0].type, 'mergedMarkdownComment'); assert.equal(c.MNComments[0].text, undefined);
  const result = h.merge(b, a); assert.equal(result.success, true, result.error);
  assert.equal(c.comments[0].text, `body [A](${url('B')})`); assert.equal(a.excerptText, '');
  assert.deepEqual(h.calls.replacements, [{ noteId: 'C', index: 0 }]);
});
test('already rewritten native incoming Markdown and LinkNote are accepted without duplicate replacement', () => {
  const h = harness({ autoRewriteIncoming: true }); const { a, b, c } = base(h);
  const result = h.merge(b, a); assert.equal(result.success, true, result.error);
  assert.equal(c.comments[0].text, `using [A](${url('B')}) and [B](${url('B')})`); assert.equal(c.comments[1].noteid, 'B');
  assert.equal(h.calls.replacements.length, 0); assert.ok(h.calls.indexes.some(call => call.noteId === 'C'));
});
test('ordinary LinkNote already resolving through native backing B is accepted without replacing it', () => {
  const h = harness(); const { a, b, c } = base(h); const originalLink = c.comments[1];
  const result = h.merge(b, a); assert.equal(result.success, true, result.error);
  assert.equal(c.comments[1], originalLink); assert.equal(h.registry.get(originalLink.noteid).groupNoteId, 'B');
  assert.deepEqual(h.calls.replacements, [{ noteId: 'C', index: 0 }]);
});
test('post-merge error immediately registers receipt but pending native grouping is not mistaken for undo', () => {
  const h = harness({ deferRetirement: true, failIndexOnce: true }); const { a, b, required } = base(h);
  const originalB = cp(b.comments); const child = a.addChild(new h.Note('CHILD'));
  const result = h.run(b, a);
  assert.equal(result.requiresUndo, true); assert.equal(h.api.getUndoReceipts().length, 1);
  assert.equal(a.groupNoteId, undefined); assert.equal(a.parentNote, null); assert.equal(child.parentNote, b);
  assert.equal(result._undoReceipt.isSourceActive(), false); assert.equal(h.pins[0].noteId, 'B');
  a.addChild(child); required.addChild(a); b.comments = cp(originalB);
  assert.equal(result._undoReceipt.isSourceActive(), true, 'only the original native source and target shape represents undo');
});
test('whole-URL TextNote parent link removed by native merge is recognized semantically and rebuilt safely', () => {
  const h = harness({ nativeRemovesSourceLinks: true, rawURLAsLinkComment: true }); const { a, b, c } = base(h);
  b.comments.splice(3, 0, field('相关链接'));
  const group = a.addChild(new h.Note('GROUP', [field('所属'), txt(url('A')), field('相关思考'), field('包含')], { type: '归类', title: '“所需命题”相关命题' }));
  const thoughtHeader = group.comments[2], containsHeader = group.comments[3];
  a.comments.push(link('GROUP'));
  assert.equal(group.comments[1].type, 'TextNote'); assert.equal(group.MNComments[1].type, 'linkComment');
  assert.equal(h.Template.getStandaloneNoteLinkInfoFromComment(group.MNComments[1]).noteId, 'A');
  const result = h.merge(b, a);
  assert.equal(result.success, true, result.error); assert.equal(h.registry.has('A'), false);
  assert.deepEqual(h.calls.parentLinks, ['GROUP']); assert.deepEqual(group.comments, [field('所属'), link('B'), field('相关思考'), field('包含')]);
  assert.equal(group.comments[2], thoughtHeader); assert.equal(group.comments[3], containsHeader);
  assert.equal(c.comments[0].text, `using [A](${url('B')}) and [B](${url('B')})`);
  assert.equal(group.parentNote, b); assert.equal(h.pins[0].noteId, 'B'); assertNoNativeCopyOrDelete(h);
});
console.log(`intermediate knowledge merge regression: ${passed} scenarios passed`);
