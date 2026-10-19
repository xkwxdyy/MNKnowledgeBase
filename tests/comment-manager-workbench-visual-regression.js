const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const html = fs.readFileSync(path.join(root, 'comment-manager.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles', 'comment-manager.css'), 'utf8');
const tokens = fs.readFileSync(path.join(root, 'styles', 'workbench-tokens.css'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'build/payload.json'), 'utf8');

const tokenLinkIndex = html.indexOf('./styles/workbench-tokens.css');
const pageCssLinkIndex = html.indexOf('./styles/comment-manager.css');
assert(tokenLinkIndex >= 0, 'comment manager must load the production workbench tokens');
assert(pageCssLinkIndex > tokenLinkIndex, 'tokens must load before page styles');
assert.match(builder, /styles\/workbench-tokens\.css/);

[
  '--color-canvas',
  '--color-paper',
  '--color-ink',
  '--color-accent',
  '--color-accent-ink',
  '--color-focus',
  '--font-display',
  '--font-body',
  '--font-mono',
].forEach((token) => assert(tokens.includes(token), `missing workbench token: ${token}`));

[
  /Production Workbench V2 visual layer/,
  /\.sidebar \{ width: 220px; \}/,
  /\.right-sidebar \{ width: 250px; \}/,
  /\.field-header \{[\s\S]*position: sticky/,
  /\.htmlmd-group \{[\s\S]*--htmlmd-group-depth/,
  /@media \(max-width: 999px\)[\s\S]*translateX\(-105%\)/,
  /@media \(max-width: 639px\)[\s\S]*width: min\(310px, 88vw\)/,
  /html,[\s\S]*body[\s\S]*overflow-x: clip/,
].forEach((contract) => assert.match(css, contract));

assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'page CSS must consume color tokens');
assert.doesNotMatch(css, /rgba?\(/i, 'page CSS must not improvise RGB colors');
assert.doesNotMatch(css, /hsla?\(/i, 'page CSS must not improvise HSL colors');
const fontFamilies = Array.from(css.matchAll(/font-family:\s*([^;]+);/gi), (match) => match[1].trim());
fontFamilies.forEach((fontFamily) => {
  assert.match(fontFamily, /^var\(/, `page CSS font family must use a token: ${fontFamily}`);
});

console.log('comment manager workbench visual regression ok');
