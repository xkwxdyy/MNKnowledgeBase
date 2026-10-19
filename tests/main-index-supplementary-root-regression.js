const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const supplementaryRootUrl = 'marginnote4app://note/00000000-0000-4000-8000-000000000001';

function extractPrototypeFunction(name, nextName) {
  const assignment = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = source.indexOf(assignment);
  const end = source.indexOf(`\n\n  MNKnowledgeBaseClass.prototype.${nextName}`, start);
  assert.ok(start !== -1 && end > start, `Cannot locate ${name}`);
  return source.slice(start + assignment.length, end).trim();
}

function normalizeNoteId(noteIdOrUrl) {
  return String(noteIdOrUrl || '').replace(/^.*\/note\//i, '').toUpperCase();
}

function run() {
  assert.ok(source.includes("get supplementaryKnowledgeBase() { return KnowledgeBaseTemplate.getConfiguredReference('roots', 'supplementaryKnowledgeBase'); }"), 'supplementary root must use explicit configuration');
  assert.match(
    utilsSource,
    /buildSearchIndex\(rootNotes, targetTypes = \["定义", "命题", "例子", "反例", "归类", "思想方法", "问题"\], mode = "light", options = \{\}\)/,
    'main indexer must accept a source-aware inclusion predicate',
  );
  assert.match(
    utilsSource,
    /shouldIndexNote\(mnNote, \{ rootNote, isRoot: false \}\)/,
    'the inclusion predicate must run for each descendant',
  );
  const descendantLoopStart = utilsSource.indexOf('for (let i = 0; i < descendants.length; i++)', utilsSource.indexOf('class KnowledgeBaseIndexer'));
  const descendantLoopEnd = utilsSource.indexOf('// 释放 descendants 引用', descendantLoopStart);
  assert.ok(descendantLoopStart !== -1 && descendantLoopEnd > descendantLoopStart, 'main-index descendant loop must exist');
  const descendantLoop = utilsSource.slice(descendantLoopStart, descendantLoopEnd);
  assert.ok(
    descendantLoop.indexOf('shouldIndexNote(mnNote') < descendantLoop.indexOf('KnowledgeBaseTemplate.getNoteType(mnNote)'),
    'supplementary-root filtering must run before general note-type inference',
  );
  assert.doesNotMatch(
    descendantLoop,
    /continue;/,
    'duplicate, invalid, and filtered descendants must share the progress checkpoint path',
  );
  assert.match(
    descendantLoop,
    /await this\.yieldMainIndexProgress\(/,
    'every descendant scan path must cooperatively yield to MarginNote UI work',
  );
  assert.match(
    utilsSource,
    /static async yieldMainIndexProgress[\s\S]*processedCount % 100[\s\S]*await MNUtil\.delay\(0\.001\)/,
    'main-index progress checkpoints must yield at a bounded interval',
  );

  const rootIds = {
    defaultKnowledgeBase: 'marginnote4app://note/DEFAULT',
    supplementaryKnowledgeBase: supplementaryRootUrl,
  };
  const notes = {
    DEFAULT: { noteId: 'DEFAULT' },
    '00000000-0000-4000-8000-000000000001': { noteId: '00000000-0000-4000-8000-000000000001' },
    FALLBACK: { noteId: 'FALLBACK' },
  };
  const context = {
    ROOT_NOTE_IDS: rootIds,
    Set,
    KnowledgeBaseTemplate: {
      normalizeNoteIdForCompare: normalizeNoteId,
      isClassificationNote(note) { return !!note.classification; },
      isKnowledgeNote(note) { return !!note.knowledge; },
    },
    resolveAvailableNote(noteOrId) {
      const id = normalizeNoteId(noteOrId && noteOrId.noteId ? noteOrId.noteId : noteOrId);
      return notes[id] || null;
    },
  };

  const getRoots = vm.runInNewContext(
    `(${extractPrototypeFunction('getMainKnowledgeBaseIndexRoots', 'shouldIndexMainKnowledgeBaseNote')})`,
    context,
  );
  const shouldIndex = vm.runInNewContext(
    `(${extractPrototypeFunction('shouldIndexMainKnowledgeBaseNote', 'getResearchProcessRootNotes')})`,
    context,
  );

  assert.deepStrictEqual(
    Array.from(getRoots(notes.FALLBACK), note => note.noteId),
    ['DEFAULT', '00000000-0000-4000-8000-000000000001'],
    'main index must include the default and supplementary roots',
  );

  const supplementaryRoot = notes['00000000-0000-4000-8000-000000000001'];
  assert.strictEqual(shouldIndex({ classification: true }, { rootNote: supplementaryRoot, isRoot: true }), false);
  assert.strictEqual(shouldIndex({ classification: true }, { rootNote: supplementaryRoot, isRoot: false }), true);
  assert.strictEqual(shouldIndex({ knowledge: true }, { rootNote: supplementaryRoot, isRoot: false }), true);
  assert.strictEqual(shouldIndex({}, { rootNote: supplementaryRoot, isRoot: false }), false);
  assert.strictEqual(shouldIndex({}, { rootNote: notes.DEFAULT, isRoot: false }), true);

  console.log('main index supplementary root regression ok');
}

run();
