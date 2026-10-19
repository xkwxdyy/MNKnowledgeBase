#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const controller = fs.readFileSync(path.join(root, 'knowledgebaseWebController.js'), 'utf8')

assert(main.includes('const TITLE_REFACTOR_MAX_CARDS = 3000'))
assert(main.includes('const queue = [root]'))
assert(main.includes('self._titleRefactorWorkbenchOpening'))
assert(main.includes('const deadline = Date.now() + 3500'))
assert(main.includes("__title_refactor_guard_timeout__"))
assert(!main.includes('return this.openTitleRefactorWorkbench(targetNote)'))
assert(controller.includes("reason: 'payload-too-large'"))
assert(controller.includes("__title_refactor_webview_timeout__"))

console.log('title refactor workbench open regression ok')
