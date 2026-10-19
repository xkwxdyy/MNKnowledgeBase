const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const controllerSource = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8');
const mergeCall = 'KnowledgeBaseTemplate.renewKnowledgeNotes(targetNote, sourceNote, mergeOptions)';
const mergeCallIndex = controllerSource.indexOf(mergeCall);
assert.notStrictEqual(mergeCallIndex, -1, 'duplicate knowledge merge must pass one options object');

const optionsStart = controllerSource.lastIndexOf('const mergeOptions = {', mergeCallIndex);
const optionsEnd = mergeCallIndex + mergeCall.length;
assert.notStrictEqual(optionsStart, -1, 'duplicate knowledge merge options block is missing');
const optionsSource = controllerSource.slice(optionsStart, optionsEnd)
  .replace(mergeCall, 'this.result = mergeOptions');

function buildMergeOptions(sourceType) {
  const sandbox = {
    KnowledgeBaseTemplate: {
      getNoteType() {
        return sourceType;
      },
    },
    config: {
      params: {
        removeTitle: false,
        keepOnlyExcerpt: false,
        locateAfterMerge: false,
      },
    },
    sourceNote: {},
    mergePosition: 'below',
    parseBooleanParam(value, defaultValue) {
      return value === undefined ? defaultValue : value === true;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(optionsSource, sandbox, { filename: 'merge-options-regression.js' });
  return sandbox.result;
}

const classificationOptions = buildMergeOptions('归类');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(classificationOptions)),
  {
    removeTitle: false,
    keepOnlyExcerpt: false,
    toBottom: true,
    focusAfterMerge: false,
    skipFields: ['所属'],
  },
  'classification merge must skip only the structural 所属 field',
);

const propositionOptions = buildMergeOptions('命题');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(propositionOptions)),
  {
    removeTitle: false,
    keepOnlyExcerpt: false,
    toBottom: true,
    focusAfterMerge: false,
  },
  'non-classification merge options must remain unchanged',
);

console.log('merge classification belonging regression: ok');
