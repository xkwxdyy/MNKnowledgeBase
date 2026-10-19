'use strict';

const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');

const addonRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(addonRoot, '..');
const knowledgeBaseSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notStrictEqual(start, -1, `cannot locate ${startMarker}`);
  assert.notStrictEqual(end, -1, `cannot locate ${endMarker}`);
  return source.slice(start, end);
}

function assertPiecewiseRuleContract() {
  const ruleStart = knowledgeBaseSource.indexOf('static OCRPiecewiseRules = `');
  const ruleEnd = knowledgeBaseSource.indexOf('\n`', ruleStart);
  assert.notStrictEqual(ruleStart, -1, 'shared piecewise OCR rule must exist');
  assert.notStrictEqual(ruleEnd, -1, 'shared piecewise OCR rule must be closed');
  const rule = knowledgeBaseSource.slice(ruleStart, ruleEnd);

  assert.match(rule, /x = ① 1，如果 \[条件\] ② 0，否则/);
  assert.doesNotMatch(rule, /；②/);
  assert.match(rule, /下一个带圈数字前只用一个空格分隔/);
  assert.match(rule, /禁止添加分号、逗号或换行/);
  assert.match(rule, /cases/);
  assert.match(rule, /\\\\begin\{cases\}/);
  assert.match(rule, /\\\\begin\{array\}/);
}

function assertPromptCoverage() {
  const promptRanges = [
    ['static get OCRDirectlyPrompt()', 'static OCRToMarkdownPrompt = `'],
    ['static OCRToMarkdownPrompt = `', 'static OCRExtractConceptPrompt = `'],
    ['static get OCRDirectlyNoTransPrompt()', 'static OCRToMarkdownNoTransPrompt = `'],
    ['static OCRToMarkdownNoTransPrompt = `', 'static OCRExtractConceptNoTransPrompt = `'],
  ];
  for (const [start, end] of promptRanges) {
    const prompt = sliceBetween(knowledgeBaseSource, start, end);
    assert.strictEqual(
      (prompt.match(/\$\{this\.OCRPiecewiseRules\}/g) || []).length,
      1,
      `${start} must include the shared piecewise OCR rule once`,
    );
  }
}

function assertToolbarUsesSharedPrompts() {
  const helper = sliceBetween(
    toolbarSource,
    'function _xdyy_getOCRPromptForMode(note, mode)',
    'function _xdyy_getOCRModelForMode(note, mode)',
  );
  assert.match(helper, /KnowledgeBaseNetwork\.OCRToMarkdownNoTransPrompt \|\| KnowledgeBaseNetwork\.OCRToMarkdownPrompt/);
  assert.match(helper, /KnowledgeBaseNetwork\.OCRDirectlyNoTransPrompt \|\| KnowledgeBaseNetwork\.OCRDirectlyPrompt/);
}

assertPiecewiseRuleContract();
assertPromptCoverage();
assertToolbarUsesSharedPrompts();
console.log('piecewise OCR prompt regression ok');
