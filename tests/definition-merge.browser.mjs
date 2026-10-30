import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DEFINITION_MERGE_PLAYWRIGHT || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.tmp/definition-merge-fix-20261022/browser');
await fs.mkdir(output, { recursive: true });

const payload = {
  revision: 'revision-1', canExecute: true, canSwap: false,
  swapDisabledReason: '来源定义卡位于目标定义卡下，不能交换合并方向。', errors: [],
  sourceDefinition: { noteId: 'DEF-A', title: '极限的定义' },
  targetDefinition: { noteId: 'DEF-B', title: '函数极限' },
  sourceNodes: [
    {
      noteId: 'SRC-1', title: '极限的定义：基本性质', shortTitle: '基本性质', subtype: '性质',
      knowledgeCount: 4, nestedCount: 1,
      knowledgeChildren: [
        { noteId: 'KN-1', title: '极限的定义：唯一性', kind: '命题' },
        { noteId: 'KN-2', title: '极限的定义：局部有界性', kind: '命题' },
        { noteId: 'KN-3', title: '极限的定义：保号性', kind: '命题' },
        { noteId: 'KN-4', title: '极限的定义：四则运算', kind: '命题' },
      ],
    },
    { noteId: 'SRC-2', title: '极限的定义：典型例题', shortTitle: '典型例题', subtype: '例题', knowledgeCount: 2, nestedCount: 2 },
  ],
  targetNodes: [
    {
      noteId: 'TGT-1', title: '函数极限：基本性质', shortTitle: '基本性质', subtype: '性质', knowledgeCount: 2, nestedCount: 0, depth: 0,
      knowledgeChildren: [
        { noteId: 'KN-T-1', title: '函数极限：唯一性', kind: '命题' },
        { noteId: 'KN-T-2', title: '函数极限：有界性', kind: '命题' },
      ],
    },
    { noteId: 'TGT-2', title: '函数极限：单侧极限', shortTitle: '单侧极限', subtype: '性质', knowledgeCount: 1, nestedCount: 0, depth: 1 },
  ],
};

const report = { result: 'running', viewports: [1280, 390], checks: [], screenshots: output };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const pageErrors = [];
  const unexpectedRequests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://definition-merge.test') {
      unexpectedRequests.push(url.href);
      return route.abort();
    }
    const target = path.resolve(root, decodeURIComponent(url.pathname.slice(1)));
    if (!target.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ path: target }); }
    catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  await context.addInitScript(() => {
    window.__nativeRequests = [];
    window.__nativeShim = (action, params) => window.__nativeRequests.push({ action, params });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const load = async (data = payload) => {
    assert.equal(await page.evaluate(value => window.loadDefinitionMergeWorkbenchData(value), data), true);
  };
  const requests = action => page.evaluate(name => window.__nativeRequests.filter(item => item.action === name), action);
  const clearRequests = () => page.evaluate(() => { window.__nativeRequests.length = 0; });
  const source = id => page.locator(`[data-source-id="${id}"] > .node-main`);
  const target = id => page.locator(`[data-target-id="${id}"] > .node-main`);
  const mapFirst = async () => { await source('SRC-1').click(); await target('TGT-1').click(); };
  const finish = result => page.evaluate(value => window.Bridge.completeDefinitionMergeAction(value), result);
  const assertNoOverflow = async label => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(layout.document <= layout.viewport && layout.body <= layout.viewport, `${label}: ${JSON.stringify(layout)}`);
  };
  const capture = async name => { await page.screenshot({ path: path.join(output, name + '.png') }); };
  const openPage = async (data = payload) => {
    await page.goto('http://definition-merge.test/definition-merge-workbench.html');
    assert.equal((await requests('ready')).length, 1);
    await load(data);
    await clearRequests();
  };

  await openPage();
  assert.equal(await page.locator('#sourceTitle').innerText(), payload.sourceDefinition.title);
  assert.equal(await page.locator('#targetTitle').innerText(), payload.targetDefinition.title);
  assert.equal(await page.locator('#pairedCount').innerText(), '0');
  assert.equal(await page.locator('#movedTreeCount').innerText(), '2');
  assert.equal(await page.locator('#deletedCount').innerText(), '1');
  assert.equal(await page.locator('#swapBtn').isDisabled(), true, '父子定义上下文不能交换方向');
  assert.match(await page.locator('#swapBtn').getAttribute('title') || '', /不能|不支持|禁止/);
  await page.locator('#swapBtn').dispatchEvent('click');
  assert.equal((await requests('swapDefinitionMergeWorkbench')).length, 0, '禁用交换按钮的事件不能触发原生交换');
  await assertNoOverflow('桌面工作台');
  await capture('desktop-default');

  await source('SRC-1').click();
  assert.equal(await page.locator('[data-source-id="SRC-1"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#cancelSelectionBtn').click();
  assert.equal(await page.locator('[data-source-id="SRC-1"]').getAttribute('aria-pressed'), 'false');
  await mapFirst();
  assert.equal(await page.locator('#pairedCount').innerText(), '1');
  assert.equal(await page.locator('#movedTreeCount').innerText(), '1');
  assert.equal(await page.locator('#movedKnowledgeCount').innerText(), '4');
  assert.equal(await page.locator('#deletedCount').innerText(), '2');
  await page.locator('[data-source-knowledge-id="KN-1"]').click();
  await page.locator('#cancelSelectionBtn').click();
  assert.equal(await page.locator('[data-source-knowledge-id="KN-1"]').getAttribute('aria-pressed'), 'false', '取消选择同时清除知识点选择');
  assert.equal(await page.locator('[data-target-knowledge-id]').count(), 0);
  await page.locator('[data-source-knowledge-id="KN-1"]').click();
  await page.locator('[data-target-knowledge-id="KN-T-1"]').click();
  assert.equal(await page.locator('#mergedKnowledgeCount').innerText(), '1');
  assert.equal(await page.locator('#movedKnowledgeCount').innerText(), '3');
  assert.equal(await page.locator('#deletedCount').innerText(), '3');
  await page.locator('[data-unmap-knowledge-id="KN-1"]').click();
  assert.equal(await page.locator('#mergedKnowledgeCount').innerText(), '0');
  await page.locator('[data-source-knowledge-id="KN-1"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-source-knowledge-id="KN-1"]').getAttribute('aria-pressed'), 'false');
  await page.locator('[data-source-id="SRC-1"] [data-unmap-source-id="SRC-1"]').click();
  assert.equal(await page.locator('#pairedCount').innerText(), '0');
  assert.equal(await page.locator('#movedTreeCount').innerText(), '2');
  await page.locator('[data-toggle-children="SRC-1"]').click();
  assert.equal(await page.locator('[data-source-knowledge-id="KN-4"]').count(), 1);
  report.checks.push('classification-and-knowledge-pairing-and-cancellation');

  await mapFirst();
  await page.locator('[data-source-knowledge-id="KN-1"]').click();
  await page.locator('[data-target-knowledge-id="KN-T-1"]').click();
  await page.locator('input[name="titleMode"][value="target"]').check({ force: true });
  await page.locator('#keepAliases').uncheck({ force: true });
  assert.match(await page.locator('#aliasHint').innerText(), /不保留/);
  await page.locator('#previewBtn').click();
  assert.equal(await page.locator('#previewModal').isVisible(), true);
  assert.equal(await page.locator('#finalTitlePreview').innerText(), payload.targetDefinition.title);
  assert.match(await page.locator('#previewRules').innerText(), /不保留另一侧词/);
  assert.equal(await page.locator('.preview-stat').count(), 5);
  assert.equal(await page.locator('.preview-action').count(), 2);
  assert.equal(await page.locator('#workbenchView').getAttribute('inert'), '');
  assert.equal((await requests('executeDefinitionMerge')).length, 0, '预演不向原生发送写入请求');
  await capture('desktop-preview');
  await page.locator('#executeBtn').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'closeModalBtn', '预演焦点循环');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#previewModal').isVisible(), false);
  assert.equal(await page.locator('#workbenchView').getAttribute('inert'), null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'previewBtn');
  report.checks.push('preview-is-read-only-and-title-alias-options');

  for (const width of report.viewports) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(`${width}px 工作台`);
    await capture(`workbench-${width}`);
    await page.locator('#previewBtn').click();
    await assertNoOverflow(`${width}px 预演`);
    await capture(`preview-${width}`);
    await page.locator('#modalBackBtn').click();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  report.checks.push('desktop-and-narrow-layout');

  await page.locator('#previewBtn').click();
  await page.locator('#executeBtn').click();
  const [execution] = await requests('executeDefinitionMerge');
  const submittedPlan = JSON.parse(execution.params.plan);
  assert.equal(execution.params.id, 'DEF-B');
  assert.equal(submittedPlan.titleMode, 'target');
  assert.equal(submittedPlan.keepAliases, false);
  assert.deepEqual(submittedPlan.knowledgeMappings, [{ sourceId: 'KN-1', targetId: 'KN-T-1' }]);
  assert.deepEqual(submittedPlan.mappings, [{ sourceId: 'SRC-1', targetId: 'TGT-1' }, { sourceId: 'SRC-2', targetId: 'move' }]);
  for (const id of ['executeBtn', 'previewBtn', 'swapBtn', 'refreshBtn', 'modalBackBtn', 'closeModalBtn']) {
    assert.equal(await page.locator('#' + id).isDisabled(), true, `执行期间禁用 ${id}`);
  }
  assert.equal(await page.evaluate(() => window.Bridge.canReplaceContext()), false);
  await page.locator('#executeBtn').dispatchEvent('click');
  await page.keyboard.press('Control+Enter');
  await page.locator('#refreshBtn').dispatchEvent('click');
  await page.locator('#closeBtn').dispatchEvent('click');
  await page.evaluate(() => window.Bridge.requestCloseDefinitionMergeWorkbench());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#previewModal').isVisible(), true, '执行期间不能关闭预演');
  assert.equal((await requests('executeDefinitionMerge')).length, 1, '执行请求只能发送一次');
  assert.equal((await requests('refreshDefinitionMergeWorkbench')).length, 0);
  assert.equal((await requests('closeDefinitionMergeWorkbench')).length, 0);
  assert.equal(await page.evaluate(data => window.loadDefinitionMergeWorkbenchData(data), { ...payload, revision: 'late-refresh' }), false, '执行期间拒绝载入其他上下文');
  assert.equal(await finish({ requestId: 'late-other-request', success: true }), false);
  assert.equal(await finish({ success: true }), false, '没有请求标识的回执不得误完成');
  assert.equal(await page.locator('#completionView').isVisible(), false);
  assert.equal(await page.locator('#executeBtn').isDisabled(), true);
  await capture('desktop-busy');
  assert.equal(await finish({ requestId: execution.params.requestId, success: true, pairedCount: 1, movedTreeCount: 1, movedKnowledgeCount: 3, mergedKnowledgeCount: 1, deletedCount: 3 }), true);
  assert.equal(await page.locator('#completionView').isVisible(), true);
  assert.equal(await page.locator('#toast').isVisible(), false, '合并完成后清除执行期间的旧错误提示');
  assert.match(await page.locator('#completionSummary').innerText(), /1 组归类合并.*1 棵整树迁移.*3 个知识点换父.*1 个重复知识点.*3 张来源卡/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'completionCloseBtn');
  assert.equal(await finish({ requestId: execution.params.requestId, success: false, error: 'duplicate' }), false, '重复回执不得覆盖完成状态');
  assert.equal(await finish({ requestId: 'late-other-request', success: true }), false);
  assert.match(await page.locator('#statusText').innerText(), /合并完成/);
  await capture('desktop-success');
  await page.setViewportSize({ width: 390, height: 900 });
  await assertNoOverflow('390px 完成界面');
  await capture('mobile-success');
  await page.locator('#completionCloseBtn').click();
  assert.equal((await requests('closeDefinitionMergeWorkbench')).length, 1);
  report.checks.push('single-execution-busy-locks-request-correlation-and-success');

  await openPage();
  await page.locator('#previewBtn').click();
  await page.locator('#executeBtn').click();
  const [failedExecution] = await requests('executeDefinitionMerge');
  assert.equal(await finish({ requestId: failedExecution.params.requestId, success: false, requiresUndo: true }), true);
  assert.match(await page.locator('#statusText').innerText(), /撤销一次/);
  assert.equal(await page.locator('#previewBtn').isDisabled(), true);
  assert.equal(await page.locator('#executeBtn').isDisabled(), true);
  await page.locator('#executeBtn').dispatchEvent('click');
  await page.keyboard.press('Control+Enter');
  assert.equal((await requests('executeDefinitionMerge')).length, 1, '中断后必须刷新才能继续执行');
  await capture('requires-undo');
  if (await page.locator('#previewModal').isVisible()) await page.locator('#modalBackBtn').click();
  await page.locator('#refreshBtn').click();
  assert.equal((await requests('refreshDefinitionMergeWorkbench')).length, 1);
  await load({ ...payload, revision: 'revision-after-undo' });
  assert.equal(await page.locator('#toast').isVisible(), false, '刷新数据后清除旧错误提示');
  assert.equal(await page.locator('#previewBtn').isDisabled(), false);
  await page.locator('#previewBtn').click();
  await page.locator('#executeBtn').click();
  assert.equal((await requests('executeDefinitionMerge')).length, 2);
  const secondExecution = (await requests('executeDefinitionMerge'))[1];
  assert.equal(await finish({ requestId: failedExecution.params.requestId, success: true }), false, '刷新后的新请求拒绝旧请求回执');
  assert.equal(await finish({ requestId: secondExecution.params.requestId, success: false, stale: true, message: '版本已变化，请刷新' }), true);
  assert.equal(await page.locator('#executeBtn').isDisabled(), true, '版本过期后要求刷新，避免重复使用旧方案');
  report.checks.push('failure-requires-refresh-and-ignores-stale-receipts');

  for (const invalid of [
    { ...payload, canExecute: false, errors: ['来源卡已删除'] },
    { ...payload, sourceDefinition: { noteId: 'DEF-B', title: '重复定义' } },
  ]) {
    await openPage(invalid);
    if (invalid.canExecute === false) assert.equal(await page.locator('#previewBtn').isDisabled(), true, '错误上下文禁用预演');
    await page.locator('#previewBtn').dispatchEvent('click');
    await page.locator('#executeBtn').dispatchEvent('click');
    assert.equal(await page.locator('#previewModal').isVisible(), false);
    assert.equal((await requests('executeDefinitionMerge')).length, 0, '错误上下文不能绕过按钮状态执行');
  }
  await openPage({ ...payload, canSwap: true, swapDisabledReason: '' });
  assert.equal(await page.locator('#swapBtn').isDisabled(), false);
  await page.locator('#swapBtn').click();
  const [swap] = await requests('swapDefinitionMergeWorkbench');
  assert.deepEqual(swap.params, { id: 'DEF-A', sourceNoteId: 'DEF-B', targetNoteId: 'DEF-A' });
  assert.equal(await finish({ requestId: 'unsolicited', success: true }), false, '无活动执行时拒绝主动完成回执');
  assert.equal(await page.locator('#completionView').isVisible(), false);
  report.checks.push('invalid-context-guards-and-unrelated-definition-swap');

  assert.deepEqual(pageErrors, [], '浏览器无未捕获异常');
  assert.deepEqual(unexpectedRequests, [], '页面资源全部来自离线源码');
  report.result = 'passed';
  report.pageErrors = pageErrors;
  report.unexpectedRequests = unexpectedRequests;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.result = 'failed';
  report.error = error.stack || error.message;
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
