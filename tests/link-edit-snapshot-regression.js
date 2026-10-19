const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.MNKB_LINK_CONTROLLER || path.join(root,'knowledgebaseWebController.js'),'utf8');
const start=source.indexOf('knowledgebaseWebController.prototype.editMarkdownLink = async function(');
const method=source.slice(start,source.indexOf('\n}',start)+2);
async function run(kind) {
 const events=[];const comment={type:'markdownComment',text:'[old](old://url)'};
 const expected={noteId:'A',commentIndex:0,linkIndex:0,type:'markdownComment',text:comment.text};
 if(kind==='changed')comment.text='[other](other://url)';
 if(kind==='type')comment.type='HtmlComment';
 if(kind==='html'){comment.type='HtmlComment';expected.type='HtmlComment';}
 if(kind==='tag'){comment.type='tagComment';expected.type='tagComment';}
 const note={noteId:'A',MNComments:[comment],refresh(){events.push('refresh')}};
 const ctx=vm.createContext({knowledgebaseWebController:function(){},MNNote:{new(){return note}},MNUtil:{showHUD(t){events.push(t)},undoGrouping(fn){events.push('undo');fn()}},KnowledgeBaseUtils:{log(){},addErrorLog(){}},buildKnowledgeBaseMarkdownLinkReplacement(){return{targetLink:{url:'old://url',displayText:'old'},newUrl:'new://url',newText:'[new](new://url)',newLinkMarkdown:'[new](new://url)'}},updateKnowledgeBaseLinkBackrefs(){events.push('backrefs')}});
 vm.runInContext(method,ctx);const c=new ctx.knowledgebaseWebController();c.loadCommentData=async()=>{events.push('load')};
 const result=await c.editMarkdownLink(kind==='wrong-note'?'B':'A',0,0,'new','new://url','',kind==='missing'?undefined:expected);
 return{events,result,comment,c,expected};
}
(async()=>{
 for(const kind of ['changed','type','wrong-note','missing','html']){
  const t=await run(kind);assert.equal(t.result,false,kind);assert(!t.events.includes('undo'),kind+': no mutation');assert(!t.events.includes('backrefs'));
 }
 assert.equal((await run('tag')).result,true,'preserve supported tag text editing');
 const t=await run('ok');assert.equal(t.result,true);assert.equal(t.comment.text,'[new](new://url)');
 assert.equal(await t.c.editMarkdownLink('A',0,0,'new','new://url','',t.expected),false,'duplicate request uses stale snapshot');
 console.log('link edit snapshot: stale content/type/note/missing snapshot rejected, valid edit and duplicate request passed');
})().catch(e=>{console.error(e);process.exitCode=1});
// Exercise the actual modal and Bridge payload mapper, with lightweight UI stubs.
{
 let currentId='A';const captured=[];const notices=[];
 const comment={type:'markdownComment',text:'[old](old://url)'};
 const state={editingLink:{}};
 const ctx=vm.createContext({state,dom:{editLinkPreview:{},editDisplayText:{},editLinkUrl:{},editLinkModal:{},editLinkConfirmBtn:{}},requireNoteId:()=>currentId,getCommentByIndex:()=>comment,decodeHtmlEntities:s=>s,showToast:s=>notices.push(s),showManagedModal(){},hideManagedModal(){},notifyCommentInteractionSettled(){},debugLog(){},Bridge:{editMarkdownLink(...args){captured.push(args);return true;}}});
 vm.runInContext(fs.readFileSync(path.join(root,'scripts/comment-manager/actions-edit.js'),'utf8'),ctx);
 ctx.updateEditLinkModalState=()=>{};ctx.setEditReplacementMarkdownError=()=>{};
 ctx.getEditLinkDraftValues=()=>({displayText:'new',url:'new://url',replacementMarkdown:''});
 ctx.showEditLinkModal(0,0,'old','old://url');currentId='B';ctx.confirmEditLink();
 assert.equal(captured.length,0,'switching cards must not send an edit');
 currentId='A';comment.text='[changed](changed://url)';ctx.confirmEditLink();
 assert.equal(captured.length,1);assert.equal(captured[0][6].text,'[old](old://url)','send opening snapshot, not current content');
 assert.equal(captured[0][6].noteId,'A');
 const bridge=fs.readFileSync(path.join(root,'scripts/comment-manager/bridge-api.js'),'utf8');
 const a=bridge.indexOf('      editMarkdownLink: createPayloadBridgeMethod('),b=bridge.indexOf('\n      mergeInlineLinkComments:',a);
 const mapper=vm.createContext({createPayloadBridgeMethod:(_name,_label,fn)=>fn,buildNoteIdPayload:(noteId,payload)=>({noteId,...payload})});
 vm.runInContext('this.api = ({'+bridge.slice(a,b)+'});',mapper);
 const payload=mapper.api.editMarkdownLink(...captured[0]);
 assert.equal(payload.targetSnapshot.text,'[old](old://url)');
 assert(source.includes('config.params.targetSnapshot'),'Native route must pass snapshot');
 console.log('link edit modal and Bridge snapshot propagation passed');
}
