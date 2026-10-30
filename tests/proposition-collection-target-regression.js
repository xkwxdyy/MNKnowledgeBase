'use strict'
const assert = require('node:assert/strict')
const { harness } = require('./research-core-regression')
async function run() {
  const h = harness(), receiver = h.add('proposition', '命题')
  h.deps.collectionMode = () => 'broad'
  await h.command('setReceiver', { noteId: receiver.noteId })
  h.deps.defaultAnchor = () => { throw Error('Matching manual receiver must not require Inbox') }
  h.deps.beginDefinition = () => { throw Error('Proposition collection must not extract concepts') }
  for (const type of ['命题', '定义', '例子', '反例', '约定', '']) {
    const note = h.add('excerpt-' + (type || 'untyped'), type), result = await h.service.processExcerpt(h.main, note)
    assert.equal(result.targetNoteId, receiver.noteId)
    assert.equal(result.madeCard, false); assert.equal(result.addedToReview, false)
    assert.deepEqual(h.calls.filter(c => c[1] === note.noteId).map(c => c[0]), ['type','move','ocr','convert','index'])
  }
  const typed = h.add('typed', '归类'); typed.acceptType = '命题'
  await h.command('setReceiver', { noteId: typed.noteId })
  const made = await h.service.processExcerpt(h.main, h.add('matching', '命题'))
  assert.equal(made.madeCard, true); assert.equal(made.addedToReview, false)
  console.log('Broad proposition targets accept all types with OCR/conversion only; typed targets still make full cards')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
