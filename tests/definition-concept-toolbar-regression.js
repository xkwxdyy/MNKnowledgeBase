'use strict';
const assert = require('node:assert/strict');
const fs = require('./support/integration-fs.js');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../mntoolbar/mntoolbar/xdyy_custom_actions_registry.js'), 'utf8');
const utils = fs.readFileSync(path.join(__dirname, '../utils.js'), 'utf8');
function between(input, start, end) {
 const i=input.indexOf(start), j=input.indexOf(end,i);assert(i>=0&&j>i);return input.slice(i,j);
}
async function run(notes, available=true) {
 const queued=[], ordinary=[], hud=[], actions={};
 const ctx={Number, String, Boolean, KnowledgeBaseTemplate:{types:{'定义':{colorIndex:2}}},
  KnowledgeBaseNetwork:{queueDefinitionConcept:available?n=>{queued.push(n.noteId);return true;}:undefined,OCRToTitle:n=>{ordinary.push(n.noteId);return true;}},
  MNUtil:{showHUD:message=>hud.push(message)},global:{registerCustomAction:(name,fn)=>actions[name]=fn},
  _xdyy_getSafeFocusNotesFromContext:context=>context.focusNotes,
  _xdyy_canRunKnowledgeBaseOCR:()=>true,_xdyy_getNoteIdSafe:note=>note.noteId,
  _xdyy_directOCRManualOptions:()=>({}),_xdyy_enqueueTitleOCRRequest:async request=>{for(const entry of request.entries)await request.worker(entry.note);return true;}};
 vm.createContext(ctx);
 vm.runInContext(between(source,'  async function _xdyy_runTitleOCRForFocusNotes','\n  function _xdyy_isSameNoteSafe')+
  between(source,'  global.registerCustomAction("ocrMode1NoTranslationReplaceTitle"','\n  global.registerCustomAction("ocrMode1NoTranslationAddToFirstHeaderLink"'),ctx);
 await actions.ocrMode1NoTranslationReplaceTitle({focusNotes:notes});return {queued,ordinary,hud};
}
(async()=>{
 assert.deepEqual(await run([{noteId:'definition',colorIndex:2}]),{queued:['definition'],ordinary:[],hud:[]});
 assert.deepEqual(await run([{noteId:'ordinary',colorIndex:1},{noteId:'definition',colorIndex:2}]),{queued:['definition'],ordinary:['ordinary'],hud:[]});
 assert.deepEqual(await run([{noteId:'definition',colorIndex:2}],false),{queued:[],ordinary:[],hud:[]});
 const received=[];const ctx={KnowledgeBaseTemplate:{types:{'定义':{colorIndex:2}}},KnowledgeBaseDefinitionConcept:{getRuntime:()=>({enqueue:note=>{received.push(note.noteId);return true;}})}};
 vm.createContext(ctx);vm.runInContext('this.Service=class Service {'+between(utils,'  static isDefinitionConceptNote','  static async OCRToTitle')+'}',ctx);
 assert.equal(ctx.Service.queueDefinitionConcept({noteId:'D',colorIndex:2}),true);assert.equal(ctx.Service.queueDefinitionConcept({noteId:'P',colorIndex:1}),false);assert.deepEqual(received,['D']);
 console.log('Actual Toolbar OCR action: definitions queued silently, mixed selection partitioned, ordinary OCR preserved, unavailable service never writes full text');
})().catch(error=>{console.error(error);process.exitCode=1;});
