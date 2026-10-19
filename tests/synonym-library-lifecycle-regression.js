const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
const bundledPath = path.join(root, 'resources', 'search', 'mnkb-synonym-library.json');
const bundledPayload = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
const buildSource = fs.readFileSync(path.join(root, 'build/payload.json'), 'utf8');
const mathCore = require(path.join(root, 'scripts', 'search', 'math-term-search-core.js'));
assert.strictEqual(bundledPayload.groups.length, 124, 'legacy synonym groups must be migrated into the local library');

const classStart = utilsSource.indexOf('class SynonymManager');
const classEnd = utilsSource.indexOf('// 排除词管理器', classStart);
assert.ok(classStart >= 0 && classEnd > classStart, 'SynonymManager source must be present');

const files = new Map();
const logs = [];
const context = {
  console,
  String,
  Number,
  Set,
  Array,
  Math,
  KnowledgeBaseConfig: { mainPath: '/addon' },
  MNUtil: {
    dbFolder: '/db',
    isfileExists(filePath) {
      return files.has(filePath);
    },
    readJSON(filePath) {
      return files.get(filePath) || null;
    },
    writeJSON(filePath, payload) {
      files.set(filePath, payload);
    },
  },
  KnowledgeBaseUtils: {
    emitRuntimeLog(level, payload) {
      logs.push({ level, payload });
    },
  },
  KnowledgeBaseTemplate: {
    generatePatternVariants(keyword, group) {
      const output = [];
      group.words.forEach((pattern) => {
        if (!pattern.includes('{{}}')) return;
        const expression = pattern.split('{{}}').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)');
        const match = String(keyword).match(new RegExp(`^${expression}$`, 'i'));
        if (!match) return;
        group.words.forEach((target) => {
          if (target === pattern) return;
          let index = 1;
          output.push(target.replace(/\{\{\}\}/g, () => match[index++] || ''));
        });
      });
      return output;
    },
  },
  kbSearchConfig: {
    synonymGroups: [
      { id: 'builtin-only', words: ['内置词', 'builtin'] },
      { id: 'override-me', words: ['旧词', 'old'] },
    ],
  },
};
vm.createContext(context);
vm.runInContext(`${utilsSource.slice(classStart, classEnd)}\nthis.SynonymManager = SynonymManager;`, context);
const manager = context.SynonymManager;

const bundledFilePath = '/addon/resources/search/mnkb-synonym-library.json';
const userFilePath = '/db/data/mnkb-synonym-library.json';
files.set(bundledFilePath, bundledPayload);
files.set(userFilePath, {
  $schema: 'mnkb.synonym-library.v1',
  version: 1,
  revision: 7,
  groups: [
    { id: 'override-me', words: ['新词', 'new'] },
    {
      id: 'context-sot',
      words: ['SOT', '强算子收敛'],
      contextTriggers: ['收敛'],
    },
    { id: 'disabled', words: ['不应', '出现'], enabled: false },
  ],
});

const loaded = manager.reloadLibrary();
assert.ok(loaded.groups.some((group) => group.id === 'builtin-only'));
assert.strictEqual(loaded.groups.find((group) => group.id === 'override-me').words[0], '新词');
const closedSubset = loaded.groups.find((group) => group.words.join('|') === '闭集|闭子集');
assert.deepStrictEqual(closedSubset.contextTriggers, ['子集']);
assert.ok(manager.getSynonymRevision().includes('user-7'));
assert.ok(manager.expandKeyword('1').includes('一'), 'legacy fixed numeric synonyms must be in the local library');
assert.ok(manager.expandKeyword('凸开集').includes('开凸集'), 'legacy pattern synonyms must remain query-expandable');
assert.ok(mathCore.augmentQueryWithSynonyms('凸开集', [
  { words: ['凸{{}}集', '{{}}凸集'], patternMode: true },
]).includes('开凸集'));

assert.deepStrictEqual(manager.expandKeyword('SOT', true), ['SOT']);
const sotExpansion = manager.expandKeyword('SOT', true, { context: 'SOT 收敛' });
assert.ok(sotExpansion.includes('SOT'));
assert.ok(sotExpansion.includes('强算子收敛'));
assert.ok(sotExpansion.includes('strong operator convergence'));
assert.ok(
  manager.expandKeyword('SOT 收敛', true, { context: 'SOT 收敛' }).includes('强算子收敛'),
  'multi-word aliases must expand when the full alias is used as a query term',
);
assert.ok(!manager.expandKeyword('新词', false).includes('新词'));
assert.deepStrictEqual(manager.expandKeyword('不应', true), ['不应']);

assert.strictEqual(manager.normalizeLibraryPayload({ $schema: 'wrong', version: 1, groups: [{ words: ['a', 'b'] }] }).groups.length, 0);
assert.strictEqual(manager.normalizeLibraryPayload({ $schema: 'mnkb.synonym-library.v1', version: 2, groups: [{ words: ['a', 'b'] }] }).groups.length, 0);
assert.strictEqual(logs.length, 0, 'valid local files should not emit load warnings');
assert.match(buildSource, /resources\/search\/mnkb-synonym-library\.json/);

console.log('synonym-library-lifecycle-regression: ok');
