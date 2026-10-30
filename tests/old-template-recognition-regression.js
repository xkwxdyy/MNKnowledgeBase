const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utils.js'), 'utf8');
const end = source.indexOf('\nclass KnowledgeBaseIndexer');
assert.ok(end > 0);
const context = {
  console,
  KnowledgeBaseConfig: { config: {} },
  KnowledgeBaseUtils: { addErrorLog(error) { throw error; } },
  HtmlMarkdownUtils: { isHtmlMDComment() { return false; } },
  MNUtil: { undoGrouping(block) { return block(); }, showHUD(message) { throw Error(message); } },
};
vm.createContext(context);
vm.runInContext(source.slice(0, end) + '\nthis.Template = KnowledgeBaseTemplate;', context);
const Template = context.Template;
const realFinalizer = Template.templateMergedCardMake;
const field = text => ({ type: 'HtmlComment', text });
const text = text => ({ type: 'markdownComment', text });
let localRefreshes = 0;
class Note {
  constructor(comments = []) {
    this.noteId = 'fixture'; this.colorIndex = 10; this.comments = comments;
    this.childNotes = []; this.title = '命题';
  }
  get MNComments() { return this.comments; }
  convertLinksToNewVersion() {}
  cleanupBrokenLinks() {}
  fixMergeProblematicLinks() {}
  refresh() { localRefreshes++; }
  clone() { return new Note(this.comments.map(comment => ({ ...comment }))); }
  removeCommentsByIndexArr(indices) {
    [...indices].sort((a, b) => b - a).forEach(index => this.comments.splice(index, 1));
  }
  addChild(child) { this.childNotes.push(child); child.parentNote = this; }
  mergeInto(target) { target.comments.push(...this.comments); }
  moveCommentsByIndexArr(indices) { const moved = indices.map(index => this.comments[index]); this.removeCommentsByIndexArr(indices); this.comments.push(...moved); }
  createChildNote() { const child = new Note(); this.addChild(child); return child; }
  appendMarkdownComment(value) { this.comments.push(text(value)); }
  appendTextComment(value) { this.comments.push({ type: 'linkComment', text: value }); }
}
const modern = ['证明', '所属', '相关链接', '相关思考'];
for (const label of ['归纳总结', ' 归纳 总结： ', '📝 归纳总结：', 'Remark', 'remark:', 'REMARK：', 'ReMaRk', '📝 Remark：']) {
  for (const fields of [['证明', label, '所属'], [...modern, label]]) {
    assert.equal(Template.isOldTemplateCard(new Note(fields.map(field))), true, label);
  }
}
for (const fields of [modern, ['证明：', '所属:', '相关链接'], ['关键词', '包含', '应用'], []]) {
  assert.equal(Template.isOldTemplateCard(new Note(fields.map(field))), false, fields.join(','));
}
assert.equal(Template.isOldTemplateCard(new Note(['证明', '所属'].map(field))), true);
assert.equal(Template.isOldTemplateCard(new Note(['证明', '应用', '所属'].map(field))), true);
assert.equal(Template.isOldTemplateCard(new Note([...modern, '应用'].map(field))), false);
assert.equal(Template.isOldTemplateCard(new Note([...modern, '应用'].map(field).concat([{type:'HtmlComment',text:'unknown HTML body'}]))), false, 'unknown HTML inside application is content, not a later field');
assert.equal(Template.isOldTemplateCard(new Note([...modern.map(field), {type:'HtmlComment',text:'应用示例的正文'}, field('所属')])), false, 'substring matches are not application headers');
assert.equal(Template.isOldTemplateCard(new Note([
  ...modern.map(field), text('remark 与归纳总结属于正文'),
  { type: 'markdownComment', text: '<span id="remark">remark</span>' },
])), false, 'Body text and semantic remark comments are not legacy field markers');

// Keep the real parser, detector, migration and entry routing; replace unrelated finalization.
const calls = [];
Object.assign(Template, {
  toNoExcerptVersion(note) { return note; },
  sanitizeNoteCommentsForMake() {},
  changeTitle() {}, changeNoteColor() {},
  _beginMakeCardPerf() { return null; }, _recordMakeCardPerf() {}, _finishMakeCardPerf() {},
  _makeCardPerfNow() { return 0; },
  getQuickReadingMakeCardPolicy() { return { mode: 'normal', noteType: '命题' }; },
  mergeTemplateAndAutoMoveNoteContent(note) {
    assert.equal(Template.isOldTemplateCard(note), false, 'Migration must precede template merging: '+note.comments.map(c=>c.text).join('|'));
    calls.push('merge');
  },
  templateMergedCardMake() { calls.push('make'); },
  moveClassificationLinksFromApplicationToRelatedField() { return {}; },
  linkParentNote() {},
  syncFinalMakeCardIndex() {}, shouldSuppressQuickReadingDefinitionIndexHUD() { return false; },
});
const realMigration = Template.processOldTemplateCard;
Template.processOldTemplateCard = function (note, options) { calls.push('migrate'); return realMigration.call(this, note, options); };
const realPreflight = Template.assertMakeCardTemplateAvailable;
Template.requireMakeCardTemplate = () => { calls.push('require-template'); return new Note(modern.concat(['应用']).map(field)); };

for (const label of ['归纳总结', 'remark', 'Remark']) {
  for (const entry of ['makeCard', 'makeNote', 'preprocess', 'makeNote-preprocess']) {
    context.KnowledgeBaseConfig.config.preProcessMode = entry === 'makeNote-preprocess';
    const excerpt = { type: 'mergedImageComment', text: 'excerpt' };
    const drawing = { type: 'drawingComment', text: 'drawing' };
    const image = { type: 'imageComment', text: 'image' };
    const url = 'marginnote4app://note/fixture-reference';
    const note = new Note([excerpt, field('证明'), text('proof body'), drawing, image,
      field(label), text('summary body'), field('应用'), { type: 'linkComment', text: url }, field('所属')]);
    const originalChild = new Note([text('existing child')]);
    note.addChild(originalChild);
    calls.length = 0;
    realPreflight.call(Template, note, { directMakeCard: true });
    assert.deepEqual(calls, ['require-template'], 'Recognized old cards must validate their migration template');
    Template.assertMakeCardTemplateAvailable = () => {};
    calls.length = 0;
    let result;
    if (entry === 'preprocess') result = Template.processNote(note, '命题', { deferFinalization: true });
    else if (entry.startsWith('makeNote')) result = Template.makeNote(note, false, false, false, { undoGrouping: false, throwOnFailure: true });
    else result = Template.makeCard(note, false, false, { throwOnFailure: true });
    assert.equal(result, note);
    assert.deepEqual(calls.filter(call => call !== 'require-template'), entry === 'preprocess' ? ['migrate']
      : entry === 'makeNote-preprocess' ? ['migrate', 'merge'] : ['migrate', 'merge', 'make']);
    assert.ok(note.comments.includes(excerpt), 'Original excerpt must survive migration');
    for (const value of ['proof body', 'drawing', 'image', url]) assert.equal(note.comments.filter(comment => comment.text === value).length, 1, value + ' stays in its core field');
    assert.equal(note.childNotes[0], originalChild, 'Existing children must remain');
    const migrated = note.childNotes.slice(1).flatMap(child => child.comments);
    for (const value of ['summary body', label]) {
      assert.equal(migrated.filter(comment => comment.text === value).length, 1, value + ' must survive exactly once');
    }
    if (entry !== 'preprocess') assert.equal(Template.isOldTemplateCard(note), false, 'A fully made card must not migrate again');
    const childCount = note.childNotes.length;
    realMigration.call(Template, note);
    assert.equal(note.childNotes.length, childCount, 'Repeated migration cannot archive the same content twice');
  }
}
// The ordinary finalizer treats trailing application prose as newly appended
// proof content. Legacy conversion must opt out only for the already filed card.
let autoMoves = 0;
Object.assign(Template, {
  templateMergedCardMake: realFinalizer,
  autoMoveNewContent(note) {
    autoMoves++;
    const application = this.findFieldObjectByNormalizedName(note, '应用');
    const indices = application.excludingFieldBlockIndexArr;
    const values = indices.map(i => note.comments[i]);
    note.removeCommentsByIndexArr(indices);
    note.comments.splice(2, 0, ...values);
  },
  moveTaskCardLinksToRelatedField() {}, moveSummaryLinksToTop() {}, handleDefinitionPropositionLinks() {},
  ensureProofLinkedNotesApplicationLinks() {}, cleanupMakeCardClassificationLinkFields() {}, refreshNotes() {},
  getNoteType() { return '命题'; }, isIntermediateKnowledge() { return false; },
  queueIntermediateKnowledgeCompletion() {}, completeIntermediateKnowledge() {},
  syncFinalMakeCardIndex() { return { success: true }; },
  requireMakeCardTemplate() { return new Note(['证明','所需知识','所属','相关链接','相关思考','应用'].map(field)); },
});
const applicationNote = () => new Note([field('证明'), text('proof'), field('所需知识'), text('needed'),
  field('相关思考'), text('thought'), field('remark'), text('archive'), field('应用'), text('application'),
  { type: 'HtmlComment', text: 'unknown HTML body' }, text('unknown body tail')]);
const preserved = applicationNote();
localRefreshes = 0;
Template.makeLegacyCard(preserved, { noteType: '命题', undoGrouping: false });
assert.equal(autoMoves, 0, 'legacy application must not enter ordinary new-content classification');
assert.equal(localRefreshes, 0, 'legacy archive migration relies on the outer UI refresh, not nested comment-writing refreshes');
assert.deepEqual(Array.from(Template.previewOldTemplateCard(preserved).blocks.find(b => b.field === '应用').indices,
  i => preserved.comments[i].text), ['应用', 'application', 'unknown HTML body', 'unknown body tail']);
for (const entry of ['makeCard', 'makeNote']) {
  context.KnowledgeBaseConfig.config.preProcessMode = false;
  const ordinaryLegacy = applicationNote();
  if (entry === 'makeCard') Template.makeCard(ordinaryLegacy, false, false, {throwOnFailure:true});
  else Template.makeNote(ordinaryLegacy, false, false, false, {undoGrouping:false,throwOnFailure:true});
  assert.equal(autoMoves, 0, entry + ' must preserve already assigned legacy application content');
  assert.deepEqual(Array.from(Template.previewOldTemplateCard(ordinaryLegacy).blocks.find(b => b.field === '应用').indices,
    i => ordinaryLegacy.comments[i].text), ['应用', 'application', 'unknown HTML body', 'unknown body tail']);
}
Template.templateMergedCardMake(applicationNote(), '命题');
assert.equal(autoMoves, 1, 'ordinary make-card classification retains its existing behavior');

class OffsetNote extends Note {
  get MNComments() { return this.comments.map((c, index) => ({ ...c, index, detail: c })).filter(c => c.type !== 'RawOnly'); }
}
const offset = new OffsetNote([{type:'RawOnly', text:'unmanaged raw content'}, field('应用'), text('application'),
  {type:'HtmlComment',text:'unknown HTML body'}, text('unknown body tail'),
  field('证明'), text('proof'), field('所需知识'), field('相关思考')]);
Template.ensureLegacyCardTemplate(offset, '命题');
assert.equal(offset.comments[0].text, 'unmanaged raw content', 'raw-only comment is not selected by a manager index');
assert.deepEqual(offset.comments.slice(-4).map(c => c.text), ['应用','application','unknown HTML body','unknown body tail'],
  'move the entire explicit legacy application block, including unknown HTML, using raw indices');
console.log('old template recognition: legacy labels, modern exclusions, preflight, direct make, preprocessing and content preservation passed');
