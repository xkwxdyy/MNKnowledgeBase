import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const forbidden = /(?:publish|deploy|upload|release|123pan|pan123)/i;
const root = fs.realpathSync(process.cwd());

function localPath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..') || /(?:^|[\\/])\.cursor(?:[\\/]|$)/i.test(value)) {
    throw new Error('Expected a repository-relative path');
  }
  const resolved = fs.realpathSync(path.resolve(root, value));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Path escapes the repository');
  if (path.relative(root, resolved).split(path.sep).some(part => part.toLowerCase() === '.cursor')) throw new Error('Excluded application data');
  return resolved;
}

try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node 24 is required');
  if (process.argv.length !== 3) throw new Error('Usage: node ci/run-checks.mjs <explicit-command-list.json>');
  const config = JSON.parse(fs.readFileSync(localPath(process.argv[2]), 'utf8'));
  if (config.schemaVersion !== 1 || !Array.isArray(config.commands) || !config.commands.length) throw new Error('A non-empty explicit command list is required');
  if (Object.keys(config).some(key => !['schemaVersion', 'commands'].includes(key))) throw new Error('Unknown configuration field');
  for (const entry of config.commands) {
    if (!entry || Object.keys(entry).some(key => !['name', 'argv'].includes(key)) || typeof entry.name !== 'string' || !entry.name.trim() || !Array.isArray(entry.argv) || entry.argv.length < 2 || entry.argv.some(arg => typeof arg !== 'string')) throw new Error('Invalid command entry');
    const [executable, ...args] = entry.argv;
    if (!['node', 'python3', 'bash'].includes(executable) || args.some(arg => forbidden.test(arg) || /[\n\r\0]/.test(arg))) throw new Error('Inline commands and distribution commands are forbidden');
    const allowedOptions = {node: ['--check', '--test'], python3: ['-B'], bash: ['-n']};
    let target;
    for (const arg of args) {
      if (!arg.startsWith('-')) { target = arg; break; }
      if (!allowedOptions[executable].includes(arg)) throw new Error('Only reviewed interpreter options are allowed');
    }
    if (!target) throw new Error('An explicit local script path is required');
    localPath(target);
  }
  // Validate the entire list before executing any command. Script contents still require review.
  for (const entry of config.commands) {
    console.log(`Check: ${entry.name}`);
    const result = spawnSync(entry.argv[0], entry.argv.slice(1), {cwd: root, stdio: 'inherit', shell: false, env: {...process.env, CI: 'true'}});
    if (result.error || result.status !== 0) throw new Error(`Check failed: ${entry.name}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
