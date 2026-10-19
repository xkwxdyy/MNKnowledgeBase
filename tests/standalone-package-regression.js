const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateRelativePath, loadPayload } = require('../build/build.js');
for (const invalid of ['', '../private.js', '/private.js', 'scripts/../private.js', '.tmp/key.json', 'scripts\\private.js']) {
  assert.throws(() => validateRelativePath(invalid));
}
const files = loadPayload();
assert(files.includes('KnowledgeBaseHandwritingOCR.js'));
assert(files.includes('scripts/proof-structure-workbench/vendor/marked.js'));
assert(files.includes('scripts/proof-structure-workbench/vendor/mathjax-tex-svg.js'));
assert(files.every(file => !/^(tests|docs|mncardbox|MEMORY|Resources|node_modules|artifacts)\//.test(file)));
const manifest = require('./manifest.json');
const listed = [...manifest.offline, ...manifest.integration, ...manifest.browser].sort();
const actual = fs.readdirSync(__dirname).filter(file => file.endsWith('-regression.js') || file.endsWith('.browser.mjs')).sort();
assert.deepEqual(listed, actual, 'Every retained regression must have an explicit suite');
console.log('standalone payload and test manifest: ok');
