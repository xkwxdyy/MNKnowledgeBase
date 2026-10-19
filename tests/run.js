#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('./manifest.json');
const root = path.resolve(__dirname, '..');
const integration = process.argv.includes('--integration');
if (Number(process.versions.node.split('.')[0]) !== manifest.node) throw new Error('The offline regression suite requires Node.js 24');
const tests = integration ? manifest.integration : manifest.offline;
let failures = 0;
for (const file of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: root, encoding: 'utf8', timeout: 30000, env: process.env });
  if (result.status !== 0 || result.error) {
    failures += 1;
    console.error(`FAIL ${file}\n${result.error || result.stderr || result.stdout}`);
  } else console.log(`PASS ${file}`);
}
console.log(`${tests.length - failures}/${tests.length} ${integration ? 'integration' : 'offline'} scripts passed`);
if (!integration) console.log(`Separate suites: ${manifest.integration.length} integration scripts and ${manifest.browser.length} browser scripts`);
process.exitCode = failures ? 1 : 0;
