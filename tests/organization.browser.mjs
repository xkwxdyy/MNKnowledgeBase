// Production WebView UI/core with simulated native transport; no user notebook access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.MNKB_PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(JSON.parse(await fs.readFile(path.join(root, 'build/payload.json'), 'utf8')));
const out = path.join(root, '.tmp/organization-verification'); await fs.mkdir(out, { recursive:true });
const server = http.createServer(async (request, response) => {
  const file = new URL(request.url,'http://localhost').pathname.slice(1);
  if (!allowed.has(file)) return response.writeHead(404).end();
  try { response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await fs.readFile(path.join(root,file))); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
const browser = await chromium.launch({ executablePath:process.env.MNKB_BROWSER_EXECUTABLE || undefined, headless:true });
const checks=[], errors=[];
try {
  const page = await browser.newPage({ viewport:{width:1360,height:950} });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/search.html`);
  await page.evaluate(() => {
    const make = (id, children=[], type='归类') => ({ id,title:id,path:id,type,children,revision:'r1',fields:[{name:'相关思考',count:1}],content:'保留的思考',excerpt:'原始摘录' });
    window.orgModel = { revision:'v1',sourceId:'B',targetId:'A',sourceNodes:[make('B',['B1','KEEP']),make('B1',['B2']),make('B2'),make('KEEP')],targetNodes:[make('A',['A1']),make('A1',['A2']),make('A2')] };
    window.orgRequests=[]; window.orgWrites=0;
    state.aiCardSearch.selectedSource='Fixture'; state.aiCardSearch.selectedModel='model';
    setCardsForDataset('knowledge',[{id:'A',title:'哈代空间上的紧算子',type:'归类'}, {id:'P',title:'紧算子的范数估计',type:'命题'}]);
    state.hasRealData=true;
    sendURLToNative=(action,params) => {
      if (!action.startsWith('organization')) return true;
      const payload=JSON.parse(window.MNKBOrganizationUI.takePayload(params.requestId));
      window.orgRequests.push({action,payload});
      if (window.orgDelay && action==='organizationSearch') { window.orgDelayed={action,params,payload}; return true; }
      let result={success:true,requestId:params.requestId};
      try {
        if (action==='organizationContext') result.source=window.orgModel.sourceNodes[0];
        if (action==='organizationModel') result.model=window.orgModel;
        if (action==='organizationSearch') result.ranked=payload.pairSourceId
          ? [{id:'A1',relation:'equivalent',reason:'<img src=x onerror=alert(1)>同一主题'}]
          : payload.stage==='container' ? [{id:'A',relation:'container',reason:'范围覆盖范数估计'}] : [];
        if (action==='organizationPreview') { result.plan=KnowledgeBaseOrganization.buildPlan(window.orgModel,payload.intent,payload.choices); result.previewToken='preview'; }
        if (action==='organizationExecute') { window.orgWrites++; result.targetId='A'; }
      } catch(error) { result={...result,success:false,error:error.message}; }
      queueMicrotask(()=>window.MNKBOrganizationUI.complete(result)); return true;
    };
    state.selectedCardId='A'; updateSelectionInfo();updateActionButtonsState();
  });
  await page.locator('#organizationReadSource').click();
  await page.waitForFunction(()=>document.querySelector('#organizationSource').textContent.includes('B'));
  await page.waitForFunction(()=>document.querySelector('#organizationSource').textContent==='待整理 B：B · 归类');
  await page.evaluate(()=>{state.selectedCardId='A';updateSelectionInfo();updateActionButtonsState();});
  assert.equal(await page.locator('#organizationMerge').textContent(),'合并重复归类');
  await page.locator('#organizationMerge').click();
  await page.locator('#organizationDialog[open]').waitFor();
  assert.equal(await page.locator('.organization-review-row').count(),2);
  assert.equal(await page.getByRole('button',{name:'查看完整预览',exact:true}).isDisabled(),true);
  await page.locator('select[aria-label="处理归类：B1"]').selectOption('A1');
  assert.equal(await page.locator('.organization-review-row').count(),3);
  await page.locator('select[aria-label="处理归类：KEEP"]').selectOption('move');
  await page.locator('select[aria-label="处理归类：B2"]').selectOption('A2');
  assert.equal(await page.evaluate(()=>window.orgWrites),0,'review must be read-only');
  await page.getByRole('button',{name:'查看完整预览',exact:true}).click();
  await page.getByRole('button',{name:'确认执行',exact:true}).waitFor();
  assert.match(await page.locator('#organizationDialogBody').textContent(),/移除来源/);
  assert.match(await page.locator('#organizationDialogBody').textContent(),/KEEP/);
  await page.screenshot({path:path.join(out,'recursive-preview.png')});
  await page.getByRole('button',{name:'确认执行',exact:true}).click();
  await page.waitForFunction(()=>window.orgWrites===1);
  assert.equal(await page.locator('#organizationDialog').evaluate(n=>n.open),false);
  assert.equal(await page.getByRole('button',{name:'定位处理后的卡片',exact:true}).isVisible(),true);
  checks.push('manual selection, recursive confirmation, preserved branches, unified preview, single execution and optional location');

  await page.evaluate(()=>{ window.orgModel.sourceNodes[0].type='命题'; window.orgModel.sourceNodes[0].title='紧算子的范数估计'; });
  await page.locator('#organizationFindEqual').click();
  await page.waitForFunction(()=>window.orgRequests.some(r=>r.action==='organizationSearch' && r.payload.stage==='container'));
  await page.getByRole('button',{name:/适合归入/}).waitFor();
  assert.equal(await page.locator('#organizationCandidates img').count(),0);
  checks.push('no equivalent candidate falls back to a containing classification using the existing source scope');

  await page.evaluate(()=>{window.orgDelay=true;});
  await page.locator('#organizationFindParent').click();
  await page.waitForFunction(()=>!!window.orgDelayed);
  await page.locator('#searchInput').fill('不相关的新查询');
  await page.evaluate(()=>{const d=window.orgDelayed; window.MNKBOrganizationUI.complete({requestId:d.params.requestId,success:true,ranked:[{id:'P',relation:'related',reason:'迟到结果'}]});});
  assert.doesNotMatch(await page.locator('#organizationCandidates').textContent(),/迟到结果/);
  checks.push('changed search scope/query suppresses late organization results');

  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{window.orgDelay=false;openSidebar();});
  await page.screenshot({path:path.join(out,'mobile-sidebar.png')});
  assert.equal(await page.locator('#organizationPanel').isVisible(),true);
  assert.equal(await page.locator('#organizationCustom').evaluate(n=>n.open),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 2),true);
  checks.push('mobile semantic controls and collapsed custom options fit the viewport');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'browser-result.json'),JSON.stringify({checks,errors},null,2));
  console.log(checks.join('\n'));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
