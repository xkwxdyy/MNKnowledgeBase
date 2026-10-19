const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const configStart = source.indexOf('const kbOCRConfig = {');
const configEnd = source.indexOf('\n\nclass KnowledgeBaseTemplate', configStart);

assert.notStrictEqual(configStart, -1, 'Cannot locate OCR post-processing config');
assert.notStrictEqual(configEnd, -1, 'Cannot locate the end of OCR post-processing config');

const context = vm.createContext({});
vm.runInContext(
  `${source.slice(configStart, configEnd)}\nthis.kbOCRConfig = kbOCRConfig;`,
  context,
  { filename: 'utils.js' },
);

function postProcessOCRResult(value) {
  return context.kbOCRConfig.postProcessingRules.reduce(
    (result, rule) => result.replace(rule.pattern, rule.replacement),
    value,
  );
}

const theoremName = '$M_{z_1}$ 的全部约化子空间';
const theoremBody = '闭子空间 $M\\subset H_\\lambda(\\mathbb{B}_d)$ 约化 $M_{z_1}$，当且仅当存在闭子空间 $E_m\\subset P_m$，$m=0,1,2,\\ldots$，使';
const displayedFormula = '$P=\\bigoplus_{m=0}^{\\infty}\\overline{\\operatorname{span}}\\{z_1^kq(z):k\\geq0,q\\in E_m\\}$';
const result = postProcessOCRResult(
  `定理 8.2（${theoremName}） ${theoremBody}\n${displayedFormula}`,
);

assert.ok(
  result.endsWith(`; ${theoremName}`),
  'the parenthetical theorem name must be moved to the end of the title',
);
assert.ok(
  result.indexOf(displayedFormula) < result.indexOf(theoremName),
  'a multiline formula must remain in the theorem body before its parenthetical name',
);

const lemmaBody = '若 A_λ≥0 且 A_λ→A（SOT）, 则 A≥0';
const lemmaName = '正算子的强极限仍为正';
[
  `引理 1.2.3（${lemmaName}）${lemmaBody}`,
  `引理 1.23 （${lemmaName}）．${lemmaBody}`,
  `引理 ① ② ③ （${lemmaName}）${lemmaBody}`,
].forEach(input => {
  assert.strictEqual(
    postProcessOCRResult(input),
    `${lemmaBody}; ${lemmaName}`,
    `lemma heading markers and numbers must be removed without changing the body: ${input}`,
  );
});

assert.match(
  source,
  /数学陈述编号不是分项序号[\s\S]*?引理 1\.2\.3[\s\S]*?不得变成 \\`引理 ① ② ③\\`/,
  'the OCR prompt must forbid converting theorem-style dotted numbers into circled list markers',
);

console.log('OCR theorem heading label order regression ok');
