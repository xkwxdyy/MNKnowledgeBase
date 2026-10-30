'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixedFormatter = require('../KnowledgeBaseOCRPostprocess.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
let fixedMath = true;
const context = vm.createContext({
  KnowledgeBaseOCRPostprocess: {
    enabled: () => fixedMath,
    normalizeScripts: fixedFormatter.normalizeScripts,
  },
});
vm.runInContext(
  source.slice(source.indexOf('const kbOCRConfig = {'), source.indexOf('\nclass KnowledgeBaseTemplate')) + '\n' +
  source.slice(source.indexOf('class KnowledgeBaseNetwork'), source.indexOf('\nclass KnowledgeBaseConfig')) + '\n' +
  'this.Network = KnowledgeBaseNetwork;', context,
);
const Network = context.Network;
const correction = Network.OCRCorrectionRules;
const scripts = Network.OCRScriptFallbackRules;
const piecewise = Network.OCRPiecewiseRules;
const numbering = Network.OCRNumberingRules;

assert.doesNotMatch(correction, /X1, Y2, Z3.*→|x2, y3, z4.*→|xn, an.*→|Σₙ₌₁∞/,
  'draft letter/digit strings and a flattened infinity must never be unconditional correction rules');
assert.match(correction, /下标位置、附着对象和作用范围必须依据原图确认/);
assert.match(correction, /x2、y3、z4、xn、an.*不得仅凭识别稿字串自动转换/);
assert.match(correction, /下限和上限分别附着于原运算符/);
assert.match(correction, /积分的上下限、积分域、微分变量及被积表达式必须各自保留/);
assert.match(correction, /求和符号 ∑ 与希腊大写字母 Σ/);
assert.match(correction, /导数括号、prime 的数量及其附着对象/);
assert.match(correction, /伴随符号、共轭符号、乘号与普通星号/);
assert.match(correction, /逆幂与负幂的位置以原图为准/);
assert.match(correction, /公式内部的上下标、求和范围、幂次、prime 及条件不是正文编号/);
assert.match(correction, /φ、ϕ、Φ 必须分别保留/);
assert.match(numbering, /转换表仅用于同层分项/);
assert.match(numbering, /嵌套列表必须保留隶属层级/);
assert.match(numbering, /数学下标 \(i\)、导数阶数 \(n\) 和公式编号不能按分项转换/);
assert.doesNotMatch(numbering, /不同层级的序号.*统一转换为带圈数字/);

assert.match(piecewise, /只有原图实际按不同条件给出对应结果/);
assert.match(piecewise, /matrix、array、aligned.*本身不能作为分段依据/);
assert.match(piecewise, /矩阵、行列式、向量、多行对齐等式或方程组保留原有结构/);
assert.match(piecewise, /没有给出的条件或“否则”分支不得补造/);
assert.match(scripts, /单个数学符号.*优先使用.*Unicode 组合标记/);
assert.match(scripts, /多字符整组或嵌套重音必须保留整体作用范围/);
assert.doesNotMatch(scripts, /对每个基础字符附加组合标记|s̄p̄ān̄/);
assert.match(scripts, /允许保留必要的 _/);
assert.match(scripts, /必要时允许保留 \^/);
assert.match(scripts, /alpha 位于上标时，允许使用 ᵅ/);

for (const value of [
  String.raw`\bar{ab}`, String.raw`\hat{ab}`, String.raw`\tilde{ab}`,
  String.raw`\overline{ab}`, String.raw`\overline{\hat{ab}c}`, 'A_{B_n} U_σ^J',
]) assert.equal(Network.getOCRResultFormatViolation(value, 1), '', 'necessary accent and script scope must remain usable');
for (const value of [
  '$T$', String.raw`\(T\)`, String.raw`\[T\]`, String.raw`\frac{a}{b}`,
  String.raw`\sum_{n=1}^{N}a_n`, String.raw`\mathbb{R}`,
]) assert.match(Network.getOCRResultFormatViolation(value, 1), /直接 OCR/,
  'accent fallback must not relax unrelated direct-mode formula boundaries');

for (const value of ['φ≠ϕ; Φ', 'Σ=∑ₙ₌₁^{N}a_n', '(A.1) φ≠ϕ', '(A.1) (Identity) Σ=∑a_n', 'kernel of T', 'let T be bounded']) {
  assert.equal(Network.postProcessOCRResult(value), value,
    'image-corrected symbol distinctions and uncertain equation labels must survive deterministic cleanup');
}
for (const value of [
  '𝒴', 'V*(x)', 'W*(x)', 'բ', 'L_a²', 'X A⁺ Y', '₀<ᵣ<₁', 'ᵣ→1',
  '𝔻₁∞', '𝔻₂∞', 'ₙ≥₀', 'ₙ≥₁', 'ₙ>₀', 'ₙ>₁',
  'Sᵀⁿ(x)', 'Sᵀⁿ x', 'Sᵀ(x)', 'Sᵀ x', 'S_T(x)', 'S_T x', 'S_B[x]', 'S_B x',
  'Sᵣ(x)', 'Sᵣ x', 'x^*k', 'x^(*)k', 'x_ϕ',
]) {
  assert.equal(Network.postProcessOCRResult(value), value,
    'image-corrected glyphs, adjoint markers and index levels must survive the tail rules and actual script normalization');
}
assert.equal(Network.postProcessOCRResult('Theorem A.1 let T be bounded'), 'let T be bounded',
  'an explicit appendix number must reach its dedicated heading rule instead of being mistaken for the article A');
assert.equal(Network.postProcessOCRResult('Theorem A bounded operator exists'), 'A bounded operator exists',
  'an actual article A must still allow a heading label without a number to be removed');
fixedMath = false;
assert.equal(Network.postProcessOCRResult('φ≠ϕ'), 'ϕ≠ϕ', 'legacy phi cleanup must remain unchanged');
assert.equal(Network.postProcessOCRResult('Σ=∑a_n'), 'Σ=Σa_n', 'legacy summation glyph cleanup must remain unchanged');
assert.equal(Network.postProcessOCRResult('(A.1) body'), 'body', 'legacy appendix cleanup must remain unchanged');
assert.equal(Network.postProcessOCRResult('Theorem A.1 Let T be bounded'), 'Let T be bounded');
assert.equal(Network.postProcessOCRResult('Theorem A bounded operator exists'), 'A bounded operator exists');
assert.equal(Network.postProcessOCRResult('kernel of T'), 'ᵏernel of T', 'legacy leading-letter conversion must remain unchanged');
assert.equal(Network.postProcessOCRResult('let T be bounded'), 'ˡet T be bounded');
assert.equal(Network.postProcessOCRResult('𝒴 V*(x) W*(x)'), '𝒱 𝒱*(x) 𝒲*(x)', 'legacy glyph substitutions must remain unchanged');
assert.equal(Network.postProcessOCRResult('x^*k'), 'x*k', 'legacy caret cleanup must remain unchanged');
assert.equal(Network.postProcessOCRResult('L_a² 𝔻₁∞'), 'L²ₐ 𝔻∞₁');

console.log('OCR structure prompts, accent fallback and image-corrected semantic preservation: ok');
