const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.MNKB_TEST_ROOT || path.resolve(__dirname, '..');
const context = { console, setTimeout, clearTimeout, URL, KnowledgeBaseConfig: { getConfig: key => key === 'ocrFixedPostprocessEnabled' } };
vm.createContext(context);
const source = fs.readFileSync(path.join(root, 'utils.js'), 'utf8');
vm.runInContext(fs.readFileSync(path.join(root, 'KnowledgeBaseOCRPostprocess.js'), 'utf8') + '\n' +
  source.slice(source.indexOf('const kbOCRConfig = {'), source.indexOf('\nclass KnowledgeBaseTemplate')) + '\n' +
  source.slice(source.indexOf('class KnowledgeBaseNetwork'), source.indexOf('\nclass KnowledgeBaseConfig')) + '\nthis.N=KnowledgeBaseNetwork;', context);
const cases = [
  ['x−y x﹘y x﹣y x－y x➖y x˗y', 'x-y x-y x-y x-y x-y x-y'],
  ['x一y=一1; aₙ一bₙ; α一β; 𝒜一𝒝', 'x-y=-1; aₙ-bₙ; α-β; 𝒜-𝒝'],
  ['(1一|z|²); x²一y²; ‖x‖一1', '(1-|z|²); x²-y²; ‖x‖-1'],
  ['x─y x━y x⎯y', 'x-y x-y x-y'],
  ['一1<x<1; (一x)+y', '-1<x<1; (-x)+y'],
  ['x^{一1}+a_{n一1}', 'x⁻¹+aₙ₋₁'],
  ['x⁻¹+aₙ₋₁+y⁽ⁿ⁻¹⁾+zᵅ⁻¹', 'x⁻¹+aₙ₋₁+y⁽ⁿ⁻¹⁾+zᵅ⁻¹'],
  [String.raw`$x一y=-1$ \(a一b\) \[c一d\]`, String.raw`$x-y=-1$ \(a-b\) \[c-d\]`],
  [String.raw`\text{唯一 x一y} + x一y`, String.raw`\text{唯一 x一y} + x-y`],
  ['一致收敛、唯一性、第一项、（一）、一阶导数、数值 1', '一致收敛、唯一性、第一项、（一）、一阶导数、数值 1'],
  [String.raw`\overline{ab}+x̄+φ≠ϕ`, String.raw`\overline{ab}+x̄+φ≠ϕ`],
];
for (const [input, expected] of cases) {
  const actual = context.N.postProcessOCRResult(input, { disableTheoremHeadingCleanup: true });
  assert.equal(actual, expected, input);
  assert.equal(context.N.postProcessOCRResult(actual, { disableTheoremHeadingCleanup: true }), expected, 'cleanup must be idempotent');
}
assert.match(context.N.OCRCorrectionRules, /ASCII U\+002D/);
assert.match(context.KnowledgeBaseOCRPostprocess.visionPrompt, /汉字一/);
console.log('OCR minus normalization passed (glyphs, contextual Chinese strokes, negative script scope, prose and accents)');
