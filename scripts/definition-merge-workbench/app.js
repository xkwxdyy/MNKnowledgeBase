(function(global) {
  'use strict';

  var Core = global.DefinitionMergeCore;
  var state = {
    model: null,
    mappings: new Map(),
    knowledgeMappings: new Map(),
    selectedSourceId: '',
    selectedKnowledgeSourceId: '',
    pendingRequestId: '',
    completed: false,
    ignoreClickUntil: 0,
    expanded: new Set(),
    lastPlan: null,
    confirmAction: '',
  };

  var dom = {
    contextText: document.getElementById('contextText'),
    statusText: document.getElementById('statusText'),
    swapBtn: document.getElementById('swapBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    closeBtn: document.getElementById('closeBtn'),
    loadingView: document.getElementById('loadingView'),
    workbenchView: document.getElementById('workbenchView'),
    errorBanner: document.getElementById('errorBanner'),
    errorBannerText: document.getElementById('errorBannerText'),
    titleModeALabel: document.getElementById('titleModeALabel'),
    titleModeBLabel: document.getElementById('titleModeBLabel'),
    keepAliases: document.getElementById('keepAliases'),
    aliasHint: document.getElementById('aliasHint'),
    workspace: document.getElementById('workspace'),
    interactionBar: document.getElementById('interactionBar'),
    interactionText: document.getElementById('interactionText'),
    cancelSelectionBtn: document.getElementById('cancelSelectionBtn'),
    sourceCount: document.getElementById('sourceCount'),
    sourceTitle: document.getElementById('sourceTitle'),
    sourceTree: document.getElementById('sourceTree'),
    targetPlanStatus: document.getElementById('targetPlanStatus'),
    targetTitle: document.getElementById('targetTitle'),
    targetTree: document.getElementById('targetTree'),
    targetAnchor: document.getElementById('targetAnchor'),
    connectorSvg: document.getElementById('connectorSvg'),
    pairedCount: document.getElementById('pairedCount'),
    movedTreeCount: document.getElementById('movedTreeCount'),
    movedKnowledgeCount: document.getElementById('movedKnowledgeCount'),
    mergedKnowledgeCount: document.getElementById('mergedKnowledgeCount'),
    deletedCount: document.getElementById('deletedCount'),
    previewBtn: document.getElementById('previewBtn'),
    previewModal: document.getElementById('previewModal'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    modalBackBtn: document.getElementById('modalBackBtn'),
    executeBtn: document.getElementById('executeBtn'),
    finalTitlePreview: document.getElementById('finalTitlePreview'),
    previewStats: document.getElementById('previewStats'),
    previewActions: document.getElementById('previewActions'),
    previewRules: document.getElementById('previewRules'),
    toast: document.getElementById('toast'),
    completionView: document.getElementById('completionView'),
    completionSummary: document.getElementById('completionSummary'),
    completionCloseBtn: document.getElementById('completionCloseBtn'),
    dragGhost: document.getElementById('dragGhost'),
  };

  var toastTimer = null;
  var confirmTimer = null;
  var sourceEls = new Map();
  var targetEls = new Map();
  var hoverSourceId = '';
  var hoverTargetId = '';
  var drag = null; // {sourceId, el, active, isTouch, holdTimer, startX, startY, x, y, overId}
  var rafId = 0;

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function escapeHTML(value) {
    return text(value).replace(/[&<>'"]/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }

  function n(value) { return Number(value) || 0; }
  function pad2(value) { return value < 10 ? '0' + value : String(value); }

  var ICONS = {
    merge: '<circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path>',
    move: '<polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path>',
    spark: '<path d="M12 3l-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"></path>',
    x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    chevron: '<path d="m6 9 6 6 6-6"></path>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    info: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
    ok: '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
  };

  function icon(name, size, extraClass) {
    return '<svg class="' + (extraClass || '') + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] + '</svg>';
  }

  function noteId(node) {
    return text(node && (node.noteId || node.id));
  }

  function sourceNodes() {
    return Array.isArray(state.model && state.model.sourceNodes) ? state.model.sourceNodes : [];
  }

  function targetNodes() {
    return Array.isArray(state.model && state.model.targetNodes) ? state.model.targetNodes : [];
  }

  function sourceNode(sourceId) {
    return sourceNodes().find(function(node) { return noteId(node) === text(sourceId); }) || null;
  }

  function targetNode(targetId) {
    return targetNodes().find(function(node) { return noteId(node) === text(targetId); }) || null;
  }

  function mappedSources(targetId) {
    return sourceNodes().filter(function(node) { return state.mappings.get(noteId(node)) === text(targetId); });
  }

  /* ── Native bridge (contract preserved) ─────────────────────────────
     Outbound: mnknowledgebase-comment://<action>?<query>
     Inbound:  window.loadDefinitionMergeWorkbenchData(payload)
               window.Bridge.completeDefinitionMergeAction(payload)
               window.Bridge.requestCloseDefinitionMergeWorkbench()
               window.Bridge.canReplaceContext()
     window.__nativeShim, when defined (test harness), intercepts outbound
     calls; production behavior in MarginNote is unchanged. */
  function postToNative(action, params) {
    if (typeof global.__nativeShim === 'function') {
      try { global.__nativeShim(action, params || {}); } catch (error) { /* harness only */ }
      return true;
    }
    var query = Object.keys(params || {})
      .filter(function(key) { return params[key] !== undefined && params[key] !== null; })
      .map(function(key) { return encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])); })
      .join('&');
    global.location.href = 'mnknowledgebase-comment://' + action + (query ? '?' + query : '');
    return true;
  }

  function setStatus(message, tone) {
    dom.statusText.className = 'status' + (tone ? ' ' + tone : '');
    dom.statusText.innerHTML = (tone === 'busy' ? '<span class="mini-spin"></span>' : '') + escapeHTML(message || '');
  }

  function showToast(message, tone) {
    global.clearTimeout(toastTimer);
    var name = tone === 'ok' ? 'ok' : tone === 'error' ? 'alert' : 'info';
    dom.toast.className = 'toast' + (tone ? ' ' + tone : '');
    dom.toast.innerHTML = icon(name, 14) + '<span>' + escapeHTML(message) + '</span>';
    dom.toast.hidden = false;
    toastTimer = global.setTimeout(function() { dom.toast.hidden = true; }, 2400);
  }

  function currentTitleMode() {
    var checked = document.querySelector('input[name="titleMode"]:checked');
    return checked && checked.value === 'target' ? 'target' : 'source';
  }

  function getPlan() {
    return Core.buildPlan(state.model, {
      mappings: state.mappings,
      knowledgeMappings: state.knowledgeMappings,
      titleMode: currentTitleMode(),
      keepAliases: dom.keepAliases.checked,
    });
  }

  /* ── rendering ── */
  function knowledgeChildren(node) {
    var children = Array.isArray(node && node.knowledgeChildren)
      ? node.knowledgeChildren
      : (Array.isArray(node && node.children) ? node.children : []);
    return children.filter(function(child) { return text(child && child.noteId) && text(child.kind || child.type) !== '归类'; });
  }

  function knowledgeEntry(nodes, childId) {
    var found = null;
    nodes.some(function(parent) {
      var child = knowledgeChildren(parent).find(function(item) { return noteId(item) === text(childId); });
      if (!child) return false;
      found = { parent: parent, parentId: noteId(parent), child: child };
      return true;
    });
    return found;
  }

  function sourceKnowledgeEntry(childId) { return knowledgeEntry(sourceNodes(), childId); }
  function targetKnowledgeEntry(childId) { return knowledgeEntry(targetNodes(), childId); }

  function childRows(node, side) {
    var children = knowledgeChildren(node);
    if (!children.length) return '';
    var id = noteId(node);
    var open = state.expanded.has(id);
    var shown = open ? children : children.slice(0, 3);
    var rows = shown.map(function(child) {
      var childId = noteId(child);
      var selected = side === 'source' && state.selectedKnowledgeSourceId === childId;
      var targetId = side === 'source' ? state.knowledgeMappings.get(childId) : '';
      var target = targetId ? targetKnowledgeEntry(targetId) : null;
      var source = state.selectedKnowledgeSourceId ? sourceKnowledgeEntry(state.selectedKnowledgeSourceId) : null;
      var armed = side === 'target' && source && state.mappings.get(source.parentId) === id;
      var data = side === 'source'
        ? ' data-source-knowledge-id="' + escapeHTML(childId) + '"'
        : (armed ? ' data-target-knowledge-id="' + escapeHTML(childId) + '"' : '');
      var mapping = target
        ? '<span class="knowledge-state">合并 → ' + escapeHTML(target.child.title || '(无标题)') +
          '<button type="button" class="chip-x" data-unmap-knowledge-id="' + escapeHTML(childId) + '" aria-label="取消知识点配对" title="取消知识点配对">' + icon('x', 10) + '</button></span>'
        : '';
      return '<div class="child-row knowledge-row' + (selected ? ' is-selected' : '') + (armed ? ' is-armed' : '') + (target ? ' is-mapped' : '') + '"' + data +
        (data ? ' tabindex="0" role="button" aria-pressed="' + (selected ? 'true' : 'false') + '"' : '') + '><span class="child-kind">' +
        escapeHTML(child.kind || child.type || '卡片') + '</span><span class="child-title">' + escapeHTML(child.title || '(无标题)') + '</span>' + mapping + '</div>';
    }).join('');
    var more = children.length > 3
      ? '<button type="button" class="child-more" data-toggle-children="' + escapeHTML(id) + '">' +
        icon('chevron', 11, open ? 'up' : '') + (open ? '收起' : '展开全部 ' + children.length + ' 张子卡') + '</button>'
      : '';
    return '<div class="child-list">' + rows + more + '</div>';
  }

  function buildPairIndex() {
    var map = new Map();
    var i = 0;
    sourceNodes().forEach(function(node) {
      var sid = noteId(node);
      var target = state.mappings.get(sid);
      if (target && target !== 'move') map.set(sid, ++i);
    });
    return map;
  }

  function sourceNodeHTML(node, pairIndex) {
    var sid = noteId(node);
    var mapping = state.mappings.get(sid) || 'move';
    var target = mapping === 'move' ? null : targetNode(mapping);
    var selected = state.selectedSourceId === sid;
    var badge = target
      ? '<span class="state-badge merge"><span class="pair-chip">' + pad2(pairIndex.get(sid)) + '</span>' +
        '<span class="badge-text">合并 → ' + escapeHTML(target.shortTitle || target.title) + '</span>' +
        '<button type="button" class="chip-x" data-unmap-source-id="' + escapeHTML(sid) + '" aria-label="取消配对" title="取消配对">' + icon('x', 10) + '</button></span>'
      : '<span class="state-badge move">' + icon('move', 11) + '<span class="badge-text">整树迁移 → B</span></span>';
    return '<article class="tree-node source-node ' + (target ? 'is-mapped' : 'is-moving') + (selected ? ' is-selected' : '') +
      '" data-source-id="' + escapeHTML(sid) + '" tabindex="0" role="button" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<div class="node-main"><div class="node-top"><div class="node-title">' + escapeHTML(node.title || '(无标题)') + '</div>' + badge + '</div>' +
      '<div class="node-meta">' + escapeHTML(node.subtype || '归类') + ' · ' + n(node.knowledgeCount) + ' 知识点 · ' + n(node.nestedCount) + ' 子归类</div>' +
      (node.reason ? '<div class="suggestion">' + icon('spark', 12) + '<span>' + escapeHTML(node.reason) + '</span></div>' : '') +
      '</div>' + childRows(node, 'source') + '</article>';
  }

  function targetNodeHTML(node, pairIndex) {
    var tid = noteId(node);
    var incoming = mappedSources(tid);
    var armed = !!state.selectedSourceId;
    var depth = Math.max(0, n(node.depth));
    var incomingHTML = incoming.length
      ? '<div class="incoming-list">' + incoming.map(function(source) {
          return '<div class="incoming-row"><span class="pair-chip">' + pad2(pairIndex.get(noteId(source))) + '</span>' +
            '<span class="incoming-name">接收「' + escapeHTML(source.shortTitle || source.title) + '」</span>' +
            '<button type="button" class="chip-x" data-unmap-source-id="' + escapeHTML(noteId(source)) + '" aria-label="取消配对" title="取消配对">' + icon('x', 10) + '</button></div>';
        }).join('') + '</div>'
      : '';
    var action = armed
      ? '<div class="target-actions"><button type="button" data-map-target-id="' + escapeHTML(tid) + '">' + icon('merge', 13) + '合并到此处</button></div>'
      : '';
    return '<article class="tree-node target-node' + (armed ? ' is-armed' : '') + (incoming.length ? ' has-incoming' : '') +
      '" data-target-id="' + escapeHTML(tid) + '" tabindex="0" style="margin-left:' + Math.min(depth, 4) * 16 + 'px">' +
      '<div class="node-main"><div class="node-top"><div class="node-title">' + escapeHTML(node.title || '(无标题)') + '</div>' +
      '<span class="subtype-tag">' + escapeHTML(node.subtype || '归类') + '</span></div>' +
      '<div class="node-meta">' + n(node.knowledgeCount) + ' 知识点 · ' + n(node.nestedCount) + ' 子归类</div></div>' +
      childRows(node, 'target') + incomingHTML + action + '</article>';
  }

  function collectEls() {
    sourceEls = new Map();
    targetEls = new Map();
    dom.sourceTree.querySelectorAll('[data-source-id]').forEach(function(el) { sourceEls.set(el.dataset.sourceId, el); });
    dom.targetTree.querySelectorAll('[data-target-id]').forEach(function(el) { targetEls.set(el.dataset.targetId, el); });
  }

  function renderTrees() {
    var pairIndex = buildPairIndex();
    var sources = sourceNodes();
    var targets = targetNodes();
    dom.sourceTree.innerHTML = sources.length
      ? sources.map(function(node) { return sourceNodeHTML(node, pairIndex); }).join('')
      : '<div class="empty-tree">来源定义下没有归类卡，<br>将直接合并定义内容。</div>';
    dom.targetTree.innerHTML = targets.length
      ? targets.map(function(node) { return targetNodeHTML(node, pairIndex); }).join('')
      : '<div class="empty-tree">目标定义下没有归类卡；<br>来源归类将全部整树迁移。</div>';
    collectEls();
    scheduleConnectors();
  }

  function renderInteraction() {
    var selected = sourceNode(state.selectedSourceId);
    var selectedKnowledge = sourceKnowledgeEntry(state.selectedKnowledgeSourceId);
    dom.interactionBar.classList.toggle('is-armed', !!selected);
    if (selected) {
      dom.interactionText.innerHTML = '<strong>已选「' + escapeHTML(selected.shortTitle || selected.title) +
        '」</strong>　点击右侧任一目标归类完成配对';
      dom.cancelSelectionBtn.hidden = false;
      return;
    }
    if (selectedKnowledge) {
      dom.interactionBar.classList.add('is-armed');
      dom.interactionText.innerHTML = '<strong>已选知识点「' + escapeHTML(selectedKnowledge.child.title || '(无标题)') +
        '」</strong>　点击右侧「' + escapeHTML(selectedKnowledge.parent.shortTitle || selectedKnowledge.parent.title) + '」下的知识点执行合并';
      dom.cancelSelectionBtn.hidden = false;
      return;
    }
    dom.interactionText.innerHTML = '<strong>未配对来源将整树迁移</strong>　点按来源卡选择，或长按拖到目标归类改为合并';
    dom.cancelSelectionBtn.hidden = true;
  }

  function renderAliasHint() {
    if (!state.model) return;
    var mode = currentTitleMode();
    var other = mode === 'source'
      ? (state.model.targetDefinition || {}).title
      : (state.model.sourceDefinition || {}).title;
    dom.aliasHint.textContent = dom.keepAliases.checked
      ? '「' + (text(other) || '另一侧标题') + '」保留为检索别名'
      : '不保留另一侧标题词';
  }

  function renderSummary() {
    var plan = getPlan();
    dom.pairedCount.textContent = String(plan.pairedCount);
    dom.movedTreeCount.textContent = String(plan.movedTreeCount);
    dom.movedKnowledgeCount.textContent = String(plan.movedKnowledgeCount);
    dom.mergedKnowledgeCount.textContent = String(plan.mergedKnowledgeCount);
    dom.deletedCount.textContent = String(plan.deletedCount);
    dom.targetPlanStatus.textContent = plan.pairedCount + ' 组合并 · ' + plan.movedTreeCount + ' 棵迁移';
    renderAliasHint();
  }

  function updateControls() {
    var busy = !!state.pendingRequestId;
    dom.previewBtn.disabled = busy || state.completed || !state.model || state.model.canExecute === false;
    dom.executeBtn.disabled = busy || state.completed;
    dom.swapBtn.disabled = busy || state.completed || !state.model;
    dom.refreshBtn.disabled = busy || state.completed || !state.model;
    dom.modalBackBtn.disabled = busy;
    dom.closeModalBtn.disabled = busy;
    dom.executeBtn.innerHTML = busy
      ? '<span class="btn-spin"></span><span>执行中…</span>'
      : icon('check', 14) + '<span>确认合并</span>';
    document.querySelectorAll('input[name="titleMode"], #keepAliases').forEach(function(control) {
      control.disabled = busy || state.completed;
    });
    if (busy) setStatus('正在执行合并…', 'busy');
  }

  function renderAll() {
    renderTrees();
    renderInteraction();
    renderSummary();
    updateControls();
  }

  /* ── connectors ── */
  function scheduleConnectors() {
    if (rafId) return;
    rafId = global.requestAnimationFrame(function() {
      rafId = 0;
      drawConnectors();
    });
  }

  function focusSourceSet() {
    var set = new Set();
    if (state.selectedSourceId) { set.add(state.selectedSourceId); return set; }
    if (drag && drag.active) { set.add(drag.sourceId); return set; }
    if (hoverSourceId) { set.add(hoverSourceId); return set; }
    if (hoverTargetId) {
      mappedSources(hoverTargetId).forEach(function(node) { set.add(noteId(node)); });
    }
    return set;
  }

  function drawConnectors() {
    var svg = dom.connectorSvg;
    if (!svg) return;
    if (dom.workbenchView.hidden || !state.model) { svg.innerHTML = ''; return; }
    var ws = dom.workspace.getBoundingClientRect();
    if (ws.width < 560 || getComputedStyle(svg).display === 'none') { svg.innerHTML = ''; return; }
    svg.setAttribute('width', ws.width);
    svg.setAttribute('height', ws.height);
    svg.setAttribute('viewBox', '0 0 ' + ws.width + ' ' + ws.height);
    var sBox = dom.sourceTree.getBoundingClientRect();
    var tBox = dom.targetTree.getBoundingClientRect();
    var clamp = function(v, a, b) { return Math.max(a, Math.min(b, v)); };
    var focus = focusSourceSet();
    var out = '';
    var pairs = [];
    var moves = [];
    sourceNodes().forEach(function(node) {
      var sid = noteId(node);
      var el = sourceEls.get(sid);
      if (!el) return;
      var mapping = state.mappings.get(sid) || 'move';
      var rect = el.getBoundingClientRect();
      var y1 = clamp(rect.top + Math.min(rect.height / 2, 24), sBox.top + 3, sBox.bottom - 3) - ws.top;
      var x1 = rect.right - ws.left;
      if (mapping !== 'move') {
        var tEl = targetEls.get(mapping);
        if (!tEl) return;
        var tRect = tEl.getBoundingClientRect();
        var y2 = clamp(tRect.top + Math.min(tRect.height / 2, 24), tBox.top + 3, tBox.bottom - 3) - ws.top;
        pairs.push({ sid: sid, x1: x1, y1: y1, x2: tRect.left - ws.left, y2: y2 });
      } else if (!state.selectedSourceId && !(drag && drag.active)) {
        moves.push({ x1: x1, y1: y1 });
      }
    });
    if (moves.length && moves.length <= 12 && dom.targetAnchor) {
      var anchor = dom.targetAnchor.getBoundingClientRect();
      var ax = anchor.left + anchor.width / 2 - ws.left;
      var ay = anchor.top + anchor.height / 2 - ws.top;
      moves.forEach(function(m) {
        var mx = (m.x1 + ax) / 2;
        out += '<path class="cn cn-move" d="M ' + m.x1 + ' ' + m.y1 + ' C ' + mx + ' ' + m.y1 + ', ' + mx + ' ' + ay + ', ' + ax + ' ' + ay + '"></path>';
      });
    }
    pairs.forEach(function(p) {
      var mx = (p.x1 + p.x2) / 2;
      var dimmed = focus.size && !focus.has(p.sid);
      var cls = 'cn cn-pair' + (focus.has(p.sid) ? ' is-focus' : dimmed ? ' is-dim' : '');
      var dot = 'cn-dot' + (dimmed ? ' is-dim' : '');
      out += '<path class="' + cls + '" d="M ' + p.x1 + ' ' + p.y1 + ' C ' + mx + ' ' + p.y1 + ', ' + mx + ' ' + p.y2 + ', ' + p.x2 + ' ' + p.y2 + '"></path>' +
        '<rect class="' + dot + '" x="' + (p.x1 - 2.5) + '" y="' + (p.y1 - 2.5) + '" width="5" height="5"></rect>' +
        '<rect class="' + dot + '" x="' + (p.x2 - 2.5) + '" y="' + (p.y2 - 2.5) + '" width="5" height="5"></rect>';
    });
    if (drag && drag.active) {
      var el = sourceEls.get(drag.sourceId);
      if (el) {
        var rect = el.getBoundingClientRect();
        var x1 = rect.right - ws.left;
        var y1 = clamp(rect.top + rect.height / 2, sBox.top, sBox.bottom) - ws.top;
        var x2 = drag.x - ws.left;
        var y2 = drag.y - ws.top;
        var mx = (x1 + x2) / 2;
        out += '<path class="cn cn-live" d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 + '"></path>';
      }
    }
    svg.innerHTML = out;
  }

  /* ── interactions ── */
  function selectSource(sourceId) {
    if (state.pendingRequestId || state.completed) return;
    state.selectedSourceId = state.selectedSourceId === sourceId ? '' : sourceId;
    state.selectedKnowledgeSourceId = '';
    renderAll();
  }

  function mapSourceToTarget(sourceId, targetId) {
    if (!sourceNode(sourceId) || !targetNode(targetId) || state.pendingRequestId || state.completed) return;
    state.mappings.set(sourceId, targetId);
    clearKnowledgeMappingsForClassification(sourceId);
    state.selectedSourceId = '';
    renderAll();
    var target = targetNode(targetId);
    showToast('已配对：合并到「' + text(target.shortTitle || target.title) + '」', 'ok');
  }

  function unmapSource(sourceId) {
    if (!sourceNode(sourceId) || state.pendingRequestId || state.completed) return;
    state.mappings.set(sourceId, 'move');
    clearKnowledgeMappingsForClassification(sourceId);
    renderAll();
  }

  function clearKnowledgeMappingsForClassification(sourceId) {
    state.knowledgeMappings.forEach(function(_, knowledgeId) {
      var source = sourceKnowledgeEntry(knowledgeId);
      if (source && source.parentId === sourceId) state.knowledgeMappings.delete(knowledgeId);
    });
    if (state.selectedKnowledgeSourceId) {
      var selected = sourceKnowledgeEntry(state.selectedKnowledgeSourceId);
      if (selected && selected.parentId === sourceId) state.selectedKnowledgeSourceId = '';
    }
  }

  function selectKnowledgeSource(knowledgeId) {
    if (state.pendingRequestId || state.completed) return;
    var source = sourceKnowledgeEntry(knowledgeId);
    if (!source) return;
    if (state.mappings.get(source.parentId) === 'move') {
      showToast('请先把来源归类配对到目标归类', 'info');
      return;
    }
    state.selectedKnowledgeSourceId = state.selectedKnowledgeSourceId === knowledgeId ? '' : knowledgeId;
    state.selectedSourceId = '';
    renderAll();
  }

  function mapKnowledgeToTarget(sourceId, targetId) {
    if (state.pendingRequestId || state.completed) return;
    var source = sourceKnowledgeEntry(sourceId);
    var target = targetKnowledgeEntry(targetId);
    if (!source || !target || state.mappings.get(source.parentId) !== target.parentId) return;
    state.knowledgeMappings.set(sourceId, targetId);
    state.selectedKnowledgeSourceId = '';
    renderAll();
    showToast('已配对：将合并重复知识点', 'ok');
  }

  function unmapKnowledge(sourceId) {
    if (state.pendingRequestId || state.completed) return;
    state.knowledgeMappings.delete(sourceId);
    renderAll();
  }

  function toggleChildren(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    renderTrees();
  }

  dom.sourceTree.addEventListener('click', function(event) {
    var unmap = event.target.closest('[data-unmap-source-id]');
    if (unmap) { event.stopPropagation(); unmapSource(unmap.dataset.unmapSourceId); return; }
    var toggle = event.target.closest('[data-toggle-children]');
    if (toggle) { event.stopPropagation(); toggleChildren(toggle.dataset.toggleChildren); return; }
    var unmapKnowledgeBtn = event.target.closest('[data-unmap-knowledge-id]');
    if (unmapKnowledgeBtn) { event.stopPropagation(); unmapKnowledge(unmapKnowledgeBtn.dataset.unmapKnowledgeId); return; }
    var knowledge = event.target.closest('[data-source-knowledge-id]');
    if (knowledge) { event.stopPropagation(); selectKnowledgeSource(knowledge.dataset.sourceKnowledgeId); return; }
    if (Date.now() < state.ignoreClickUntil) return;
    var el = event.target.closest('[data-source-id]');
    if (el) selectSource(el.dataset.sourceId);
  });

  dom.targetTree.addEventListener('click', function(event) {
    var unmap = event.target.closest('[data-unmap-source-id]');
    if (unmap) { event.stopPropagation(); unmapSource(unmap.dataset.unmapSourceId); return; }
    var toggle = event.target.closest('[data-toggle-children]');
    if (toggle) { event.stopPropagation(); toggleChildren(toggle.dataset.toggleChildren); return; }
    var targetKnowledge = event.target.closest('[data-target-knowledge-id]');
    if (targetKnowledge && state.selectedKnowledgeSourceId) {
      event.stopPropagation();
      mapKnowledgeToTarget(state.selectedKnowledgeSourceId, targetKnowledge.dataset.targetKnowledgeId);
      return;
    }
    var mapBtn = event.target.closest('[data-map-target-id]');
    if (mapBtn) {
      event.stopPropagation();
      if (state.selectedSourceId) mapSourceToTarget(state.selectedSourceId, mapBtn.dataset.mapTargetId);
      return;
    }
    var el = event.target.closest('[data-target-id]');
    if (el && state.selectedSourceId) mapSourceToTarget(state.selectedSourceId, el.dataset.targetId);
  });

  function treeKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button')) return;
    var sourceEl = event.target.closest('[data-source-id]');
    var sourceKnowledgeEl = event.target.closest('[data-source-knowledge-id]');
    if (sourceKnowledgeEl) { event.preventDefault(); selectKnowledgeSource(sourceKnowledgeEl.dataset.sourceKnowledgeId); return; }
    if (sourceEl) { event.preventDefault(); selectSource(sourceEl.dataset.sourceId); return; }
    var targetEl = event.target.closest('[data-target-id]');
    var targetKnowledgeEl = event.target.closest('[data-target-knowledge-id]');
    if (targetKnowledgeEl && state.selectedKnowledgeSourceId) {
      event.preventDefault();
      mapKnowledgeToTarget(state.selectedKnowledgeSourceId, targetKnowledgeEl.dataset.targetKnowledgeId);
      return;
    }
    if (targetEl && state.selectedSourceId) {
      event.preventDefault();
      mapSourceToTarget(state.selectedSourceId, targetEl.dataset.targetId);
    }
  }
  dom.sourceTree.addEventListener('keydown', treeKeydown);
  dom.targetTree.addEventListener('keydown', treeKeydown);

  /* hover emphasis on connectors (mouse only) */
  dom.sourceTree.addEventListener('pointerover', function(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    var el = event.target.closest('[data-source-id]');
    var id = el ? el.dataset.sourceId : '';
    if (id !== hoverSourceId) { hoverSourceId = id; scheduleConnectors(); }
  });
  dom.sourceTree.addEventListener('pointerleave', function() {
    if (hoverSourceId) { hoverSourceId = ''; scheduleConnectors(); }
  });
  dom.targetTree.addEventListener('pointerover', function(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    var el = event.target.closest('[data-target-id]');
    var id = el ? el.dataset.targetId : '';
    if (id !== hoverTargetId) { hoverTargetId = id; scheduleConnectors(); }
  });
  dom.targetTree.addEventListener('pointerleave', function() {
    if (hoverTargetId) { hoverTargetId = ''; scheduleConnectors(); }
  });

  /* pointer drag: mouse drags after 5px; touch/pen lifts after a 300ms hold
     (a quick swipe scrolls, a tap selects). HTML5 DnD is not used — it never
     fires on iPad touch. */
  function cleanupDrag() {
    if (!drag) return;
    global.clearTimeout(drag.holdTimer);
    if (drag.el) drag.el.classList.remove('is-dragging');
    if (drag.overEl) drag.overEl.classList.remove('is-drag-over');
    dom.workbenchView.classList.remove('is-live-drag');
    dom.dragGhost.hidden = true;
    drag = null;
    scheduleConnectors();
  }

  function activateDrag() {
    if (!drag || drag.active) return;
    drag.active = true;
    drag.el.classList.add('is-dragging');
    dom.workbenchView.classList.add('is-live-drag');
    var node = sourceNode(drag.sourceId);
    dom.dragGhost.innerHTML = '<span>' + escapeHTML(node ? (node.shortTitle || node.title) : '') + '</span>';
    dom.dragGhost.hidden = false;
    moveGhost();
    if (state.selectedSourceId && state.selectedSourceId !== drag.sourceId) {
      state.selectedSourceId = '';
      renderInteraction();
    }
    dom.interactionText.innerHTML = '<strong>拖拽中</strong>　松手到目标归类完成合并配对';
    dom.interactionBar.classList.add('is-armed');
  }

  function moveGhost() {
    dom.dragGhost.style.transform = 'translate(' + (drag.x + 14) + 'px, ' + (drag.y + 12) + 'px)';
  }

  function hitTarget() {
    dom.dragGhost.style.pointerEvents = 'none';
    var el = document.elementFromPoint(drag.x, drag.y);
    var targetEl = el && el.closest ? el.closest('[data-target-id]') : null;
    if (drag.overEl && drag.overEl !== targetEl) drag.overEl.classList.remove('is-drag-over');
    if (targetEl) targetEl.classList.add('is-drag-over');
    drag.overEl = targetEl;
    drag.overId = targetEl ? targetEl.dataset.targetId : '';
  }

  dom.sourceTree.addEventListener('pointerdown', function(event) {
    if (state.pendingRequestId || state.completed || (drag && drag.active)) return;
    if (event.target.closest('button')) return;
    var el = event.target.closest('[data-source-id]');
    if (!el) return;
    var isTouch = event.pointerType !== 'mouse';
    drag = {
      sourceId: el.dataset.sourceId, el: el, active: false, isTouch: isTouch,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      overEl: null, overId: '', holdTimer: 0,
    };
    if (isTouch) drag.holdTimer = global.setTimeout(activateDrag, 300);
  });

  global.addEventListener('pointermove', function(event) {
    if (!drag) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    var dx = drag.x - drag.startX;
    var dy = drag.y - drag.startY;
    var dist = Math.hypot(dx, dy);
    if (!drag.active) {
      if (drag.isTouch) {
        if (dist > 12) cleanupDrag(); /* finger moved before hold: it's a scroll */
      } else if (dist > 5) {
        activateDrag();
      }
      return;
    }
    moveGhost();
    hitTarget();
    scheduleConnectors();
  });

  global.addEventListener('pointerup', function() {
    if (!drag) return;
    var wasActive = drag.active;
    var sourceId = drag.sourceId;
    var overId = drag.overId;
    cleanupDrag();
    if (wasActive) {
      state.ignoreClickUntil = Date.now() + 350;
      if (overId) mapSourceToTarget(sourceId, overId);
      else renderAll();
    }
  });

  global.addEventListener('pointercancel', function() {
    if (!drag) return;
    var wasActive = drag.active;
    cleanupDrag();
    if (wasActive) { state.ignoreClickUntil = Date.now() + 350; renderAll(); }
  });

  /* stop page scroll only while an actual touch drag is live */
  document.addEventListener('touchmove', function(event) {
    if (drag && drag.active) event.preventDefault();
  }, { passive: false });

  /* ── preview & execute ── */
  function openPreview() {
    if (!state.model || state.pendingRequestId || state.completed) return;
    var plan = getPlan();
    var validation = Core.validatePlan(state.model, plan);
    if (!validation.valid) {
      showToast(validation.errors[0] || '方案无效，请刷新', 'error');
      return;
    }
    var sourceById = new Map(sourceNodes().map(function(node) { return [noteId(node), node]; }));
    var targetById = new Map(targetNodes().map(function(node) { return [noteId(node), node]; }));
    dom.finalTitlePreview.textContent = plan.finalTitle;
    dom.previewStats.innerHTML = [
      [plan.pairedCount, '归类合并'],
      [plan.movedTreeCount, '整树迁移'],
      [plan.mergedKnowledgeCount, '重复知识点合并'],
      [plan.movedKnowledgeCount, '知识点换父'],
      [plan.deletedCount, '合并后删除'],
    ].map(function(item) {
      return '<div class="preview-stat"><strong>' + item[0] + '</strong><span>' + item[1] + '</span></div>';
    }).join('');
    dom.previewActions.innerHTML = plan.mappings.map(function(mapping) {
      var source = sourceById.get(mapping.sourceId) || {};
      var target = targetById.get(mapping.targetId) || {};
      var moved = mapping.targetId === 'move';
      var nested = n(source.nestedCount) ? ' · ' + n(source.nestedCount) + ' 子归类' : '';
      return '<div class="preview-action">' +
        '<span class="preview-action-badge' + (moved ? ' move' : '') + '">' + (moved ? '迁移' : '合并') + '</span>' +
        '<span class="preview-route">' + escapeHTML(source.shortTitle || source.title) + ' <b>→</b> ' +
        escapeHTML(moved ? '目标定义 B' : (target.shortTitle || target.title)) + '</span>' +
        '<span class="preview-meta">' + n(source.knowledgeCount) + ' 知识点' + nested + '</span></div>';
    }).join('') || '<div class="preview-action"><span class="preview-route">无归类卡，直接合并定义内容</span></div>';
    dom.previewRules.innerHTML =
      '<div class="preview-rule"><strong>标题</strong><span>' +
      (plan.titleMode === 'source' ? '来源 A 为主标题' : '保留目标 B 标题') + ' · ' +
      (plan.keepAliases ? '另一侧词保留为别名' : '不保留另一侧词') + '</span></div>' +
      '<div class="preview-rule"><strong>迁移</strong><span>仅更新换父知识点前缀 · 重建结构链接 · 保留手写链接</span></div>';
    dom.previewModal.hidden = false;
    dom.closeModalBtn.focus();
  }

  function closePreview() {
    if (state.pendingRequestId) return;
    dom.previewModal.hidden = true;
    dom.previewBtn.focus();
  }

  function executePlan() {
    if (!state.model || state.pendingRequestId || state.completed) return;
    var plan = getPlan();
    var validation = Core.validatePlan(state.model, plan);
    if (!validation.valid) {
      showToast(validation.errors[0] || '方案无效，请刷新', 'error');
      return;
    }
    var requestId = Core.makeRequestId('definition-merge');
    state.pendingRequestId = requestId;
    state.lastPlan = plan;
    updateControls();
    postToNative('executeDefinitionMerge', {
      id: plan.targetDefinitionId,
      requestId: requestId,
      plan: JSON.stringify(plan),
    });
  }

  /* ── native entry points (names & semantics preserved) ── */
  function loadDefinitionMergeWorkbenchData(payload) {
    state.model = payload || null;
    state.mappings = Core.createDefaultMappings(state.model);
    state.knowledgeMappings = new Map();
    state.selectedSourceId = '';
    state.selectedKnowledgeSourceId = '';
    state.pendingRequestId = '';
    state.completed = false;
    state.lastPlan = null;
    state.expanded = new Set();
    cleanupDrag();
    dom.loadingView.hidden = true;
    dom.workbenchView.hidden = false;
    dom.completionView.hidden = true;
    dom.previewModal.hidden = true;
    var sourceDefinition = state.model && state.model.sourceDefinition ? state.model.sourceDefinition : {};
    var targetDefinition = state.model && state.model.targetDefinition ? state.model.targetDefinition : {};
    dom.sourceTitle.textContent = sourceDefinition.title || '(无标题)';
    dom.targetTitle.textContent = targetDefinition.title || '(无标题)';
    dom.titleModeALabel.textContent = sourceDefinition.title || '来源标题';
    dom.titleModeBLabel.textContent = targetDefinition.title || '目标标题';
    dom.sourceCount.textContent = sourceNodes().length + ' 棵来源归类树';
    dom.contextText.textContent = '来源 A → 目标 B · ' + (sourceDefinition.title || '(无标题)') + ' → ' + (targetDefinition.title || '(无标题)');
    var errors = Array.isArray(state.model && state.model.errors) ? state.model.errors : [];
    if (errors.length) {
      dom.errorBanner.hidden = false;
      dom.errorBannerText.textContent = errors.join('；');
    } else if (state.model && state.model.canExecute === false) {
      dom.errorBanner.hidden = false;
      dom.errorBannerText.textContent = '当前数据不可执行合并，请刷新后重试。';
    } else {
      dom.errorBanner.hidden = true;
    }
    setStatus(errors.length ? errors[0] : '已同步', errors.length ? 'error' : 'ok');
    renderAll();
    return true;
  }

  function completeDefinitionMergeAction(payload) {
    var result = payload || {};
    if (state.pendingRequestId && result.requestId && result.requestId !== state.pendingRequestId) return false;
    state.pendingRequestId = '';
    if (result.success === true) {
      state.completed = true;
      dom.previewModal.hidden = true;
      var plan = state.lastPlan;
      var pairedCount = result.pairedCount !== undefined
        ? n(result.pairedCount)
        : n(plan && plan.pairedCount);
      var movedTreeCount = result.movedTreeCount !== undefined
        ? n(result.movedTreeCount)
        : n(plan && plan.movedTreeCount);
      var movedKnowledgeCount = result.movedKnowledgeCount !== undefined
        ? n(result.movedKnowledgeCount)
        : n(plan && plan.movedKnowledgeCount);
      var mergedKnowledgeCount = result.mergedKnowledgeCount !== undefined
        ? n(result.mergedKnowledgeCount)
        : n(plan && plan.mergedKnowledgeCount);
      var deletedCount = result.deletedCount !== undefined
        ? n(result.deletedCount)
        : n(plan && plan.deletedCount);
      dom.completionSummary.textContent = pairedCount + ' 组归类合并 · ' +
        movedTreeCount + ' 棵整树迁移 · ' + movedKnowledgeCount +
        ' 个知识点换父 · ' + mergedKnowledgeCount + ' 个重复知识点已合并 · ' + deletedCount + ' 张来源卡已删除。';
      dom.completionView.hidden = false;
      dom.completionCloseBtn.focus();
      setStatus('合并完成', 'ok');
      showToast('定义卡及归类树已合并', 'ok');
    } else {
      var message = result.requiresUndo
        ? '合并中断，请在 MarginNote 撤销一次'
        : (result.message || result.error || '合并失败，请刷新后重试');
      setStatus(message, 'error');
      showToast(message, 'error');
    }
    updateControls();
    return true;
  }

  function requestCloseDefinitionMergeWorkbench() {
    if (state.pendingRequestId) {
      showToast('正在执行合并，暂时不能关闭', 'error');
      return true;
    }
    postToNative('closeDefinitionMergeWorkbench', {});
    return true;
  }

  function requestRefresh(swap) {
    if (!state.model || state.pendingRequestId || state.completed) return;
    var actionKey = swap ? 'swap' : 'refresh';
    var button = swap ? dom.swapBtn : dom.refreshBtn;
    var plan = getPlan();
    if (plan.pairedCount > 0 && state.confirmAction !== actionKey) {
      state.confirmAction = actionKey;
      button.classList.add('is-confirming');
      showToast('已有 ' + plan.pairedCount + ' 组配对，再点一次' + (swap ? '「交换」' : '「刷新」') + '将重置', 'info');
      global.clearTimeout(confirmTimer);
      confirmTimer = global.setTimeout(function() {
        state.confirmAction = '';
        dom.swapBtn.classList.remove('is-confirming');
        dom.refreshBtn.classList.remove('is-confirming');
      }, 2600);
      return;
    }
    state.confirmAction = '';
    dom.swapBtn.classList.remove('is-confirming');
    dom.refreshBtn.classList.remove('is-confirming');
    var sourceId = noteId(state.model.sourceDefinition);
    var targetId = noteId(state.model.targetDefinition);
    setStatus(swap ? '正在交换…' : '正在刷新…', 'busy');
    postToNative(swap ? 'swapDefinitionMergeWorkbench' : 'refreshDefinitionMergeWorkbench', {
      id: swap ? sourceId : targetId,
      sourceNoteId: swap ? targetId : sourceId,
      targetNoteId: swap ? sourceId : targetId,
    });
  }

  /* ── global wiring ── */
  dom.cancelSelectionBtn.addEventListener('click', function() { state.selectedSourceId = ''; renderAll(); });
  dom.previewBtn.addEventListener('click', openPreview);
  dom.closeModalBtn.addEventListener('click', closePreview);
  dom.modalBackBtn.addEventListener('click', closePreview);
  dom.executeBtn.addEventListener('click', executePlan);
  dom.refreshBtn.addEventListener('click', function() { requestRefresh(false); });
  dom.swapBtn.addEventListener('click', function() { requestRefresh(true); });
  dom.closeBtn.addEventListener('click', requestCloseDefinitionMergeWorkbench);
  dom.completionCloseBtn.addEventListener('click', requestCloseDefinitionMergeWorkbench);
  document.querySelectorAll('input[name="titleMode"], #keepAliases').forEach(function(control) {
    control.addEventListener('change', renderSummary);
  });
  dom.previewModal.addEventListener('click', function(event) {
    if (event.target === dom.previewModal) closePreview();
  });
  document.addEventListener('keydown', function(event) {
    if (event.key !== 'Escape') return;
    if (!dom.previewModal.hidden) closePreview();
    else if (state.selectedSourceId) { state.selectedSourceId = ''; renderAll(); }
  });

  dom.sourceTree.addEventListener('scroll', scheduleConnectors, { passive: true });
  dom.targetTree.addEventListener('scroll', scheduleConnectors, { passive: true });
  global.addEventListener('resize', scheduleConnectors);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(scheduleConnectors).observe(dom.workspace);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleConnectors);
  }

  global.loadDefinitionMergeWorkbenchData = loadDefinitionMergeWorkbenchData;
  global.Bridge = Object.assign(global.Bridge || {}, {
    canReplaceContext: function() { return !state.pendingRequestId; },
    completeDefinitionMergeAction: completeDefinitionMergeAction,
    requestCloseDefinitionMergeWorkbench: requestCloseDefinitionMergeWorkbench,
  });

  postToNative('ready', {});
})(window);
