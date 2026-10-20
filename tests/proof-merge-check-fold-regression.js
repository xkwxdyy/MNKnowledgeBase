const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const start = source.indexOf('class ProofMergeCheckFoldSession');
const end = source.indexOf('\nclass Pangu', start);
assert.notEqual(start, -1, 'Cannot locate production ProofMergeCheckFoldSession');
assert.notEqual(end, -1, 'Cannot locate HtmlMarkdownUtils boundary');

function comment(tag, text = '', options = {}) {
  const value = { type: 'TextNote', text, markdown: false, collapsed: false, ...options };
  Object.defineProperty(value, 'testTag', { value: tag });
  return value;
}
const check = tag => comment(tag, '<span id="check">🔍 CHECK</span>', { markdown: true });
const drawing = (tag, options = {}) => comment(tag, '', { type: 'PaintNote', drawing: 'same-drawing-hash', ...options });
const identifiedDrawing = tag => drawing(tag, { commentId: `COMMENT:${tag}` });
const link = (tag, noteId) => comment(tag, `marginnote4app://note/${noteId}`, { type: 'LinkNote', noteid: noteId });
function cloneComment(value) {
  const clone = { ...value };
  Object.defineProperty(clone, 'testTag', { value: value.testTag });
  return clone;
}
function tags(note) { return note.comments.map(value => value.testTag); }
function foldedTags(note) { return note.comments.filter(value => value.collapsed).map(value => value.testTag); }

function harness(options = {}) {
  const registry = new Map();
  const nativeCalls = [];
  const wrapperCalls = [];
  const methodNames = ['appendMarkdownComment', 'removeCommentByIndex', 'moveComment', 'sortCommentsByNewIndices', 'merge'];
  const fresh = value => value && Object.assign(Object.create(Note.prototype), registry.get(value.noteId) || value, { isFreshWrapper: true });
  class Note {
    constructor(id, comments = [], options = {}) {
      this.noteId = this.id = id;
      this._parentNote = null;
      this._childNotes = [];
      this.knowledge = options.knowledge === true;
      this.classification = options.classification === true;
      this.excerptType = options.excerptType || (options.excerptText ? 'text' : 'none');
      this.excerptText = options.excerptText || '';
      this.mainExcerptText = this.excerptText;
      this.excerptPic = options.excerptPic || null;
      this.excerpt = this.excerptPic ? { type: this.excerptType, imageHash: 'excerpt-image' } : { type: this.excerptType };
      this._state = { title: options.title === undefined ? id : options.title, revision: 0 };
      const owner = this;
      this.note = {
        noteId: id,
        comments: comments.map(cloneComment),
        excerptText: this.excerptText,
        excerptPic: this.excerptPic,
        commentState() { return owner.nativeState(); },
        setCommentsCollapsed(targets, collapsed, revision) {
          const currentRevision = owner.revisionToken();
          assert.equal(revision, currentRevision, 'Every fold batch must use the latest target revision');
          assert.ok(targets.length > 0 && targets.length <= 200, 'Host accepts at most 200 targets per batch');
          assert.equal(new Set(targets.map(target => target.index)).size, targets.length);
          const selected = targets.map(target => {
            assert.ok(Number.isInteger(target.index) && target.index >= 1 && target.index <= owner.comments.length,
              'Native targets must use one-based comment indices');
            return owner.comments[target.index - 1];
          });
          nativeCalls.push({ noteId: id, revision, targets: targets.map(target => ({ ...target })), tags: selected.map(value => value.testTag) });
          if (owner.nativeFailure === 'revision') {
            owner.revision++;
            return { ok: false, error: { code: 'COMMENT_CHANGED', message: 'fixture stale revision' } };
          }
          if (owner.nativeFailure === 'persisted') {
            return { ...owner.nativeState(), persisted: false, collapsed, requestedCount: targets.length, changedCount: 0, affectedOwnerNoteIds: [] };
          }
          if (owner.nativeFailure !== 'readback') selected.forEach(value => { value.collapsed = collapsed; });
          owner.revision++;
          return {
            ...owner.nativeState(), persisted: true, collapsed, requestedCount: targets.length,
            changedCount: selected.length, affectedOwnerNoteIds: [id],
          };
        },
      };
      registry.set(id, this);
    }
    static new(value) {
      const note = value instanceof Note ? value : registry.get(typeof value === 'string' ? value.replace(/^.*\/note\//, '') : value && value.noteId);
      return options.freshWrappers ? fresh(note) : note;
    }
    get title() { return this._state.title; }
    set title(value) { this._state.title = value; }
    get noteTitle() { return this._state.title; }
    set noteTitle(value) { this._state.title = value; }
    setTitle(value) { this._state.title = value; }
    get revision() { return this._state.revision; }
    set revision(value) { this._state.revision = value; }
    get parentNote() {
      const parent = (registry.get(this.noteId) || this)._parentNote;
      return options.freshWrappers ? fresh(parent) : parent;
    }
    set parentNote(value) { (registry.get(this.noteId) || this)._parentNote = value && (registry.get(value.noteId) || value); }
    get childNotes() {
      const children = (registry.get(this.noteId) || this)._childNotes;
      return options.freshWrappers ? children.map(fresh) : children;
    }
    get comments() { return this.note.comments; }
    get MNComments() {
      return this.comments.map((raw, index) => ({
        type: raw.type === 'TextNote' ? (raw.markdown ? 'markdownComment' : 'textComment')
          : raw.type === 'PaintNote' ? 'drawingComment' : raw.q_htext || raw.q_hpic ? 'mergedTextComment' : 'linkComment',
        text: raw.text || raw.q_htext || '', markdown: raw.markdown === true, index,
        get note() { return Note.new(raw.noteid); },
        rawComment: raw,
      }));
    }
    get descendantNodes() {
      const descendant = [], treeIndex = [];
      const visit = (note, indices) => note.childNotes.forEach((child, index) => {
        const location = [...indices, index];
        descendant.push(child); treeIndex.push(location); visit(child, location);
      });
      visit(this, []);
      return { descendant, treeIndex };
    }
    addChild(child) {
      const target = registry.get(this.noteId) || this;
      const original = registry.get(child.noteId) || child;
      if (original._parentNote) {
        const siblings = original._parentNote._childNotes;
        const index = siblings.findIndex(note => note.noteId === original.noteId);
        if (index >= 0) siblings.splice(index, 1);
      }
      target._childNotes.push(original); original._parentNote = target;
      return options.freshWrappers ? fresh(original) : original;
    }
    revisionToken() { return `${this.noteId}:revision:${this.revision}`; }
    nativeState() {
      return { ok: true, noteid: this.noteId, revision: this.revisionToken(), comments: this.comments.map((raw, index) => ({
        index: index + 1, ownerNoteId: this.noteId, commentId: raw.commentId || null,
        collapsed: raw.collapsed === true, type: raw.type, text: raw.text || raw.q_htext || '',
      })) };
    }
    appendMarkdownComment(text) {
      wrapperCalls.push({ name: 'appendMarkdownComment', receiver: this });
      this.comments.push(comment(`title:${this.noteId}:${this.revision}`, text, { markdown: true })); this.revision++;
    }
    removeCommentByIndex(index) {
      wrapperCalls.push({ name: 'removeCommentByIndex', receiver: this });
      this.comments.splice(index, 1); this.revision++;
    }
    moveComment(from, to) {
      wrapperCalls.push({ name: 'moveComment', receiver: this });
      const value = this.comments.splice(from, 1)[0]; this.comments.splice(to, 0, value); this.revision++;
    }
    sortCommentsByNewIndices(destinations) {
      wrapperCalls.push({ name: 'sortCommentsByNewIndices', receiver: this });
      if (this.sortNoop) return;
      const reordered = new Array(this.comments.length);
      destinations.forEach((destination, index) => { reordered[destination] = this.comments[index]; });
      this.note.comments = reordered; this.revision++;
    }
    merge(sourceNote) {
      wrapperCalls.push({ name: 'merge', receiver: this });
      const additions = [];
      if (sourceNote.excerptText.trim() || sourceNote.excerptPic || options.alwaysMergedShell) {
        additions.push(comment(`excerpt:${sourceNote.noteId}`, '', {
          type: 'LinkNote', noteid: sourceNote.noteId, q_htext: sourceNote.excerptText,
          q_hpic: sourceNote.excerptPic,
        }));
      }
      additions.push(...sourceNote.comments.map(value => {
        const copy = cloneComment(value);
        if (options.nativeProvenance && copy.type !== 'LinkNote') copy.noteid = sourceNote.noteId;
        return copy;
      }));
      if (this.mergeFault === 'wrong-excerpt') additions[0].noteid = 'UNEXPECTED-SOURCE';
      if (this.mergeFault === 'reorder') additions.reverse();
      this.comments.push(...additions); this.revision++;
      sourceNote.groupNoteId = this.noteId;
      return this;
    }
    mergeInto(target) {
      // Model MNUtils link cleanup through the same methods that production observes.
      for (const [note, other] of [[this, target], [target, this]]) {
        for (let index = note.comments.length - 1; index >= 0; index--) {
          const value = note.comments[index];
          if (value.type === 'LinkNote' && !value.q_htext && !value.q_hpic && value.noteid === other.noteId) note.removeCommentByIndex(index);
        }
      }
      target.merge(this);
      const original = registry.get(this.noteId) || this;
      if (original._parentNote) {
        const siblings = original._parentNote._childNotes;
        const index = siblings.findIndex(note => note.noteId === this.noteId);
        if (index >= 0) siblings.splice(index, 1);
      }
      original._parentNote = null;
      [...this.childNotes].forEach(child => target.addChild(child));
    }
    focusInMindMap() {}
    refresh() {}
  }
  const context = vm.createContext({
    console, MNNote: Note,
    Pangu: { spacing: value => String(value || '') },
    KnowledgeBaseTemplate: {
      isClassificationNote: note => note.classification,
      isKnowledgeNote: note => note.knowledge,
      getNoteType: note => note.classification ? '归类' : note.knowledge ? '命题' : '',
    },
    KnowledgeBaseUtils: { log() {}, addErrorLog() {}, emitRuntimeLog() {} },
    MNUtil: {
      typeOf: value => value instanceof Note ? 'MNNote' : typeof value,
      undoGrouping: block => block(), showHUD() {}, log() {}, error() {}, warn() {},
    },
  });
  context.global = context;
  context.globalThis = context;
  vm.runInContext(`${source.slice(start, end)}\nthis.HtmlMarkdownUtils = HtmlMarkdownUtils;`, context, { filename: 'proof-merge-production.js' });
  assert.equal(typeof context.HtmlMarkdownUtils.runProofMergeWithCheckFolding, 'function');
  return {
    Note, api: context.HtmlMarkdownUtils, nativeCalls, wrapperCalls, fresh,
    captureMethods(notes) {
      return notes.flatMap(note => methodNames.map(name => ({ note, name, value: note[name], descriptor: Object.getOwnPropertyDescriptor(note, name) })));
    },
    assertRestored(saved) {
      for (const item of saved) {
        assert.equal(item.note[item.name], item.value, `${item.note.noteId}.${item.name} must be restored`);
        assert.deepEqual(Object.getOwnPropertyDescriptor(item.note, item.name), item.descriptor,
          'Instrumentation must not leave new own properties on wrappers');
      }
    },
  };
}

let passed = 0;
function test(name, run) {
  run(); passed++; console.log(`ok ${passed} - ${name}`);
}

test('source excerpt and comments through Check fold, later handwriting and root excerpt remain expanded', () => {
  const h = harness();
  const root = new h.Note('ROOT', [comment('root-proof', 'already in proof')], { excerptText: 'root excerpt' });
  const sourceNote = root.addChild(new h.Note('SOURCE', [comment('original', 'original'), check('check'), drawing('handwriting')], { excerptText: 'source excerpt' }));
  const saved = h.captureMethods([root, sourceNote]);
  const operationResult = { fixture: 'original result' };
  const result = h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => { sourceNote.mergeInto(root); return operationResult; });
  assert.equal(result, operationResult, 'The wrapper must preserve the original operation return value');
  assert.deepEqual(foldedTags(root), ['excerpt:SOURCE', 'original', 'check']);
  assert.equal(root.excerptText, 'root excerpt');
  assert.deepEqual(h.nativeCalls.flatMap(call => call.tags), ['excerpt:SOURCE', 'original', 'check']);
  h.assertRestored(saved);
});

test('actual layered styled merge handles siblings, duplicate text, empty drawings and field movement', () => {
  const h = harness();
  const root = new h.Note('ROOT', [comment('proof-head', '<b>证明：</b>', { type: 'HtmlNote' }), comment('later-field', '<b>应用：</b>', { type: 'HtmlNote' })]);
  const first = root.addChild(new h.Note('FIRST', [drawing('first-before'), check('first-check'), drawing('first-after')], { excerptText: 'shared excerpt' }));
  first.addChild(new h.Note('DEEP', [comment('deep-original', 'same text'), check('deep-check'), drawing('deep-after')], { excerptText: 'shared excerpt' }));
  const second = root.addChild(new h.Note('SECOND', [comment('second-original', 'same text'), check('second-check'), drawing('second-after')], { excerptType: 'text' }));
  const notes = [root, ...root.descendantNodes.descendant];
  const saved = h.captureMethods(notes);
  h.api.runProofMergeWithCheckFolding(root, null, () => {
    h.api.upwardMergeWithStyledComments(root, 'level1');
    const fieldIndex = root.comments.findIndex(value => value.testTag === 'later-field');
    root.moveComment(fieldIndex, root.comments.length - 1);
  });
  assert.deepEqual(new Set(foldedTags(root)), new Set([
    'excerpt:FIRST', 'first-before', 'first-check', 'excerpt:DEEP', 'deep-original', 'deep-check', 'second-original', 'second-check',
  ]));
  assert.ok(root.comments.some(value => String(value.testTag).startsWith('title:')));
  assert.ok(root.comments.filter(value => String(value.testTag).startsWith('title:')).every(value => !value.collapsed), 'Generated hierarchy titles stay expanded');
  assert.equal(root.comments.at(-1).testTag, 'later-field');
  assert.ok(root.comments.filter(value => /after$/.test(value.testTag)).every(value => !value.collapsed));
  h.assertRestored(saved);
});

test('fresh wrappers sharing native notes retain merge and move identity without intercepting unrelated notes', () => {
  const h = harness({ freshWrappers: true });
  const root = new h.Note('ROOT', [comment('later-field', '<b>应用：</b>', { type: 'HtmlNote' }), link('child-link', 'FIRST')]);
  const first = root.addChild(new h.Note('FIRST', [link('parent-link', 'ROOT'), drawing('first-original'), check('first-check'), drawing('first-after')], { excerptText: 'first excerpt' }));
  const deep = first.addChild(new h.Note('DEEP', [check('deep-check'), drawing('deep-after')], { excerptText: 'deep excerpt' }));
  const unrelated = new h.Note('UNRELATED', [comment('unrelated-original', 'outside')]);
  const unrelatedSource = new h.Note('UNRELATED-SOURCE', [comment('unrelated-payload', 'outside source')]);
  assert.notEqual(root.childNotes[0], root.childNotes[0]);
  assert.notEqual(first.parentNote, first.parentNote);
  assert.notEqual(root.descendantNodes.descendant[0], root.descendantNodes.descendant[0]);
  const operationalRoot = h.fresh(root);
  const operationalMoveRoot = h.fresh(root);
  const operationalUnrelated = h.fresh(unrelated);
  assert.notEqual(operationalRoot, root);
  assert.equal(operationalRoot.note, root.note);
  const descriptors = Object.getOwnPropertyDescriptors(h.Note.prototype);
  const saved = h.captureMethods([root, first, deep, unrelated, unrelatedSource, operationalRoot, operationalMoveRoot]);
  h.api.runProofMergeWithCheckFolding(root, null, () => {
    h.api.upwardMergeWithStyledComments(operationalRoot, 'level1');
    assert.equal(operationalUnrelated.merge(h.fresh(unrelatedSource)), operationalUnrelated,
      'Untracked merge must preserve its actual receiver and return value');
    operationalUnrelated.appendMarkdownComment('outside generated title');
    operationalUnrelated.moveComment(unrelated.comments.length - 1, 0);
    operationalUnrelated.removeCommentByIndex(1);
    const boundaryIndex = operationalMoveRoot.comments.findIndex(value => value.testTag === 'later-field');
    operationalMoveRoot.moveComment(boundaryIndex, operationalMoveRoot.comments.length - 1);
  });
  assert.deepEqual(new Set(foldedTags(root)), new Set(['excerpt:FIRST', 'first-original', 'first-check', 'excerpt:DEEP', 'deep-check']));
  assert.equal(root.comments.at(-1).testTag, 'later-field');
  assert.ok(root.comments.filter(value => String(value.testTag).startsWith('title:') || /after$/.test(value.testTag)).every(value => !value.collapsed));
  assert.equal(h.wrapperCalls.at(-1).receiver, operationalMoveRoot, 'Tracked methods must run on the calling wrapper');
  assert.ok(h.wrapperCalls.every(call => call.receiver.isFreshWrapper), 'Each actual mutation must retain its fresh receiver');
  assert.deepEqual(tags(unrelated), ['title:UNRELATED:1', 'unrelated-payload']);
  assert.deepEqual(foldedTags(unrelated), []);
  assert.ok(h.nativeCalls.every(call => call.noteId === 'ROOT'));
  assert.deepEqual(Object.getOwnPropertyDescriptors(h.Note.prototype), descriptors, 'The entire prototype must be restored');
  h.assertRestored(saved);
});

test('link deletion before native merge preserves the Check boundary and matching empty handwriting', () => {
  const h = harness();
  const root = new h.Note('ROOT', [link('child-link', 'SOURCE'), comment('root-field', 'field')]);
  const sourceNote = root.addChild(new h.Note('SOURCE', [link('parent-link', 'ROOT'), drawing('before'), check('check'), drawing('after')]));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    root.appendMarkdownComment('<span id="level1">source title</span>');
    sourceNote.mergeInto(root);
    root.moveComment(root.comments.findIndex(value => value.testTag === 'root-field'), root.comments.length - 1);
  });
  assert.deepEqual(foldedTags(root), ['before', 'check']);
  assert.ok(!tags(root).includes('parent-link') && !tags(root).includes('child-link'));
  assert.equal(root.comments.find(value => value.testTag === 'after').collapsed, false);
});

test('swapping indistinguishable comments without stable IDs rejects before native sorting', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [drawing('before'), check('check'), drawing('after')]));
  const saved = h.captureMethods([root, sourceNote]);
  assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    sourceNote.mergeInto(root);
    root.sortCommentsByNewIndices([2, 1, 0]);
  }), /稳定标识/);
  assert.deepEqual(tags(root), ['before', 'check', 'after']);
  assert.ok(!h.wrapperCalls.some(call => call.name === 'sortCommentsByNewIndices'), 'Unverifiable identical swaps must stop before calling Native');
  assert.equal(h.nativeCalls.length, 0); assert.deepEqual(foldedTags(root), []); h.assertRestored(saved);
});

test('stable comment IDs detect a swallowed native sort even when content values stay identical', () => {
  const h = harness(); const root = new h.Note('ROOT'); root.sortNoop = true;
  const sourceNote = root.addChild(new h.Note('SOURCE', [identifiedDrawing('before'), check('check'), identifiedDrawing('after')]));
  const saved = h.captureMethods([root, sourceNote]);
  assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    sourceNote.mergeInto(root);
    root.sortCommentsByNewIndices([2, 1, 0]);
  }), /稳定标识/);
  assert.ok(h.wrapperCalls.some(call => call.name === 'sortCommentsByNewIndices'), 'The simulated host no-op must actually run');
  assert.deepEqual(tags(root), ['before', 'check', 'after']);
  assert.equal(h.nativeCalls.length, 0); assert.deepEqual(foldedTags(root), []); h.assertRestored(saved);
});

test('image excerpts fold and excerptType alone does not invent a main excerpt', () => {
  const h = harness();
  const root = new h.Note('ROOT');
  const image = root.addChild(new h.Note('IMAGE', [check('image-check'), drawing('image-after')], { excerptPic: { paint: 'image' }, excerptType: 'image' }));
  const empty = root.addChild(new h.Note('EMPTY', [check('empty-check'), drawing('empty-after')], { excerptType: 'text' }));
  h.api.runProofMergeWithCheckFolding(root, [image, empty], () => { image.mergeInto(root); empty.mergeInto(root); });
  assert.deepEqual(foldedTags(root), ['excerpt:IMAGE', 'image-check', 'empty-check']);
  assert.ok(!tags(root).includes('excerpt:EMPTY'));
});

test('multiple Check markers abort before operation and restore wrapper methods', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [check('one'), check('two'), drawing('after')]));
  const saved = h.captureMethods([root, sourceNote]); let operations = 0;
  assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => { operations++; sourceNote.mergeInto(root); }));
  assert.equal(operations, 0); assert.deepEqual(tags(sourceNote), ['one', 'two', 'after']);
  assert.equal(h.nativeCalls.length, 0); h.assertRestored(saved);
});

test('sources without Check retain ordinary merge behavior even on hosts without folding', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [comment('ordinary', 'no check'), drawing('after')]));
  delete root.note.commentState; delete root.note.setCommentsCollapsed;
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.deepEqual(tags(root), ['ordinary', 'after']); assert.deepEqual(foldedTags(root), []);
  assert.equal(h.nativeCalls.length, 0);
});

test('a plain text span is not a Check marker and does not create a duplicate marker', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [
    comment('literal-span', '<span id="check">literal source text</span>'), check('real-check'), drawing('after'),
  ]));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.deepEqual(foldedTags(root), ['literal-span', 'real-check']);
});

test('a plain text span alone preserves no-Check behavior without native folding support', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [comment('literal-span', '<span id="check">literal source text</span>'), drawing('after')]));
  delete root.note.commentState; delete root.note.setCommentsCollapsed;
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.deepEqual(tags(root), ['literal-span', 'after']); assert.equal(h.nativeCalls.length, 0);
});

test('default source discovery preserves excluded knowledge and classification branches', () => {
  const h = harness(); const root = new h.Note('ROOT');
  root.addChild(new h.Note('SOURCE', [check('included-check'), drawing('included-after')]));
  const knowledge = root.addChild(new h.Note('KNOWLEDGE', [check('knowledge-one'), check('knowledge-two')], { knowledge: true }));
  const descendant = knowledge.addChild(new h.Note('KNOWLEDGE-DEEP', [check('deep-one'), check('deep-two')]));
  const classification = root.addChild(new h.Note('CLASSIFICATION', [check('classification-one'), check('classification-two')], { classification: true }));
  const saved = h.captureMethods([root, ...root.descendantNodes.descendant]);
  h.api.runProofMergeWithCheckFolding(root, null, () => h.api.upwardMergeWithStyledComments(root, 'level1'));
  assert.deepEqual(foldedTags(root), ['included-check']);
  assert.equal(knowledge.parentNote, root); assert.equal(descendant.parentNote, knowledge); assert.equal(classification.parentNote, root);
  assert.deepEqual(foldedTags(knowledge), []); assert.deepEqual(foldedTags(descendant), []); assert.deepEqual(foldedTags(classification), []);
  h.assertRestored(saved);
});

for (const fault of ['wrong-excerpt', 'reorder']) {
  test(`unexpected native merge mapping (${fault}) stops all folding and restores methods`, () => {
    const h = harness(); const root = new h.Note('ROOT'); root.mergeFault = fault;
    const sourceNote = root.addChild(new h.Note('SOURCE', [comment('original', 'source'), check('check'), drawing('after')], { excerptText: 'excerpt' }));
    const saved = h.captureMethods([root, sourceNote]);
    assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root)));
    assert.equal(h.nativeCalls.length, 0); assert.deepEqual(foldedTags(root), []); h.assertRestored(saved);
  });
}

test('operation failures propagate without attempting folds and restore all methods', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [check('check')]));
  const saved = h.captureMethods([root, sourceNote]);
  assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => { sourceNote.mergeInto(root); throw new Error('fixture operation failure'); }), /fixture operation failure/);
  assert.equal(h.nativeCalls.length, 0); h.assertRestored(saved);
});

for (const failure of ['revision', 'persisted', 'readback']) {
  test(`native ${failure} failure is rejected and instrumentation is restored`, () => {
    const h = harness(); const root = new h.Note('ROOT'); root.nativeFailure = failure;
    const sourceNote = root.addChild(new h.Note('SOURCE', [check('check'), drawing('after')]));
    const saved = h.captureMethods([root, sourceNote]);
    assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root)));
    assert.equal(root.comments.find(value => value.testTag === 'after').collapsed, false);
    assert.equal(h.nativeCalls.length, 1, 'A failed native batch must never be retried automatically'); h.assertRestored(saved);
  });
}

test('more than 200 targets use bounded batches with the latest revision and retain later handwriting', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const originals = Array.from({ length: 205 }, (_, index) => comment(`original:${index}`, 'same text'));
  const sourceNote = root.addChild(new h.Note('SOURCE', [...originals, check('check'), drawing('after')], { excerptText: 'excerpt' }));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.equal(foldedTags(root).length, 207);
  assert.equal(h.nativeCalls.length, 2);
  assert.equal(h.nativeCalls[0].targets.length, 200);
  assert.equal(h.nativeCalls[1].targets.length, 7);
  assert.equal(root.comments.at(-1).testTag, 'after'); assert.equal(root.comments.at(-1).collapsed, false);
});

test('plain text replacement through raw append preserves source selection and accepts a new comment ID', () => {
  const h = harness(); const root = new h.Note('ROOT');
  h.Note.prototype.replaceWithTextComment = function (text, index) {
    this.removeCommentByIndex(index);
    this.note.comments.push(comment('replacement', text)); this.revision++;
    this.moveComment(this.comments.length - 1, index);
  };
  const sourceNote = root.addChild(new h.Note('SOURCE', [
    comment('before', 'original', { commentId: 'OLD-ID' }), check('check'), drawing('after'),
  ]));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    sourceNote.replaceWithTextComment('updated', 0);
    sourceNote.mergeInto(root);
    root.replaceWithTextComment('updated again', 0);
  });
  assert.deepEqual(foldedTags(root), ['replacement', 'check']);
  assert.equal(root.comments[0].text, 'updated again');
  assert.equal(root.comments.at(-1).collapsed, false);
});

test('legacy link upgrade and broken link removal preserve the original Check selection', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const referenced = new h.Note('REFERENCE'); referenced.noteURL = 'marginnote4app://note/REFERENCE';
  h.Note.prototype.appendNoteLink = function (target) {
    this.note.comments.push(comment('upgraded-link', target.noteURL)); this.revision++;
  };
  h.Note.prototype.convertLinksToNewVersion = function () {
    for (let index = this.comments.length - 1; index >= 0; index--) {
      const value = this.comments[index];
      if (value.type !== 'TextNote' || !value.text.startsWith('marginnote3app://note/')) continue;
      const target = h.Note.new(value.text.slice('marginnote3app://note/'.length));
      this.removeCommentByIndex(index);
      if (target) { this.appendNoteLink(target); this.moveComment(this.comments.length - 1, index); }
    }
  };
  const sourceNote = root.addChild(new h.Note('SOURCE', [
    comment('legacy', 'marginnote3app://note/REFERENCE', { commentId: 'OLD-LEGACY-ID' }),
    comment('broken', 'marginnote3app://note/MISSING'), check('check'), drawing('after'),
  ]));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    sourceNote.convertLinksToNewVersion(); sourceNote.mergeInto(root);
  });
  assert.deepEqual(foldedTags(root), ['upgraded-link', 'check']);
  assert.equal(root.comments[0].text, referenced.noteURL);
  assert.equal(root.comments.at(-1).collapsed, false);
});

test('in-place merged Markdown link cleanup does not invalidate a known source position', () => {
  const h = harness();
  const root = new h.Note('ROOT', [comment('old-merged', '', {
    type: 'LinkNote', noteid: 'OLD-SOURCE', q_htext: 'context [source](marginnote4app://note/SOURCE)',
  })]);
  const sourceNote = root.addChild(new h.Note('SOURCE', [check('check'), drawing('after')]));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    root.comments[0].q_htext = 'context ';
    sourceNote.mergeInto(root);
  });
  assert.deepEqual(foldedTags(root), ['check']);
  assert.equal(root.comments[0].collapsed, false);
});

test('a swallowed observation error still prevents the final fold', () => {
  const h = harness(); const root = new h.Note('ROOT'); root.sortNoop = true;
  const sourceNote = root.addChild(new h.Note('SOURCE', [identifiedDrawing('before'), check('check'), identifiedDrawing('after')]));
  assert.throws(() => h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => {
    sourceNote.mergeInto(root);
    try { root.sortCommentsByNewIndices([2, 1, 0]); } catch (_) { /* MNUtils has catch-and-report paths. */ }
  }), /稳定标识/);
  assert.equal(h.nativeCalls.length, 0);
});

test('no-Check operations do not read an unavailable optional native folding API', () => {
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [comment('plain', 'ordinary content')]));
  let reads = 0;
  root.note.commentState = sourceNote.note.commentState = () => { reads++; throw new Error('Native folding unavailable'); };
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.equal(reads, 0);
  assert.deepEqual(tags(root), ['plain']);
});

test('native NSNull comment IDs are absent IDs and may be allocated by the fold transaction', () => {
  const nativeNull = { toString() { return '[object NSNull]'; } };
  const h = harness(); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [comment('before', 'original'), check('check'), drawing('after')]));
  for (const note of [root, sourceNote]) {
    const read = note.nativeState;
    note.nativeState = function () {
      const state = read.call(this);
      state.comments.forEach(value => { if (!value.commentId) value.commentId = nativeNull; });
      return state;
    };
  }
  const set = root.note.setCommentsCollapsed;
  root.note.setCommentsCollapsed = (targets, collapsed, revision) => {
    const result = set(targets, collapsed, revision);
    targets.forEach(target => { root.comments[target.index - 1].commentId = `NATIVE:${target.index}`; });
    return { ...result, ...root.nativeState() };
  };
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.deepEqual(foldedTags(root), ['before', 'check']);
  assert.equal(root.comments.at(-1).collapsed, false);
});

test('a source-identified empty merge shell is tracked even when no main excerpt exists', () => {
  const h = harness({ alwaysMergedShell: true }); const root = new h.Note('ROOT');
  const sourceNote = root.addChild(new h.Note('SOURCE', [comment('before', 'original'), check('check'), drawing('after')]));
  h.api.runProofMergeWithCheckFolding(root, [sourceNote], () => sourceNote.mergeInto(root));
  assert.deepEqual(foldedTags(root), ['excerpt:SOURCE', 'before', 'check']);
  assert.equal(root.comments.at(-1).collapsed, false);
});

test('native provenance added and rewritten across layers preserves original boundaries and link targets', () => {
  const h = harness({ alwaysMergedShell: true, nativeProvenance: true, freshWrappers: true });
  const root = new h.Note('ROOT');
  const middle = root.addChild(new h.Note('MIDDLE', [comment('middle-before', 'same'), check('middle-check'), drawing('middle-after')]));
  const leaf = middle.addChild(new h.Note('LEAF', [
    comment('leaf-link', '', { type: 'LinkNote', noteid: 'REFERENCE', q_htext: 'linked excerpt' }),
    comment('leaf-before', 'same'), check('leaf-check'), drawing('leaf-after'),
  ]));
  h.api.runProofMergeWithCheckFolding(root, null, () => {
    h.fresh(leaf).mergeInto(h.fresh(middle));
    h.fresh(middle).mergeInto(h.fresh(root));
  });
  assert.deepEqual(foldedTags(root), ['excerpt:MIDDLE', 'middle-before', 'middle-check', 'excerpt:LEAF', 'leaf-link', 'leaf-before', 'leaf-check']);
  assert.equal(root.comments.find(value => value.testTag === 'leaf-before').noteid, 'MIDDLE');
  assert.equal(root.comments.find(value => value.testTag === 'leaf-link').noteid, 'REFERENCE');
  assert.ok(root.comments.filter(value => /after$/.test(value.testTag)).every(value => !value.collapsed));
});

console.log(`proof merge Check folding regression: ${passed} scenarios passed`);
