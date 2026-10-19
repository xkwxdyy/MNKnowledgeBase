const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.join(__dirname, '..');
const utilsSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(addonRoot, 'main.js'), 'utf8');
const resultsSource = fs.readFileSync(path.join(addonRoot, 'scripts/search/app-ui-results.js'), 'utf8');

function loadTemplate() {
  const end = utilsSource.indexOf('\nclass KnowledgeBaseIndexer');
  assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseTemplate boundary');
  const context = vm.createContext({
    console,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Math,
    JSON,
    kbTemplateConfig: {
      types: {},
      knowledgeNoteTypes: [],
      singleHtmlCommentTemplateNoteIds: {},
      keywordTypeMapping: {},
      inlineLinkPhrases: [],
    },
    KnowledgeBaseUtils: { log() {}, addErrorLog() {} },
  });
  vm.runInContext(`${utilsSource.slice(0, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`, context);
  return context.KnowledgeBaseTemplate;
}

function run() {
  const KBT = loadTemplate();
  const expected = [
    '定义', '命题', '例子', '反例', '思想方法',
    '文献综述', '引用点', '结构脉络', '评注', '关键技法',
    '遗留问题', '疑问', '约定记号', '疏漏错误',
  ];
  assert.deepStrictEqual(Array.from(KBT.getReadingClassificationTypes()), expected);
  assert.strictEqual(KBT.getReadingClassificationType('“论文”相关评注'), '评注');
  assert.strictEqual(KBT.getReadingClassificationType('“论文”相关不存在的类型'), '');

  const containCalls = [];
  KBT.getNoteType = note => note && note._type;
  KBT.isClassificationNote = note => !!(note && note._classification);
  KBT.collectClassificationNotesFromField = () => [];
  KBT.upsertClassificationContainInlineLink = (parent, child) => {
    containCalls.push({ parentId: parent.noteId, childId: child.noteId });
    return { updated: true };
  };
  const readingA = { noteId: 'A', _type: '归类', _classification: true };
  const nestedC = { noteId: 'C', _type: '归类', _classification: true, parentNote: readingA };
  const syncResult = KBT.syncClassificationContainInlineLinksForNote(nestedC, readingA);
  assert.strictEqual(syncResult.updated, 1);
  assert.deepStrictEqual(containCalls, [{ parentId: 'A', childId: 'C' }]);

  assert.match(mainSource, /collectLiteratureReadingIndexPlan/);
  assert.match(mainSource, /mode: 'regular', shouldIndex: true/);
  assert.match(mainSource, /forcedIntermediate: true/);
  assert.match(mainSource, /debug\.entryPlans = collected\.entryPlans/);
  assert.match(mainSource, /skipNoteTypes: \[\]/);
  assert.match(mainSource, /progressNotification: false/);
  assert.match(utilsSource, /if \(progressNotificationEnabled\) \{/);
  assert.match(utilsSource, /options\.progressNotification !== false/);

  assert.match(mainSource, /const isCompleteKnowledge = KnowledgeBaseTemplate\.getKnowledgePointCompletionState\(note\)\.complete/);
  assert.match(mainSource, /const isCompleteClassification = KnowledgeBaseTemplate\.isClassificationNote\(note\) &&/);
  assert.match(utilsSource, /entry\.type = forcedType/);
  assert.doesNotMatch(utilsSource, /reason: "readingClassificationOneWay"/);
  assert.match(utilsSource, /const parentIsReadingClassification = this\.isReadingClassificationNote\(actualParentNote, cache\)/);
  assert.match(utilsSource, /this\.upsertNoteNativeLinkInField\(actualParentNote, note, "包含"\)/);
  assert.match(utilsSource, /this\.isReadingClassificationNote\(primaryNote\)\s*\?\s*this\.upsertNoteNativeLinkInField\(primaryNote, note, "包含"\)/);
  assert.doesNotMatch(utilsSource, /suppressReadingClassificationChildBacklink/);
  assert.match(utilsSource, /noteType === "归类"\s*\?/);
  assert.match(resultsSource, /stateBadge\.textContent = '中间卡片'/);

  console.log('literature-reading-index-state-regression: ok');
}

run();
