#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const {harness} = require('./research-core-regression');
(async () => {
  const h=harness(); let mode='intensive'; h.deps.collectionMode=()=>mode;
  const n=h.add('selected'); const options=[]; let late;
  h.deps.makeCard=(note,type,valid,settings)=>{assert(valid());options.push(settings);late=valid;return {note,pending:false,addedToReview:settings.addToReview};};
  assert.equal(h.service.isSceneActive(h.main),true);
  assert.equal((await h.service.processExcerpt(h.main,n)).skipped,'no-active-receiver');
  const made=await h.command('makeCard',{noteId:n.noteId});
  assert.equal(made.reviewAllowed,true);assert.equal(made.addedToReview,true);assert.equal(options.at(-1).addToReview,true);
  await h.command('addTemplate',{noteId:n.noteId});
  const receiver=h.add('receiver','归类');receiver.acceptType='命题';
  await h.command('setReceiver',{noteId:receiver.noteId});
  assert.equal(h.service.state(h.main).receiver.active,true);
  await h.command('stopReceiver');
  await assert.rejects(h.command('setReceiver',{noteId:n.noteId}),/receiver-must-be-classification$/);
  for(const command of ['setInbox','registerProject','startProject']) await assert.rejects(h.command(command,{noteId:n.noteId}),/research-scene-inactive/);
  await assert.rejects(h.command('makeCard',{noteId:'missing'}),/note-unavailable/);
  mode='broad';assert.equal(late(),false,'A scene switch invalidates intensive deferred card work');
  const broad=await h.command('makeCard',{noteId:n.noteId});assert.equal(broad.reviewAllowed,false);assert.equal(options.at(-1).addToReview,false);
  const writes=[];h.deps.setInbox=(instance,note)=>writes.push(note.noteId);
  await h.command('setInbox',{noteId:n.noteId});assert.deepEqual(writes,['selected']);
  await assert.rejects(h.command('setInbox',{noteId:n.noteId},h.main,'other-book'),/different-notebook/);
  mode='research';await assert.rejects(h.command('setInbox',{noteId:n.noteId}),/research-scene-inactive/);
  // Exercise the native facade rather than only the injected service dependencies.
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const code=fs.readFileSync(process.env.MN_READING_CORE || path.join(__dirname,'../KnowledgeBaseResearchCore.js'),'utf8');
  for(const currentMode of ['broad','intensive']) {
    const win={}, instance={window:win}, note={noteId:'native',note:{},notebookId:'study',colorIndex:10,noteURL:'marginnote4app://note/native',focusInMindMap(){}};
    const config={referenceNoteIds:{roots:{existing:'keep'},templates:{definition:'keep'}},readingFollowMode:true};let saves=0,review=false; const notifications=[];const controller={notebookController:{notebookId:'study'},isNoteInReview:()=>review};
    const context={module:{exports:{}},console:{log(){}},
      Application:{sharedInstance:()=>({studyController:()=>controller})},
      Database:{sharedInstance:()=>({getNoteById:id=>{assert.equal(id,note.noteId);return note.note;}})},
      NSNotificationCenter:{defaultCenter:()=>({postNotificationNameObjectUserInfo:(name,object,info)=>{assert.equal(name,'AddToReview');assert.equal(object,controller);assert.equal(info.note,note.note);notifications.push(info.note);review=true;}})},
      MNUtil:{currentWindow:win,currentNotebookId:'study',isNoteInReview:()=>review},
      MNNote:{new:()=>note},KnowledgeBaseConfig:{config,save:()=>saves++},
      NSUserDefaults:{standardUserDefaults:()=>({objectForKey(){},setObjectForKey(){}})},
      IntermediateKnowledgeIndexer:{upsertIncrementalIndexEntry:()=>({success:true})},
      KnowledgeBaseTemplate:{getReadingScene:()=>currentMode,getNoteType:(n,useColor)=>useColor?'命题':'',assertMakeCardTemplateAvailable(){},toNoExcerptVersion:n=>n,
        runUndoGroupingWithoutGlobalDBRefresh:block=>block(),refreshNoteLocally(){},addToReview(){},
        makeCard(n,allowReview){assert.equal(this.getQuickReadingMakeCardPolicy().mode,'normal');assert.equal(allowReview,currentMode==='intensive');if(allowReview)this.addToReview(n,true);return n;}},
    };
    vm.createContext(context);vm.runInContext(code,context);const native=context.module.exports.getRuntime();
    const command=(name)=>native.dispatch(instance,{version:1,requestId:'native-test',command:name,notebookId:'study',payload:{noteId:'native'}});
    const result=await command('makeCard');assert.equal(result.addedToReview,currentMode==='intensive');assert.equal(notifications.length,currentMode==='intensive'?1:0,'Review must address the processed native card independently of selection');
    if(currentMode==='broad') {await command('setInbox');assert.equal(saves,1);assert.equal(config.referenceNoteIds.roots.classInput,note.noteURL);assert.equal(config.referenceNoteIds.roots.existing,'keep');assert.equal(config.referenceNoteIds.templates.definition,'keep');assert.equal(instance.classInputRootNote,note);}
    assert.equal(config.readingFollowMode,true,'Saved reading flags remain unchanged');
  }
  console.log('Reading scene core: intensive explicit commands, review intent, explicit classification receivers, lifecycle guard and explicit Inbox configuration passed');
})().catch(e=>{console.error(e);process.exitCode=1});
