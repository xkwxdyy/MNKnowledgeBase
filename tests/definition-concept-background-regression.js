'use strict';
const assert = require('node:assert/strict');
const api = require('../KnowledgeBaseDefinitionConcept');
const good = JSON.stringify({ titles: [{ zh: '紧算子', en: 'compact operator' }] });
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
function harness(options={}) {
 const notes=new Map(), saved=[], calls=[], scheduled=[];
 const note={noteId:'definition',noteTitle:'原摘录',title:'原摘录',colorIndex:2,text:'原文',comments:[]};notes.set(note.noteId,note);
 const deps={capture:()=>({image:'data:image/png;base64,fixture'}),getNote:id=>notes.get(id),delay:ms=>new Promise(resolve=>{scheduled.push({ms,resolve})}),request:async body=>{calls.push(body);return calls.length%2===1?'若 T 将有界集映为相对紧集，则称 T 为紧算子。':good;},save:r=>saved.push(r),apply:async fn=>fn(),setTitle:(n,t)=>{n.title=t;n.noteTitle=t;},...options};
 const manager=api.create(deps);
 return {notes,note,saved,calls,scheduled,deps,manager,async start(){scheduled.filter(t=>t.ms===0).forEach(t=>t.resolve());await flush();}};
}
(async()=>{
 assert.equal(api.formatTitles(good),'紧算子; compact operator');
 assert.equal(api.formatTitles({titles:[{zh:'伯格曼空间',en:'Bergman space'}]}),'伯格曼空间; Bergman space');
 assert.equal(api.formatTitles({titles:[{zh:'C*-代数',en:'C*-algebra'},{zh:'GNS构造',en:'GNS construction'}]}),'C*-代数; C*-algebra; GNS构造; GNS construction');
 assert.equal(api.formatTitles({titles:[{zh:'Bergman 空间',en:'Bergman space'},{zh:'Hardy 空间',en:'Hardy space'}]}),'Bergman 空间; Bergman space; Hardy 空间; Hardy space');
 assert.equal(api.formatTitles({titles:[{zh:'Bergman空间',en:'Bergman space'}]}),'Bergman空间; Bergman space');
 assert.equal(api.formatTitles('{"titles":[]}'),'');
 assert.throws(()=>api.formatTitles({titles:[{zh:'集合相等',en:'sets are equal'}]}));
 for(const titles of [[{zh:'normal operator',en:'normal operator'}],[{zh:'正规算子',en:'正规算子'}],[{zh:'定义正文。',en:'normal operator'}],[{zh:'紧算子; closed',en:'compact operator'}],[{zh:'紧算子',en:'compact\noperator'}]]) assert.throws(()=>api.formatTitles({titles}));
 assert.equal(api.isNonDefinitionBlock('定理 1.2.3. 设 a,b≥0，则 (a+b)/2≥√(ab)。'),true);
 assert.equal(api.isNonDefinitionBlock('Definition 3. A mapping is defined...'),false);
 assert.equal(api.requestBody('ocr',[],null).thinking.type,'disabled');
 assert.equal(api.requestBody('concept','source','low').reasoning_effort,'low');
 {
  const h=harness(),job=h.manager.begin(h.note);assert.equal(h.manager.begin(h.note),null);assert.equal(h.calls.length,0);
  h.manager.finish(job);assert.equal(h.calls.length,0);await h.start();
  assert.equal(h.calls.length,2);assert.equal(h.note.title,'紧算子; compact operator');assert.equal(h.note.text,'原文');assert.deepEqual(h.note.comments,[]);assert.equal(h.manager.pending(),0);assert.equal(h.saved.at(-1).status,'applied');
 }
 {
  const h=harness();const job=h.manager.begin(h.note);const converted={...h.note,noteId:'converted',noteTitle:'【定义 >> 测试】原摘录'};h.notes.set(converted.noteId,converted);h.manager.retarget(h.note,converted);h.notes.delete(h.note.noteId);h.manager.finish(job);await h.start();assert.equal(converted.title,'【定义 >> 测试】紧算子; compact operator');
 }
 {
  const h=harness();h.note.noteTitle=h.note.title='【定义 >> 测试】; 原概念; original concept';
  assert.equal(h.manager.enqueue(h.note),true);await h.start();assert.equal(h.note.title,'【定义 >> 测试】; 紧算子; compact operator');
 }
 {
  const h=harness(), order=[], job=h.manager.begin(h.note);
  assert.equal(h.manager.deferMakeCard(h.note,n=>{order.push(n.title);assert.equal(h.manager.deferMakeCard(n,()=>{}),false);n.title='【定义 >> 测试】'+n.title;}),true);
  assert.deepEqual(order,[]);h.manager.finish(job);await h.start();assert.deepEqual(order,['紧算子; compact operator']);assert.equal(h.note.title,'【定义 >> 测试】紧算子; compact operator');assert.equal(h.saved.at(-1).status,'applied');
 }
 {
  const h=harness({capture:()=>({text:'The Hardy space consists of analytic functions with bounded radial Lp means.'}),request:async()=>JSON.stringify({titles:[{zh:'Hardy 空间',en:'Hardy space'}]})});
  const job=h.manager.begin(h.note);let received;
  h.manager.deferMakeCard(h.note,n=>{received=n.title;n.title='【定义 >> 测试】; '+n.title;});
  h.manager.finish(job);await h.start();assert.equal(received,'Hardy 空间; Hardy space');assert.equal(h.note.title,'【定义 >> 测试】; Hardy 空间; Hardy space');assert.equal(h.saved.at(-1).status,'applied');
 }
 {
  const h=harness({request:async()=>{throw Error('offline')}});let made=false;h.manager.deferMakeCard(h.note,()=>{made=true});const j=h.manager.begin(h.note);h.manager.deferMakeCard(h.note,()=>{made=true});h.manager.finish(j);await h.start();assert.equal(made,false);
 }
 {
  const h=harness();h.manager.finish(h.manager.begin(h.note));h.manager.deferMakeCard(h.note,()=>{throw Error('template unavailable')});await h.start();assert.equal(h.saved.at(-1).status,'card-failed');assert.equal(h.note.title,'紧算子; compact operator');
 }
 {
  const h=harness({enabled:()=>false});assert.equal(h.manager.begin(h.note),null);assert.equal(h.manager.enqueue(h.note),true);assert.equal(h.manager.enqueue(h.note),true);await h.start();assert.equal(h.calls.length,2);
 }
 {
  let captures=0;const h=harness({capture:()=>{captures++;return {text:'definition'};},request:async()=>good});
  for(let i=0;i<20;i++){const n={...h.note,noteId:'batch-'+i};h.notes.set(n.noteId,n);assert.equal(h.manager.enqueue(n),true);}
  assert.equal(captures,0);await h.start();for(let i=0;i<20&&h.manager.pending();i++)await flush();assert.equal(captures,20);assert.equal(h.manager.pending(),0);assert.equal(h.saved.filter(r=>r.status==='applied').length,20);
 }
 {
  const h=harness();let made=false;h.manager.finish(h.manager.begin(h.note));h.manager.deferMakeCard(h.note,()=>{made=true});h.note.noteTitle='阅读中改名';await h.start();assert.equal(made,false);assert.equal(h.calls.length,0);
 }
 {
  let context='original-study';const h=harness({context:()=>context});const job=h.manager.begin(h.note);context='different-study';h.manager.finish(job);await h.start();assert.equal(h.saved.at(-1).status,'stale');assert.equal(h.calls.length,0);assert.equal(h.note.title,'原摘录');
 }
 {
  let resolve;const h=harness({request:()=>new Promise(r=>{resolve=r;})});const job=h.manager.begin(h.note);h.manager.finish(job);await h.start();h.note.noteTitle='用户修改';resolve('识别正文');await flush();assert.equal(h.saved.at(-1).status,'stale');assert.equal(h.note.noteTitle,'用户修改');
 }
 {
  let apply;const h=harness({apply:fn=>{apply=fn;return new Promise(()=>{});}});h.manager.finish(h.manager.begin(h.note));await h.start();h.note.noteTitle='用户后改';apply();assert.equal(h.note.noteTitle,'用户后改');
 }
 {
  let resolve;const h=harness({request:()=>new Promise(r=>{resolve=r;})});h.manager.finish(h.manager.begin(h.note));await h.start();h.scheduled.find(t=>t.ms>0).resolve();await flush();assert.equal(h.saved.at(-1).status,'timeout');resolve('迟到识别结果');await flush();assert.equal(h.note.title,'原摘录');assert.equal(h.manager.pending(),0);
 }
 {
  const h=harness({request:async()=>{throw Error('HTTP 502')}});h.manager.finish(h.manager.begin(h.note));await h.start();assert.equal(h.saved.at(-1).status,'failed');assert.equal(h.note.title,'原摘录');assert.equal(h.manager.pending(),0);
 }
 {
  const h=harness({request:async()=> '□'});h.manager.finish(h.manager.begin(h.note));await h.start();assert.equal(h.saved.at(-1).status,'unreadable');assert.equal(h.note.title,'原摘录');
 }
 {
  const h=harness({capture:()=>({text:'来自 PDF 文本层的定义'}),request:async body=>{h.calls.push(body);return good;}});h.manager.finish(h.manager.begin(h.note));await h.start();assert.equal(h.calls.length,1);assert.equal(h.calls[0].messages[1].content,'来自 PDF 文本层的定义');assert.equal(h.note.title,'紧算子; compact operator');
 }
 {
  const h=harness();h.manager.finish(h.manager.begin(h.note));h.note.comments.push({type:'TextNote',text:'阅读中新增评论'});await h.start();assert.equal(h.calls.length,0);assert.equal(h.saved.at(-1).status,'stale');
 }
 {
  const h=harness();h.manager.finish(h.manager.begin(h.note));h.notes.delete(h.note.noteId);await h.start();assert.equal(h.calls.length,0);assert.equal(h.saved.at(-1).status,'stale');
 }
 {
  const h=harness();h.manager.finish(h.manager.begin(h.note));h.manager.stop();await h.start();assert.equal(h.calls.length,0);assert.equal(h.manager.pending(),0);
 }
 {
  const h=harness({request:async body=>{h.calls.push(body);return '定理 1.2.3. 设 a,b≥0，则 (a+b)/2≥√(ab)。';}});
  h.manager.finish(h.manager.begin(h.note));await h.start();assert.equal(h.calls.length,1);assert.equal(h.saved.at(-1).status,'no-definition');assert.equal(h.note.title,'原摘录');
 }
 console.log('Definition background: format, two-stage requests, deferral, conversion, stale edits, deletion, timeout, failures, text layer and stop passed');
})().catch(e=>{console.error(e);process.exitCode=1});

// Exercise the actual excerpt event: reading early returns and direct OCR must both release to the background.
{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
 const start=source.indexOf('onProcessNewExcerpt: async function (sender) {');
 const end=source.indexOf('\n    queryAddonCommandStatus:',start);
 const event=source.slice(start,end).replace(/,\s*$/,'');
 const run=async mode=>{
  const events=[],note={noteId:'event-note',colorIndex:2};
  const manager={begin:()=>{events.push('begin');return{};},finish:()=>events.push('finish')};
  const self={window:'window',classAutoMoveMode:false,shouldSkipReadingOCR:()=>true,processReadingModeNote:async()=>events.push('collect'),hasDirectOCRTagComment:()=>false};
  const ctx={MNUtil:{currentWindow:'window'},MNKnowledgeBaseClass:{prototype:{markReadingFollowSource(){}}},self,MNNote:{new:()=>note},isKnowledgeBaseExtendNote:()=>false,KnowledgeBaseConfig:{config:{readingFollowMode:mode==='reading',excerptOCRMode:mode==='direct'?3:0}},KnowledgeBaseDefinitionConcept:{getRuntime:()=>manager},KnowledgeBaseNetwork:{OCRToTitle:async()=>{throw Error('Definition must not wait for synchronous OCR')}},KnowledgeBaseUtils:{addErrorLog:e=>{throw e}}};
  vm.createContext(ctx);vm.runInContext('this.event = ({'+event+'}).onProcessNewExcerpt',ctx);
  await ctx.event({userInfo:{noteid:note.noteId}});
  assert.deepEqual(events,mode==='reading'?['begin','collect','finish']:['begin','finish']);
 };
 Promise.all([run('reading'),run('direct'),run('all-modes-off')]).then(()=>console.log('Actual excerpt event starts definition OCR independently of other mode switches')).catch(e=>{console.error(e);process.exitCode=1});
}

// Pending definitions defer the actual shared card-making entry points before template/prefix work.
{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../utils.js'),'utf8');
 for(const method of ['makeCard','makeNote']) {
  const start=source.indexOf('  static '+method+'('),end=source.indexOf('    this.assertMakeCardTemplateAvailable',start);let continuation;
  const ctx={KnowledgeBaseDefinitionConcept:{getRuntime:()=>({deferMakeCard:(note,fn)=>{continuation=fn;return true;}})}};vm.createContext(ctx);
  vm.runInContext('this.Owner = class Owner {'+source.slice(start,end)+'throw Error("must defer before template checks");}}',ctx);
  const args=[];const note={noteId:'pending'};assert.equal(ctx.Owner[method](note,false,true),note);ctx.Owner[method]=(...values)=>args.push(values);continuation({noteId:'converted',title:'紧算子; compact operator'});assert.equal(args[0][0].noteId,'converted');assert.equal(args[0].at(-1).silent,true);if(method==='makeNote')assert.equal(args[0][3],false);
 }
}

// Exercise runtime wiring with native APIs replaced by inert stubs; a foreign endpoint must receive no credentials.
(async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../KnowledgeBaseDefinitionConcept.js'),'utf8');
 async function runtime(url,truncated=false,networkError=false) {
  const note={noteId:'runtime',noteTitle:'original',title:'original',text:'source',comments:[]},requests=[],records=[],timers=[];
  const ctx={Promise,Date,JSON,Array,Object,String,Math,Number,RegExp,
   KnowledgeBaseConfig:{getConfig:()=>undefined},ocrUtils:{getImageFromNote:()=>({base64Encoding:()=> 'synthetic-image'})},
   MNNote:{new:()=>note},chatAIConfig:{getConfigFromSource:source=>{assert.equal(source,'Deepseek');return {url,key:'fixture-key'}}},
   MNUtil:{isNSNull:value=>value==null,showHUD:()=>{throw Error('Background requests must remain silent')},delay:seconds=>new Promise(resolve=>{if(seconds<0.01)timers.push(resolve)}),getLocalDataByKey:()=>[],setLocalDataByKey:data=>records.push(data)},
   MNConnection:{initRequest:(endpoint,options)=>{requests.push({endpoint,options});return options},sendRequest:()=>{throw Error('The shared sender displays network failures')}},
   NSOperationQueue:{mainQueue:()=>({})},NSJSONSerialization:{JSONObjectWithDataOptions:data=>data},
   NSURLConnection:{sendAsynchronousRequestQueueCompletionHandler:(request,queue,callback)=>callback({statusCode:()=>networkError?502:200},{choices:[{finish_reason:truncated?'length':'stop',message:{content:request.json.messages[0].content.includes('忠实识别')?'T is called a compact operator.':good}}]},networkError?{localizedDescription:'offline'}:null)},
   KnowledgeBaseTemplate:{runUndoGroupingWithoutGlobalDBRefreshAsync:async fn=>fn(),refreshNoteLocally:()=>{}},IntermediateKnowledgeIndexer:{addToIncrementalIndex:(n,options)=>assert.equal(options.showErrorHUD,false)}};
  vm.createContext(ctx);vm.runInContext(source,ctx);const manager=ctx.KnowledgeBaseDefinitionConcept.getRuntime();manager.finish(manager.begin(note));timers.forEach(fn=>fn());await flush();await flush();
  return {note,requests,records};
 }
 const ok=await runtime('https://api.deepseek.com/chat/completions');assert.equal(ok.note.title,'紧算子; compact operator');assert.equal(ok.requests.length,2);assert(ok.requests.every(r=>r.options.json.thinking.type==='disabled'));
 const foreign=await runtime('https://unconfigured.invalid/chat/completions');assert.equal(foreign.requests.length,0);assert.equal(foreign.note.title,'original');
 const truncated=await runtime('https://api.deepseek.com/v1/chat/completions',true);assert.equal(truncated.note.title,'original');assert.equal(truncated.requests.length,1);
 const failed=await runtime('https://api.deepseek.com/chat/completions',false,true);assert.equal(failed.note.title,'original');assert.equal(failed.requests.length,1);assert.equal(failed.records.at(-1).at(-1).status,'failed');
 console.log('Runtime request wiring: configured DeepSeek only, disabled thinking, silent indexing and truncated-response rejection passed');
})().catch(e=>{console.error(e);process.exitCode=1});
