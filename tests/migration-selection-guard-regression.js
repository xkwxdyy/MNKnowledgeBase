'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../utils.js'), 'utf8');
const begin = source.indexOf('  static async prepareCardMigrationSelection(');
const end = source.indexOf('  static processOldTemplateCard(', begin);
async function run(options = {}) {
  const parent = {noteId:'P', notebookId:'BOOK', comments:[], childNotes:[]};
  const target = {noteId:'A', notebookId:'BOOK', comments:[], childNotes:[]};
  const source = {noteId:'B', notebookId:'BOOK', title:'source', comments:[{type:'TextNote',text:'body'}], childNotes:[], parentNote: options.root ? null : parent};
  const child = {noteId:'C', notebookId:'BOOK', comments:[], childNotes:[], parentNote:source}; source.childNotes.push(child);
  if (!options.root) parent.childNotes.push(source);
  const notes = new Map([parent,target,source,child].map(n=>[n.noteId,n]));
  let selected = [options.descendant ? child : options.unselected ? target : source], focus=selected[0];
  const events=[];
  class Wrapper {
    constructor(native) { Object.assign(this, native); }
    async focusInMindMap() { events.push(['focus',this.noteId]); if (!options.refuse) {focus=notes.get(this.noteId);selected=[focus];} }
    static getFocusNotes() {return selected;}
    static getFocusNote() {return focus;}
  }
  const util={currentNotebookId:'BOOK',getNoteById:id=>notes.get(id),delay:async()=>{},
    async selectNotesInMindmap(ids) {
      events.push(['select',...ids]);
      if (!options.refuse) {focus=notes.get(ids[0]);selected=[focus];}
      if(options.changed) child.comments.push({text:'concurrent edit'});
      if(options.switched) util.currentNotebookId='OTHER';
      if(options.removed) notes.delete('B');
    }};
  const context=vm.createContext({MNUtil:util,MNNote:Wrapper});
  vm.runInContext('class Guard {\n'+sourceCode()+'\n}; this.Guard=Guard;',context);
  context.Guard.getSafeComments=n=>n.comments;
  const before=JSON.stringify(source.comments);
  let result,error;
  try { result=await context.Guard.prepareCardMigrationSelection([source],options.fallback?target:null); } catch(e) {error=e;}
  assert.equal(JSON.stringify(source.comments),before,'selection guard never edits source comments');
  return {result,error,events};
}
function sourceCode(){return source.slice(begin,end);}
(async()=>{
  for(const options of [{},{descendant:true},{root:true,fallback:true}]) {const r=await run(options);assert.equal(r.error,undefined);assert.equal(r.result,true);assert.deepEqual(r.events[0],['select',options.root?'A':'P']);}
  const noop=await run({unselected:true});assert.equal(noop.result,false);assert.equal(noop.events.length,0);
  for(const options of [{root:true},{refuse:true},{changed:true},{switched:true},{removed:true}]) {const r=await run(options);assert(r.error,JSON.stringify(options));}
  console.log('migration selection guard: retained parent/target, descendant selection, no writes, no-parent refusal, stale subtree, notebook change and selection failure passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
