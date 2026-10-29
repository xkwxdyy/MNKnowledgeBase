// Run with playwright-core (or MNKB_PLAYWRIGHT_MODULE pointing to its index.mjs).
// Set MNKB_BROWSER_EXECUTABLE when using an installed Chrome instead of bundled Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.MNKB_PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.tmp/search-ui-verification');
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  // Serve only the page and runtime assets; never expose .tmp or repository metadata.
  if (!/^\/(search\.html|KnowledgeBaseOrganization\.js|styles\/(?:search|organization)\.css|scripts\/search\/[\w-]+\.js)$/.test(pathname)) {
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
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const errors = [];
const checks = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.MNKB_BROWSER_EXECUTABLE || undefined,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // This fixture exercises WebView-only behavior. Native dispatch is not device acceptance.
    window.MNKBBridge = { postMessage: () => true };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/search.html`);
  await page.evaluate(() => {
    sendURLToNative = () => true;
    window.setCardsForDataset('knowledge', [
      { id: 'ui-1', title: '紧致性：定义与等价刻画', type: '定义' },
      { id: 'ui-2', title: '紧致空间的基本性质与连续映射下的不变性', type: '归类' },
      { id: 'ui-3', title: '连续映射保持紧致性', type: '命题' },
      { id: 'ui-4', title: '紧致性与有限覆盖', type: '例子' },
      { id: 'ui-5', title: '拓扑空间：紧致与列紧的关系', type: '问题' },
      { id: 'ui-6', title: '闭区间上的连续函数', type: '定理' },
    ]);
  });
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 6 && !state.isRenderingResults);
  const card = page.locator('.card[data-id="ui-2"]');
  const titleBefore = await card.locator('.card-title').boundingBox();
  await card.click();
  const titleAfter = await card.locator('.card-title').boundingBox();
  assert.equal(titleAfter.width, titleBefore.width, 'selection must preserve title width');
  const actions = await card.locator('.card-actions').boundingBox();
  assert.ok(actions.y >= titleAfter.y + titleAfter.height, 'actions must be below the title');
  checks.push('selected title retains full width; actions stay below content');

  const selectButton = card.locator('.card-select-btn');
  await selectButton.focus();
  await selectButton.press('Enter');
  assert.equal(await selectButton.getAttribute('aria-pressed'), 'false');
  assert.equal(await card.locator('.card-actions').count(), 0);
  await selectButton.press('Space');
  assert.equal(await selectButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await card.locator('.card-action-icon').count(), 9);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('data-action'), 'add-template', 'Tab must follow the visual title-to-actions order');
  await selectButton.focus();
  const nextRowId = await page.evaluate(() => {
    const cards = getRenderedResultCardNodes();
    const current = cards.findIndex((card) => card.dataset.id === 'ui-2');
    return cards[Math.min(cards.length - 1, current + getRenderedResultColumnCount(cards))].dataset.id;
  });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').evaluate((button) => button.closest('.card').dataset.id), nextRowId);
  assert.equal(await page.evaluate(() => state.selectedCardId), 'ui-2', 'arrow navigation must not change the target card');
  await page.keyboard.press('Home');
  assert.equal(await page.locator(':focus').evaluate((button) => button.closest('.card') === document.querySelector('.card')), true);
  await page.keyboard.press('End');
  assert.equal(await page.locator(':focus').evaluate((button) => button.closest('.card') === Array.from(document.querySelectorAll('.card')).at(-1)), true);
  checks.push('native card buttons: Enter/Space selection, Tab action order, grid arrows and Home/End without mutation');

  await page.evaluate(() => {
    window.uiNativeRequests = [];
    postBridge = (action, params) => { window.uiNativeRequests.push({ action, params }); return true; };
  });
  const copyButton = card.locator('[data-action="copy-url"]');
  await copyButton.focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.deepEqual(await page.evaluate(() => window.uiNativeRequests.map(({ action, params }) => [action, params.id])), [['copyNoteURL', 'ui-2']], 'held Enter must dispatch once with the stable card ID');
  const biLink = card.locator('[data-action="bi-link"]');
  await biLink.focus();
  await biLink.press('Enter');
  assert.equal(await biLink.evaluate((button) => button.classList.contains('confirm-pending')), true);
  await biLink.press('Escape');
  assert.equal(await biLink.evaluate((button) => button.classList.contains('confirm-pending')), false);
  await biLink.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal(await biLink.evaluate((button) => button.classList.contains('confirm-pending')), false, 'blur must disarm confirmation');
  await page.evaluate(() => { window.uiNativeRequests = []; });
  await biLink.dblclick();
  assert.deepEqual(await page.evaluate(() => window.uiNativeRequests.map(({ action, params }) => [action, params.id])), [['bidirectionalLinkFromeFocusNoteToTargetNote', 'ui-2']]);
  assert.equal(await biLink.evaluate((button) => button.classList.contains('confirm-pending')), false, 'dblclick must not arm a third action');
  checks.push('keyboard action dispatch keeps stable IDs; repeat/blur/Escape guards; double click confirms exactly once');

  await page.evaluate(() => { window.uiNativeRequests = []; });
  await card.locator('[data-action="focus-mindmap"]').click({ delay: 620 });
  await card.locator('[data-action="pin-card"]').click({ delay: 620 });
  assert.deepEqual(await page.evaluate(() => window.uiNativeRequests.map(({ action, params }) => [action, params.id])), [['focusCardInFloatMindMap', 'ui-2'], ['pinCard', 'ui-2']], 'native button conversion must preserve long press and suppress its follow-up click');
  checks.push('locate and Pin long presses preserve existing Native requests and suppress follow-up clicks');

  await page.evaluate(() => {
    state.activePresets.add('基本性质');
    state.activeNegativePresets.add('例子');
    state.manualExclusionInput = '习题';
    updateFilterToggleLabel();
  });
  assert.equal(await page.locator('#toggleFiltersBtn').getAttribute('data-active-count'), '3');
  await page.evaluate(() => {
    state.activePresets.clear();
    state.activeNegativePresets.clear();
    state.manualExclusionInput = '';
    updateFilterToggleLabel();
  });
  assert.equal(await page.locator('#toggleFiltersBtn').getAttribute('data-active-count'), '');
  checks.push('filter badge counts presets/exclusions and clears without stale numbers');

  for (const width of [320, 375, 414, 768, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForFunction((expected) => window.innerWidth === expected, width);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      const input = document.querySelector('#searchInput').getBoundingClientRect();
      const card = document.querySelector('.card.selected');
      const title = card.querySelector('.card-title').getBoundingClientRect();
      const actions = card.querySelector('.card-actions').getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll('.topbar button')).filter((button) => button.getClientRects().length);
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        inputWidth: input.width,
        countVisible: document.querySelector('#searchCount').getClientRects().length > 0,
        actionsBelow: actions.y >= title.bottom,
        actionsFit: Array.from(card.querySelectorAll('.card-action-icon')).every((icon) => icon.getBoundingClientRect().right <= actions.right + 1),
        toolbarFits: buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth;
        }),
      };
    });
    assert.equal(layout.overflow, false, `${width}px root overflow`);
    assert.ok(layout.inputWidth >= 140, `${width}px search field is too narrow`);
    assert.ok(layout.countVisible && layout.toolbarFits && layout.actionsBelow && layout.actionsFit, `${width}px layout: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: path.join(output, `search-${width}.png`) });
  }
  checks.push('320/375/414/768/1280px: visible result count, usable input, no horizontal overflow');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => document.querySelector('#sidebar').getAttribute('aria-hidden') === 'true');
  await selectButton.press('Enter');
  await page.waitForFunction(() => document.querySelector('#sidebar').classList.contains('show'));
  assert.equal(await page.locator(':focus').getAttribute('id'), 'sidebarCloseBtn');
  assert.equal(await page.locator('#sidebarCloseBtn').evaluate((button) => getComputedStyle(button).visibility), 'visible', 'reduced motion must not delay inherited visibility');
  assert.equal(await page.locator('#sidebarPanelBtn').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sidebar').getAttribute('aria-hidden'), 'true');
  assert.equal(await selectButton.evaluate((button) => button === document.activeElement), true);
  assert.equal(await page.evaluate(() => state.selectedCardId), 'ui-2');
  await page.locator('#sidebarPanelBtn').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('#sidebar').getBoundingClientRect().left) < 1);
  await page.evaluate(() => { document.querySelector('#sidebar').scrollTop = 1000; });
  const closeRect = await page.locator('#sidebarCloseBtn').boundingBox();
  const sidebarRect = await page.locator('#sidebar').boundingBox();
  assert.ok(sidebarRect.x >= -1 && sidebarRect.x + sidebarRect.width <= 375, 'opened drawer must be on screen horizontally');
  assert.ok(closeRect.y >= sidebarRect.y && closeRect.y + closeRect.height <= sidebarRect.y + sidebarRect.height, 'close control must remain visible while the drawer scrolls');
  await page.screenshot({ path: path.join(output, 'search-sidebar-compact.png') });
  await page.locator('#sidebarCloseBtn').click();
  assert.equal(await page.locator(':focus').getAttribute('id'), 'sidebarPanelBtn');
  await page.locator('#sidebarPanelBtn').click();
  await page.locator('#searchInput').focus();
  assert.equal(await page.locator('#sidebar').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'searchInput', 'returning to search must not have its focus stolen');
  await page.locator('#sidebarPanelBtn').click();
  await page.setViewportSize({ width: 1280, height: 812 });
  await page.waitForFunction(() => !document.querySelector('#sidebar').classList.contains('show'));
  assert.equal(await page.locator(':focus').getAttribute('id'), 'sidebarPanelBtn', 'viewport expansion must not strand focus on a hidden close control');
  assert.equal(await page.locator('#sidebar').getAttribute('aria-hidden'), 'false');
  checks.push('drawer close/Escape restores the opener; sticky close remains reachable; search and viewport changes retain usable focus');

  await page.evaluate(() => {
    state.searchHistory = { normal: [], ai: [] };
    saveSearchHistory('normal', '连续映射', 1);
    saveSearchHistory('normal', '紧致性', 2);
    saveSearchHistory('ai', '有限覆盖', 3);
    applyFilterPanelState(false, { skipSave: true });
  });
  const input = page.locator('#searchInput');
  await input.focus();
  assert.equal(await input.getAttribute('aria-expanded'), 'true');
  await input.press('ArrowDown');
  assert.equal(await page.locator(':focus .search-history-item__query').textContent(), '紧致性');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus .search-history-item__query').textContent(), '连续映射');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator(':focus .search-history-item__query').textContent(), '有限覆盖');
  await page.keyboard.press('Escape');
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  assert.equal(await input.evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => isFilterPanelCollapsed), false, 'history Escape must not close filters');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => isFilterPanelCollapsed), true);
  checks.push('history arrows wrap; first Escape closes history and restores focus; second closes filters');

  await input.focus();
  await page.evaluate(() => {
    document.querySelector('#searchInput').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', isComposing: true, bubbles: true,
    }));
  });
  assert.equal(await input.evaluate((element) => element === document.activeElement), true, 'IME must retain input focus');
  await input.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await input.inputValue(), '紧致性');
  await page.waitForFunction(() => state.userInput === '紧致性' && state.filteredCards.length > 0 && state.filteredCards.length < 6);
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  checks.push('IME navigation ignored; Enter restores a normal history query and searches');

  await input.fill('');
  await input.press('ArrowDown');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('class'), 'search-history-item__delete');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('class'), 'search-history-item__delete', 'deletion must retain a usable focus target');
  await page.keyboard.press('Escape');
  await input.press('ArrowDown');
  await page.locator('#aiCardSearchBtn').focus();
  assert.equal(await input.getAttribute('aria-expanded'), 'false', 'leaving popup by keyboard must dismiss it');
  checks.push('history deletion remains keyboard accessible; focus leaving popup dismisses it');

  await page.setViewportSize({ width: 375, height: 420 });
  await input.focus();
  await page.screenshot({ path: path.join(output, 'search-history-compact.png') });
  const popup = await page.locator('#searchHistoryDropdown').boundingBox();
  assert.ok(popup && popup.y + popup.height <= 420, 'history must fit a short viewport');

  while (await page.locator('.search-history-item__delete').count()) {
    await page.locator('.search-history-item__delete').first().focus();
    await page.keyboard.press('Enter');
  }
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  assert.equal(await input.evaluate((element) => element === document.activeElement), true, 'deleting the last entry restores input focus');
  await page.evaluate(() => loadSearchHistory());
  assert.equal(await page.evaluate(() => state.searchHistory.normal.length + state.searchHistory.ai.length), 0, 'deletion must survive history reload');
  checks.push('short viewport popup fits; deleting the final history entry restores focus and persists');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    state.hasRealData = true;
    state.userInput = '紧致';
    dom.searchInput.value = '紧致';
    state.currentTypeKey = 'definitions';
    state.activePresets.add('紧致');
    state.activeNegativePresets.add('不匹配的排除词');
    state.manualExclusionInput = '"一段很长的排除词组，用来验证窄屏下的完整移除按钮"';
    dom.excludeInput.value = state.manualExclusionInput;
    applyFilterPanelState(true, { skipSave: true });
    refreshSearchFilterControls();
  });
  await page.waitForFunction(() => !state.isFilteringResults && !state.isRenderingResults && state.filteredCards.length === 1);
  assert.equal(await page.locator('#searchCount').textContent(), '1 条结果');
  assert.equal(await page.locator('#activeSearchFilters').isVisible(), true, 'collapsed filters must retain their summary');
  assert.equal(await page.locator('#activeSearchFilterList button').count(), 4);
  assert.equal(await page.locator('#toggleFiltersBtn').getAttribute('data-active-count'), '4');
  for (const width of [320, 1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${width}px filter summary must fit`);
    const clearRect = await page.locator('#activeSearchFilters [data-search-recovery="filters"]').boundingBox();
    assert.ok(clearRect.x >= 0 && clearRect.x + clearRect.width <= width, 'clear remains visible while chips scroll');
    if (width === 1280) await page.screenshot({ path: path.join(output, 'search-active-filters-1280.png') });
  }
  const typeChip = page.locator('[data-filter-kind="type"]');
  await typeChip.focus();
  await typeChip.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('data-filter-kind'), 'preset', 'removing a focused chip must focus its neighbor');
  assert.deepEqual(await page.evaluate(() => [state.userInput, state.activePresets.size, state.activeNegativePresets.size]), ['紧致', 1, 1]);
  assert.equal(await page.locator('#toggleFiltersBtn').getAttribute('data-active-count'), '3');
  await page.locator('[data-filter-kind="manual"]').focus();
  assert.equal(await page.locator(':focus').getAttribute('data-filter-kind'), 'manual');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'long chip must not widen the page');
  await page.screenshot({ path: path.join(output, 'search-active-filters-375.png') });
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#excludeInput').inputValue(), '');
  await page.evaluate(() => {
    state.localSearchRootId = 'scope-test';
    state.localSearchDescendantIds = new Set(state.cards.map((card) => card.id));
  });
  await page.locator('#activeSearchFilters [data-search-recovery="filters"]').click();
  assert.equal(await page.locator('#activeSearchFilters').isVisible(), false);
  assert.equal(await page.locator(':focus').getAttribute('id'), 'toggleFiltersBtn');
  assert.deepEqual(await page.evaluate(() => [state.userInput, state.localSearchRootId, getActiveFilterCount()]), ['紧致', 'scope-test', 0], 'clearing filters preserves the query and local scope');
  await page.evaluate(() => { state.localSearchRootId = null; });
  checks.push('active filters remain visible when collapsed; single removal preserves other conditions and keyboard focus; clear keeps query/scope');

  await input.fill('不存在的主题');
  await page.waitForFunction(() => state.userInput === '不存在的主题' && !state.isFilteringResults && !state.isRenderingResults && state.filteredCards.length === 0);
  assert.equal(await page.locator('#searchEmptyTitle').textContent(), '没有匹配的卡片');
  assert.equal(await page.locator('#searchEmptyFiltersBtn').isVisible(), false);
  await page.locator('#searchEmptyEditBtn').click();
  assert.deepEqual(await input.evaluate((element) => [element === document.activeElement, element.selectionStart, element.selectionEnd]), [true, 0, '不存在的主题'.length]);
  await input.fill('紧致');
  await page.waitForFunction(() => state.userInput === '紧致' && state.filteredCards.length > 0 && !state.isFilteringResults);
  await page.evaluate(() => { selectTypeFilter('errors'); applyFilterPanelState(true, { skipSave: true }); });
  await page.waitForFunction(() => !state.isFilteringResults && !state.isRenderingResults && state.filteredCards.length === 0);
  await page.screenshot({ path: path.join(output, 'search-empty-375.png') });
  await page.locator('#searchEmptyFiltersBtn').click();
  await page.waitForFunction(() => state.filteredCards.length > 0 && !state.isFilteringResults);
  assert.equal(await input.inputValue(), '紧致');
  assert.equal(await page.locator('#searchEmptyState').isVisible(), false);
  checks.push('no-match feedback offers only useful recovery actions; editing selects the query and clearing filters restores results');

  await page.evaluate(() => {
    state.userInput = '';
    dom.searchInput.value = '';
    window.setCardsForDataset('knowledge', Array.from({ length: 420 }, (_, index) => ({ id: `many-${index}`, title: `紧致空间 ${index}`, type: '定义' })));
  });
  await page.waitForFunction(() => state.filteredCards.length === 420 && !state.isFilteringResults && !state.isRenderingResults);
  assert.equal(await page.locator('#searchCount').textContent(), '420 条结果');
  assert.ok(await page.evaluate(() => state.displayedCards.length < state.filteredCards.length));
  await page.evaluate(() => loadMore());
  await page.waitForFunction(() => !state.isLoadingMore && !state.isRenderingResults);
  assert.equal(await page.locator('#searchCount').textContent(), '420 条结果', 'pagination must not alter the total count');
  assert.equal(await page.locator('#searchCount').getAttribute('title'), await page.evaluate(() => `共 420 条结果，已加载 ${state.displayedCards.length} 条`));
  const pendingStatus = await page.evaluate(() => {
    window.uiOriginalProcessCard = processCardForFilter;
    // Force a multi-frame search and inspect feedback before the next animation frame.
    window.uiOriginalChunkPredicate = shouldUseChunkedFilterLoop;
    shouldUseChunkedFilterLoop = () => true;
    applyFilters(buildQueryPayload());
    return { busy: dom.results.getAttribute('aria-busy'), count: dom.searchCount.textContent, empty: document.getElementById('searchEmptyState').hidden };
  });
  assert.deepEqual(pendingStatus, { busy: 'true', count: '正在搜索…', empty: true });
  await page.waitForFunction(() => !state.isFilteringResults && !state.isRenderingResults);
  assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'false');
  await page.evaluate(() => {
    // A new query supersedes a queued filter; its completion owns the count.
    state.userInput = '旧查询';
    applyFilters(buildQueryPayload());
    state.userInput = '紧致';
    applyFilters(buildQueryPayload());
  });
  await page.waitForFunction(() => !state.isFilteringResults && !state.isRenderingResults && state.filteredCards.length === 420);
  assert.equal(await page.locator('#searchCount').textContent(), '420 条结果');
  await page.evaluate(() => {
    processCardForFilter = () => { throw new Error('controlled UI test failure'); };
    applyFilters(buildQueryPayload());
  });
  await page.waitForFunction(() => document.querySelector('#searchCount').textContent === '搜索未完成');
  assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#searchEmptyRetryBtn').isVisible(), true);
  await page.evaluate(() => {
    processCardForFilter = window.uiOriginalProcessCard;
    shouldUseChunkedFilterLoop = window.uiOriginalChunkPredicate;
  });
  await page.locator('#searchEmptyRetryBtn').click();
  await page.waitForFunction(() => document.querySelector('#searchCount').textContent === '420 条结果' && !state.isFilteringResults && !state.isRenderingResults);
  checks.push('420-result count stays stable across pagination; filtering busy state, superseded queries, failure release and retry recover correctly');

  await page.evaluate(() => {
    state.userInput = '';
    dom.searchInput.value = '';
    window.setCardsForDataset('knowledge', []);
  });
  await page.waitForFunction(() => !state.isFilteringResults && !state.isRenderingResults && state.filteredCards.length === 0);
  assert.equal(await page.locator('#searchEmptyTitle').textContent(), '当前知识库暂无卡片');
  assert.equal(await page.locator('#searchEmptyRefreshBtn').isVisible(), true);
  assert.equal(await page.locator('#searchEmptyEditBtn').isVisible(), false);
  await page.evaluate(() => {
    state.aiCardSearch.active = true;
    state.aiCardSearch.analysis = null;
    setAICardSearchLoading(true);
  });
  assert.equal(await page.locator('#searchEmptyState').isVisible(), false, 'AI has its own feedback panel');
  await page.evaluate(() => { deactivateAICardSearch(); });
  assert.equal(await page.locator('#searchEmptyState').isVisible(), true);
  assert.equal(await page.locator('#results').getAttribute('aria-busy'), 'false');
  checks.push('empty index and AI search use distinct feedback; cancelling AI releases the busy state');

  const touchPage = await browser.newPage({ viewport: { width: 320, height: 740 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
  touchPage.on('pageerror', (error) => errors.push(error.message));
  await touchPage.goto(`http://127.0.0.1:${server.address().port}/search.html`);
  const targets = await touchPage.locator('.quick-btn').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  assert.ok(targets.every((target) => target.width >= 44 && target.height >= 44), 'touch shortcuts need 44px targets');
  assert.ok((await touchPage.locator('#searchInput').boundingBox()).width >= 140, 'touch targets must not squeeze the search input');
  await touchPage.locator('#toggleFiltersBtn').tap();
  await touchPage.waitForFunction(() => !isFilterPanelCollapsed);
  await touchPage.waitForFunction(() => getComputedStyle(document.querySelector('#filtersPanel')).opacity === '1');
  const filterRect = await touchPage.locator('#filtersPanel').boundingBox();
  assert.ok(filterRect.x >= 0 && filterRect.x + filterRect.width <= 320 && filterRect.y + filterRect.height <= 740, 'touch filter panel must fit the viewport');
  await touchPage.screenshot({ path: path.join(output, 'search-touch-filters.png') });
  await touchPage.locator('#sidebarPanelBtn').tap();
  await touchPage.waitForFunction(() => Math.abs(document.querySelector('#sidebar').getBoundingClientRect().left) < 1);
  assert.equal(await touchPage.locator(':focus').getAttribute('id'), 'sidebarCloseBtn', 'normal motion must also focus the drawer close button');
  await touchPage.locator('#sidebarCloseBtn').tap();
  assert.equal(await touchPage.locator(':focus').getAttribute('id'), 'sidebarPanelBtn');
  assert.equal(await touchPage.locator('#sidebarPanelBtn').getAttribute('aria-expanded'), 'false');
  await touchPage.evaluate(() => {
    state.activePresets.add('一个很长的预设条件');
    state.activeNegativePresets.add('排除词');
    updateFilterToggleLabel();
  });
  await touchPage.locator('#toggleFiltersBtn').tap();
  await touchPage.waitForFunction(() => !isFilterPanelCollapsed && getComputedStyle(document.querySelector('#filtersPanel')).opacity === '1');
  const summaryFilterRect = await touchPage.locator('#filtersPanel').boundingBox();
  const topbarRect = await touchPage.locator('.topbar').boundingBox();
  assert.ok(summaryFilterRect.y >= topbarRect.y + topbarRect.height && summaryFilterRect.y + summaryFilterRect.height <= 740, 'touch filter overlay must account for the summary height');
  const chipRect = await touchPage.locator('.active-search-filter').first().boundingBox();
  assert.ok(chipRect.height >= 44, 'touch filter removal needs a 44px target');
  await touchPage.close();
  checks.push('320px touch: 44px shortcuts, usable search field, filter panel fits');
  assert.deepEqual(errors, [], 'page must not raise uncaught JavaScript errors');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(`search UI browser regression ok (${checks.length} groups); screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
