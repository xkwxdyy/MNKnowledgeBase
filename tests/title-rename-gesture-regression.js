'use strict'
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
let owner, scene = 'broad', allowed = true, currentBook = 'book', osType = 0, focusWindow, refreshes = 0, clipboard = null
const gestures = [], observers = [], removed = [], dialogs = [], errors = [], undo = [], redo = []
const notes = { a: { noteId: 'a', notebookId: 'book', noteTitle: '定义群' }, b: { noteId: 'b', notebookId: 'book', noteTitle: '定义环' } }
const rootView = { hidden: false, alpha: 1, frame: {x:0,y:0,width:1000,height:800} }, view = { hidden: false, alpha: 1, superview: rootView,
  addGestureRecognizer: g => {gestures.push(g);g.view=view;g.enabled=true}, removeGestureRecognizer: g => { const i=gestures.indexOf(g); if(i>=0) gestures.splice(i,1);g.view=null } }
rootView.subviews=[view];view.frame={x:200,y:716,width:500,height:62};view.subviews=[{}];view.gestureRecognizers=gestures
let selection = [{ note: { note: notes.a } }, { note: { note: notes.b } }]
const study = { view: rootView, notebookController: { get notebookId() { return currentBook }, mindmapView: { get selViewLst() { return selection } } } }
const center = { addObserverSelectorName: (o, selector, name) => observers.push({ o, selector, name }), removeObserverName: (o, name) => removed.push({ o, name }) }
const app = { appVersion:'test-version',build:'test-build',studyController: () => study, get focusWindow() { return focusWindow }, get osType() { return osType }, checkNotifySenderInWindow: (s,w) => s.object === w, showHUD: text => errors.push(text), refreshAfterDBChanged: () => refreshes++ }
const context = { MNUtil: {studyHeight:800,copy:text=>{clipboard=text}}, Application: { sharedInstance: () => app, immersiveTemplateForAddon: () => ({ allowed, config: { scene } }) },
  Database: { sharedInstance: () => ({ getNoteById: id => notes[id] }) },
  NSNotificationCenter: { defaultCenter: () => center },
  UISwipeGestureRecognizer: function(o, selector) { this.owner = o; this.selector = selector },
  UIAlertView: { showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock: (title, message, style, cancel, buttons, callback) => {
    if(style===0){assert.equal(cancel,'关闭');assert.deepEqual(Array.from(buttons),['复制诊断'])}
    else{assert.equal(style,2); assert.equal(cancel,'取消'); assert.deepEqual(Array.from(buttons),['重命名'])}
    const field={text:''}, alert={callback, field, cancelButtonIndex:0, firstOtherButtonIndex:1, textFieldAtIndex: () => field, dismissWithClickedButtonIndexAnimated: i => callback(alert,i)}; dialogs.push(alert); return alert
  } },
  UndoManager: { sharedInstance: () => ({ undoGrouping: (label, book, callback) => { assert.equal(book,'book'); const snapshot=Object.fromEntries(Object.entries(notes).map(([id,n])=>[id,n.noteTitle])); callback(); undo.push(snapshot) } }) }
}
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'KnowledgeBaseTitleRename.js'),'utf8'),context)
const feature=context.KnowledgeBaseTitleRename
let count=0
function test(name, callback) { callback(); count++; console.log('PASS '+name) }
function makeOwner() { const o={window:{}}; feature.connect(o); return o }
function bind(o=owner, target=view) { feature.bind(o,{object:o.window,userInfo:{bottomToolbar:target}}) }
function swipe() { feature.swipe(owner, owner.kbTitleRename.gesture); return dialogs.at(-1) }
function confirm(text, alert=dialogs.at(-1)) { alert.field.text=text; alert.callback(alert,1) }
function titles() { return Object.values(notes).map(n=>n.noteTitle) }
function assertRule(input, title, expected) { const r=feature.parse(input);assert.equal(title.replace(r.regexp,r.replacement),expected) }
owner=makeOwner();focusWindow=owner.window
test('native selector bindings and payload', () => {
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8')
  for(const name of ['onKBTitleRenameSelection','onKBTitleRenameClosed','onKBTitleRenameSwipe','onKBTitleRenameNativeSelection','onKBTitleRenameTemplateChanged','onKBTitleRenameDiagnostic','controllerWillLayoutSubviews']) assert.match(main,new RegExp(name+': function'))
  assert.match(main,/JSB.require\('KnowledgeBaseTitleRename'\)/)
  assert(require(path.join(root,'build/payload.json')).includes('KnowledgeBaseTitleRename.js'))
})
test('connect once per window',()=>{feature.connect(owner);assert.equal(observers.length,4)})
test('native toolbar notification required',()=>{feature.bind(owner,{object:{},userInfo:{bottomToolbar:view}});assert.equal(gestures.length,0);bind(owner,null);assert.equal(gestures.length,0)})
test('hidden and foreign view rejected',()=>{view.hidden=true;bind();assert.equal(gestures.length,0);view.hidden=false;bind(owner,{superview:{}});assert.equal(gestures.length,0)})
test('all template modes supported and no Mac touch claim',()=>{for(const m of ['broad','intensive','research','literature']){scene=m;bind();assert.equal(gestures.length,1);feature.clear(owner)}osType=2;bind();assert.equal(gestures.length,0);osType=0;scene='broad'})
test('left swipe attaches only to toolbar without cancelling clicks',()=>{bind();assert.equal(gestures.length,1);assert.equal(gestures[0].direction,2);assert.equal(gestures[0].numberOfTouchesRequired,1);assert.equal(gestures[0].cancelsTouchesInView,false);bind();assert.equal(gestures.length,1)})
test('single selection never opens input',()=>{const saved=selection;selection=[selection[0]];feature.swipe(owner,gestures[0]);assert.equal(dialogs.length,0);selection=saved})
test('duplicate swipe opens only one input',()=>{swipe();swipe();assert.equal(dialogs.length,1);dialogs[0].callback(dialogs[0],0);assert.equal(undo.length,0)})
test('native cancel button never writes while confirmation uses index 1',()=>{
  const before=titles();const a=swipe();a.field.text='must not write';a.callback(a,0);assert.deepEqual(titles(),before);assert.equal(owner.kbTitleRename.pending,null)
})
test('captures rename selected titles in one undo group and one refresh',()=>{swipe();confirm('(/^(定义)(.*)$/, "概念$2")');assert.deepEqual(titles(),['概念群','概念环']);assert.equal(undo.length,1);assert.equal(refreshes,1);assert.equal(errors.length,0)})
test('native undo and redo snapshot semantics',()=>{const after=titles(),before=undo.pop();redo.push(after);Object.entries(before).forEach(([id,title])=>notes[id].noteTitle=title);assert.deepEqual(titles(),['定义群','定义环']);const value=redo.pop();Object.keys(notes).forEach((id,i)=>notes[id].noteTitle=value[i]);assert.deepEqual(titles(),after)})
test('regex parser handles slash, character class, flags and escaped replacement',()=>{
  assertRule('(/a\\/b/g, "x")','a/b a/b','x x')
  assertRule('(/[/]/g, "-")','a/b','a-b')
  assertRule('(/a/i, "b")','A','b')
  assertRule('(/a/g, "x\\n\\\"y")','a','x\n"y')
  assertRule('(/a/g, "b/g, c")','a','b/g, c')
  assertRule('前缀 $&','甲\n乙','前缀 甲\n乙')
  assertRule('新标题','','新标题')
})
test('invalid expressions and unsupported old macros never write',()=>{for(const input of ['(/[/, "x")','(/a/gg, "x")','(/a/z, "x")','(/a/, "\\q")','(/a/, (()=>1)())','%["1"] $&']){const before=titles(),n=undo.length;swipe();confirm(input);assert.deepEqual(titles(),before);assert.equal(undo.length,n)}})
test('global and sticky expressions reset per card',()=>{notes.a.noteTitle='aa';notes.b.noteTitle='aa';swipe();confirm('(/a/gy, "b")');assert.deepEqual(titles(),['bb','bb'])})
test('no-op replacement neither refreshes nor creates undo',()=>{const n=undo.length,r=refreshes;swipe();confirm('(/q/g, "b")');assert.equal(undo.length,n);assert.equal(refreshes,r)})
test('invalid second target blocks all writes',()=>{swipe();const before=titles();notes.b.notebookId='other';confirm('bad');assert.deepEqual(titles(),before);notes.b.notebookId='book'})
test('concurrent title edit cancels entire batch',()=>{swipe();notes.b.noteTitle='external edit';confirm('bad');assert.deepEqual(titles(),['bb','external edit'])})
test('setter failure restores previously written titles',()=>{
  const previous=notes.b.noteTitle,n=undo.length
  Object.defineProperty(notes.b,'noteTitle',{configurable:true,get:()=>previous,set:value=>{if(value!==previous)throw Error('native failure')}})
  swipe();confirm('bad');assert.equal(notes.a.noteTitle,'bb');assert.equal(notes.b.noteTitle,previous);assert.equal(undo.length,n);assert.match(errors.at(-1),/原标题已恢复/)
  Object.defineProperty(notes.b,'noteTitle',{configurable:true,writable:true,value:previous})
})
test('cross-window, scene, notebook and deleted-card guards',()=>{
  for(const change of ['window','scene','book','delete']){
    swipe();const before=titles();if(change==='window')focusWindow={};if(change==='scene')scene='intensive';if(change==='book')currentBook='other';let missing;if(change==='delete'){missing=notes.b;delete notes.b}
    confirm('bad');if(missing)notes.b=missing;assert.deepEqual(titles(),before);focusWindow=owner.window;scene='broad';currentBook='book'
  }
})
test('closing toolbar cancels pending dialog and removes gesture',()=>{const alert=swipe(),before=titles();feature.closed(owner,{object:owner.window});confirm('bad',alert);assert.deepEqual(titles(),before);assert.equal(gestures.length,0);assert.equal(owner.kbTitleRename.pending,null)})
test('stale alert cannot cancel a later input',()=>{bind();const old=swipe();feature.clear(owner);bind();const fresh=swipe();confirm('bad',old);assert.equal(owner.kbTitleRename.pending.alert,fresh);fresh.callback(fresh,0)})
test('multi-window teardown leaves other owner untouched',()=>{const other=makeOwner();feature.disconnect(owner);assert.equal(owner.kbTitleRename,null);assert(other.kbTitleRename);feature.disconnect(other);assert.equal(removed.length,8)})
test('inactive or unmanaged templates never bind',()=>{owner=makeOwner();focusWindow=owner.window;allowed=false;bind();assert.equal(gestures.length,0);allowed=true;scene='';bind();assert.equal(gestures.length,0);feature.disconnect(owner)})
test('diagnostics report native selection without requiring toolbar notification',()=>{
  owner=makeOwner();focusWindow=owner.window;scene='broad';feature.observe(owner,{object:owner.window},'native.selection')
  const event=feature.report(owner).events.find(e=>e.stage==='native.selection');assert.equal(event.status.selectedCount,2);assert.equal(event.status.gestureCreated,false)
})
test('diagnostics expose legacy geometry misses and delayed toolbar visibility',()=>{
  view.frame.y=200;view.hidden=true;feature.observe(owner,study,'layout');let e=feature.report(owner).events.filter(e=>e.stage==='layout').at(-1)
  assert.equal(e.status.views[0].legacyBottom,false);assert.equal(e.status.views[0].legacyHeight,true);assert.equal(e.status.views[0].hidden,true)
  view.frame.y=716;view.hidden=false;owner.kbTitleRename.lastLayoutAt=0;feature.observe(owner,study,'layout');e=feature.report(owner).events.filter(e=>e.stage==='layout').at(-1);assert.equal(e.status.views[0].legacyBottom,true);assert.equal(e.status.views[0].hidden,false)
})
test('diagnostics distinguish missing notifications, gate rejection and disabled attachment',()=>{
  bind(owner,null);let events=feature.report(owner).events;assert(events.some(e=>e.stage==='bind.rejected'&&e.reason==='toolbar-missing'))
  allowed=false;bind();assert(feature.report(owner).events.some(e=>e.stage==='bind.rejected'&&e.reason==='scene-or-permission'));allowed=true
  bind();owner.kbTitleRename.gesture.enabled=false;feature.observe(owner,study,'layout');const e=feature.report(owner).events.at(-1)
  assert.equal(e.status.gestureCreated,true);assert.equal(e.status.gestureEnabled,false);assert.equal(e.status.gestureHasView,true);assert.equal(e.status.attachmentFound,true)
})
test('diagnostics are bounded and suppress repeated unchanged layout samples',()=>{
  feature.observe(owner,study,'layout');const n=owner.kbTitleRename.history.length;for(let i=0;i<100;i++)feature.observe(owner,study,'layout');assert.equal(owner.kbTitleRename.history.length,n)
  for(let i=0;i<100;i++)feature.observe(owner,{object:owner.window},'native.selection');assert.equal(feature.report(owner).events.length,60)
})
test('layout diagnostics rate-limit expensive native view traversal',()=>{
  const saved=rootView.subviews;let reads=0;Object.defineProperty(rootView,'subviews',{configurable:true,get:()=>{reads++;return saved}})
  owner.kbTitleRename.lastLayoutAt=Date.now();for(let i=0;i<100;i++)feature.observe(owner,study,'layout');assert.equal(reads,0)
  owner.kbTitleRename.lastLayoutAt=0;feature.observe(owner,study,'layout');assert.equal(reads,1)
  Object.defineProperty(rootView,'subviews',{configurable:true,writable:true,value:saved})
})
test('diagnostics never collect selected note content, IDs, or mutate titles',()=>{
  const before=titles(),a=notes.a.noteTitle;notes.a.noteTitle='PRIVATE_TITLE_SENTINEL';notes.a.content='PRIVATE_BODY_SENTINEL'
  const text=JSON.stringify(feature.report(owner));for(const secret of ['PRIVATE_TITLE_SENTINEL','PRIVATE_BODY_SENTINEL','external edit'])assert(!text.includes(secret))
  assert(!text.includes('noteTitle'));assert(!text.includes('noteId'));assert.equal(notes.a.noteTitle,'PRIVATE_TITLE_SENTINEL');notes.a.noteTitle=a;delete notes.a.content;assert.deepEqual(titles(),before)
})
test('diagnostic export copies only on explicit confirmation and remains silent',()=>{
  const before=titles(),n=undo.length,h=errors.length;feature.showDiagnostic(owner);const a=dialogs.at(-1);a.callback(a,0);assert.equal(clipboard,null)
  a.callback(a,1);const output=JSON.parse(clipboard);assert.equal(output.schema,1);assert.equal(output.appVersion,'test-version');assert.deepEqual(titles(),before);assert.equal(undo.length,n);assert.equal(errors.length,h);feature.disconnect(owner)
})
console.log(count+' title-rename checks passed; native gestures and native undo still require device acceptance')
