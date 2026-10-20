#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}
function validateRelativePath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Invalid runtime payload path');
  }
  return name;
}
function loadPayload() {
  const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'payload.json'), 'utf8'));
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error('Runtime payload must contain unique files');
  for (const name of files) {
    validateRelativePath(name);
    const file = path.join(root, name);
    if (!fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) throw new Error(`Runtime payload must be a regular local file: ${name}`);
  }
  for (const required of ['main.js', 'utils.js', 'mnaddon.json', 'logo.png']) {
    if (!files.includes(required)) throw new Error(`Missing runtime entry: ${required}`);
  }
  return files;
}
const referenceMarker = 'const kbBundledReferenceNoteIds = {};';
function loadReferences(profile) {
  const references = JSON.parse(fs.readFileSync(profile, 'utf8'));
  if (!references || Array.isArray(references) || typeof references !== 'object' || !Object.keys(references).length) throw new Error('Reference profile must be a nonempty object');
  const maps = ['templates', 'htmlCommentTemplates', 'roots'];
  const lists = ['rootScopes', 'mathTermSourceNoteIds'];
  const scalars = ['keywordTemplateNoteId', 'simpleClassificationTemplateNoteId', 'relatedLinksTemplateNoteId', 'searchBoardId'];
  for (const [key, value] of Object.entries(references)) {
    if (lists.includes(key)) {
      if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(ids =>
        !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()))) throw new Error(`Invalid reference list map: ${key}`);
      if (key === 'rootScopes' && Object.keys(value).some(name => !['researchProcessRootIds', 'literatureClassificationRootIds', 'circularScanRootIds'].includes(name))) throw new Error('Invalid root scope');
    } else if (maps.includes(key)) {
      if (!value || Array.isArray(value) || typeof value !== 'object' || Object.values(value).some(id => typeof id !== 'string' || !id.trim())) throw new Error(`Invalid reference map: ${key}`);
    } else if (!scalars.includes(key) || typeof value !== 'string' || !value.trim()) {
      throw new Error(`Invalid reference key: ${key}`);
    }
  }
  return references;
}
function runtimeContent(file, references) {
  const content = fs.readFileSync(path.join(root, file));
  if (!references) return content;
  const corpusJSON = 'resources/search/math-term-corpus.runtime.json';
  const corpusJS = 'resources/search/math-term-corpus.runtime.js';
  if ((file === corpusJSON || file === corpusJS) && references.mathTermSourceNoteIds) {
    const corpus = JSON.parse(fs.readFileSync(path.join(root, corpusJSON), 'utf8'));
    const bindings = references.mathTermSourceNoteIds;
    const matched = new Set();
    for (const concept of corpus.concepts) for (const sense of concept.senses) {
      if (Object.prototype.hasOwnProperty.call(bindings, sense.id)) {
        sense.sourceNoteIds = bindings[sense.id];
        matched.add(sense.id);
      }
    }
    if (matched.size !== Object.keys(bindings).length) throw new Error('Personal terminology bindings no longer match the corpus');
    if (file === corpusJSON) return Buffer.from(JSON.stringify(corpus, null, 2) + '\n');
    const source = content.toString('utf8');
    const start = source.indexOf('  const runtime = '), end = source.indexOf(';\n', start);
    if (start < 0 || end < 0) throw new Error('Terminology runtime marker changed');
    return Buffer.from(source.slice(0, start) + '  const runtime = ' + JSON.stringify(corpus) + source.slice(end));
  }
  if (file !== 'utils.js') return content;
  const source = content.toString('utf8');
  if (source.split(referenceMarker).length !== 2) throw new Error('Reference injection marker changed');
  const { mathTermSourceNoteIds, ...runtimeReferences } = references;
  return Buffer.from(source.replace(referenceMarker, () => `const kbBundledReferenceNoteIds = ${JSON.stringify(runtimeReferences)};`));
}
function verify(artifact, references = null) {
  const files = loadPayload();
  run('unzip', ['-tq', artifact]);
  const entries = run('unzip', ['-Z1', artifact]).trim().split(/\r?\n/);
  if (JSON.stringify(entries.slice().sort()) !== JSON.stringify(files.slice().sort())) throw new Error('Archive entries differ from the runtime payload');
  for (const file of files) {
    const packed = run('unzip', ['-p', artifact, file], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
    if (!packed.equals(runtimeContent(file, references))) throw new Error(`Archive differs from source: ${file}`);
  }
  return { files: files.length, sourceParity: !references, configuredPayloadParity: true, personalReferences: !!references, archiveIntegrity: true };
}
function pack(references = null) {
  const files = loadPayload();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mnaddon.json'), 'utf8'));
  if (!/^[A-Za-z0-9._-]+$/.test(manifest.version)) throw new Error('Invalid package version');
  const destination = path.join(root, 'dist');
  fs.mkdirSync(destination, { recursive: true });
  const suffix = references ? '_personal' : '';
  const artifact = path.join(destination, `mnknowledgebase_v${manifest.version.replace(/\./g, '_')}${suffix}.mnaddon`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mnkb-pack-'));
  try {
    const candidate = path.join(temporary, 'package.zip');
    const payload = path.join(temporary, 'payload');
    for (const file of files) {
      const target = path.join(payload, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, runtimeContent(file, references));
    }
    run('zip', ['-q', '-X', candidate, ...files], { cwd: payload });
    const result = verify(candidate, references);
    fs.copyFileSync(candidate, artifact);
    fs.writeFileSync(path.join(destination, `verification${suffix}.json`), JSON.stringify({ artifact: path.basename(artifact), addonid: manifest.addonid, version: manifest.version, ...result }, null, 2) + '\n');
    console.log(JSON.stringify({ artifact: path.relative(root, artifact), ...result }));
    return artifact;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const profileIndex = args.indexOf('--references');
    let profile = path.join(root, 'reference-note-ids.local.json');
    if (profileIndex !== -1) {
      if (!args[profileIndex + 1]) throw new Error('Missing reference profile path');
      profile = path.resolve(args[profileIndex + 1]);
      args.splice(profileIndex, 2);
      if (!fs.existsSync(profile)) throw new Error('Reference profile does not exist');
    }
    const publicIndex = args.indexOf('--public');
    if (publicIndex !== -1) {
      if (profileIndex !== -1) throw new Error('Cannot combine --public and --references');
      args.splice(publicIndex, 1);
    }
    const references = publicIndex === -1 && fs.existsSync(profile) ? loadReferences(profile) : null;
    if (args[0] === '--verify' && args.length === 2) console.log(JSON.stringify(verify(path.resolve(args[1]), references)));
    else if (args.length === 0) pack(references);
    else throw new Error('Usage: node build/build.js [--public | --references <profile>] [--verify <artifact>]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { validateRelativePath, loadPayload, loadReferences, runtimeContent, verify };
