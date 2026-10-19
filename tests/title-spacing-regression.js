const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseTemplate in utils.js');

let panguCallCount = 0;
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
      panguCallCount += 1;
      return String(text)
        .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
        .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2');
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
    addToIncrementalIndex() {},
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

assert.strictEqual(
  KBT.normalizeTitleSpaces('算子A  +  B = C ⊗ D × E · F'),
  '算子 A+B=C⊗D×E·F',
  'title normalization must keep Pangu CJK spacing while compacting common math operators',
);
assert.strictEqual(panguCallCount, 1, 'the canonical title normalizer must invoke Pangu exactly once');

assert.strictEqual(
  KBT.normalizeTitleSpaces('sin (x) + cos （y）'),
  'sin(x)+cos（y）',
  'function calls and math operators must both use compact title spacing',
);

assert.strictEqual(
  KBT.normalizeTitleSpaces('条件* 说明，A * B × C'),
  '条件* 说明，A * B×C',
  'ASCII asterisks are not multiplication operators and must preserve surrounding spaces',
);

assert.strictEqual(
  KBT.normalizeTitleSpaces('|x| 后文'),
  '|x| 后文',
  'an absolute-value delimiter must preserve the following word boundary',
);

assert.strictEqual(
  KBT.normalizeTitleSpaces('A | B'),
  'A | B',
  'ASCII vertical bars are delimiters and must preserve surrounding spaces',
);

assert.strictEqual(
  KBT.normalizeTitleSpaces('【命题 >> 空间A + B】C > D'),
  '【命题 >> 空间 A+B】C>D',
  'math operator compaction must preserve spaces around the title-prefix >> separator',
);

KBT.getNoteType = () => '作者';
KBT.noteTypeCache = new Map();
const madeNote = {
  title: '空间A + B = C',
};
KBT.changeTitle(madeNote);
assert.strictEqual(
  madeNote.title,
  '空间 A+B=C',
  'make-card title processing must use the canonical title normalizer',
);

context.MNNote = {
  clone() {
    return { noteTitle: '' };
  },
};
KBT.types = {
  归类: {
    templateNoteId: 'CLASSIFICATION-TEMPLATE',
  },
};
KBT.linkParentNote = () => {};
const parentNote = {
  addChild() {},
};
const createdNote = KBT.createClassificationNoteAsChildNote(
  parentNote,
  '空间A + B = C ⊗ D',
  '命题',
);
assert.strictEqual(
  createdNote.noteTitle,
  '“空间 A+B=C⊗D”相关命题',
  'AddTemplate-created classification titles must use the same canonical spacing as make-card',
);

const parentClassification = {
  title: '“空间 A+B”相关命题',
  type: '归类',
};
createdNote.title = createdNote.noteTitle;
createdNote.type = '归类';
KBT.getNoteType = note => note.type;
assert.strictEqual(
  KBT.getRelativeClassificationContentDisplayText(parentClassification, createdNote),
  '=C⊗D',
  'consistent AddTemplate spacing must preserve incremental-title truncation for inline links',
);

const vonNeumannBase = 'Tₐ=Σᵢ₌₁ⁿaᵢSᵢ ｜T_c=Σᵢ₌₁ⁿ cᵢSᵢ, cᵢ=|aᵢ| ｜① aᵢ≠0 ② |aᵢ|≠|aⱼ|, ∀i≠j)｜T_c 生成的单位 von Neumann 代数 𝒲*(T_c)';
const vonNeumannParent = {
  title: `“${vonNeumannBase}”相关命题`,
  type: '归类',
};
const vonNeumannChild = {
  title: `“${vonNeumannBase} 的基本性质”相关命题`,
  type: '归类',
};
assert.strictEqual(
  KBT.getRelativeClassificationContentDisplayText(vonNeumannParent, vonNeumannChild),
  '基本性质',
  'a connector after whitespace must not force the inline title back to the nearest hierarchy segment',
);

const mathContinuationParent = {
  title: '“B 关于 {V_s} 的终衍分支 Ω⊂B^-1(V_s0)｜∂V_s”相关命题',
  type: '归类',
};
const mathContinuationChild = {
  title: '“B 关于 {V_s} 的终衍分支 Ω⊂B^-1(V_s0)｜∂V_s (s0<s<1) 的基本性质”相关命题',
  type: '归类',
};
assert.strictEqual(
  KBT.getRelativeClassificationContentDisplayText(mathContinuationParent, mathContinuationChild),
  '∂V_s (s0<s<1) 的基本性质',
  'a mathematical continuation must retain the nearest hierarchy segment for context',
);

const changeTitleStart = source.indexOf('static changeTitle(');
const changeTitleEnd = source.indexOf('\n  static getDiagnosticNoteBrief', changeTitleStart);
assert.doesNotMatch(
  source.slice(changeTitleStart, changeTitleEnd),
  /Pangu\.spacing/,
  'changeTitle must not maintain a second, divergent Pangu spacing path',
);

console.log('title spacing regression ok');
