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
function verify(artifact) {
  const files = loadPayload();
  run('unzip', ['-tq', artifact]);
  const entries = run('unzip', ['-Z1', artifact]).trim().split(/\r?\n/);
  if (JSON.stringify(entries.slice().sort()) !== JSON.stringify(files.slice().sort())) throw new Error('Archive entries differ from the runtime payload');
  for (const file of files) {
    const packed = run('unzip', ['-p', artifact, file], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
    if (!packed.equals(fs.readFileSync(path.join(root, file)))) throw new Error(`Archive differs from source: ${file}`);
  }
  return { files: files.length, sourceParity: true, archiveIntegrity: true };
}
function pack() {
  const files = loadPayload();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mnaddon.json'), 'utf8'));
  if (!/^[A-Za-z0-9._-]+$/.test(manifest.version)) throw new Error('Invalid package version');
  const destination = path.join(root, 'dist');
  fs.mkdirSync(destination, { recursive: true });
  const artifact = path.join(destination, `mnknowledgebase_v${manifest.version.replace(/\./g, '_')}.mnaddon`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mnkb-pack-'));
  try {
    const candidate = path.join(temporary, 'package.zip');
    run('zip', ['-q', '-X', candidate, ...files]);
    const result = verify(candidate);
    fs.copyFileSync(candidate, artifact);
    fs.writeFileSync(path.join(destination, 'verification.json'), JSON.stringify({ artifact: path.basename(artifact), addonid: manifest.addonid, version: manifest.version, ...result }, null, 2) + '\n');
    console.log(JSON.stringify({ artifact: path.relative(root, artifact), ...result }));
    return artifact;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    if (process.argv[2] === '--verify') {
      if (!process.argv[3]) throw new Error('Usage: node build/build.js --verify <artifact>');
      console.log(JSON.stringify(verify(path.resolve(process.argv[3]))));
    } else if (process.argv.length === 2) pack();
    else throw new Error('Usage: node build/build.js [--verify <artifact>]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { validateRelativePath, loadPayload, verify };
