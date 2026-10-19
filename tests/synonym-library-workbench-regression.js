#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'tests/fixtures/synonym-library-workbench.html');
const html = fs.readFileSync(file, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(html.includes('AI 录入候选'), 'prototype should expose AI intake');
assert(html.includes('发送并查重'), 'prototype should expose AI duplicate check action');
assert(html.includes('追加到此词组'), 'prototype should expose append-to-existing action');
assert(html.includes('data-create-candidate'), 'prototype should expose create-new-from-candidate action');
assert(html.includes('＋ 新建'), 'prototype should expose create-new action');
assert(html.includes('保存到本地文件'), 'prototype should expose local writeback action');
assert(html.includes('mnkb-synonym-library.json'), 'prototype should identify the local synonym file');
assert(html.includes('固定词库 · 正在加载'), 'prototype should auto-load the fixed library');
assert(html.includes('resources/search/mnkb-synonym-library.json'), 'prototype should point to the fixed resource path');
assert(html.includes('本地文件是唯一事实来源'), 'prototype should make local-file ownership explicit');
assert(html.includes('查看固定提示词'), 'prototype should expose the fixed AI prompt');
assert(script, 'prototype should contain an inline script');
new Function(script[1]);
const embedded = script[1].match(/const embeddedPayload = JSON\.parse\(atob\('([^']+)'\)\)/);
assert(embedded, 'prototype should embed a fixed-library fallback');
const embeddedPayload = JSON.parse(Buffer.from(embedded[1], 'base64').toString('utf8'));
const resourcePayload = JSON.parse(fs.readFileSync(path.join(root, 'resources/search/mnkb-synonym-library.json'), 'utf8'));
assert(embeddedPayload.groups.length === resourcePayload.groups.length, 'embedded fallback must contain every fixed-library group');
assert(embeddedPayload.groups.some((group) => group.id === 'math-sot-convergence'), 'embedded fallback must retain the SOT group');

for (const token of ['levenshtein', 'parseCandidate', 'parseAIResponse', 'findMatches', 'appendCandidate', 'createFromCandidate', 'saveGroup', 'deleteGroup', 'saveFile', 'embeddedPayload', 'loadFixedLibrary', 'applyLibraryPayload', 'fetch', 'enabled']) {
  assert(script[1].includes(token), `prototype script should include ${token}`);
}

for (const token of ['openLocalFile', 'loadLocalFile', 'showOpenFilePicker', 'fileInput']) {
  assert(!script[1].includes(token), `prototype must not require manual file picking: ${token}`);
}

assert(!/\b(XMLHttpRequest|WebSocket)\b/.test(script[1]), 'local-only prototype must not use unmanaged transports');
console.log('synonym-library-workbench-regression: ok');
