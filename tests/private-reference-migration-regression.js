'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../utils.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const build = require('../build/build.js');
const types = ['定义','命题','例子','反例','归类','思想方法','问题','思路','作者','研究进展','论文','书作','文献','总结'];
const rootNames = ['preExcerpt','classInput','readingAuto','defaultKnowledgeBase','supplementaryKnowledgeBase','researchProcess','historyArchive','literaturePaperLibrary','literatureBookLibrary'];
const references = {
  templates: Object.fromEntries(types.map(name => [name, 'template-' + name])),
  htmlCommentTemplates: Object.fromEntries(['证明','原理','反例'].map(name => [name, 'field-' + name])),
  roots: Object.fromEntries(rootNames.map(name => [name, 'root-' + name])),
  keywordTemplateNoteId: 'keyword', simpleClassificationTemplateNoteId: 'simple',
  relatedLinksTemplateNoteId: 'related', searchBoardId: 'board',
  rootScopes: { researchProcessRootIds: ['research'], literatureClassificationRootIds: ['paper','book'], circularScanRootIds: ['circular-a','circular-b'] },
};
function runtime(config = {}) {
  const local = new Map(), cloud = new Map(), writes = [];
  const context = vm.createContext({
    KnowledgeBaseUtils: { emitRuntimeLog() {}, addErrorLog(error) { throw error; } },
    MNUtil: { showHUD() {} }, toolbarConfig: { iCloudSync: true },
    NSUserDefaults: { standardUserDefaults: () => ({ objectForKey: key => local.get(key), setObjectForKey(value,key) { writes.push(key); local.set(key,value); } }) },
    NSUbiquitousKeyValueStore: { defaultStore: () => ({ objectForKey: key => cloud.get(key) }) },
  });
  const configured = source.replace('const kbBundledReferenceNoteIds = {};', 'const kbBundledReferenceNoteIds = ' + JSON.stringify(references) + ';');
  const configStart = source.indexOf('class KnowledgeBaseConfig');
  const configEnd = source.indexOf('\nclass ProofMergeCheckFoldSession', configStart);
  vm.runInContext(configured.slice(0, configured.indexOf('\nclass KnowledgeBaseIndexer')) + '\n' + source.slice(configStart, configEnd) + '\nthis.T=KnowledgeBaseTemplate;this.C=KnowledgeBaseConfig;', context);
  context.C.config = config;
  context.C.save = () => writes.push('config-save');
  const start = main.indexOf('  const ROOT_NOTE_IDS = {'), end = main.indexOf('\n  }', start) + 4;
  vm.runInContext(main.slice(start,end) + ';this.roots=ROOT_NOTE_IDS;', context);
  return { ...context, local, cloud, writes };
}
const r = runtime();
// Native database lookups take note IDs; legacy profiles also contain note URLs.
r.MNUtil.getNoteById = id => id === 'fixture-template' ? { noteId: id } : null;
assert.equal(r.T.requireMakeCardTemplate('marginnote4app://note/fixture-template').noteId, 'fixture-template');
assert.equal(r.T.requireMakeCardTemplate('fixture-template').noteId, 'fixture-template');
for (const name of types) assert.equal(r.T.types[name].templateNoteId, references.templates[name]);
for (const name of rootNames) assert.equal(r.roots[name], references.roots[name]);
for (const name of Object.keys(references.htmlCommentTemplates)) assert.equal(r.T.singleHtmlCommentTemplateNoteIds[name], references.htmlCommentTemplates[name]);
for (const key of ['keywordTemplateNoteId','simpleClassificationTemplateNoteId','relatedLinksTemplateNoteId','searchBoardId']) assert.equal(r.T.getConfiguredReference(key), references[key]);
assert.equal(r.T.getCurrentSearchRoot(), references.roots.defaultKnowledgeBase);
assert.equal(r.writes.length, 0, 'loading roots must not overwrite storage');
for (const [key,ids] of Object.entries(references.rootScopes)) assert.equal(JSON.stringify(r.C.defaultConfig[key]),JSON.stringify(ids));
r.C.config = { researchProcessRootIds: [], literatureClassificationRootIds: ['custom-literature'], circularScanRootIds: [], prefixMode: true };
r.C.migrateResearchProcessIndexConfig();
assert.equal(JSON.stringify(r.C.config.researchProcessRootIds),'["research"]');
assert.equal(JSON.stringify(r.C.config.circularScanRootIds),'["circular-a","circular-b"]');
assert.equal(JSON.stringify(r.C.config.literatureClassificationRootIds),'["custom-literature"]');
assert.equal(r.C.config.prefixMode,true);
r.C.config.circularScanRootIds = []; r.C.config.researchProcessRootIds = [];
r.C.migrateResearchProcessIndexConfig();
assert.equal(JSON.stringify(r.C.config.circularScanRootIds),'[]','subsequent explicit empty scope must survive');
assert.equal(JSON.stringify(r.C.config.researchProcessRootIds),'[]');
const key = 'KnowledgeBaseTemplate_SearchConfig';
const saved = { roots: { selected: { id: 'custom-root', name: 'Custom' } }, rootsOrder: ['selected'], lastUsedRoot: 'selected', lastModified: 7, ignorePrefix: true };
const cloudSaved = { ...saved, roots: { selected: { id: 'cloud-root' } }, lastModified: 8 };
function read(local,cloud) { r.local.set(key,local); r.cloud.set(key,cloud);r.T.searchRootConfigs=null;return r.T.loadSearchConfig(); }
assert.equal(read(JSON.stringify(saved),'{corrupt').roots.selected.id,'custom-root');
assert.equal(read('{corrupt',JSON.stringify(cloudSaved)).roots.selected.id,'cloud-root');
assert.equal(read(JSON.stringify(saved),JSON.stringify(cloudSaved)).roots.selected.id,'cloud-root');
assert.equal(read('{corrupt','{corrupt').roots.default.id,references.roots.defaultKnowledgeBase);
const restored = read(JSON.stringify({roots:{},rootsOrder:[],lastUsedRoot:'',ignorePrefix:true}),undefined);
assert.equal(restored.roots.default.id,references.roots.defaultKnowledgeBase);
assert.equal(restored.ignorePrefix,true);
assert.equal(r.local.get(key).includes('"roots":{}'),true,'recovery must not rewrite the original saved evidence');
const originalCorpus = JSON.parse(fs.readFileSync(path.join(__dirname,'../resources/search/math-term-corpus.runtime.json'),'utf8'));
const sense = originalCorpus.concepts[0].senses[0];
const profile = { ...references, mathTermSourceNoteIds: { [sense.id]: ['fixture-origin'] } };
const json = JSON.parse(build.runtimeContent('resources/search/math-term-corpus.runtime.json',profile));
const scriptContext = vm.createContext({});
vm.runInContext(build.runtimeContent('resources/search/math-term-corpus.runtime.js',profile).toString(),scriptContext);
assert.equal(JSON.stringify(scriptContext.__MNKB_MATH_TERM_CORPUS__),JSON.stringify(json));
assert.equal(json.concepts[0].senses[0].sourceNoteIds[0],'fixture-origin');
assert(!build.runtimeContent('utils.js',profile).includes(Buffer.from('fixture-origin')),'term bindings must not be duplicated in native runtime');
assert.throws(() => build.runtimeContent('resources/search/math-term-corpus.runtime.js',{mathTermSourceNoteIds:{unknown:['fixture']}}),/no longer match/);
assert.equal(originalCorpus.concepts[0].senses[0].sourceNoteIds.length,0,'public source stays unbound');
console.log('All reference consumers, scope upgrade, local/cloud recovery and personal terminology packaging passed');
