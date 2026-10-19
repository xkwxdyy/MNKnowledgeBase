// WebView integration only: uses the production corpus/core and a simulated Native transport.
// MNKB_PLAYWRIGHT_MODULE and MNKB_BROWSER_EXECUTABLE select local browser dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MNKB_PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tmp/ai-card-search-verification');
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!/^\/(search\.html|styles\/search\.css|scripts\/search\/[\w-]+\.js|resources\/search\/math-term-corpus\.runtime\.js)$/.test(pathname)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const contents = await fs.readFile(path.join(root, pathname));
    const mime = pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
    response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
let browser;
const errors = [];
const checks = [];
try {
  browser = await chromium.launch({ executablePath: process.env.MNKB_BROWSER_EXECUTABLE || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.MNKBBridge = { postMessage: () => true }; });
  await page.goto(`http://127.0.0.1:${server.address().port}/search.html`);
  await page.evaluate(() => {
    window.aiTestRequests = [];
    sendURLToNative = (action, params) => { window.aiTestRequests.push({ action, params }); return true; };
    setCardsForDataset('knowledge', [
      { id: 'ai-1', title: '紧致空间的定义', type: '定义', searchText: '紧致空间 开覆盖 有限子覆盖' },
      { id: 'ai-2', title: '紧致空间的连续像仍是紧致空间', type: '命题' },
      { id: 'ai-3', title: '紧致空间与闭区间', type: '例子' },
      { id: 'ai-4', title: '紧致空间的有限交性质', type: '命题' },
      { id: 'ai-5', title: '有界线性算子的范数', type: '定义' },
    ]);
    state.hasRealData = true;
    isNativeAICardSearchRuntime = () => true;
    handleAICardSearchModelOptions({
      sources: [{ source: 'Fixture', models: ['model-a', 'model-b'] }],
      selected: { source: 'Fixture', model: 'model-a' },
    });
  });
  const requests = () => page.evaluate(() => window.aiTestRequests.filter((item) => item.action === 'aiSearchRerank'));
  async function startSearch(query = '紧致空间') {
    const count = (await requests()).length;
    await page.locator('#searchInput').fill(query);
    await page.locator('#aiCardSearchBtn').click();
    try {
      await page.waitForFunction((previous) => window.aiTestRequests.filter((item) => item.action === 'aiSearchRerank').length > previous, count);
    } catch (error) {
      console.error(await page.evaluate(() => ({
        status: dom.aiCardSearchStatus.textContent, toast: dom.toast.textContent,
        active: state.aiCardSearch.active, loading: state.aiCardSearch.loading,
        selectedModel: state.aiCardSearch.selectedModel, resultCount: state.filteredCards.length,
      })));
      throw error;
    }
    return (await requests()).at(-1).params.requestId;
  }
  async function complete(requestId, options = {}) {
    return page.evaluate(({ requestId, options }) => {
      const payload = takeAICardSearchRerankPayload(requestId);
      window.aiTestLastPayload = payload;
      return completeAICardSearchRerank(options.failure ? { requestId, success: false, error: '模拟服务失败' } : {
        requestId,
        success: true,
        ranked: payload.candidates.slice().reverse().map((card, index) => ({ id: card.id, relevance: 99 - index, reason: options.clean ? '包含所查询的紧致空间知识' : '<img src=x onerror=alert(1)>', answerRole: 'direct_answer' })),
        modelLabel: `Fixture: ${window.aiTestRequests.find((item) => item.action === 'aiSearchRerank' && item.params.requestId === requestId).params.model}`,
      });
    }, { requestId, options });
  }

  let requestId = await startSearch();
  const localIds = await page.evaluate(() => state.filteredCards.map((card) => card.id));
  assert.ok(localIds.length > 1);
  assert.ok(!localIds.includes('ai-5'));
  await complete(requestId);
  await page.waitForFunction(() => !state.aiCardSearch.loading);
  assert.equal(await page.evaluate(() => state.aiCardSearch.modelReranked), true);
  assert.equal(await page.locator('#aiCardSearchRetryBtn').isVisible(), false, 'successful ranking must hide retry in computed layout');
  assert.equal(await page.locator('#results img[onerror]').count(), 0, 'model reason must render as text');
  assert.deepEqual((await page.evaluate(() => state.filteredCards.map((card) => card.id))).sort(), localIds.slice().sort());
  checks.push('production corpus/local recall and candidate-only model ranking; model reason escaped');

  await page.locator('#aiCardSearchCloseBtn').click();
  requestId = await startSearch();
  await page.locator('#searchInput').fill('线性算子');
  assert.equal(await page.evaluate(() => state.aiCardSearch.active), false);
  assert.equal(await page.evaluate((id) => completeAICardSearchRerank({ requestId: id, success: true, ranked: [{ id: 'ai-1', relevance: 100 }] }), requestId), false);
  assert.ok(await page.evaluate((id) => window.aiTestRequests.some((item) => item.action === 'aiSearchCancelRerank' && item.params.requestId === id), requestId));
  await page.waitForFunction(() => state.filteredCards.length === 1 && state.filteredCards[0].id === 'ai-5');
  checks.push('input change cancels immediately; late reply cannot restore the old result');

  requestId = await startSearch();
  const historyCount = (await requests()).length;
  await page.evaluate(() => executeSearchHistoryItem('ai', { query: '紧致空间的性质' }));
  await page.waitForFunction((previous) => window.aiTestRequests.filter((item) => item.action === 'aiSearchRerank').length > previous, historyCount);
  assert.equal(await page.evaluate((id) => completeAICardSearchRerank({ requestId: id, success: true, ranked: [] }), requestId), false);
  assert.equal(await page.locator('#searchInput').inputValue(), '紧致空间的性质');
  await complete((await requests()).at(-1).params.requestId);
  await page.waitForFunction(() => !state.aiCardSearch.loading);
  checks.push('AI history cancels the in-flight query and starts the selected history query');

  requestId = await startSearch();
  await complete(requestId, { failure: true });
  await page.waitForFunction(() => !state.aiCardSearch.loading);
  assert.equal(await page.locator('#aiCardSearchRetryBtn').isVisible(), true);
  const retryCount = (await requests()).length;
  await page.locator('#aiCardSearchRetryBtn').click();
  await page.waitForFunction((previous) => window.aiTestRequests.filter((item) => item.action === 'aiSearchRerank').length > previous, retryCount);
  await page.evaluate(() => retryAICardSearchRerank());
  assert.equal((await requests()).length, retryCount + 1, 'retry is single flight');
  requestId = (await requests()).at(-1).params.requestId;
  assert.equal(await page.locator('#aiCardSearchBtn').isDisabled(), true);
  await page.locator('#clearBtn').click();
  assert.equal(await page.locator('#aiCardSearchPanel').isVisible(), false);
  assert.equal(await page.evaluate((id) => completeAICardSearchRerank({ requestId: id, success: true, ranked: [{ id: 'ai-1', relevance: 100 }] }), requestId), false);
  checks.push('failed model preserves local cards; retry cannot overlap; clear cancels retry');

  requestId = await startSearch();
  await page.evaluate(() => activateLocalSearch('root-fixture', '测试范围'));
  assert.equal(await page.evaluate(() => state.aiCardSearch.active), false);
  const beforeScope = (await requests()).length;
  await page.locator('#aiCardSearchBtn').click();
  assert.equal((await requests()).length, beforeScope, 'pending scope must not send the full index');
  await page.evaluate(() => handleSetDescendantCardIds({ rootId: 'root-fixture', requestId: state.localSearchRequestId, descendantIds: ['ai-2', 'ai-4'] }));
  requestId = await startSearch();
  await complete(requestId);
  await page.waitForFunction(() => !state.aiCardSearch.loading);
  assert.deepEqual((await page.evaluate(() => window.aiTestLastPayload.candidates.map((card) => card.id))).sort(), ['ai-2', 'ai-4']);
  checks.push('starting a local scope cancels ranking; loading scope is closed; resolved scope constrains model candidates');

  await page.evaluate(() => deactivateLocalSearch());
  requestId = await startSearch();
  await page.evaluate(() => applyCardsPatch({ upserts: [{ id: 'ai-1', title: '索引更新后的紧致空间', type: '定义' }] }));
  assert.equal(await page.evaluate(() => state.aiCardSearch.active), false);
  assert.equal(await page.evaluate((id) => completeAICardSearchRerank({ requestId: id, success: true, ranked: [{ id: 'ai-1', relevance: 100 }] }), requestId), false);
  checks.push('index patch invalidates pending ranking before old cards can overwrite refreshed data');

  requestId = await startSearch();
  await complete(requestId);
  await page.waitForFunction(() => !state.aiCardSearch.loading);
  await page.evaluate(() => {
    requestAICardSearchModelCatalog({ refresh: true });
    window.aiOldCatalogId = window.aiTestRequests.filter((item) => item.action === 'aiSearchGetModels').at(-1).params.requestId;
  });
  await page.locator('#aiCardSearchModelSelect').selectOption(JSON.stringify(['Fixture', 'model-b']));
  const selection = await page.evaluate(() => window.aiTestRequests.filter((item) => item.action === 'aiSearchSetModel').at(-1).params);
  assert.ok(selection.requestId);
  await page.evaluate((selection) => {
    handleAICardSearchModelOptions({ requestId: selection.requestId, sources: [{ source: 'Fixture', models: ['model-a', 'model-b'] }], selected: selection });
    handleAICardSearchModelOptions({ requestId: window.aiOldCatalogId, sources: [{ source: 'Fixture', models: ['model-a'] }], selected: { source: 'Fixture', model: 'model-a' } });
  }, selection);
  assert.equal(await page.evaluate(() => state.aiCardSearch.selectedModel), 'model-b');
  checks.push('model setting and catalog requests carry identities; late refresh cannot overwrite a newer manual selection');

  requestId = await startSearch();
  await complete(requestId, { clean: true });
  await page.waitForFunction(() => !state.aiCardSearch.loading);
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px page overflows`);
    assert.equal(await page.locator('#aiCardSearchCloseBtn').isVisible(), true);
    assert.equal(await page.locator('#aiCardSearchStatus').isVisible(), true, `${width}px ranking status must remain visible`);
    assert.ok(await page.locator('#aiCardSearchStatus').evaluate((status) => status.getBoundingClientRect().width > 80));
    assert.equal(await page.locator('#aiCardSearchRetryBtn').isVisible(), false);
    if (width === 375 || width === 1280) await page.screenshot({ path: path.join(output, `ai-search-${width}.png`), fullPage: true });
  }
  checks.push('AI results and controls fit 320/375/768/1280 px; desktop/mobile screenshots saved');
  assert.deepEqual(errors, []);
  const result = { checks, pageErrors: errors, runtime: 'Chromium + simulated Native transport; no live MNAI service or device calls' };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
