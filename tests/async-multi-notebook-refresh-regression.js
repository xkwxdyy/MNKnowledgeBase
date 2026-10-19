const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.env.MNKB_UTILS_SOURCE||path.join(__dirname,'../utils.js'),'utf8');
const start=source.indexOf('  static async runUndoGroupingWithoutGlobalDBRefreshAsync('),end=source.indexOf('\n  /**',start);
function setup(fail='',app=true){
 const events=[];const refresh=async id=>{events.push(id);if(id===fail)throw Error('refresh failed');};
 const util={currentNotebookId:'A',refreshAfterDBChanged:refresh,undoGroupingNotRefreshAsync:async fn=>await fn()};
 if(app)util.app={refreshAfterDBChanged:refresh};
 const c=vm.createContext({MNUtil:util});vm.runInContext('class H {'+source.slice(start,end)+'} this.run=H.runUndoGroupingWithoutGlobalDBRefreshAsync',c);
 return {run:c.run,util,events};
}
(async()=>{
 let t=setup(),releaseA,releaseB,opA;const original=t.util.refreshAfterDBChanged;
 const a=t.run(async op=>{opA=op;await new Promise(r=>releaseA=r);op.requestRefresh('C');op.requestRefresh('C');return 1;},{finalRefreshAfterDBChanged:true});
 t.util.currentNotebookId='B';
 const b=t.run(async op=>{await new Promise(r=>releaseB=r);op.requestRefresh('D');return 2;},{finalRefreshAfterDBChanged:true});
 assert.equal(t.util.refreshAfterDBChanged,original,'no global interceptor across await');
 releaseB();assert.equal(await b,2);assert.deepEqual(t.events,['B','D']);
 releaseA();assert.equal(await a,1);assert.deepEqual(t.events,['B','D','A','C']);assert.equal(opA.requestRefresh('LATE'),false);
 t=setup();await t.run(op=>op.requestRefresh('C'));assert.deepEqual(t.events,[]);
 t=setup();await t.run(()=>1,{finalRefreshAfterDBChanged:true,refreshNotebookIds:['X','Y','X']});assert.deepEqual(t.events,['X','Y']);
 t=setup('X');let caught=false;try{await t.run(()=>{throw null;},{finalRefreshAfterDBChanged:true,refreshNotebookIds:['X','Y']});}catch(e){caught=true;assert.equal(e,null);}assert(caught);assert.deepEqual(t.events,['X','Y']);
 t=setup('X');await assert.rejects(t.run(()=>1,{finalRefreshAfterDBChanged:true,refreshNotebookIds:['X','Y']}),/refresh failed/);assert.deepEqual(t.events,['X','Y']);
 t=setup('',false);await t.run(op=>op.requestRefresh('C'),{finalRefreshAfterDBChanged:true});assert.deepEqual(t.events,['A','C']);
 await assert.rejects(t.run(()=>1,{refreshNotebookIds:['']}),/ID/);
 await assert.rejects(t.run(op=>op.requestRefresh(null)),/ID/);
 console.log('PASS async refresh: concurrent reverse completion, dedupe, captured IDs, opt-out, late requests, falsy failure and fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
