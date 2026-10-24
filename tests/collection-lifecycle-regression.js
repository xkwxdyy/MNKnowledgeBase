'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { harness, start } = require('./research-core-regression')
const root = process.env.MNKB_TEST_ROOT || path.join(__dirname, '..')
async function run() {
  {
    const h = harness(), inbox = h.add('inbox'), old = h.add('existing-inbox-child', '命题', inbox)
    let mode = 'broad'; h.deps.collectionMode = () => mode; h.deps.defaultAnchor = () => inbox
    const r = h.add('receiver', '归类'); r.acceptType = '定义'
    await h.command('setReceiver', { noteId: r.noteId })
    const match = await h.service.processExcerpt(h.main, h.add('match', '定义'))
    assert.equal(match.route, 'receiver'); assert.equal(match.madeCard, true)
    const unmatched = await h.service.processExcerpt(h.main, h.add('unmatched', '命题'))
    assert.equal(unmatched.route, 'inbox'); assert.equal(unmatched.madeCard, false)
    assert.equal(h.notes.get(unmatched.noteId).parentNote.parentNote, inbox)
    assert.equal(old.parentNote, inbox, 'Existing Inbox content is never migrated')
    await h.command('addTemplate', { noteId: 'match', receive: true })
    assert.equal(h.service.state(h.main).receiver.noteId, r.noteId, 'Creation cannot replace a receiver')
    let finish; h.ocr(() => new Promise(resolve => { finish = resolve }))
    const waiting = h.service.processExcerpt(h.main, h.add('waiting', '定义'))
    const queued = h.service.processExcerpt(h.main, h.add('queued', '定义'))
    await Promise.resolve(); await Promise.resolve()
    mode = 'intensive'
    assert.equal(h.service.state(h.main).receiver.active, false)
    assert.equal((await h.service.processExcerpt(h.main, h.add('proof-step'))).handled, false)
    await assert.rejects(h.command('setReceiver', { noteId: r.noteId }), /scene-inactive/)
    finish(); assert.equal((await waiting).skipped, 'context-changed'); assert.equal((await queued).skipped, 'context-changed')
    h.ocr(null); mode = 'broad'
    assert.equal(h.service.state(h.main).receiver.active, false)
    assert.equal((await h.service.processExcerpt(h.main, h.add('after-return', '定义'))).route, 'inbox')
    await h.command('setReceiver', { noteId: r.noteId })
    assert.equal((await h.service.processExcerpt(h.main, h.add('after-restore', '定义'))).route, 'receiver')
    h.service.close(h.main, 'study')
    assert.equal(h.service.state(h.main).receiver.active, false)
    assert.equal((await h.service.processExcerpt(h.main, h.add('closed'))).handled, false)
    h.service.connect(h.main)
    assert.equal((await h.service.processExcerpt(h.main, h.add('reopen'))).route, 'inbox')
    assert.equal(h.service.state(h.main).receiver.active, false)
  }
  {
    const h = harness(); await start(h)
    let finish; h.ocr(() => new Promise(resolve => { finish = resolve }))
    const pending = h.service.processExcerpt(h.main, h.add('closing'))
    await Promise.resolve(); await Promise.resolve(); h.service.close(h.main, 'study'); finish()
    assert.equal((await pending).skipped, 'context-changed')
    assert.equal(h.calls.filter(c => c[0] === 'convert').length, 0)
    h.service.connect(h.main); assert.equal(h.service.state(h.main).activeProject, null)
  }
  {
    const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8'), calls = [], instance = { window: {} }
    const runtime = { close: (...args) => calls.push(['close', ...args]), connect: (...args) => calls.push(['connect', ...args]) }
    const context = vm.createContext({ self: instance, KnowledgeBaseResearchCore: { getRuntime: () => runtime }, KnowledgeBaseUtils: { addErrorLog(e) { throw e } } })
    for (const name of ['notebookWillClose', 'notebookWillOpen']) {
      const a = source.indexOf('    ' + name + ': function(topicid) {'), b = source.indexOf('\n    },', a)
      assert(a >= 0 && b > a, name)
      vm.runInContext('({' + source.slice(a, b) + '\n    }}).' + name + '("study")', context)
    }
    assert.deepEqual(calls, [['close', instance, 'study'], ['connect', instance]])
    const a = source.indexOf('    onPopupMenuOnNote:'), b = source.indexOf('处理来自其他插件的通信消息', a)
    assert.doesNotMatch(source.slice(a,b), /commitReadingFollowTarget|scheduleUntitledReadingFollowTarget/, 'Ordinary selection cannot activate or replace receiver')
  }
  {
    const calls = [], coreSource = fs.readFileSync(path.join(root, 'KnowledgeBaseResearchCore.js'), 'utf8')
    let scene = 'broad'
    const context = vm.createContext({ console: {log() {}}, module: {exports:{}}, capture: deps => deps,
      KnowledgeBaseTemplate: { getReadingScene: () => scene }, KnowledgeBaseConfig: { config: { excerptOCRMode: 2, readingFollowMode: true } },
      Application: { sharedInstance: () => ({}) } })
    vm.runInContext(coreSource.replace('runtime = create({', 'runtime = capture({'), context)
    const deps = context.module.exports.getRuntime(), valid = () => false
    const instance = { applyOCRToTitleWithMode: (...args) => calls.push(['markdown', ...args]), applyQuickReadingOCRToTitle: (...args) => calls.push(['plain', ...args]) }
    deps.ocr(instance, {noteId:'fixture'}, { researchScene:false, valid })
    assert.equal(calls[0][0], 'markdown'); assert.equal(calls[0][2], 2); assert.equal(calls[0][3].valid, valid)
    context.KnowledgeBaseConfig.config.excerptOCRMode = 1; deps.ocr(instance, {}, {valid})
    assert.equal(calls[1][0], 'plain'); assert.equal(calls[1][2].skipIndex, true)
    scene = 'intensive'; assert.equal(deps.collectionMode(instance), 'intensive')
    scene = ''; instance.readingCollectionStopped = true; assert.equal(deps.collectionMode(instance), '')
    instance.readingCollectionStopped = false; assert.equal(deps.collectionMode(instance), 'broad')
  }
  {
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
    const a = main.indexOf('  MNKnowledgeBaseClass.prototype.toggleReadingFollowMode = '), b = main.indexOf('  MNKnowledgeBaseClass.prototype.demoModeToggledInternal', a)
    let state = {sceneActive:true,collectionMode:'broad',notebookId:'study',receiver:{noteId:'old',title:'紧算子',type:'命题',active:false,available:true}}
    const commands = [], owner = {window:{},getSelectedNotes:()=>[{noteId:'selected'}]}, choices = [2,1]
    const context = vm.createContext({KnowledgeBaseTemplate:{getReadingScene:()=> 'broad'}, KnowledgeBaseConfig:{config:{}},
      KnowledgeBaseResearchCore:{getRuntime:()=>({state:()=>state,dispatch:(_,request)=>commands.push(request)})},
      MNUtil:{currentWindow:owner.window,currentNotebookId:'study',userSelect:async(title,detail,actions)=>{assert.match(detail,/等待手动恢复/);assert.deepEqual(Array.from(actions),['将选中卡片设为接收目标','恢复上次接收目标']);return choices.shift()}}})
    const menu = vm.runInContext('('+main.slice(main.indexOf(' = ',a)+3,b).trim()+')',context)
    await menu.call(owner); await menu.call(owner)
    assert.deepEqual(commands.map(c=>[c.command,c.payload.noteId]),[['setReceiver','old'],['setReceiver','selected']])
  }
  console.log('Collection lifecycle: Inbox fallback, matching, explicit restore, scene changes, queued OCR, close/reopen and native selectors passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
