const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractPrototypeFunction(name, nextName) {
  const marker = `MNKnowledgeBaseClass.prototype.${name} = `;
  const start = mainSource.indexOf(marker);
  const end = mainSource.indexOf(`\n\n  MNKnowledgeBaseClass.prototype.${nextName}`, start);
  assert.ok(start !== -1 && end > start, `Cannot locate ${name}`);
  return mainSource.slice(start + marker.length, end).trim();
}

function mergeCardsById(baseCards = [], extraCards = []) {
  const cards = new Map();
  [...baseCards, ...extraCards].forEach((card) => {
    if (card && card.id) cards.set(String(card.id), card);
  });
  return Array.from(cards.values());
}

function assertMenuStructure() {
  const quickMenu = extractPrototypeFunction('getQuickAccessMenuItems', 'getAutomationMenuItems');
  const maintenanceMenu = extractPrototypeFunction('openMaintenanceMenu', 'getSelectedNotes');
  const mainIndexPosition = quickMenu.indexOf('索引主知识库');
  const literatureIndexPosition = quickMenu.indexOf('索引文献归类知识库');

  assert.ok(mainIndexPosition >= 0, 'the main index command must remain in quick access');
  assert.ok(
    literatureIndexPosition > mainIndexPosition,
    'the literature index command must be at the same level immediately after the main index command',
  );
  assert.match(
    quickMenu,
    /导出实际搜索索引 JSON[^\n]+exportActualSearchIndex:/,
    'quick access must export the dataset actually used by search',
  );
  assert.doesNotMatch(
    maintenanceMenu,
    /索引文献归类知识库/,
    'the maintenance submenu must not duplicate the promoted literature index command',
  );
  assert.match(
    maintenanceMenu,
    /导出主索引 JSON[^\n]+shareIndexFile:/,
    'the old main-only export must remain available as a clearly named maintenance action',
  );
  assert.match(
    mainSource,
    /exportActualSearchIndex: function\(\)[\s\S]*?MNKnowledgeBaseClass\.prototype\.exportActualSearchIndexInternal\.call\(self\)/,
    'the selector-bound lifecycle method must delegate to prototype logic',
  );
}

function assertActualDatasetMerge() {
  const buildExport = vm.runInNewContext(
    `(${extractPrototypeFunction('buildActualSearchIndexExportData', 'exportActualSearchIndexInternal')})`,
    { Set, String, Array, Math, Date, Error },
  );
  const instance = {
    loadMainKnowledgeBaseCards() {
      return {
        actualMode: 'light',
        metadata: { mode: 'light' },
        cards: [
          { id: 'A', indexSource: 'main' },
          { id: 'B', indexSource: 'main' },
          { id: '', indexSource: 'main' },
        ],
      };
    },
    loadIntermediateKnowledgeBaseCards() {
      return [
        { id: 'B', indexSource: 'intermediate' },
        { id: 'C', indexSource: 'intermediate' },
        { id: 'C', indexSource: 'intermediate' },
      ];
    },
    loadLiteratureClassificationKnowledgeBaseCards() {
      return [
        { id: 'C', indexSource: 'literature-classification' },
        { id: 'D', indexSource: 'literature-classification' },
      ];
    },
    loadHistoryCardKnowledgeBaseCards() {
      return [
        { id: 'E', indexSource: 'history-card' },
        { id: 'REMOVED', indexSource: 'history-card' },
      ];
    },
    mergeCardsById,
    getWebViewKnownRemovedSearchIds() {
      return ['REMOVED'];
    },
    filterKnownRemovedSearchCards(cards, removedIds) {
      const removed = new Set(removedIds);
      return {
        cards: cards.filter(card => card.id && !removed.has(card.id)),
        removedIds: cards.filter(card => removed.has(card.id)).map(card => card.id),
      };
    },
    normalizeSearchIndexSource(source) {
      return source || '';
    },
    buildWebViewSearchDataCacheKey() {
      return 'source-signature';
    },
    getActualSearchIndexSourceRevisions() {
      return { main: { base: { mode: 'light' } } };
    },
  };

  const exported = buildExport.call(instance);
  assert.strictEqual(exported.metadata.exportSchema, 'mnkb.actual-search-index.v1');
  assert.strictEqual(exported.metadata.mode, 'light');
  assert.strictEqual(exported.metadata.sourceSignature, 'source-signature');
  assert.deepStrictEqual(
    Array.from(exported.metadata.mergeOrder),
    ['main', 'intermediate', 'literature-classification', 'history-card'],
  );
  assert.deepStrictEqual(
    Array.from(exported.searchData, card => `${card.id}:${card.indexSource}`),
    [
      'A:main',
      'B:intermediate',
      'C:literature-classification',
      'D:literature-classification',
      'E:history-card',
    ],
    'later runtime sources must replace duplicate IDs while preserving indexSource',
  );
  assert.strictEqual(exported.metadata.totalCards, 5);
  assert.strictEqual(exported.metadata.filteredKnownRemovedCount, 1);
  assert.strictEqual(exported.metadata.sourceStats.main.finalCards, 1);
  assert.strictEqual(exported.metadata.sourceStats.intermediate.replacedExistingIds, 1);
  assert.strictEqual(exported.metadata.sourceStats.intermediate.duplicateIdsWithinSource, 1);
  assert.strictEqual(exported.metadata.sourceStats['literature-classification'].finalCards, 2);
  assert.strictEqual(exported.metadata.sourceStats['history-card'].finalCards, 1);
}

function assertExportAction() {
  const exportAction = vm.runInNewContext(
    `(${extractPrototypeFunction('exportActualSearchIndexInternal', 'pushSearchIndexToWebView')})`,
    {
      Date,
      String,
      MNUtil: {
        tempPath: '/tmp/mnkb-export-test',
        tempFolder: '',
        dbFolder: '/unused',
        showHUD() {},
        writeJSON(filepath, data) {
          this.written = { filepath, data };
        },
        saveFile(filepath, type) {
          this.saved = { filepath, type };
        },
      },
    },
  );
  const payload = {
    metadata: {
      sourceStats: {
        main: { finalCards: 1 },
        intermediate: { finalCards: 1 },
        'literature-classification': { finalCards: 1 },
        'history-card': { finalCards: 1 },
      },
    },
    searchData: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
  };
  const instance = {
    checkPopover() {},
    buildActualSearchIndexExportData() {
      return payload;
    },
  };

  const result = exportAction.call(instance);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.totalCards, 4);
  assert.match(result.filepath, /kb-search-index-actual-merged-.*\.json$/);
}

assertMenuStructure();
assertActualDatasetMerge();
assertExportAction();
console.log('actual search index export and menu regression ok');
