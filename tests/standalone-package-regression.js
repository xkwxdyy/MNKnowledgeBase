const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateRelativePath, loadPayload, loadReferences, runtimeContent } = require('../build/build.js');
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
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mnkb-reference-profile-test-'));
try {
  const profile = path.join(temporary, 'references.json');
  const references = { templates: { '定义': 'fixture-definition' } };
  fs.writeFileSync(profile, JSON.stringify(references));
  assert.deepEqual(loadReferences(profile), references);
  const original = fs.readFileSync(path.join(__dirname, '../utils.js'));
  assert(runtimeContent('utils.js', null).equals(original));
  const configured = runtimeContent('utils.js', references).toString();
  assert(configured.includes('const kbBundledReferenceNoteIds = ' + JSON.stringify(references) + ';'));
  assert.equal(fs.readFileSync(path.join(__dirname, '../utils.js')).equals(original), true, 'personal packaging must not edit public source');
  assert(runtimeContent('main.js', references).equals(fs.readFileSync(path.join(__dirname, '../main.js'))));
  for (const invalid of [null, [], {}, { password: 'secret' }, { templates: [] }, { templates: { '定义': '' } }]) {
    fs.writeFileSync(profile, JSON.stringify(invalid));
    assert.throws(() => loadReferences(profile));
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('standalone payload and test manifest: ok');
