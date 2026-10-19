const fs = require('./support/integration-fs.js');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const addonRoot = path.join(__dirname, '..');
const repositoryRoot = path.resolve(addonRoot, '..');
const utilsSource = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8');
const toolbarSource = fs.readFileSync(
  path.join(repositoryRoot, 'mntoolbar', 'mntoolbar', 'xdyy_custom_actions_registry.js'),
  'utf8',
);

function loadKnowledgeBaseConfig(modelSource) {
  const start = utilsSource.indexOf('class KnowledgeBaseConfig');
  const end = utilsSource.indexOf('\nclass HtmlMarkdownUtils', start);
  assert.notStrictEqual(start, -1, 'Cannot locate KnowledgeBaseConfig');
  assert.notStrictEqual(end, -1, 'Cannot locate KnowledgeBaseConfig end');
  const context = vm.createContext({
    console,
    Array,
    Object,
    String,
    JSON,
    ocrConfig: {
      modelSource(key) {
        return modelSource[key];
      },
    },
    KnowledgeBaseUtils: {
      addErrorLog(error) {
        throw error;
      },
    },
  });
  vm.runInContext(
    `${utilsSource.slice(start, end)}\nthis.KnowledgeBaseConfig = KnowledgeBaseConfig;`,
    context,
  );
  return context.KnowledgeBaseConfig;
}

const liveSource = JSON.parse(fs.readFileSync(path.join(repositoryRoot,
  'mntoolbar/mntoolbar/dev-notes/ocr-benchmark-2026-10-18/catalog.json'), 'utf8')).ocrModelSource;
const Config = loadKnowledgeBaseConfig(liveSource);

const available = Array.from(Config.getAvailableOCRSources(1));
assert.deepStrictEqual(
  available,
  [
    'gemini-3.5-flash-minimal',
    'qwen3.8-flash-nothinking',
    'glm-5.3-flashx-low',
    'glm-5.3-flash-nothinking',
    'doubao-seed-2-1-lite-nothinking',
  ],
  'direct OCR models must keep the benchmark ranking and exclude uncurated models',
);
assert.deepStrictEqual(
  Array.from(Config.getAvailableOCRSources(2)),
  [
    'Doc2X',
    'doubao-seed-1.6-flash-nothinking',
    'doubao-seed-1-6-nothinking',
    'qwen3.8-flash-nothinking',
    'glm-5.3-flash-nothinking',
    'glm-5.3-flashx-low',
    'SimpleTex',
  ],
  'Markdown OCR models must put the user-validated Doc2X default first',
);
assert.strictEqual(
  Config.DEFAULT_EXCERPT_OCR_MODEL,
  'gemini-3.5-flash-minimal',
  'the best direct OCR model must be the default',
);
assert.strictEqual(
  Config.DEFAULT_MARKDOWN_OCR_MODEL,
  'Doc2X',
  'the user-validated Doc2X model must be the mode 2 default',
);
assert.strictEqual(
  Config.defaultConfig.quickReadingOCRFallbackModel,
  'glm-5.3-flashx-low',
  'quick reading timeout fallback must use the live MNOCR source alias',
);
assert.strictEqual(
  Config.defaultConfig.quickReadingOCRTimeoutSeconds,
  12,
  'quick reading must stop waiting well before the old sixty-second provider timeout',
);

let saveCalls = 0;
Config.save = () => {
  saveCalls += 1;
};
Config.config = {
  excerptOCRModel: 'doubao-seed-1-8-nothinking',
  excerptOCRModelForMode1: 'doubao-seed-1-8',
  excerptOCRModelForMode2: 'Doc2X',
  excerptOCRModelForMode3: 'doubao-seed-1-8',
  excerptOCRTranslateModel: 'doubao-seed-1-8-nothinking',
  quickReadingOCRModel: 'doubao-seed-1-8',
  quickReadingOCRFallbackModel: 'removed-vision-model',
  excerptOCRModelIndex: 99,
};
Config.migrateDefaultOCRModels();
[
  'excerptOCRModel',
  'excerptOCRModelForMode1',
  'excerptOCRModelForMode3',
  'excerptOCRTranslateModel',
  'quickReadingOCRModel',
].forEach(key => {
  assert.strictEqual(
    Config.config[key],
    key === 'excerptOCRModelForMode3' ? 'qwen3.5-nothinking' : 'gemini-3.5-flash-minimal',
    `${key} must migrate to the curated direct OCR default`,
  );
});
assert.strictEqual(
  Config.config.excerptOCRModelForMode2,
  'Doc2X',
  'a valid vendor Markdown OCR setting must be preserved',
);
Config.config.excerptOCRModelForMode2 = '';
Config.migrateDefaultOCRModels();
assert.strictEqual(
  Config.config.excerptOCRModelForMode2,
  'Doc2X',
  'an empty Markdown OCR setting must migrate to the Doc2X default',
);
assert.strictEqual(
  Config.config.quickReadingOCRFallbackModel,
  'glm-5.3-flashx-low',
  'an unavailable quick-reading fallback must migrate to the tested fast fallback',
);
assert.strictEqual(saveCalls, 2, 'each model migration must persist exactly once');
assert.strictEqual(
  Config.config.excerptOCRModelIndex,
  available.indexOf('gemini-3.5-flash-minimal'),
  'the persisted menu index must match the live model list',
);

Config.config = {
  ...Config.defaultConfig,
  excerptOCRModel: 'glm-5v-turbo-nothinking',
  excerptOCRModelForMode1: 'glm-5v-turbo-nothinking',
  excerptOCRModelForMode2: 'glm-4.6v-nothinking',
  excerptOCRModelForMode3: 'glm-5v-turbo-nothinking',
  quickReadingOCRFallbackModel: 'glm-4.6v-nothinking',
};
Config.migrateDefaultOCRModels();
assert.strictEqual(Config.config.excerptOCRModel, 'glm-5v-turbo-nothinking');
assert.strictEqual(Config.config.excerptOCRModelForMode1, 'glm-5v-turbo-nothinking');
assert.strictEqual(Config.config.excerptOCRModelForMode2, 'glm-4.6v-nothinking');
assert.strictEqual(Config.config.quickReadingOCRFallbackModel, 'glm-4.6v-nothinking');

Config.config = {
  ...Config.defaultConfig,
  excerptOCRModel: 'gpt-4.1-mini',
  excerptOCRModelForMode1: 'gpt-4.1-mini',
  excerptOCRModelForMode3: 'gpt-4.1-mini',
};
Config.migrateDefaultOCRModels();
assert.strictEqual(Config.config.excerptOCRModel, 'gpt-4.1-mini');
assert.strictEqual(Config.config.excerptOCRModelForMode1, 'gpt-4.1-mini');
assert.strictEqual(Config.config.excerptOCRModelForMode3, 'gpt-4.1-mini');

assert.match(
  utilsSource,
  /ocrConfig\.inModelSource\(ocrSource\)/,
  'new server-activated OCR models must not require another hard-coded switch edit',
);
assert.match(
  utilsSource,
  /model\[_ -\]\?not\[_ -\]\?found[\s\S]*?doubao-seed-2-0-mini-nothinking/,
  'model_not_found responses for saved Doubao 1.8 configurations must have a safe fallback',
);
assert.match(
  toolbarSource,
  /KnowledgeBaseConfig\.getAvailableOCRSources\(mode\)/,
  'MNToolbar must request the MNKnowledgeBase list for the active OCR mode',
);

console.log('OCR model availability regression ok');
