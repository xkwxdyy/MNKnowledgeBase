#!/usr/bin/env node

const assert = require('node:assert/strict')
const fs = require('./support/integration-fs.js')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const literature = read('mnliterature/utils.js')
const knowledgeBase = read('mnknowledgebase/utils.js')
const knowledgeBaseController = read('mnknowledgebase/knowledgebaseWebController.js')
const pinner = read('mnpinner/src/utils.js')
const commentManager = fs.readFileSync(
  path.join(root, 'mncommentmanager', 'src', 'CommentMutations.js'),
  'utf8',
)

assert.match(literature, /literatureUtils\.log\(message, "literatureNoteUtils\.createChildNoteCompat"/)
assert.match(literature, /requestedDocId: documentId/)
assert.match(literature, /requestedPageNumber: hasExplicitPageNumber \? pageNumber : null/)
assert.match(literature, /creationPath/)
assert.match(knowledgeBase, /conversionTraceId = `kb_no_excerpt_/)
assert.match(knowledgeBase, /logConversionDiagnostic\("转非摘录缺少文档身份或页码/)
assert.match(knowledgeBaseController, /KnowledgeBaseUtils\.log\("脑图定位调用失败"/)
assert.match(pinner, /source: "refreshAfterDBChangedCompat"[\s\S]*message: "final refresh failed"/)
assert.match(commentManager, /function logMutationDiagnostic\(level, message, detail\)/)
assert.match(commentManager, /新建空白子卡片缺少稳定 noteId/)

console.log('dangerous path structured logging regression: ok')
