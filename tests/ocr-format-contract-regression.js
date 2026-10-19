'use strict';

const assert = require('assert');
const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const utilsSource = fs.readFileSync(path.join(repoRoot, 'mnknowledgebase', 'utils.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(repoRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

const methodStart = utilsSource.indexOf('  static getOCRResultFormatViolation');
const methodEnd = utilsSource.indexOf('\n\n  static async OCRDirectlyToClipboard', methodStart);
assert.notStrictEqual(methodStart, -1, 'OCR format validator is missing');
assert.notStrictEqual(methodEnd, -1, 'OCR format validator boundary is missing');
const methodSource = utilsSource.slice(methodStart, methodEnd).replace(/^  static /, '');
const runtime = vm.runInNewContext(`({${methodSource}})`, { String, RegExp });

assert.strictEqual(
  runtime.getOCRResultFormatViolation('设 T 是算子\n且 T ≠ 0', 1),
  '',
  'direct OCR may preserve line breaks when it remains Unicode-only',
);
assert.match(
  runtime.getOCRResultFormatViolation(String.raw`设 $T$ 是算子`, 1),
  /直接 OCR/,
  'direct OCR must reject dollar-delimited Markdown math',
);
assert.match(
  runtime.getOCRResultFormatViolation(String.raw`设 \(T\) 是算子`, 1),
  /直接 OCR/,
  'direct OCR must reject parenthesized inline LaTeX math',
);

assert.strictEqual(
  runtime.getOCRResultFormatViolation(String.raw`设 $T\in\mathcal{B}(H)$ 是算子`, 2),
  '',
  'Markdown OCR must allow dollar-delimited inline math',
);
assert.strictEqual(
  runtime.getOCRResultFormatViolation(String.raw`设 \(T\in\mathcal{B}(H)\) 是算子`, 2),
  '',
  'Markdown OCR must allow parenthesized inline math',
);
assert.match(
  runtime.getOCRResultFormatViolation(String.raw`$$T\in\mathcal{B}(H)$$`, 2),
  /单行行内公式/,
  'Markdown OCR must reject display math delimiters',
);
assert.match(
  runtime.getOCRResultFormatViolation(String.raw`\[T\in\mathcal{B}(H)\]`, 2),
  /单行行内公式/,
  'Markdown OCR must reject bracketed display math',
);

assert.match(toolbarSource, /const XDYY_DIRECT_OCR_TIMEOUT_SECONDS = 10/);
assert.match(
  toolbarSource,
  /mode === 1 \? \{ \.\.\._xdyy_directOCRManualOptions\(\) \} : \{ \.\.\._xdyy_ocrManualOptions\(\) \}/,
  'Markdown clipboard OCR must not inherit the direct OCR timeout helper',
);
assert.match(
  toolbarSource,
  /timeoutSeconds: mode === 1[\s\S]*?Number\(options && options\.timeoutSeconds\)/,
  'MNAI translated direct OCR must pass the direct OCR timeout',
);

console.log('OCR format contract regression ok');
