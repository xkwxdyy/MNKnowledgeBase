'use strict';

const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');

const indexedNoteIds = [];
const context = {
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
  Pangu: {
    spacing(text) {
      return String(text || '');
    },
  },
  MNUtil: {
    log() {},
    showHUD() {},
  },
  KnowledgeBaseUtils: {
    log() {},
    addErrorLog(error) {
      throw error;
    },
  },
  KnowledgeBaseIndexer: {
    addToIncrementalIndex(note) {
      indexedNoteIds.push(note.noteId);
    },
    cleanHighlightMarkers(text) {
      return String(text || '');
    },
  },
  HtmlMarkdownUtils: {
    isHtmlMDComment() {
      return false;
    },
  },
};
context.global = context;
vm.createContext(context);
vm.runInContext(`${source.slice(0, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`, context);

const KBT = context.KnowledgeBaseTemplate;
const notesById = new Map();
let nextId = 1;

class FakeNote {
  constructor(title, type) {
    this.noteId = `QUESTION-CHAIN-${nextId++}`;
    this.title = title;
    this.noteTitle = title;
    this._type = type;
    this.noteURL = `marginnote4app://note/${this.noteId}`;
    this.comments = [];
    this.parentNote = null;
    this.childNotes = [];
    notesById.set(this.noteId.toUpperCase(), this);
  }

  get MNComments() {
    return this.comments;
  }

  addChild(child) {
    child.parentNote = this;
    this.childNotes.push(child);
  }

  appendNoteLink(note) {
    this.comments.push({ type: 'linkComment', text: note.noteURL });
  }

  appendMarkdownComment(text) {
    this.comments.push({ type: 'markdownComment', text });
  }

  replaceWithMarkdownComment(text, index) {
    this.comments[index] = { type: 'markdownComment', text };
  }

  removeCommentsByIndexArr(indices) {
    Array.from(new Set(indices)).sort((a, b) => b - a).forEach(index => {
      this.comments.splice(index, 1);
    });
  }

  removeCommentByIndex(index) {
    this.comments.splice(index, 1);
  }

  moveCommentsByIndexArr(indices, targetIndex) {
    const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
    const moving = unique.map(index => this.comments[index]).filter(Boolean);
    unique.slice().reverse().forEach(index => this.comments.splice(index, 1));
    const beforeTarget = unique.filter(index => index < targetIndex).length;
    const adjustedTarget = Math.max(0, Math.min(this.comments.length, targetIndex - beforeTarget));
    this.comments.splice(adjustedTarget, 0, ...moving);
  }
}

context.MNNote = {
  new(noteIdOrUrl) {
    const noteId = KBT.extractNoteIdFromLinkUrl(String(noteIdOrUrl || '')) || String(noteIdOrUrl || '');
    return notesById.get(noteId.toUpperCase()) || null;
  },
};

KBT.getNoteType = note => note && note._type;
KBT.isNSNullLike = value => value === null || typeof value === 'undefined';
KBT.noteTypeCache = new Map();
KBT.classificationParentCache = new Map();
KBT.moveCommentsArrToField = function(note, indexArr, fieldName, toBottom = true) {
  const fieldObj = this.findFieldObjectByNormalizedName(note, fieldName);
  assert(fieldObj, `missing field ${fieldName}`);
  const indices = Array.isArray(indexArr)
    ? indexArr
    : String(indexArr).split(',').map(value => {
      const token = value.trim();
      if (token === 'Z') return note.comments.length - 1;
      return Number(token);
    }).filter(Number.isFinite);
  const targetIndex = toBottom
    ? (fieldObj.excludingFieldBlockIndexArr[fieldObj.excludingFieldBlockIndexArr.length - 1] ?? fieldObj.index) + 1
    : fieldObj.index + 1;
  note.moveCommentsByIndexArr(indices, targetIndex);
};

function addField(note, fieldName) {
  note.comments.push({ type: 'HtmlComment', text: fieldName });
}

function addNative(note, target) {
  note.appendNoteLink(target);
}

function addMarkdown(note, label, target) {
  note.appendMarkdownComment(`- [${label}](${target.noteURL})`);
}

function fieldComments(note, fieldName) {
  const field = KBT.findFieldObjectByNormalizedName(note, fieldName);
  assert(field, `missing field ${fieldName}`);
  return field.excludingFieldBlockIndexArr.map(index => note.comments[index]);
}

function linkIdsInField(note, fieldName) {
  const ids = [];
  fieldComments(note, fieldName).forEach(comment => {
    if (comment.type === 'linkComment') {
      ids.push(KBT.normalizeNoteIdForCompare(comment.text));
      return;
    }
    if (comment.type === 'markdownComment') {
      KBT.parseMarkdownMarginNoteLinksFromText(comment.text).forEach(link => {
        ids.push(KBT.normalizeNoteIdForCompare(link.noteId));
      });
    }
  });
  return ids;
}

function countLinksTo(note, fieldName, target) {
  const targetId = KBT.normalizeNoteIdForCompare(target.noteId);
  return linkIdsInField(note, fieldName).filter(noteId => noteId === targetId).length;
}

function addFormalFields(note) {
  addField(note, '相关思考');
  addField(note, '相关链接');
}

const classification = new FakeNote('“算子谱论”相关归类', '归类');
addField(classification, '包含');
const problem = new FakeNote('【问题 >> 紧算子】紧性可以弱化到什么程度？', '问题');
addFormalFields(problem);
const idea = new FakeNote('【思路 >> 旧问题】测试紧扰动条件', '思路');
addFormalFields(idea);
const counterexample = new FakeNote('【反例 >> 旧问题】单侧移位算子', '反例');
addFormalFields(counterexample);
const summary = new FakeNote('【总结 >> 旧问题】当前阶段小结', '总结');
addFormalFields(summary);
const otherBranch = new FakeNote('【思路 >> 旁支旧前缀】研究 Riesz 算子', '思路');
addFormalFields(otherBranch);
const nestedClassification = new FakeNote('“Riesz 算子”相关归类', '归类');
addField(nestedClassification, '所属');
addField(nestedClassification, '包含');
const nestedExample = new FakeNote('【例子 >> 旧前缀】幂紧算子', '例子');
addFormalFields(nestedExample);
const nestedProblem = new FakeNote('【问题 >> 本质谱】不同定义是否等价？', '问题');
addFormalFields(nestedProblem);
const nestedIdea = new FakeNote('【思路 >> 嵌套旧前缀】比较定义', '思路');
addFormalFields(nestedIdea);
const manualRelated = new FakeNote('手动相关卡', '命题');
addFormalFields(manualRelated);

classification.addChild(problem);
problem.addChild(idea);
idea.addChild(counterexample);
counterexample.addChild(summary);
problem.addChild(otherBranch);
otherBranch.addChild(nestedClassification);
nestedClassification.addChild(nestedExample);
counterexample.addChild(nestedProblem);
nestedProblem.addChild(nestedIdea);

addMarkdown(problem, '思路 B', idea);
KBT.moveCommentsArrToField(problem, 'Z', '相关思考');
addMarkdown(idea, '反例 C', counterexample);
KBT.moveCommentsArrToField(idea, 'Z', '相关思考');

[idea, counterexample, summary].forEach(note => {
  addNative(note, classification);
  KBT.moveCommentsArrToField(note, 'Z', '相关链接');
  addNative(classification, note);
  KBT.moveCommentsArrToField(classification, 'Z', '包含');
});
addMarkdown(idea, '问题 A', problem);
KBT.moveCommentsArrToField(idea, 'Z', '相关链接');
addMarkdown(counterexample, '思路 B', idea);
KBT.moveCommentsArrToField(counterexample, 'Z', '相关链接');
addNative(summary, counterexample);
KBT.moveCommentsArrToField(summary, 'Z', '相关链接');
addMarkdown(summary, '反例 C', counterexample);
KBT.moveCommentsArrToField(summary, 'Z', '相关链接');
addNative(counterexample, manualRelated);
KBT.moveCommentsArrToField(counterexample, 'Z', '相关链接');

const contextForCounterexample = KBT.getQuestionChainContext(counterexample);
assert(contextForCounterexample, 'counterexample must resolve a question-chain context');
assert.strictEqual(contextForCounterexample.questionNote, problem);
assert.deepStrictEqual(
  Array.from(contextForCounterexample.lineage, note => note.noteId),
  [idea.noteId, counterexample.noteId],
  'lineage must run from the question child to the current note',
);
assert.strictEqual(KBT.getQuestionChainContext(nestedClassification), null, 'classification X must be a boundary itself');
assert.strictEqual(KBT.getQuestionChainContext(nestedExample), null, 'descendants below classification X must use ordinary rules');
assert.strictEqual(KBT.getQuestionChainContext(problem), null, 'the question card itself must keep ordinary rules');
assert.strictEqual(KBT.getQuestionChainContext(nestedIdea).questionNote, nestedProblem, 'the nearest nested question must become the new anchor');

KBT.changeTitle(counterexample);

assert.strictEqual(
  idea.title,
  '【思路 >> 紧算子｜❓紧性可以弱化到什么程度？】测试紧扰动条件',
  'the ancestor idea on the active branch must be rebuilt from problem A',
);
assert.strictEqual(
  counterexample.title,
  '【反例 >> 紧算子｜❓紧性可以弱化到什么程度？｜💡 测试紧扰动条件】单侧移位算子',
  'C must append the intermediate idea B to the problem path',
);
assert.strictEqual(
  summary.title,
  '【总结 >> 紧算子｜❓紧性可以弱化到什么程度？｜💡 测试紧扰动条件｜反例：单侧移位算子】当前阶段小结',
  'deeper descendants must keep accumulating intermediate path nodes',
);
assert.strictEqual(otherBranch.title, '【思路 >> 旁支旧前缀】研究 Riesz 算子', 'sibling problem branches must not be scanned');
assert.strictEqual(nestedIdea.title, '【思路 >> 嵌套旧前缀】比较定义', 'nested question descendants must not be rewritten by the outer problem');
assert(indexedNoteIds.includes(idea.noteId));
assert(indexedNoteIds.includes(counterexample.noteId));
assert(indexedNoteIds.includes(summary.noteId));
assert(!indexedNoteIds.includes(otherBranch.noteId));

problem.title = '【问题 >> Riesz 算子】哪些条件能压缩本质谱？';
idea.title = '【思路 >> 待替换】改走 Fredholm 路线';
counterexample.title = '【反例 >> 待替换】单侧移位算子';
summary.title = '【总结 >> 待替换】当前阶段小结';
indexedNoteIds.length = 0;
KBT.changeTitle(idea);
assert.strictEqual(
  idea.title,
  '【思路 >> Riesz 算子｜❓哪些条件能压缩本质谱？】改走 Fredholm 路线',
  're-carding B must update B itself from the changed problem A',
);
assert.strictEqual(
  counterexample.title,
  '【反例 >> Riesz 算子｜❓哪些条件能压缩本质谱？｜💡 改走 Fredholm 路线】单侧移位算子',
  're-carding B must also update descendant C with the changed B path',
);
assert.strictEqual(
  summary.title,
  '【总结 >> Riesz 算子｜❓哪些条件能压缩本质谱？｜💡 改走 Fredholm 路线｜反例：单侧移位算子】当前阶段小结',
  're-carding B must update deeper descendants on the same branch',
);
assert(!indexedNoteIds.includes(otherBranch.noteId));

KBT.linkParentNote(counterexample);

assert.strictEqual(countLinksTo(idea, '相关链接', problem), 1, 'B must keep one native parent link to A');
assert.strictEqual(countLinksTo(counterexample, '相关链接', idea), 1, 'C must keep one native parent link to B');
assert.strictEqual(countLinksTo(summary, '相关链接', counterexample), 1, 'deeper descendants must link to their direct structural parent');
assert.strictEqual(
  fieldComments(idea, '相关链接').find(comment => KBT.normalizeNoteIdForCompare(comment.text) === KBT.normalizeNoteIdForCompare(problem.noteId)).type,
  'linkComment',
  'B -> A must be a MarginNote native link',
);
assert.strictEqual(
  fieldComments(counterexample, '相关链接').find(comment => KBT.normalizeNoteIdForCompare(comment.text) === KBT.normalizeNoteIdForCompare(idea.noteId)).type,
  'linkComment',
  'C -> B must be a MarginNote native link',
);
assert.strictEqual(countLinksTo(counterexample, '相关链接', manualRelated), 1, 'unrelated manual links must survive');
assert.strictEqual(countLinksTo(idea, '相关链接', classification), 0, 'legacy broad classification parent link must be removed from B');
assert.strictEqual(countLinksTo(counterexample, '相关链接', classification), 0, 'legacy broad classification parent link must be removed from C');
assert.strictEqual(countLinksTo(summary, '相关链接', classification), 0, 'legacy broad classification parent link must be removed from descendants');
assert.strictEqual(countLinksTo(classification, '包含', idea), 0, 'legacy reverse contain link to B must be removed');
assert.strictEqual(countLinksTo(classification, '包含', counterexample), 0, 'legacy reverse contain link to C must be removed');
assert.strictEqual(countLinksTo(classification, '包含', summary), 0, 'legacy reverse contain link to descendants must be removed');
assert.strictEqual(countLinksTo(problem, '相关思考', idea), 1, 'existing parent-side research entry must survive');
assert.strictEqual(countLinksTo(idea, '相关思考', counterexample), 1, 'existing parent-side thought entry must survive');

assert.strictEqual(
  KBT.createChildNoteTitlePrefixContent(counterexample),
  'Riesz 算子｜❓哪些条件能压缩本质谱？｜💡 改走 Fredholm 路线｜反例：单侧移位算子',
  'new child cards must inherit the full problem path through their direct parent',
);

KBT.linkParentNote(nestedClassification);
assert.strictEqual(
  countLinksTo(nestedClassification, '所属', otherBranch),
  1,
  'classification X itself must use the existing ordinary classification rule',
);
KBT.linkParentNote(nestedExample);
assert.strictEqual(
  countLinksTo(nestedExample, '相关链接', nestedClassification),
  1,
  'cards below classification X must link to X through the ordinary rule',
);

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);
assert.match(
  mainSource,
  /parentQuestionChainContext[\s\S]*?getNoteType\(parentNote\) === '思路' && !parentQuestionChainContext/,
  'research-workbench creation must not append the idea path twice',
);
assert.match(
  toolbarSource,
  /parentQuestionChainContext[\s\S]*?getNoteType\(parentNote\) === "思路" && !parentQuestionChainContext/,
  'toolbar child creation must not append the idea path twice',
);

console.log('problem chain make-card regression ok');
