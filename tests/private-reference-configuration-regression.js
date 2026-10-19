const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../utils.js'), 'utf8');
assert(!/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(source), 'public runtime must not contain private notebook identifiers');
const corpus = fs.readFileSync(path.join(__dirname, '../resources/search/math-term-corpus.runtime.json'), 'utf8');
assert(!/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(corpus), 'public terminology must omit private source note IDs');
assert(JSON.parse(corpus).concepts.every(concept => concept.senses.every(sense => sense.sourceNoteIds.length === 0)));
for (const name of ['main.js', 'title-refactor-workbench.html', 'scripts/comment-manager/data-native.js']) {
  const text = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  assert(!/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(text), name + ': runtime defaults must not contain notebook UUIDs');
}
const store = new Map();
const writes = [];
const messages = [];
const nativeCalls = [];
const context = {
  console, Map, Set, WeakMap, Array, Object, String, Number, Boolean, RegExp, Date, Math, Promise,
  KnowledgeBaseConfig: { config: {} },
  MNUtil: { showHUD(message) { messages.push(message); } },
  MNNote: { new(id) { nativeCalls.push(id); throw new Error('unexpected native lookup'); }, clone(id) { nativeCalls.push(id); throw new Error('unexpected native clone'); } },
  NSUserDefaults: { standardUserDefaults() { return { objectForKey(key) { return store.get(key); }, setObjectForKey(value, key) { writes.push(key); store.set(key, value); } }; } },
  KnowledgeBaseUtils: { emitRuntimeLog() {}, addErrorLog(error) { throw error; } },
};
vm.createContext(context);
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
vm.runInContext(source.slice(0, end) + '\nthis.Template = KnowledgeBaseTemplate;', context);
const Template = context.Template;
const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const rootStart = mainSource.indexOf('  const ROOT_NOTE_IDS = {');
const rootEnd = mainSource.indexOf('\n  }', rootStart) + 4;
vm.runInContext(mainSource.slice(rootStart, rootEnd) + ';this.Roots = ROOT_NOTE_IDS;', context);
assert.equal(context.Roots.preExcerpt, '');
assert.equal(context.Roots.supplementaryKnowledgeBase, '');
assert.equal(Template.types.定义.templateNoteId, '');
assert.equal(Template.singleHtmlCommentTemplateNoteIds.证明, '');
assert.equal(Template.searchBoardId, '');
assert.deepEqual(JSON.parse(JSON.stringify(Template.getLastUsedRootIds())), []);
assert.equal(Template.showSearchBoard(), null);
assert.throws(() => Template.createClassificationNoteAsChildNote({}, 'test', 'type', false), /配置/);
assert.equal(nativeCalls.length, 0, 'unset references must never select an implicit native note');
assert.equal(writes.length, 0, 'loading missing configuration must not overwrite saved state');
const saved = { roots: { selected: { id: 'fixture-root', name: 'Saved root' } }, rootsOrder: ['selected'], lastUsedRoot: 'selected', lastModified: 1 };
store.set('KnowledgeBaseTemplate_SearchConfig', JSON.stringify(saved));
Template.searchRootConfigs = null;
assert.equal(Template.getCurrentSearchRoot(), 'fixture-root');
assert.equal(Template.searchRootConfigs.roots.selected.name, 'Saved root');
Template.saveSearchConfig();
assert.equal(writes.at(-1), 'KnowledgeBaseTemplate_SearchConfig', 'saving root selection must not overwrite search-mode settings');
Template.saveSearchConfig({ mode: 'exact' });
assert.equal(writes.at(-1), 'KnowledgeBaseTemplate_SearchModeConfig');
context.KnowledgeBaseConfig.config.referenceNoteIds = {
  templates: { '定义': 'fixture-definition', '归类': 'fixture-classification' },
  htmlCommentTemplates: { '证明': 'fixture-proof' },
  searchBoardId: 'fixture-board',
  roots: { preExcerpt: 'fixture-pre-excerpt', supplementaryKnowledgeBase: 'fixture-supplementary' },
};
assert.equal(context.Roots.preExcerpt, 'fixture-pre-excerpt');
assert.equal(context.Roots.supplementaryKnowledgeBase, 'fixture-supplementary');
assert.equal(Template.types.定义.templateNoteId, 'fixture-definition');
assert.equal(Template.singleHtmlCommentTemplateNoteIds.证明, 'fixture-proof');
assert.equal(Template.searchBoardId, 'fixture-board');
let removals = 0;
Template.parseNoteComments = () => ({ htmlCommentsObjArr: [{ index: 0, text: '关键词' }] });
Template.getSafeComments = () => [{ text: '关键词：' }];
Template.getSafeCommentText = comment => comment.text;
Template.processEmptyKeywordField({ removeCommentByIndex() { removals += 1; } });
assert.equal(removals, 0, 'missing keyword template must preserve the existing comment');
assert.equal(nativeCalls.length, 0);
assert(messages.some(message => /模板/.test(message)));
assert(messages.some(message => /根目录/.test(message)));
console.log('private reference defaults, persisted settings and mutation guards: ok');
