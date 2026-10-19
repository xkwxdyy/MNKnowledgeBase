(function(global) {
  'use strict';
  const Core = global.ProofStructureCore;
  const state = { payload: null, parsed: null, selectedId: 'proof-root', mode: 'read', branchId: '', scale: 1, panX: 20, panY: 20, dragging: false, requestId: 0 };
  const dom = {};
  ['loadingView', 'workbenchView', 'fieldTitle', 'noteTitle', 'fieldName', 'fieldRange', 'structureCount', 'contentCount', 'viewport', 'stage', 'nodesLayer', 'connectors', 'outline', 'canvasMeta', 'toast', 'backBtn', 'closeBtn', 'zoomIn', 'zoomOut', 'fitMap', 'readMode', 'mapMode', 'readerPanel', 'readerBody', 'canvasPanel', 'readingContext', 'showAllBtn', 'outlineToggle', 'outlineClose', 'sidebarBackdrop', 'refreshBtn', 'viewCaption', 'mediaViewer', 'mediaImage', 'mediaTitle', 'mediaClose', 'mediaSize', 'mediaScroll', 'previousEntry', 'nextEntry', 'readingPosition', 'readingProgress', 'mapScale', 'mapLocate', 'mediaPrevious', 'mediaNext', 'mediaPosition'].forEach(id => { dom[id] = document.getElementById(id); });
  const labels = { goal: '目标', level1: '章节', level2: '小节', level3: '小节', level4: '小节', level5: '小节', step: '步骤', method: '方法', idea: '思路', key: '关键', question: '问题', alert: '注意', danger: '易错', case: '情形', check: '检验', sketch: '证明提纲', remark: '说明', textComment: '正文', markdownComment: '正文', mergedTextComment: '摘录', mergedMarkdownComment: '摘录', linkComment: '引用卡片', drawingComment: '手写', imageComment: '图片', imageCommentWithDrawing: '图片与手写', mergedImageComment: '图片摘录', mergedImageCommentWithDrawing: '图片摘录与手写', audioComment: '音频', HtmlComment: '字段', blankTextComment: '空白评论' };
  let currentLayout = null;
  let currentSizes = new Map();
  let toastTimer;
  let mediaOpener;
  let mathQueue = Promise.resolve();
  let readingInteraction = 0;
  let readingFrame = 0;
  let readingPin = null;
  let mapInitialized = false;
  let mapViewportSize = null;
  let mapGesture = null;
  let suppressMapClick = false;
  const mapPointers = new Map();
  let mediaGallery = [];
  let mediaIndex = -1;
  const compactLayout = global.matchMedia('(max-width: 760px)');
  const text = value => value == null ? '' : String(value);
  const escapeHTML = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortTitle = item => {
    const firstLine = text(item.body || item.title).split(/\n/).find(line => line.trim()) || item.title;
    const title = Core.stripHtml(firstLine).replace(/^#{1,6}\s+/, '').replace(/\*\*|__|`|\$/g, '');
    return title.length > 100 ? `${title.slice(0, 100)}…` : title;
  };
  const label = item => labels[item.htmlMDType || item.detailedType] || '评论';
  const flatNodes = () => state.parsed ? Core.flatten(state.parsed.tree) : [];
  const findItem = id => state.parsed && (state.parsed.items.find(item => item.id === id) || state.parsed.tree);

  function postToNative(action, params) {
    const query = Object.keys(params || {}).filter(key => params[key] != null).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(text(params[key]))}`).join('&');
    const url = `mnknowledgebase-comment://${action}${query ? `?${query}` : ''}`;
    if (/^https?:$/.test(global.location.protocol)) {
      global.__lastProofStructureNativeRequest = { action, params: params || {}, url };
      return true;
    }
    global.location.href = url;
    return true;
  }
  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(() => dom.toast.classList.remove('is-visible'), 2200);
  }
  function imageSource(value, mime) {
    const source = text(value).trim();
    if (!source) return '';
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z\d+/=\s]+$/i.test(source)) return source;
    if (/^[a-z\d+/=\s]+$/i.test(source) && /^image\/(?:png|jpe?g|gif|webp)$/i.test(mime || '')) return `data:${mime};base64,${source}`;
    return '';
  }
  function mediaSources(item) {
    const result = [];
    const image = imageSource(item.imageBase64, item.imageMimeType);
    const drawing = imageSource(item.drawingPreviewDataURI);
    if (image) result.push({ kind: 'image', src: image, label: '图片' });
    if (drawing && drawing !== image) result.push({ kind: 'drawing', src: drawing, label: '手写' });
    return result;
  }
  function safeURL(value) {
    const url = text(value).trim();
    return /^(?:https?:\/\/|marginnote[234]app:\/\/note\/)[^\s<>"']+$/i.test(url) ? url : '';
  }
  function sanitizeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set(['P', 'BR', 'SPAN', 'DIV', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'SUB', 'SUP', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG']);
    Array.from(template.content.querySelectorAll('*')).forEach(element => {
      if (!allowed.has(element.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'TEMPLATE'].includes(element.tagName)) element.remove();
        else element.replaceWith(...element.childNodes);
        return;
      }
      const href = element.getAttribute('href');
      const src = element.getAttribute('src');
      const alt = element.getAttribute('alt');
      Array.from(element.attributes).forEach(attribute => element.removeAttribute(attribute.name));
      if (element.tagName === 'A') {
        const url = safeURL(href);
        if (url) { element.setAttribute('href', url); element.setAttribute('rel', 'noopener noreferrer'); element.setAttribute('title', '定位原评论查看链接'); }
      }
      if (element.tagName === 'IMG') {
        const url = imageSource(src) || (/^https?:\/\//i.test(text(src)) ? safeURL(src) : '');
        if (url) { element.setAttribute('src', url); element.setAttribute('alt', alt || '正文图片'); element.setAttribute('loading', 'lazy'); }
        else element.replaceWith(document.createTextNode(alt || '图片不可用'));
      }
    });
    return template.innerHTML;
  }
  function renderBody(item) {
    const raw = text(item.body);
    if (!raw.trim()) return '';
    let html;
    if (item.markdown && global.marked) {
      const maths = [];
      let tokenPrefix = 'PROOFMATH';
      while (raw.includes(tokenPrefix)) tokenPrefix += 'X';
      // Protect TeX from Markdown's backslash/emphasis rules; leave code literal.
      const protectedText = raw.replace(/```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s|\$)(?:\\.|[^$\n])+?\$/g, match => {
        if (match[0] === '`') return match;
        const token = `${tokenPrefix}${maths.length}TOKEN`;
        maths.push(match);
        return token;
      });
      html = global.marked.parse(protectedText, { breaks: true });
      html = html.replace(new RegExp(`${tokenPrefix}(\\d+)TOKEN`, 'g'), (match, index) => Number(index) < maths.length ? escapeHTML(maths[Number(index)]) : match);
    } else if (item.detailedType === 'HtmlComment' || /^\s*<(?:p|div|span|b|strong)\b/i.test(raw)) {
      html = raw;
    } else {
      html = escapeHTML(raw).replace(/\n/g, '<br>');
    }
    return sanitizeHTML(html);
  }
  function typeset() {
    if (!global.MathJax || typeof global.MathJax.typesetPromise !== 'function') return;
    const generation = state.parsed;
    mathQueue = mathQueue.catch(() => {}).then(() => {
      if (generation !== state.parsed) return;
      return global.MathJax.typesetPromise([dom.readerBody]);
    }).catch(() => { showToast('部分公式未能排版，已保留原文'); });
  }
  global.MathJax = {
    tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true, packages: ['base', 'ams', 'newcommand', 'noundefined'] },
    svg: { fontCache: 'local' },
    options: { enableMenu: false },
    startup: { typeset: false, ready() { global.MathJax.startup.defaultReady(); typeset(); } },
  };
  function sizeOf(node) {
    return currentSizes.get(node.id) || { width: node.role === 'root' ? 260 : 246, height: 92 };
  }

  function layoutTopDown(root) {
    const positions = new Map();
    const subtreeWidths = new Map();
    const rowHeights = [];
    const gapX = 42;
    const gapY = 78;
    const margin = 54;

    function measureSubtree(node, depth) {
      const size = sizeOf(node);
      rowHeights[depth] = Math.max(rowHeights[depth] || 0, size.height);
      const childWidths = (node.children || []).map((child) => measureSubtree(child, depth + 1));
      const childrenWidth = childWidths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, childWidths.length - 1) * gapX;
      const subtreeWidth = Math.max(size.width, childrenWidth);
      subtreeWidths.set(node.id, subtreeWidth);
      return subtreeWidth;
    }

    measureSubtree(root, 0);
    const rowCenters = [margin + rowHeights[0] / 2];
    for (let depth = 1; depth < rowHeights.length; depth += 1) {
      rowCenters[depth] = rowCenters[depth - 1]
        + rowHeights[depth - 1] / 2 + gapY + rowHeights[depth] / 2;
    }

    function place(node, depth, left) {
      const subtreeWidth = subtreeWidths.get(node.id);
      positions.set(node.id, { x: left + subtreeWidth / 2, y: rowCenters[depth] });
      const children = node.children || [];
      const childBandWidth = children.reduce((sum, child) => sum + subtreeWidths.get(child.id), 0)
        + Math.max(0, children.length - 1) * gapX;
      let cursor = left + (subtreeWidth - childBandWidth) / 2;
      children.forEach((child) => {
        place(child, depth + 1, cursor);
        cursor += subtreeWidths.get(child.id) + gapX;
      });
    }

    place(root, 0, margin);
    const lastDepth = rowHeights.length - 1;
    return {
      positions,
      width: Math.max(760, subtreeWidths.get(root.id) + margin * 2),
      height: Math.max(640, rowCenters[lastDepth] + rowHeights[lastDepth] / 2 + margin),
    };
  }

  function renderMedia(item) {
    const sources = mediaSources(item);
    let html = sources.map(media => `<figure class="proof-media"><button type="button" class="media-open" data-media-item="${item.id}" data-media-kind="${media.kind}" aria-label="放大查看${media.label}，评论 #${item.sourceIndex}"><img src="${escapeHTML(media.src)}" alt="${media.label}，评论 #${item.sourceIndex}" loading="lazy" /></button><figcaption>${media.label} · 点击放大</figcaption></figure>`).join('');
    if (item.drawingPreviewPending) html += '<p class="media-status" role="status">手写正在转换，完成后自动显示…</p>';
    else if (item.drawingPreviewError) html += '<p class="media-status is-warning">手写暂时无法显示，可刷新重试或定位原评论查看。</p>';
    else if (!sources.length && item.role === 'media') html += `<p class="media-status">${item.detailedType === 'audioComment' ? '音频请定位到原评论播放。' : '媒体预览暂不可用，请定位原评论查看。'}</p>`;
    return html;
  }
  function sourceActions(item) {
    const studio = item.detailedType === 'markdownComment' || !!item.htmlMDType;
    return `<button type="button" data-source-action="locate" data-source-id="${item.id}" title="定位原评论 #${item.sourceIndex}" aria-label="定位原评论 #${item.sourceIndex}">↗ 原评论</button>${studio ? `<button type="button" data-source-action="studio" data-source-id="${item.id}" title="编辑评论 #${item.sourceIndex}" aria-label="编辑评论 #${item.sourceIndex}">编辑</button>` : ''}`;
  }
  function branchItems(id) {
    if (!id || id === 'proof-root') return state.parsed.items;
    const ids = new Set([id]);
    state.parsed.items.forEach(item => { if (ids.has(item.parentId)) ids.add(item.id); });
    return state.parsed.items.filter(item => ids.has(item.id));
  }
  function renderReader() {
    if (global.MathJax && global.MathJax.typesetClear) global.MathJax.typesetClear([dom.readerBody]);
    const items = branchItems(state.branchId);
    const fieldName = state.payload.field.name;
    dom.readingContext.textContent = state.branchId ? `${fieldName} / ${shortTitle(findItem(state.branchId))}` : `${fieldName} · 全文`;
    dom.showAllBtn.hidden = !state.branchId;
    dom.readerBody.innerHTML = `<div class="proof-intro"><span class="field-label">${escapeHTML(fieldName)}</span><h2>${escapeHTML(state.payload.noteTitle || '无标题卡片')}</h2><p>${state.parsed.structuralCount ? '沿目录逐步阅读；每段均可定位原评论。' : '此字段尚无层级标记，以下按原评论顺序完整展示。'}</p></div>` + (items.length ? items.map(item => {
      const structural = Core.structuralTypes.has(item.htmlMDType);
      const body = renderBody(item);
      const node = structural && flatNodes().find(entry => entry.node.id === item.id);
      return `<article class="proof-entry${structural ? ' is-structure' : ''}" id="read-${item.id}" data-read-id="${item.id}" data-kind="${escapeHTML(item.htmlMDType || item.role)}" tabindex="-1"><div class="entry-heading"><span class="entry-label">${escapeHTML(label(item))}</span><span class="source-index">#${item.sourceIndex}</span><div class="entry-tools">${sourceActions(item)}${node && (node.node.children.length || node.node.evidence.length) ? `<button type="button" class="branch-button" data-branch-id="${item.id}">只看此分支</button>` : ''}</div></div><div class="proof-content${structural ? ' structure-content' : ''}">${body || (item.role === 'blank' ? '<p class="empty-copy">空白评论</p>' : '')}</div>${renderMedia(item)}${item.linkedNoteId && item.detailedType === 'linkComment' ? `<p class="reference-copy">↗ ${escapeHTML(item.linkedNoteTitle || '引用卡片')}</p>` : ''}${item.diagnostics.length ? `<details class="parse-details"><summary>结构说明</summary><p>${escapeHTML(item.reason)}</p></details>` : ''}</article>`;
    }).join('') : '<div class="empty-state"><h3>这个字段还没有内容</h3><p>返回评论管理器，在字段下添加文字、步骤或手写后即可阅读。</p><button type="button" data-return>返回评论管理器</button></div>');
    typeset();
    updateReadingState(state.selectedId);
  }
  function renderOutline() {
    const collapsed = new Set(Array.from(dom.outline.querySelectorAll('details:not([open])')).map(el => el.dataset.nodeId));
    const itemRow = item => `<button class="outline-btn" type="button" data-item-id="${item.id}" aria-current="${item.id === state.selectedId}"><span class="comment-icon">${escapeHTML(item.icon)}</span><span class="outline-label">${escapeHTML(shortTitle(item))}</span><span class="outline-index">#${item.sourceIndex}</span></button>`;
    function treeRow(node) {
      const contents = (node.evidence || []).map(itemRow).join('') + (node.children || []).map(treeRow).join('');
      return `<details class="outline-branch" data-node-id="${node.id}" ${collapsed.has(node.id) ? '' : 'open'}><summary><span>${escapeHTML(label(node))}</span><span class="branch-count">${node.children.length + node.evidence.length}</span></summary>${itemRow(node)}<div class="outline-children">${contents}</div></details>`;
    }
    const root = state.parsed.tree;
    dom.outline.innerHTML = `<button class="outline-btn field-overview" type="button" data-item-id="proof-root" aria-current="${state.selectedId === 'proof-root'}">${escapeHTML(state.payload.field.name)} · 全部内容</button>${root.evidence.map(itemRow).join('')}${root.children.map(treeRow).join('')}`;
    updateReadingState(state.selectedId);
  }
  function currentPath(itemId) {
    const path = [];
    let item = findItem(itemId);
    while (item && item.role !== 'root') {
      path.unshift(item);
      item = item.parentId ? findItem(item.parentId) : null;
    }
    return path;
  }
  function currentMapNodeId() {
    const path = currentPath(state.selectedId);
    const node = path.reverse().find(item => Core.structuralTypes.has(item.htmlMDType));
    return node ? node.id : 'proof-root';
  }
  function updateReadingState(itemId) {
    if (!state.parsed) return;
    state.selectedId = itemId;
    const path = currentPath(itemId);
    const pathIds = new Set(path.map(item => item.id));
    dom.outline.querySelectorAll('[data-item-id]').forEach(element => {
      element.setAttribute('aria-current', String(element.dataset.itemId === itemId));
    });
    dom.outline.querySelectorAll('[data-node-id]').forEach(element => {
      element.classList.toggle('contains-current', pathIds.has(element.dataset.nodeId));
    });
    dom.readerBody.querySelectorAll('[data-read-id]').forEach(element => {
      element.classList.toggle('is-current', element.dataset.readId === itemId);
    });
    const context = [state.payload.field.name].concat(path.filter(item => Core.structuralTypes.has(item.htmlMDType)).map(shortTitle));
    if (context.length === 1) context.push(state.branchId ? shortTitle(findItem(state.branchId)) : '全文');
    dom.readingContext.textContent = `${context[0]} / ${context[context.length - 1]}`;
    dom.readingContext.title = context.join(' / ');
    const items = branchItems(state.branchId);
    const index = items.findIndex(item => item.id === itemId);
    dom.readingPosition.textContent = `${Math.max(0, index + 1)} / ${items.length}`;
    dom.readingPosition.setAttribute('aria-label', `当前第 ${Math.max(0, index + 1)} 段，共 ${items.length} 段`);
    dom.previousEntry.disabled = index <= 0;
    dom.nextEntry.disabled = !items.length || index >= items.length - 1;
    dom.readingProgress.style.width = `${items.length ? Math.max(0, index + 1) / items.length * 100 : 0}%`;
    const mapId = currentMapNodeId();
    dom.nodesLayer.querySelectorAll('[data-item-id]').forEach(element => element.setAttribute('aria-current', String(element.dataset.itemId === mapId)));
  }
  function syncReadingPosition() {
    readingFrame = 0;
    if (!state.parsed || state.mode !== 'read') return;
    // A requested paragraph remains current when the browser clamps scrolling
    // near the end of the document. Resume scroll tracking on user movement.
    if (readingPin && Math.abs(dom.readerPanel.scrollTop - readingPin.scrollTop) < 1) {
      updateReadingState(readingPin.id);
      return;
    }
    readingPin = null;
    const heading = dom.readerPanel.querySelector('.reading-heading');
    const line = heading.getBoundingClientRect().bottom + 18;
    const entries = Array.from(dom.readerBody.querySelectorAll('[data-read-id]'));
    let current = entries.find(element => element.getBoundingClientRect().bottom > line);
    if (dom.readerPanel.scrollTop <= 1 || (current === entries[0] && current.getBoundingClientRect().top > line + 20)) current = null;
    if (dom.readerPanel.scrollTop > 1 && dom.readerPanel.scrollTop + dom.readerPanel.clientHeight >= dom.readerPanel.scrollHeight - 2) current = entries[entries.length - 1];
    updateReadingState(current ? current.dataset.readId : 'proof-root');
  }
  function scheduleReadingPosition() {
    if (!readingFrame) readingFrame = global.requestAnimationFrame(syncReadingPosition);
  }
  function moveReading(direction) {
    if (!state.parsed) return;
    const items = branchItems(state.branchId);
    const index = items.findIndex(item => item.id === state.selectedId);
    const next = items[index + direction];
    if (next) selectItem(next.id);
  }
  function revealCurrentOutline(focus) {
    const row = Array.from(dom.outline.querySelectorAll('[data-item-id]')).find(element => element.dataset.itemId === state.selectedId);
    if (!row) return;
    let parent = row.parentElement;
    while (parent && parent !== dom.outline) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
    row.scrollIntoView({ block: 'nearest' });
    if (focus) row.focus({ preventScroll: true });
  }
  function renderNode(node, position) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'map-node';
    element.dataset.itemId = node.id;
    element.dataset.role = node.role;
    element.setAttribute('aria-current', String(node.id === currentMapNodeId()));
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    const media = node.evidence.flatMap(mediaSources)[0];
    element.innerHTML = `<span class="node-type">${node.role === 'root' ? '字段' : escapeHTML(label(node))}</span><strong class="node-title">${escapeHTML(shortTitle(node))}</strong>${media ? `<img class="node-media" src="${escapeHTML(media.src)}" alt="${media.label}预览" />` : ''}<span class="node-preview">${node.evidence.length} 条正文 · ${node.children.length} 个子章节或步骤</span><span class="node-open">打开正文 ↗</span>`;
    return element;
  }
  function renderMap() {
    dom.nodesLayer.innerHTML = '';
    const nodes = flatNodes();
    nodes.forEach(({ node }) => {
      const element = renderNode(node, { x: 0, y: 0 });
      element.style.visibility = 'hidden';
      dom.nodesLayer.appendChild(element);
    });
    currentSizes = new Map(Array.from(dom.nodesLayer.children).map(el => [el.dataset.itemId, { width: el.offsetWidth, height: el.offsetHeight }]));
    currentLayout = layoutTopDown(state.parsed.tree);
    const nextSize = { width: dom.viewport.clientWidth, height: dom.viewport.clientHeight };
    if (mapInitialized && mapViewportSize) {
      state.panX += (nextSize.width - mapViewportSize.width) / 2;
      state.panY += (nextSize.height - mapViewportSize.height) / 2;
    }
    mapViewportSize = nextSize;
    dom.stage.style.width = `${currentLayout.width}px`;
    dom.stage.style.height = `${currentLayout.height}px`;
    dom.nodesLayer.innerHTML = '';
    nodes.forEach(({ node }) => dom.nodesLayer.appendChild(renderNode(node, currentLayout.positions.get(node.id))));
    dom.connectors.setAttribute('viewBox', `0 0 ${currentLayout.width} ${currentLayout.height}`);
    dom.connectors.innerHTML = nodes.filter(entry => entry.parent).map(({ node, parent }) => {
      const from = currentLayout.positions.get(parent.id);
      const to = currentLayout.positions.get(node.id);
      const y1 = from.y + sizeOf(parent).height / 2;
      const y2 = to.y - sizeOf(node).height / 2;
      return `<path class="connector" d="M ${from.x} ${y1} C ${from.x} ${(y1 + y2) / 2}, ${to.x} ${(y1 + y2) / 2}, ${to.x} ${y2}"></path>`;
    }).join('');
    dom.canvasMeta.textContent = state.parsed.structuralCount ? '连线表示章节归属；点击节点阅读' : '尚无层级标记，点击字段阅读全部评论';
    applyTransform();
  }
  function applyTransform() {
    dom.stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
    dom.mapScale.textContent = `${Math.round(state.scale * 100)}%`;
    dom.zoomOut.disabled = state.scale <= 0.08001;
    dom.zoomIn.disabled = state.scale >= 1.99999;
  }
  function locateOnMap() {
    if (!currentLayout) return;
    const position = currentLayout.positions.get(currentMapNodeId());
    if (!position) return;
    state.scale = Math.max(0.8, state.scale);
    state.panX = dom.viewport.clientWidth / 2 - position.x * state.scale;
    state.panY = dom.viewport.clientHeight / 2 - position.y * state.scale;
    applyTransform();
  }
  function fitMap() {
    if (!currentLayout || state.mode !== 'map') return;
    const width = dom.viewport.clientWidth;
    const height = dom.viewport.clientHeight;
    state.scale = Math.max(0.08, Math.min(1, (width - 24) / currentLayout.width, (height - 24) / currentLayout.height));
    state.panX = (width - currentLayout.width * state.scale) / 2;
    state.panY = (height - currentLayout.height * state.scale) / 2;
    applyTransform();
  }
  function scaleAt(nextScale, clientX, clientY) {
    const clamped = Math.max(0.08, Math.min(2, nextScale));
    const rect = dom.viewport.getBoundingClientRect();
    const x = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
    const y = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;
    state.panX = x - (x - state.panX) / state.scale * clamped;
    state.panY = y - (y - state.panY) / state.scale * clamped;
    state.scale = clamped;
    applyTransform();
  }
  function setMode(mode) {
    state.mode = mode;
    dom.readerPanel.hidden = mode !== 'read';
    dom.canvasPanel.hidden = mode !== 'map';
    dom.readMode.setAttribute('aria-pressed', String(mode === 'read'));
    dom.mapMode.setAttribute('aria-pressed', String(mode === 'map'));
    dom.viewCaption.textContent = mode === 'read' ? '按原评论顺序阅读' : '先看结构，再读正文';
    resetMapGesture();
    if (mode === 'map' && state.parsed) {
      renderMap();
      if (!mapInitialized) { fitMap(); mapInitialized = true; }
    } else scheduleReadingPosition();
  }
  function setOutline(open, restoreFocus) {
    open = open && compactLayout.matches;
    dom.workbenchView.classList.toggle('outline-open', open);
    dom.outlineToggle.setAttribute('aria-expanded', String(open));
    dom.sidebarBackdrop.hidden = !open;
    [dom.readerPanel, dom.canvasPanel].forEach(panel => {
      if (open) panel.setAttribute('inert', '');
      else panel.removeAttribute('inert');
    });
    if (open) revealCurrentOutline(true);
    else if (restoreFocus) dom.outlineToggle.focus();
  }
  function selectItem(id, branchOnly) {
    const item = findItem(id);
    if (!item) return;
    readingInteraction += 1;
    state.selectedId = item.id;
    if (branchOnly || (state.branchId && !branchItems(state.branchId).some(entry => entry.id === id)) || id === 'proof-root') {
      state.branchId = branchOnly && id !== 'proof-root' ? id : '';
      renderReader();
    }
    setMode('read');
    updateReadingState(item.id);
    setOutline(false);
    const target = document.getElementById(`read-${id}`);
    if (target) { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); }
    else dom.readerPanel.scrollTop = 0;
    if (!compactLayout.matches) revealCurrentOutline(false);
    readingPin = { id: item.id, scrollTop: dom.readerPanel.scrollTop };
  }
  function captureReadingPosition() {
    const top = dom.readerPanel.getBoundingClientRect().top;
    const headingHeight = dom.readerPanel.querySelector('.reading-heading').offsetHeight;
    const entry = Array.from(dom.readerBody.querySelectorAll('[data-read-id]')).find(el => el.getBoundingClientRect().bottom > top + headingHeight + 1);
    return entry ? { id: entry.id, offset: entry.getBoundingClientRect().top - top, scroll: dom.readerPanel.scrollTop } : { scroll: dom.readerPanel.scrollTop };
  }
  function restoreReadingPosition(anchor) {
    const element = anchor.id && document.getElementById(anchor.id);
    dom.readerPanel.scrollTop = anchor.scroll;
    if (element) dom.readerPanel.scrollTop += element.getBoundingClientRect().top - dom.readerPanel.getBoundingClientRect().top - anchor.offset;
    if (readingPin) readingPin.scrollTop = dom.readerPanel.scrollTop;
  }
  function loadProofStructureWorkbenchData(payload) {
    if (!payload || !payload.noteId || !payload.field || !text(payload.field.name).trim() || !Array.isArray(payload.comments)) return false;
    const indices = payload.comments.map(item => item && item.index);
    if (indices.some(index => !Number.isInteger(index) || index < 0) || new Set(indices).size !== indices.length) return false;
    if (Array.isArray(payload.field.commentIndices) && indices.some(index => !payload.field.commentIndices.includes(index))) return false;
    if (Number(payload.requestId) > 0 && Number(payload.requestId) < state.requestId) return false;
    const sameField = state.payload && state.payload.noteId === payload.noteId && state.payload.field.name === payload.field.name;
    const presentationKeys = ['index', 'text', 'htmlText', 'detailedType', 'type', 'originalType', 'markdown', 'htmlMarkdownType', 'htmlMarkdownContent', 'imageBase64', 'imageMimeType', 'drawingPreviewDataURI', 'drawingPreviewPending', 'drawingPreviewError', 'linkedNoteId', 'linkedNoteTitle'];
    const samePresentation = sameField && state.payload.noteTitle === payload.noteTitle
      && state.payload.comments.length === payload.comments.length
      && payload.comments.every((comment, index) => presentationKeys.every(key => comment[key] === state.payload.comments[index][key]));
    state.requestId = Number(payload.requestId) || state.requestId;
    if (samePresentation) {
      // Conversion polling must not rebuild the document or re-typeset every second.
      state.payload = payload;
      return true;
    }
    const anchor = captureReadingPosition();
    const interaction = readingInteraction;
    state.payload = payload;
    state.parsed = Core.parsePayload(payload);
    if (!sameField) {
      state.selectedId = 'proof-root'; state.branchId = ''; state.mode = 'read'; readingPin = null;
      mapInitialized = false; mapViewportSize = null; currentLayout = null;
      dom.outline.innerHTML = '';
      closeMedia(); setOutline(false); resetMapGesture();
    }
    else {
      if (!state.parsed.items.some(item => item.id === state.selectedId)) { state.selectedId = 'proof-root'; readingPin = null; }
      if (state.branchId && !state.parsed.items.some(item => item.id === state.branchId)) state.branchId = '';
    }
    dom.fieldTitle.textContent = `${payload.field.name}阅读`;
    dom.noteTitle.textContent = payload.noteTitle || '无标题卡片';
    dom.fieldName.textContent = payload.field.name;
    dom.fieldRange.textContent = payload.comments.length ? `${payload.comments.length} 条评论 · #${payload.field.startIndex}–#${payload.field.endIndex}` : '字段为空';
    dom.structureCount.textContent = `${state.parsed.structuralCount} 个章节与步骤`;
    dom.contentCount.textContent = `${payload.comments.length} 条评论`;
    dom.loadingView.hidden = true;
    dom.workbenchView.hidden = false;
    dom.refreshBtn.disabled = false;
    renderReader();
    renderOutline();
    if (sameField && state.mode === 'map') renderMap();
    else setMode(state.mode);
    if (sameField) {
      restoreReadingPosition(anchor);
      const parsed = state.parsed;
      mathQueue.then(() => {
        if (parsed === state.parsed && interaction === readingInteraction) restoreReadingPosition(anchor);
      });
    }
    else dom.readerPanel.scrollTop = 0;
    scheduleReadingPosition();
    if (!dom.mediaViewer.hidden) refreshMediaGallery();
    if (payload.handwritingRetryExhausted) showToast('手写仍未就绪，可稍后刷新或查看原评论');
    return true;
  }
  function returnToCommentManager(commentIndex) {
    if (!state.payload) return false;
    return postToNative('returnToCommentManager', { id: state.payload.noteId, fieldName: state.payload.field.name, commentIndex: Number.isInteger(commentIndex) ? commentIndex : -1, revision: state.payload.revision || '' });
  }
  function requestCloseProofStructureWorkbench() { return postToNative('closeProofStructureWorkbench', {}); }
  function closeMedia() {
    dom.mediaViewer.hidden = true;
    dom.mediaImage.removeAttribute('src');
    document.querySelector('.app-shell').removeAttribute('inert');
    if (mediaOpener) {
      const currentButton = Array.from(dom.readerBody.querySelectorAll('[data-media-item]')).find(button =>
        button.dataset.mediaItem === mediaOpener.dataset.mediaItem && button.dataset.mediaKind === mediaOpener.dataset.mediaKind);
      if (currentButton) currentButton.focus({ preventScroll: true });
      else dom.readerPanel.focus({ preventScroll: true });
    }
    mediaOpener = null;
    mediaGallery = [];
    mediaIndex = -1;
  }
  function collectMediaGallery() {
    return branchItems(state.branchId).flatMap(item => mediaSources(item).map(media => Object.assign({ itemId: item.id, sourceIndex: item.sourceIndex }, media)));
  }
  function displayMedia(index) {
    const source = mediaGallery[index];
    if (!source) return;
    mediaIndex = index;
    dom.mediaTitle.textContent = `${source.label} · 评论 #${source.sourceIndex}`;
    dom.mediaImage.alt = dom.mediaTitle.textContent;
    dom.mediaImage.src = source.src;
    dom.mediaScroll.scrollTop = 0;
    dom.mediaScroll.scrollLeft = 0;
    dom.mediaPosition.textContent = `${index + 1} / ${mediaGallery.length}`;
    dom.mediaPrevious.disabled = index === 0;
    dom.mediaNext.disabled = index === mediaGallery.length - 1;
    dom.mediaPrevious.parentElement.hidden = mediaGallery.length <= 1;
  }
  function refreshMediaGallery() {
    const current = mediaGallery[mediaIndex];
    const gallery = collectMediaGallery();
    const index = current ? gallery.findIndex(media => media.itemId === current.itemId && media.kind === current.kind) : -1;
    if (index < 0) { closeMedia(); return; }
    mediaGallery = gallery;
    displayMedia(index);
  }
  function openMedia(button) {
    mediaGallery = collectMediaGallery();
    const index = mediaGallery.findIndex(media => media.itemId === button.dataset.mediaItem && media.kind === button.dataset.mediaKind);
    if (index < 0) return;
    mediaOpener = button;
    dom.mediaScroll.classList.remove('actual-size');
    dom.mediaSize.textContent = '原始大小';
    displayMedia(index);
    dom.mediaViewer.hidden = false;
    document.querySelector('.app-shell').setAttribute('inert', '');
    dom.mediaClose.focus();
  }
  function resetMapGesture() {
    const ids = Array.from(mapPointers.keys());
    mapPointers.clear();
    ids.forEach(id => { if (dom.viewport.hasPointerCapture(id)) dom.viewport.releasePointerCapture(id); });
    mapGesture = null;
    state.dragging = false;
    dom.viewport.classList.remove('is-dragging');
  }
  function beginMapGesture() {
    const points = Array.from(mapPointers.values());
    if (!points.length) { mapGesture = null; return; }
    const a = points[0];
    const b = points[1] || a;
    mapGesture = {
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      distance: points.length > 1 ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      scale: state.scale, panX: state.panX, panY: state.panY,
    };
  }
  function finishMapPointer(event) {
    if (!mapPointers.has(event.pointerId)) return;
    mapPointers.delete(event.pointerId);
    if (dom.viewport.hasPointerCapture(event.pointerId)) dom.viewport.releasePointerCapture(event.pointerId);
    beginMapGesture();
    if (!mapPointers.size) {
      state.dragging = false;
      dom.viewport.classList.remove('is-dragging');
    }
  }
  document.addEventListener('click', event => {
    const target = event.target;
    if (dom.viewport.contains(target) && suppressMapClick) {
      suppressMapClick = false;
      if (event.detail > 0) { event.preventDefault(); return; }
    }
    const media = target.closest('[data-media-item]');
    if (media) { openMedia(media); return; }
    const branch = target.closest('[data-branch-id]');
    if (branch) { selectItem(branch.dataset.branchId, true); return; }
    const item = target.closest('[data-item-id]');
    if (item) { selectItem(item.dataset.itemId); return; }
    if (target.closest('[data-return]')) { returnToCommentManager(-1); return; }
    const source = target.closest('[data-source-action]');
    if (source && state.payload) {
      const sourceItem = findItem(source.dataset.sourceId);
      if (sourceItem.role === 'root') return;
      if (source.dataset.sourceAction === 'locate') returnToCommentManager(sourceItem.sourceIndex);
      else postToNative('openProofStructureHtmlMDStudio', { id: state.payload.noteId, fieldName: state.payload.field.name, commentIndex: sourceItem.sourceIndex, revision: state.payload.revision || '' });
    }
    const link = target.closest('.proof-content a');
    if (link) {
      event.preventDefault();
      // Native already owns link navigation in the original comment. Keep the
      // reader and its field context alive instead of navigating this WebView.
      const article = link.closest('[data-read-id]');
      const sourceItem = article && findItem(article.dataset.readId);
      if (sourceItem) returnToCommentManager(sourceItem.sourceIndex);
    }
  });
  document.addEventListener('error', event => {
    if (event.target.tagName !== 'IMG') return;
    const image = event.target;
    const message = document.createElement('span');
    message.className = 'media-status is-warning';
    message.textContent = '图片未能加载，请定位原评论查看';
    if (image.id === 'mediaImage') { closeMedia(); showToast(message.textContent); }
    else image.replaceWith(message);
  }, true);
  document.addEventListener('keydown', event => {
    if (!dom.mediaViewer.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeMedia(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); displayMedia(mediaIndex - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); displayMedia(mediaIndex + 1); }
      if (event.key === 'Tab') {
        const buttons = Array.from(dom.mediaViewer.querySelectorAll('button:not([disabled])')).filter(button => button.getClientRects().length);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (compactLayout.matches && dom.workbenchView.classList.contains('outline-open')) {
      if (event.key === 'Escape') { event.preventDefault(); setOutline(false, true); return; }
      if (event.key === 'Tab') {
        const buttons = [dom.outlineToggle].concat(Array.from(document.getElementById('sidebar').querySelectorAll('button, summary')).filter(element => element.getClientRects().length));
        const index = buttons.indexOf(document.activeElement);
        const next = index < 0 ? 0 : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next].focus();
      }
    }
  });
  dom.readMode.addEventListener('click', () => setMode('read'));
  dom.readerPanel.addEventListener('scroll', scheduleReadingPosition, { passive: true });
  dom.readerBody.addEventListener('load', scheduleReadingPosition, true);
  dom.previousEntry.addEventListener('click', () => moveReading(-1));
  dom.nextEntry.addEventListener('click', () => moveReading(1));
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(name => dom.readerPanel.addEventListener(name, event => {
    readingInteraction += 1;
    // Keep an explicit selection until navigation handles the click; clearing
    // it on pointerdown can let a pending scroll frame skip the next paragraph.
    if (!event.target.closest('.reading-heading')) readingPin = null;
  }, { passive: true }));
  dom.mapMode.addEventListener('click', () => { if (state.parsed) setMode('map'); });
  dom.showAllBtn.addEventListener('click', () => { const id = state.selectedId; state.branchId = ''; renderReader(); selectItem(id); });
  dom.outlineToggle.addEventListener('click', () => setOutline(dom.outlineToggle.getAttribute('aria-expanded') !== 'true', true));
  dom.outlineClose.addEventListener('click', () => setOutline(false, true));
  dom.sidebarBackdrop.addEventListener('click', () => setOutline(false, true));
  dom.backBtn.addEventListener('click', () => returnToCommentManager(-1));
  dom.closeBtn.addEventListener('click', requestCloseProofStructureWorkbench);
  dom.refreshBtn.addEventListener('click', () => { postToNative('ready', {}); });
  dom.mediaClose.addEventListener('click', closeMedia);
  dom.mediaPrevious.addEventListener('click', () => displayMedia(mediaIndex - 1));
  dom.mediaNext.addEventListener('click', () => displayMedia(mediaIndex + 1));
  dom.mediaSize.addEventListener('click', () => { const actual = dom.mediaScroll.classList.toggle('actual-size'); dom.mediaSize.textContent = actual ? '适应窗口' : '原始大小'; });
  dom.zoomIn.addEventListener('click', () => scaleAt(state.scale * 1.2));
  dom.zoomOut.addEventListener('click', () => scaleAt(state.scale / 1.2));
  dom.fitMap.addEventListener('click', fitMap);
  dom.mapLocate.addEventListener('click', locateOnMap);
  dom.viewport.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey) scaleAt(state.scale * Math.exp(-event.deltaY * 0.012), event.clientX, event.clientY);
    else { state.panX -= event.shiftKey ? event.deltaY : event.deltaX; state.panY -= event.shiftKey ? 0 : event.deltaY; applyTransform(); }
  }, { passive: false });
  dom.viewport.addEventListener('pointerdown', event => {
    if (event.button > 0 || mapPointers.size >= 2) return;
    if (!mapPointers.size) suppressMapClick = false;
    mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mapPointers.size > 1) suppressMapClick = true;
    beginMapGesture();
  });
  dom.viewport.addEventListener('pointermove', event => {
    if (!mapPointers.has(event.pointerId) || !mapGesture) return;
    mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(mapPointers.values());
    const a = points[0], b = points[1] || a;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const dx = x - mapGesture.x, dy = y - mapGesture.y;
    if (points.length === 1 && !state.dragging && Math.hypot(dx, dy) < 5) return;
    state.dragging = true;
    suppressMapClick = true;
    dom.viewport.classList.add('is-dragging');
    dom.viewport.setPointerCapture(event.pointerId);
    const scale = mapGesture.distance > 0
      ? Math.max(0.08, Math.min(2, mapGesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / mapGesture.distance))
      : mapGesture.scale;
    const rect = dom.viewport.getBoundingClientRect();
    state.panX = x - rect.left - (mapGesture.x - rect.left - mapGesture.panX) / mapGesture.scale * scale;
    state.panY = y - rect.top - (mapGesture.y - rect.top - mapGesture.panY) / mapGesture.scale * scale;
    state.scale = scale;
    applyTransform();
  });
  dom.viewport.addEventListener('dragstart', event => event.preventDefault());
  ['pointerup', 'pointercancel'].forEach(name => global.addEventListener(name, finishMapPointer));
  dom.viewport.addEventListener('lostpointercapture', event => {
    if (event.target === dom.viewport) finishMapPointer(event);
  });
  global.addEventListener('resize', () => {
    if (!compactLayout.matches) setOutline(false);
    if (state.parsed && state.mode === 'map') { resetMapGesture(); renderMap(); }
    else scheduleReadingPosition();
  });
  global.loadProofStructureWorkbenchData = loadProofStructureWorkbenchData;
  global.Bridge = Object.assign(global.Bridge || {}, { requestCloseProofStructureWorkbench });
  global.__proofStructureWorkbench = { state, renderReader, fitMap, mediaSources, renderBody, sanitizeHTML, getLayout: () => currentLayout, whenTypeset: () => mathQueue };
  postToNative('ready', {});
})(window);
