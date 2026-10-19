// Cross-repository tests require an explicit map; public CI never loads siblings.
const fs = require('node:fs');
const path = require('node:path');
const addonRoot = path.resolve(__dirname, '../..');
const parent = path.dirname(addonRoot);
function resolveSource(filename) {
  if (typeof filename !== 'string') return filename;
  const absolute = path.resolve(filename);
  const ownRelative = path.relative(addonRoot, absolute);
  if (!ownRelative.startsWith('..' + path.sep) && ownRelative !== '..') return absolute;
  const relative = path.relative(parent, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('Integration source escapes the configured workspace');
  const [name, ...rest] = relative.split(path.sep);
  const key = name === 'batch_build_addons.sh' || name === 'batch_fetch_latest_addons.sh' ? 'internal' : name;
  const roots = JSON.parse(process.env.MNKB_PROJECT_ROOTS || '{}');
  const root = roots[key];
  if (!root || !path.isAbsolute(root)) throw new Error(`MNKB_PROJECT_ROOTS must provide an absolute ${key} project root`);
  return path.join(root, ...(key === 'internal' ? [name] : rest));
}
module.exports = { ...fs, readFileSync(filename, ...args) { return fs.readFileSync(resolveSource(filename), ...args); } };
