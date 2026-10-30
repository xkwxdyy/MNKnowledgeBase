'use strict'
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const root=process.env.MNKB_TEST_ROOT||path.resolve(__dirname,'..')
const source=fs.readFileSync(path.join(root,'main.js'),'utf8')
function proto(name,next){const a=source.indexOf('  MNKnowledgeBaseClass.prototype.'+name+' = '),b=source.indexOf('  MNKnowledgeBaseClass.prototype.'+next+' = ',a);assert(a>=0&&b>a,name);return source.slice(a,b)}
async function test(staleFlag){
 const calls=[],note={noteId:'synthetic',noteTitle:'待整理命题',colorIndex:9}
 const config={excerptOCRMode:0,readingFollowMode:false,classificationMode:false,referenceNoteIds:{roots:{preExcerpt:'retained-preparation-reference'}},personal:'keep'}
 const ctx={MNKnowledgeBaseClass:function(){},KnowledgeBaseConfig:{config,save(){calls.push('save')}},KnowledgeBaseUtils:{addErrorLog(e){throw e}},KnowledgeBaseNetwork:{OCRToTitle:async(n,mode,translation)=>{calls.push(['ocr',mode,translation]);return true}},MNUtil:{currentWindow:'w',showHUD(){calls.push('hud')}},MNNote:{new:()=>note},isKnowledgeBaseExtendNote:()=>false,IntermediateKnowledgeIndexer:{addToIncrementalIndex(){calls.push('index')}}}
 vm.createContext(ctx)
 for(const[a,b]of [['getManagedAutomationModeKeys','getManagedAutomationModeLabel'],['isManagedAutomationModeEnabled','disableManagedAutomationMode'],['disableManagedAutomationMode','disableManagedAutomationModes'],['getConflictingAutomationModeKeys','showManagedAutomationModeHUD'],['togglePreExcerptModeInternal','togglePrefixModeInternal'],['applyOCRToTitleWithMode','convertExcerptToNoExcerptIfNeeded'],['getAutomationMenuItems','openMainMenu']])vm.runInContext(proto(a,b),ctx)
 const h=new ctx.MNKnowledgeBaseClass();ctx.self=h
 Object.assign(h,{window:'w',preExcerptMode:staleFlag,classAutoMoveMode:true,preExcerptRootNote:{addChild(){throw Error('retired preparation root must not receive cards')}},shouldSkipReadingOCR:()=>false,hasDirectOCRTagComment:()=>false,processInboxAutoMoveNote:async()=>calls.push('inbox'),processDirectOCRExcerptMakeCard:async n=>n,getSupportedExcerptOCRMode:()=>0,menuSeparator:()=>({}),indentedTableItem:(title,selector)=>({title,selector}),nestedTableItem:(title,selector)=>({title,selector})})
 assert(!h.getAutomationMenuItems({}).some(x=>x.selector==='preExcerptModeToggled:'))
 assert(h.getAutomationMenuItems({}).some(x=>x.selector==='classAutoMoveModeToggled:'))
 assert(h.getAutomationMenuItems({}).some(x=>x.selector==='readingFollowModeToggled:'))
 assert(!h.getManagedAutomationModeKeys().includes('preExcerpt'));assert.equal(h.isManagedAutomationModeEnabled('preExcerpt'),false)
 for(const key of ['excerptOCR','prefixMode','classAutoMove'])assert(!h.getConflictingAutomationModeKeys(key).includes('preExcerpt'))
 const saved=JSON.stringify(config);h.disableManagedAutomationMode('preExcerpt');assert.equal(JSON.stringify(config),saved)
 const a=source.indexOf('    onProcessNewExcerpt: async function (sender) {'),b=source.indexOf('\n    queryAddonCommandStatus:',a)
 vm.runInContext('this.event=({'+source.slice(a,b).replace(/,\s*$/,'')+'}).onProcessNewExcerpt',ctx)
 await ctx.event({userInfo:{noteid:note.noteId}});assert.deepEqual(calls,['inbox']);calls.length=0
 // Retired stale state must not select the translated-original prompt in automatic OCR.
 config.excerptOCRMode=1;h.classAutoMoveMode=false
 await ctx.event({userInfo:{noteid:note.noteId}});assert.deepEqual(calls,[['ocr',1,false],'index']);calls.length=0
 await h.applyOCRToTitleWithMode(note,1,{skipIndex:true});assert.deepEqual(calls,[['ocr',1,false]]);calls.length=0
 h.togglePreExcerptModeInternal();assert.equal(h.preExcerptMode,false);assert.deepEqual(calls,[])
 assert.equal(config.referenceNoteIds.roots.preExcerpt,'retained-preparation-reference');assert.equal(config.personal,'keep')
 assert.equal(typeof h.togglePreExcerptModeInternal,'function')
}
Promise.all([test(false),test(true)]).then(()=>console.log('Retired pre-excerpt: one collection path, stale flags ignored, no preparation writes, OCR defaults and private references preserved')).catch(e=>{console.error(e);process.exitCode=1})
