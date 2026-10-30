#!/usr/bin/env node

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const addonRoot = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(addonRoot, 'utils.js'), 'utf8')

function loadTemplate() {
  const registry = new Map()
  const context = {
    console,
    Map,
    Set,
    WeakMap,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Math,
    Promise,
    MNUtil: {
      db: {
        createNoteWithTitleTopicid() {},
      },
      log() {},
      showHUD() {},
    },
    MNNote: {
      new(noteId) {
        return registry.get(String(noteId))
      },
      detachMergedSourceFromParent(sourceNote, targetNote, expectedParent) {
        assert.strictEqual(sourceNote.parentNote, expectedParent)
        assert.strictEqual(sourceNote.groupNoteId, targetNote.noteId)
        sourceNote.removeFromParent()
        return true
      },
    },
    KnowledgeBaseUtils: {
      addErrorLog(error) {
        throw error
      },
    },
    HtmlMarkdownUtils: {
      isHtmlMDComment() {
        return false
      },
    },
  }
  context.global = context
  context.globalThis = context
  context.__registry = registry

  const end = source.indexOf('\nclass KnowledgeBaseIndexer')
  assert.notEqual(end, -1, 'Cannot locate KnowledgeBaseTemplate')
  vm.createContext(context)
  vm.runInContext(
    `${source.slice(0, end)}\nthis.KnowledgeBaseTemplate = KnowledgeBaseTemplate;`,
    context,
    { filename: 'mnknowledgebase-utils.js' },
  )
  return context
}

function assertExcerptConversionRemovesOnlyTheStaleStructuralParent() {
  const context = loadTemplate()
  const Template = context.KnowledgeBaseTemplate
  const registry = context.__registry
  const parent = {
    noteId: 'PARENT-1',
    childNotes: [],
    createChildNote(config) {
      this.lastCreateConfig = config
      const target = {
        noteId: 'TARGET-1',
        noteTitle: config.title,
        parentNote: this,
        childNotes: [],
        comments: [],
        moveTo(index) {
          this.movedTo = index
        },
      }
      this.childNotes.push(target)
      registry.set(target.noteId, target)
      return target
    },
  }
  const sourceNote = {
    noteId: 'SOURCE-1',
    noteTitle: 'Excerpt title',
    colorIndex: 2,
    excerptType: 'image',
    parentNote: parent,
    childNotes: [],
    comments: [],
    indexInBrotherNotes: 0,
    mergeInto(target) {
      this.groupNoteId = target.noteId
      target.comments.push({ type: 'LinkNote', noteid: this.noteId })
    },
    removeFromParent() {
      const index = this.parentNote.childNotes.indexOf(this)
      if (index >= 0) this.parentNote.childNotes.splice(index, 1)
      this.parentNote = null
      this.removeFromParentCalls = (this.removeFromParentCalls || 0) + 1
    },
  }
  parent.childNotes.push(sourceNote)
  registry.set(parent.noteId, parent)
  registry.set(sourceNote.noteId, sourceNote)

  const originals = {
    collect: Template.collectClassificationNotesForContainSync,
    parent: Template.getFirstClassificationParentNote,
    cleanup: Template.cleanupConvertedExcerptSourceLinks,
  }
  Template.collectClassificationNotesForContainSync = () => []
  Template.getFirstClassificationParentNote = () => null
  Template.cleanupConvertedExcerptSourceLinks = () => {}
  try {
    const converted = Template.toNoExcerptVersion(sourceNote)
    assert.strictEqual(converted.noteId, 'TARGET-1')
    assert.strictEqual(converted.movedTo, 0)
    assert.strictEqual(sourceNote.removeFromParentCalls, 1)
    assert.deepStrictEqual(parent.childNotes.map(note => note.noteId), ['TARGET-1'])
    assert.equal(parent.lastCreateConfig._mnkbMakeCardDiagnostic, undefined)
    assert.equal(converted.comments[0].noteid, 'SOURCE-1')
  } finally {
    Template.collectClassificationNotesForContainSync = originals.collect
    Template.getFirstClassificationParentNote = originals.parent
    Template.cleanupConvertedExcerptSourceLinks = originals.cleanup
  }
}

function assertTopLevelExcerptConversion() {
  const context = loadTemplate()
  const Template = context.KnowledgeBaseTemplate
  Template.collectClassificationNotesForContainSync = () => []
  Template.getFirstClassificationParentNote = () => null
  Template.cleanupConvertedExcerptSourceLinks = () => {}
  const sourceNote = {
    noteId: 'ROOT-SOURCE', noteTitle: 'Root excerpt', notebookId: 'BOOK-1',
    docMd5: 'DOC-1', startPage: 3, colorIndex: 2,
    excerptType: 'image', parentNote: null, indexInBrotherNotes: -1,
    mergeInto(target) { target.comments.push({ type: 'LinkNote', noteid: this.noteId }) },
  }
  const target = { noteId: 'ROOT-TARGET', parentNote: null, comments: [],
    moveTo() { assert.fail('A root note cannot move through a parent') } }
  let createdConfig
  context.MNNote.new = config => { createdConfig = config; return target }
  assert.strictEqual(Template.toNoExcerptVersion(sourceNote), sourceNote, 'Legacy callers retain the root guard')
  const result = Template.toNoExcerptVersion(sourceNote, undefined, { allowTopLevel: true })
  assert.strictEqual(result, target)
  assert.equal(createdConfig.notebookId, 'BOOK-1')
  assert.equal(createdConfig.docId, 'DOC-1')
  assert.equal(createdConfig.pageNumber, 3)
  assert.equal(result.parentNote, null)
  assert.equal(result.comments[0].noteid, 'ROOT-SOURCE')
  assert.equal(result.kbSourceExcerptNoteId, 'ROOT-SOURCE')
  sourceNote.noteTitle = 'Title before failed creation'
  context.MNNote.new = () => null
  assert.throws(() => Template.toNoExcerptVersion(sourceNote, undefined, { allowTopLevel: true }), /non-excerpt-create-failed/)
  assert.equal(sourceNote.noteTitle, 'Title before failed creation')
}

assertExcerptConversionRemovesOnlyTheStaleStructuralParent()
assertTopLevelExcerptConversion()
assert(!source.includes('makeCardConversionDiagnostic'))
assert(!source.includes('_mnkbMakeCardDiagnostic'))
console.log('make-card conversion regression: ok')
