const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');

const knowledgeBaseRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(knowledgeBaseRoot, '..');
const knowledgeBaseSource = fs.readFileSync(path.join(knowledgeBaseRoot, 'utils.js'), 'utf8');
const literatureSource = fs.readFileSync(path.join(repoRoot, 'mnliterature', 'utils.js'), 'utf8');

function extractTemplate(source, declaration) {
  const startToken = `${declaration} = \``;
  const start = source.indexOf(startToken);
  assert.notStrictEqual(start, -1, `missing template: ${declaration}`);
  const contentStart = start + startToken.length;
  const end = source.indexOf('\n\`', contentStart);
  assert.notStrictEqual(end, -1, `unterminated template: ${declaration}`);
  return source.slice(contentStart, end);
}

function extractSection(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notStrictEqual(start, -1, `missing section start: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notStrictEqual(end, -1, `missing section end: ${endToken}`);
  return source.slice(start, end);
}

const knowledgeBaseRules = extractTemplate(
  knowledgeBaseSource,
  'static OCRScriptFallbackRules',
);
const literatureRules = extractTemplate(
  literatureSource,
  'static OCRScriptFallbackRules',
);

assert.strictEqual(
  literatureRules,
  knowledgeBaseRules,
  'MNKnowledgeBase and MN Literature must ship the same plain-text script rules',
);
assert.ok(
  knowledgeBaseRules.includes('Xₙ₌₀'),
  'fully representable n=0 subscripts must prefer Unicode',
);
assert.ok(
  knowledgeBaseRules.includes('X_{n≠0}') &&
    knowledgeBaseRules.includes('n≠0') &&
    knowledgeBaseRules.includes('整体降级'),
  'one unsupported subscript character must force whole-fragment _{...} fallback',
);
assert.ok(
  knowledgeBaseRules.includes('A_{B_C}') &&
    knowledgeBaseRules.includes('A_B_C') &&
    knowledgeBaseRules.includes('嵌套下标必须保留层级'),
  'nested subscripts must preserve hierarchy with braces',
);
assert.ok(
  !knowledgeBaseRules.includes('xₙₖ\\`（对应 \\`x_{n_k}'),
  'nested subscripts must not be flattened into consecutive Unicode glyphs',
);
assert.ok(
  knowledgeBaseRules.includes('U+0304') &&
    knowledgeBaseRules.includes('U+0302') &&
    knowledgeBaseRules.includes('U+0303'),
  'bar, hat, and tilde must use their Unicode combining marks',
);
assert.ok(
  knowledgeBaseRules.includes('ᵃᵇᶜ') &&
    knowledgeBaseRules.includes('ᴬᴮᴰ') &&
    knowledgeBaseRules.includes('ᵀ'),
  'available lowercase and uppercase Unicode superscripts must remain preferred',
);
assert.ok(
  knowledgeBaseRules.includes('𝒜̂') &&
    knowledgeBaseRules.includes('ℝ̄') &&
    knowledgeBaseRules.includes('s̄p̄ān̄'),
  'combining marks must cover styled symbols and whole multi-character identifiers',
);
assert.ok(
  knowledgeBaseRules.includes('\\\\bar{...}') &&
    knowledgeBaseRules.includes('\\\\hat{...}') &&
    knowledgeBaseRules.includes('\\\\tilde{...}'),
  'complex accent scopes must retain an explicit LaTeX fallback',
);

const sharedRuleReference = '${this.OCRScriptFallbackRules}';
const escapedSharedRuleReference = '\\${this.OCRScriptFallbackRules}';
const directPromptSections = [
  {
    name: 'MNKnowledgeBase translated direct OCR',
    source: knowledgeBaseSource,
    start: 'static get OCRDirectlyPrompt()',
    end: 'static OCRToMarkdownPrompt = `',
  },
  {
    name: 'MNKnowledgeBase untranslated direct OCR',
    source: knowledgeBaseSource,
    start: 'static get OCRDirectlyNoTransPrompt()',
    end: 'static OCRToMarkdownNoTransPrompt = `',
  },
  {
    name: 'MN Literature document direct OCR',
    source: literatureSource,
    start: 'static getDirectOCRPrompt()',
    end: 'static OCRCorrectionRules = `',
  },
  {
    name: 'MN Literature translated direct OCR',
    source: literatureSource,
    start: 'static get OCRDirectlyPrompt()',
    end: 'static OCRToMarkdownPrompt = `',
  },
  {
    name: 'MN Literature untranslated direct OCR',
    source: literatureSource,
    start: 'static get OCRDirectlyNoTransPrompt()',
    end: 'static OCRToMarkdownNoTransPrompt = `',
  },
];

directPromptSections.forEach(({ name, source, start, end }) => {
  const promptSection = extractSection(source, start, end);
  assert.ok(
    promptSection.includes(sharedRuleReference),
    `${name} must interpolate the shared subscript rules`,
  );
  assert.ok(
    !promptSection.includes(escapedSharedRuleReference),
    `${name} must not output the interpolation expression literally`,
  );
});

assert.match(
  literatureSource,
  /case "direct":[\s\S]*?return shouldTranslate \? this\.OCRDirectlyPrompt : this\.OCRDirectlyNoTransPrompt/,
  'MN Literature reading direct OCR must route through the covered prompts',
);

console.log('OCR subscript prompt regression ok');
