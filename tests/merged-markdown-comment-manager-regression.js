#!/usr/bin/env node

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const actionsMerge = read('scripts/comment-manager/actions-merge.js')
const actionsTextMerge = read('scripts/comment-manager/actions-text-merge.js')
const dataNative = read('scripts/comment-manager/data-native.js')
const renderCards = read('scripts/comment-manager/render-cards.js')
const controller = read('knowledgebaseWebController.js')
const main = read('main.js')

assert.match(actionsMerge, /'mergedMarkdownComment'/)
assert.match(actionsTextMerge, /'mergedMarkdownComment'/)
assert.match(dataNative, /if \(comment\.markdown\) \{\s*return 'mergedMarkdownComment';/)
assert.match(renderCards, /mergedMarkdownComment: createMarkdownCardContent/)
assert.match(renderCards, /comment\.type === 'markdownComment' \|\| comment\.type === 'mergedMarkdownComment'/)
assert.match(controller, /"mergedMarkdownComment"/)
assert.match(main, /case "LinkNote":\s*\/\/ 合并评论：可能包含文本或图片\s*commentData\.markdown = !!rawComment\.markdown;/)

console.log('MNKnowledgeBase merged Markdown comment-manager contract regression: ok')
