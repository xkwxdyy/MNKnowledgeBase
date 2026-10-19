import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PROOF_PLAYWRIGHT || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.tmp/proof-reader-round2');
await fs.mkdir(output, { recursive: true });
const ink = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="840" height="260" viewBox="0 0 840 260"><rect width="840" height="260" fill="white"/><g fill="#183b76" font-family="Georgia,serif" font-style="italic"><text x="45" y="70" font-size="29">n = 1:  1 = 1(1 + 1) / 2</text><text x="45" y="136" font-size="29">S(k + 1) = k(k + 1)/2 + (k + 1)</text><text x="192" y="202" font-size="31">= (k + 1)(k + 2) / 2</text></g><path d="M185 220 Q380 230 664 216" fill="none" stroke="#a83131" stroke-width="3"/></svg>').toString('base64');
const comments = [
  { index: 5, detailedType: 'markdownComment', htmlMarkdownType: 'goal', htmlMarkdownContent: '证明前 $n$ 个正整数的和\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$' },
  { index: 6, detailedType: 'markdownComment', htmlMarkdownType: 'method', htmlMarkdownContent: '**数学归纳法**：先验证起点，再说明命题从 $k$ 到 $k+1$ 成立。\n\n这里保留方法的说明，方便回顾为什么这样证明。' },
  { index: 7, detailedType: 'markdownComment', htmlMarkdownType: 'level1', htmlMarkdownContent: '建立归纳证明' },
  { index: 8, detailedType: 'markdownComment', htmlMarkdownType: 'step', htmlMarkdownContent: '验证起点，并写出归纳假设' },
  { index: 9, detailedType: 'textComment', text: '当 n = 1 时，左右两边都等于 1。\n假设命题对 n = k 成立，接下来考察 n = k + 1。' },
  { index: 10, detailedType: 'drawingComment', drawingPreviewDataURI: ink },
  { index: 11, detailedType: 'markdownComment', htmlMarkdownType: 'step', htmlMarkdownContent: '完成递推' },
  { index: 12, detailedType: 'mergedMarkdownComment', markdown: true, text: '由归纳假设可得：\n\n$$S_{k+1} = S_k + (k+1) = \\frac{(k+1)(k+2)}{2}.$$\n\n所以命题对所有正整数成立。' },
  { index: 13, detailedType: 'linkComment', linkedNoteId: 'INDUCTION', linkedNoteTitle: '数学归纳法的原理' },
  { index: 14, detailedType: 'markdownComment', htmlMarkdownType: 'check', htmlMarkdownContent: '检验 $n=2$：左边 $1+2=3$，右边 $2\\times3/2=3$。' },
];
const payload = { noteId: 'DEMO-NOTE', noteTitle: '前 n 个正整数的和', revision: 'revision-1', requestId: 1, field: { name: '证明', index: 4, startIndex: 5, endIndex: 14, commentIndices: comments.map(item => item.index) }, comments };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('http://proof-reader.test/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ path: target }); } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  const page = await context.newPage();
  const assertReading = async id => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__proofStructureWorkbench.state.selectedId), id, '逐段导航在滚动帧完成后保持选择');
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://proof-reader.test/proof-structure-workbench.html');
  assert.equal(await page.evaluate(data => window.loadProofStructureWorkbenchData(data), payload), true);
  await page.waitForSelector('mjx-container svg');
  assert.equal(await page.locator('.proof-entry').count(), comments.length, '每条原评论独立显示');
  assert.equal(await page.locator('mjx-container').count() >= 4, true, '离线数学排版');
  await page.locator('.proof-media img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const img = document.querySelector('.proof-media img'); return img.complete && img.naturalWidth > 0; });
  await page.locator('#readerPanel').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, 'reader-desktop.png') });
  await page.locator('#read-comment-10').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'reader-handwriting.png') });
  await page.locator('[data-media-item="comment-10"]').click();
  assert.equal(await page.locator('#mediaViewer').isVisible(), true);
  await page.locator('#mediaSize').click();
  assert.match(await page.locator('#mediaScroll').getAttribute('class'), /actual-size/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#mediaViewer').isVisible(), false);
  await page.locator('#mapMode').click();
  const layout = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.map-node')].map(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: el.offsetWidth, height: el.offsetHeight }));
    let overlaps = 0;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2) overlaps++;
    }
    return { overlaps, count: nodes.length };
  });
  assert.equal(layout.overlaps, 0);
  assert.equal(layout.count, 5);
  await page.screenshot({ path: path.join(output, 'reader-roadmap.png') });
  await page.locator('.map-node[data-item-id="comment-8"]').click();
  assert.equal(await page.locator('#readerPanel').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'read-comment-8');
  await page.locator('[data-branch-id="comment-8"]').click();
  assert.equal(await page.locator('.proof-entry').count(), 3, '步骤只显示自己的正文与手写');
  await page.locator('#showAllBtn').click();
  assert.equal(await page.locator('.proof-entry').count(), 10);
  await page.locator('#read-comment-12 [data-source-action="locate"]').click();
  assert.deepEqual(await page.evaluate(() => window.__lastProofStructureNativeRequest.params), { id: 'DEMO-NOTE', fieldName: '证明', commentIndex: 12, revision: 'revision-1' });
  const pendingPayload = structuredClone(payload);
  pendingPayload.requestId = 2;
  pendingPayload.comments[5].drawingPreviewPending = true;
  pendingPayload.comments[5].drawingPreviewDataURI = '';
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), pendingPayload);
  await page.locator('#read-comment-12').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('mjx-container').length > 0);
  await page.evaluate(() => window.__proofStructureWorkbench.whenTypeset());
  const before = await page.locator('#read-comment-12').evaluate(el => el.getBoundingClientRect().top);
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), { ...payload, requestId: 3 });
  await page.evaluate(() => window.__proofStructureWorkbench.whenTypeset());
  const after = await page.locator('#read-comment-12').evaluate(el => el.getBoundingClientRect().top);
  assert.ok(Math.abs(before - after) < 3, '媒体补齐时保留正文锚点，不回页首');
  assert.equal(await page.evaluate(data => window.loadProofStructureWorkbenchData(data), pendingPayload), false, '拒绝迟到响应');
  assert.equal(await page.locator('.proof-media img').count(), 1);
  await page.evaluate(() => { window.proofEntryBefore = document.querySelector('.proof-entry'); });
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), { ...payload, requestId: 3 });
  assert.equal(await page.evaluate(() => window.proofEntryBefore === document.querySelector('.proof-entry')), true, '重复数据不重建正文');
  // Round two: passive reading navigation must not rebuild or reopen the outline.
  await page.evaluate(() => { window.proofEntryBeforeScroll = document.querySelector('.proof-entry'); document.querySelector('[data-node-id="comment-7"]').open = false; });
  await page.locator('#read-comment-10').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.waitForFunction(() => window.__proofStructureWorkbench.state.selectedId === 'comment-10');
  assert.equal(await page.locator('.outline-btn[data-item-id="comment-10"]').getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('[data-node-id="comment-7"]').getAttribute('open'), null);
  assert.equal(await page.evaluate(() => window.proofEntryBeforeScroll === document.querySelector('.proof-entry')), true);
  assert.equal(await page.locator('#readingPosition').innerText(), '6 / 10');
  await page.locator('#nextEntry').click();
  await page.waitForFunction(() => window.__proofStructureWorkbench.state.selectedId === 'comment-11');
  assert.match(await page.locator('#readingContext').innerText(), /完成递推/);
  for (const index of [12, 13, 14]) {
    await page.locator('#nextEntry').click();
    await assertReading(`comment-${index}`);
  }
  assert.equal(await page.locator('#nextEntry').isDisabled(), true);
  for (const index of [13, 12, 11]) {
    await page.locator('#previousEntry').click();
    await assertReading(`comment-${index}`);
  }
  await page.locator('#previousEntry').click();
  await page.waitForFunction(() => window.__proofStructureWorkbench.state.selectedId === 'comment-10');
  await page.locator('#mapMode').click();
  await page.locator('#mapLocate').click();
  assert.equal(await page.locator('.map-node[data-item-id="comment-8"]').getAttribute('aria-current'), 'true');
  await page.locator('#zoomIn').click();
  const savedMap = await page.evaluate(() => { const s = window.__proofStructureWorkbench.state; return [s.scale, s.panX, s.panY]; });
  await page.locator('#readMode').click();
  await page.locator('#mapMode').click();
  assert.deepEqual(await page.evaluate(() => { const s = window.__proofStructureWorkbench.state; return [s.scale, s.panX, s.panY]; }), savedMap, '切换视图保留画布缩放与位置');
  const mapNode = await page.locator('.map-node[data-item-id="comment-8"]').boundingBox();
  await page.mouse.move(mapNode.x + mapNode.width / 2, mapNode.y + 20);
  await page.mouse.down();
  await page.mouse.move(mapNode.x + mapNode.width / 2 + 70, mapNode.y + 55, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator('#canvasPanel').isVisible(), true, '拖拽节点不会误打开正文');
  assert.equal(await page.evaluate(() => window.__proofStructureWorkbench.state.dragging), false);
  assert.ok(Math.abs((await page.evaluate(() => window.__proofStructureWorkbench.state.panX)) - savedMap[1] - 70) < 2);
  const touch = await context.newCDPSession(page);
  await page.locator('#mapLocate').click();
  const viewBox = await page.locator('#viewport').boundingBox();
  const cx = viewBox.x + viewBox.width / 2, cy = viewBox.y + viewBox.height / 2;
  const initialGesture = await page.evaluate(({ x, y }) => { const s = window.__proofStructureWorkbench.state; const r = document.getElementById('viewport').getBoundingClientRect(); return { scale: s.scale, stageX: (x - r.left - s.panX) / s.scale, stageY: (y - r.top - s.panY) / s.scale }; }, { x: cx, y: cy });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 70 + 25, y: cy + 18, id: 1 }, { x: cx + 70 + 25, y: cy + 18, id: 2 }] });
  const finalGesture = await page.evaluate(({ x, y }) => { const s = window.__proofStructureWorkbench.state; const r = document.getElementById('viewport').getBoundingClientRect(); return { scale: s.scale, stageX: (x - r.left - s.panX) / s.scale, stageY: (y - r.top - s.panY) / s.scale }; }, { x: cx + 25, y: cy + 18 });
  assert.ok(Math.abs(finalGesture.scale - Math.min(2, initialGesture.scale * 1.75)) < 0.01, '真实触控事件改变缩放');
  assert.ok(Math.abs(finalGesture.stageX - initialGesture.stageX) < 2 && Math.abs(finalGesture.stageY - initialGesture.stageY) < 2, '双指缩放保持中心锚点');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.evaluate(() => window.__proofStructureWorkbench.state.dragging), false);
  assert.equal(await page.locator('#canvasPanel').isVisible(), true);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await page.evaluate(() => window.__proofStructureWorkbench.state.dragging), false, '取消手势释放拖拽状态');
  await touch.detach();
  await page.locator('#mapLocate').click();
  await page.locator('.map-node[data-item-id="comment-8"]').click();
  assert.equal(await page.locator('#readerPanel').isVisible(), true, '拖拽结束后的下一次点击仍能打开正文');
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px 无页面横向溢出`);
    assert.equal(await page.locator('#readerPanel').isVisible(), true);
    if (width < 760) {
      await page.locator('#outlineToggle').click();
      assert.equal(await page.locator('#sidebar').isVisible(), true);
      assert.equal(await page.locator('#readerPanel').getAttribute('inert'), '');
      assert.equal(await page.evaluate(() => document.getElementById('sidebar').contains(document.activeElement)), true, '目录打开后焦点进入目录');
      await page.locator('#outlineToggle').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'outlineClose', '目录焦点不进入背后的视图按钮');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#readerPanel').getAttribute('inert'), null);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'outlineToggle');
      await page.locator('#outlineToggle').click();
      await page.locator('.outline-btn[data-item-id="comment-10"]').click();
      assert.equal(await page.locator('#sidebar').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'read-comment-10');
      if (width === 375) await page.screenshot({ path: path.join(output, 'reader-mobile.png') });
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#read-comment-10').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.media-open').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', '深色模式手写保留纸底');
  await page.screenshot({ path: path.join(output, 'reader-dark.png') });
  const galleryPayload = structuredClone(payload);
  galleryPayload.requestId = 4;
  const secondInk = 'data:image/svg+xml;base64,' + Buffer.from(Buffer.from(ink.split(',')[1], 'base64').toString().replace('#183b76', '#315d29')).toString('base64');
  galleryPayload.comments[8] = { index: 13, detailedType: 'mergedImageCommentWithDrawing', imageBase64: secondInk, drawingPreviewDataURI: ink };
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), galleryPayload);
  await page.locator('[data-media-item="comment-10"]').click();
  assert.equal(await page.locator('#mediaPosition').innerText(), '1 / 3');
  assert.equal(await page.locator('#mediaPrevious').isDisabled(), true);
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#mediaTitle').innerText(), /图片.*#13/);
  await page.locator('#mediaNext').click();
  assert.equal(await page.locator('#mediaPosition').innerText(), '3 / 3');
  assert.equal(await page.locator('#mediaNext').isDisabled(), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#mediaPosition').innerText(), '3 / 3', '末张不越界');
  await page.locator('#mediaSize').click();
  await page.keyboard.press('ArrowLeft');
  assert.match(await page.locator('#mediaScroll').getAttribute('class'), /actual-size/, '连续查看保留原始大小选择');
  await page.locator('#mediaClose').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mediaPrevious', '图片面板焦点循环');
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'reader-gallery-mobile.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.mediaItem), 'comment-10', '关闭图片回到原打开位置');
  const hostile = structuredClone(payload);
  hostile.requestId = 5;
  hostile.comments = [{ index: 5, detailedType: 'markdownComment', text: '<script>window.proofXss=1</script><img src="x" onerror="window.proofXss=2"><a href="javascript:alert(1)">bad</a>\n\n**安全文本**' }];
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), hostile);
  assert.equal(await page.evaluate(() => window.proofXss), undefined);
  assert.equal(await page.locator('.proof-content [onerror], .proof-content script, .proof-content a[href^="javascript:"]').count(), 0);
  const ordinary = { noteId: 'ORDINARY', requestId: 6, field: { name: '原理', index: 0 }, comments: Array.from({ length: 100 }, (_, i) => ({ index: i + 1, detailedType: 'textComment', text: `完整的原评论 ${i + 1}\n第二段内容` })) };
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), ordinary);
  assert.equal(await page.locator('.proof-entry').count(), 100);
  assert.match(await page.locator('#readerBody').innerText(), /完整的原评论 100/);
  const empty = { noteId: 'EMPTY', requestId: 7, field: { name: '反例', index: 0 }, comments: [] };
  await page.evaluate(data => window.loadProofStructureWorkbenchData(data), empty);
  assert.equal(await page.locator('.empty-state').isVisible(), true);
  assert.equal(await page.locator('#fieldName').innerText(), '反例');
  assert.equal(await page.locator('#previousEntry').isDisabled(), true);
  assert.equal(await page.locator('#nextEntry').isDisabled(), true);
  assert.deepEqual(errors, [], '浏览器无未捕获错误');
  console.log(JSON.stringify({ result: 'passed', viewports: [320, 375, 768, 1024, 1280], independentComments: 100, mapOverlaps: layout.overlaps, math: 'offline SVG', screenshots: output }, null, 2));
} finally { await browser.close(); }
