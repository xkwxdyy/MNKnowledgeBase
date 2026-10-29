const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'utils.js'), 'utf8');
const prefix = source.slice(0, source.indexOf('\nclass KnowledgeBaseIndexer'));
(async () => {
  let finalizations=0, depth=0;
  const context=vm.createContext({console,Set,Map,WeakMap,
    MNUtil:{delay:async()=>{},copyJSON(){},showHUD(){},undoGrouping(fn){depth++;try{fn();}catch(_){}finally{depth--;}}},
    KnowledgeBaseMergeTransaction:{finalizeSourceRemoval(result){assert.equal(depth,0);finalizations++;result.pendingVerification=false;result.success=true;}}
  });
  vm.runInContext(prefix+'\nthis.T=KnowledgeBaseTemplate;',context);
  const T=context.T;
  T.renewKnowledgeNotesInTransaction=()=>{throw Error('native callback failure');};
  assert.throws(()=>T.renewKnowledgeNotes({}, {}, {throwOnError:true}),/native callback failure/);
  T.renewKnowledgeNotesInTransaction=()=>({success:false,committed:true,pendingVerification:true});
  const result=T.renewKnowledgeNotes({}, {}, {throwOnError:true});
  assert.equal(result.pendingVerification,true);
  await result.verification;
  assert.equal(result.success,true);assert.equal(finalizations,1);
  console.log('native merge result: swallowed callback failure captured; retirement verified after undo group commits');
})().catch(error=>{console.error(error);process.exitCode=1;});
