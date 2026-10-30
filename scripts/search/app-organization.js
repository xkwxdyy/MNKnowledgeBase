/* Semantic organization UI. Requests are snapshots; browsing never mutates cards. */
(function() {
  'use strict';
  const Core = window.KnowledgeBaseOrganization;
  if (!Core) return;
  const payloads = new Map(), pending = new Map();
  let source = null, epoch = 0, busy = false, editor = null, lastTarget = null;
  const $ = id => document.getElementById(id);
  const panel = $('organizationPanel'), status = $('organizationStatus');
  function el(tag, text, className) {
    const node = document.createElement(tag); if (text != null) node.textContent = text;
    if (className) node.className = className; return node;
  }
  function button(text, handler, title) {
    const node = el('button', text, 'btn'); node.type = 'button';
    if (title) { node.title = title; node.setAttribute('aria-label', title); }
    node.addEventListener('click', () => Promise.resolve().then(handler).catch(fail)); return node;
  }
  function fail(error) { status.textContent = error.message || String(error); }
  function request(action, payload = {}) {
    const requestId = 'organization-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    payloads.set(requestId, { ...payload, requestId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); payloads.delete(requestId); reject(new Error('整理请求超时；执行结果未知时请先刷新核对，勿重复提交')); }, 90000);
      pending.set(requestId, { resolve, reject, timer, action });
      if (!postToAddon(action, { requestId })) { clearTimeout(timer); pending.delete(requestId); payloads.delete(requestId); reject(new Error('无法连接 MarginNote')); }
    });
  }
  function base() { return { sourceId: source.id, sourceRevision: source.revision }; }
  function modelChoice() { return { modelSource: state.aiCardSearch.selectedSource, model: state.aiCardSearch.selectedModel }; }
  async function readSource() {
    const current = ++epoch;
    const result = await request('organizationContext');
    if (current !== epoch) throw new Error('整理来源请求已失效');
    source = result.source;
    $('organizationSource').textContent = '待整理 B：' + (source.title || '无标题') + ' · ' + (source.type || '类型待确认');
    status.textContent = '先查找等价卡片；没有合适结果时查找上级归类。';
    updateSelection(); return source;
  }
  function cancel() {
    epoch++; editor = null; closeDialog();
    if (source) request('organizationCancel').catch(() => {});
  }
  function cancelSearch() {
    if (!busy && [...pending.values()].some(item => item.action === 'organizationSearch')) {
      epoch++;
      request('organizationCancel').catch(() => {});
      status.textContent = '检索条件已变化，整理检索已取消。';
    }
  }
  function updateSelection() {
    if (!panel) return;
    const selected = state.selectedCardId && getCardById(state.selectedCardId);
    const targetChanged = lastTarget !== state.selectedCardId;
    if (targetChanged) {
      lastTarget = state.selectedCardId;
      if (editor && !busy) cancel();
      if (typeof setPanelOptions === 'function') {
        setPanelOptions('merge', { ...DEFAULT_MERGE_OPTIONS });
        setPanelOptions('move', { ...DEFAULT_MOVE_OPTIONS });
        renderMergeOptions(); renderMoveOptions();
      }
    }
    const bothClass = source && source.type === '归类' && selected && selected.type === '归类';
    $('organizationMerge').textContent = bothClass ? '合并重复归类' : '合并重复知识点';
    $('organizationMerge').disabled = busy || !selected || (source && (source.id === selected.id || source.type !== selected.type));
    $('organizationMove').disabled = busy || !selected || selected.type !== '归类';
    $('organizationProof').hidden = !selected || !['命题', '例子', '反例', '思想方法'].includes(selected.type);
    $('organizationProof').disabled = busy;
  }
  function localCandidates(stage) {
    const query = [source.title, source.excerpt].filter(Boolean).join(' ').slice(0, 500);
    const tokens = query.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2}/g) || [];
    const candidates = state.cards.filter(card => card.id !== source.id && passesSearchSourceFilter(card)
      && (!state.localSearchRootId || state.localSearchDescendantIds.has(String(card.id)))
      && (stage === 'container' ? card.type === '归类' : card.type === source.type));
    const filtered = applyCurrentNegativeFilters(candidates, buildQueryPayload());
    const scored = filtered.map(card => ({ card, score: tokens.reduce((sum, token) => sum + (JSON.stringify([card.title, card.prefix, card.titleLinkWords]).toLowerCase().includes(token) ? 1 : 0), 0) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 40).map(item => item.card);
  }
  async function find(stage = 'equivalent', reuseSource = false) {
    if (busy) return;
    if (!source || !reuseSource) await readSource();
    const current = ++epoch;
    const searchRevision = typeof searchExecutionRevision === 'number' ? searchExecutionRevision : 0;
    const searchCards = state.cards, searchRoot = state.localSearchRootId;
    const isCurrent = () => current === epoch && searchCards === state.cards && searchRoot === state.localSearchRootId
      && searchRevision === (typeof searchExecutionRevision === 'number' ? searchExecutionRevision : 0);
    status.textContent = stage === 'container' ? '正在查找能够容纳 B 的上级归类…' : '正在核对候选的对象、条件和结论…';
    let candidates = localCandidates(stage);
    try {
      const engine = await loadMathTermSearchEngine();
      if (!isCurrent()) return;
      const query = [source.title, source.excerpt].filter(Boolean).join(' ').slice(0, 500);
      const analysis = window.MNKBMathTermSearch.queryRuntime(engine, query);
      const pool = applyCurrentNegativeFilters(state.cards.filter(card => card.id !== source.id
        && passesSearchSourceFilter(card) && (!state.localSearchRootId || state.localSearchDescendantIds.has(String(card.id)))
        && (stage === 'container' ? card.type === '归类' : card.type === source.type)), buildQueryPayload());
      const ranked = window.MNKBMathTermSearch.rankKnowledgeCards(pool, analysis, query, { maxCards: 40, allowedTypes: [stage === 'container' ? '归类' : source.type] });
      candidates = Array.from(new Map([...ranked.cards, ...candidates].map(card => [card.id, card])).values()).slice(0, 40);
    } catch (_) { /* Existing local index remains available when the term corpus cannot load. */ }
    if (!isCurrent()) return;
    let result;
    try {
      result = await request('organizationSearch', { ...base(), ...modelChoice(), stage, candidateIds: candidates.map(card => card.id) });
    } catch (error) {
      if (!isCurrent()) return;
      if (/来源|选卡|已变化|不存在/.test(error.message)) { source = null; throw error; }
      result = { local: true, error: error.message, ranked: candidates.map(card => ({ id: card.id, relation: 'uncertain', reason: '模型未完成，需人工核对' })) };
    }
    if (!isCurrent()) return;
    renderResultsList(result.ranked, candidates);
    if (stage === 'equivalent' && !result.local && !result.ranked.some(row => row.relation === 'equivalent')) {
      status.textContent = '当前候选中未找到可靠等价卡片，继续查找上级归类。';
      return find('container', true);
    }
    status.textContent = result.error || (result.ranked.length ? '选择候选 A 后，可预览合并或归入方案。' : '当前范围未找到合适候选；可调整检索范围后重试。');
  }
  function renderResultsList(rows, cards) {
    const list = $('organizationCandidates'); list.replaceChildren();
    const labels = { equivalent: '可能等价', container: '适合归入', related: '仅相关', uncertain: '尚不确定' };
    rows.forEach(row => {
      const card = cards.find(item => item.id === row.id); if (!card) return;
      const item = button('', () => {
        state.selectedCardId = card.id; setSelectedCardElement(getRenderedCardElementById(card.id));
        updateSelectionInfo(); updateActionButtonsState(); openSidebar();
      });
      item.classList.add('organization-candidate');
      item.append(el('span', labels[row.relation], 'organization-relation'), el('strong', card.title || '无标题'), el('small', row.reason));
      list.append(item);
    });
  }
  async function start(intent) {
    if (busy || !state.selectedCardId) return;
    const targetId = state.selectedCardId;
    if (!source) await readSource();
    if (targetId !== state.selectedCardId) return;
    const current = ++epoch;
    const result = await request('organizationModel', { ...base(), targetId });
    if (current !== epoch) return;
    const model = result.model;
    if (intent === 'merge' && model.sourceNodes[0].type === '归类' && model.targetNodes[0].type === '归类') intent = 'classification';
    editor = { model, intent, choices: {}, suggestions: {}, revision: 0 };
    if (intent !== 'classification') await preview(); else renderReview();
  }
  function dialog() {
    const d = $('organizationDialog');
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    return $('organizationDialogBody');
  }
  function closeDialog() {
    const d = $('organizationDialog'); if (!d) return;
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }
  function heading(body, title) {
    body.replaceChildren(el('h2', title));
    const model = editor.model;
    body.append(el('p', 'B：' + model.sourceNodes[0].title + ' → A：' + model.targetNodes[0].title));
  }
  function renderReview() {
    if (!editor) return;
    const body = dialog(); heading(body, '逐层审阅重复归类');
    body.append(el('p', '审阅期间不修改卡片。确认配对后展开下一级；保留独立的分支将连同子树整体迁入。'));
    const contentReview = el('details'); contentReview.open = true;
    contentReview.append(el('summary', '先核对归类内容'));
    for (const [label, entry] of [['来源 B', editor.model.sourceNodes[0]], ['保留 A', editor.model.targetNodes[0]]]) {
      contentReview.append(el('strong', label + '：' + entry.path), el('pre', [entry.excerpt, entry.content].filter(Boolean).join('\n') || '没有文字内容'));
    }
    contentReview.append(el('p', '摘录、媒体、相关思考及其他内容按原样保留。下方配对只处理归类，普通知识卡片保持独立。'));
    body.append(contentReview);
    const reviewed = Core.review(editor.model, editor.choices);
    reviewed.rows.forEach(row => {
      const box = el('section', null, 'organization-review-row');
      box.append(el('h3', row.source.path));
      const content = el('details'); content.append(el('summary', '核对该归类内容'), el('pre', [row.source.excerpt, row.source.content].filter(Boolean).join('\n') || '没有文字内容')); box.append(content);
      const select = el('select'); select.setAttribute('aria-label', '处理归类：' + row.source.title);
      const options = [['', '请选择处理方式'], ['move', '保持独立，整体迁入']].concat(row.candidates.map(n => [n.id, '合并到：' + n.path]));
      options.forEach(([value, text]) => { const option = el('option', text); option.value = value; select.append(option); });
      select.value = row.choice;
      select.addEventListener('change', () => {
        const descendants = Core.descendants(new Map(editor.model.sourceNodes.map(n => [n.id, n])), row.source.id, false);
        descendants.forEach(n => delete editor.choices[n.id]);
        if (select.value) editor.choices[row.source.id] = select.value; else delete editor.choices[row.source.id];
        editor.revision++; renderReview();
      });
      box.append(select, button('✦', async () => {
        const active = editor, version = editor.revision;
        const result = await request('organizationSearch', { ...base(), ...modelChoice(), targetId: editor.model.targetId,
          pairSourceId: row.source.id, choices: editor.choices, stage: 'equivalent' });
        if (editor !== active || editor.revision !== version) return;
        editor.suggestions[row.source.id] = result.ranked; renderReview();
      }, 'AI 核对重复归类'));
      (editor.suggestions[row.source.id] || []).forEach(suggestion => {
        const target = row.candidates.find(n => n.id === suggestion.id);
        if (target) box.append(el('p', (suggestion.relation === 'equivalent' ? '可能等价：' : '需核对：') + target.path + '；' + suggestion.reason));
      });
      body.append(box);
    });
    if (!reviewed.rows.length) body.append(el('p', '没有需要配对的下级归类，内容与普通子卡片将进入合并预览。'));
    const next = button('查看完整预览', preview); next.disabled = reviewed.pending.length > 0;
    body.append(next, button('取消', cancel));
  }
  async function preview() {
    const active = editor;
    const result = await request('organizationPreview', { ...base(), targetId: active.model.targetId,
      revision: active.model.revision, intent: active.intent, choices: active.choices });
    if (editor !== active) return;
    editor.previewToken = result.previewToken;
    editor.executionId = 'execute-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const body = dialog(); heading(body, '确认整理方案');
    const map = new Map([...editor.model.sourceNodes, ...editor.model.targetNodes].map(n => [n.id, n]));
    const title = id => map.get(id)?.path || id;
    const list = el('ul');
    result.plan.moves.forEach(move => list.append(el('li', '移动完整子树：' + title(move.sourceId) + ' → ' + title(move.targetId))));
    result.plan.fields.forEach(item => {
      const detail = el('details'); detail.append(el('summary', '合并内容：' + title(item.sourceId) + ' → ' + title(item.targetId)));
      detail.append(el('p', '摘录、证明、应用、所需知识及其他有效内容均保留；已有内容不被覆盖。'));
      item.fields.forEach(field => detail.append(el('p', field.name + ' → ' + (field.destination || field.name) + '：' + field.count + ' 条评论')));
      if (item.legacy) detail.append(el('p', '旧卡整理：保留 ' + item.legacy.keepFields.join('、') +
        (item.legacy.childFields.length ? '；完整转存为子卡片：' + item.legacy.childFields.join('、') : '')));
      const n = map.get(item.sourceId), target = map.get(item.targetId);
      detail.append(el('p', '来源内容'), el('pre', [n.excerpt, n.content].filter(Boolean).join('\n')));
      detail.append(el('p', '目标已有内容'), el('pre', [target.excerpt, target.content].filter(Boolean).join('\n')));
      detail.append(el('p', active.intent === 'proof' ? '摘录补入目标证明字段。图片、手写与原文定位保留原始数据。' : '保留目标主标题；来源的有效别名随内容收录。图片、手写与原文定位保留原始数据。'));
      body.append(detail);
    });
    body.append(list);
    if (result.plan.deletedIds.length) body.append(el('p', '内容和子树迁移完成后移除来源：' + result.plan.deletedIds.map(title).join('；'), 'organization-removal'));
    body.append(el('p', '本次操作使用同一撤销分组。执行失败时停止后续操作，并提示撤销；不自动重试。'));
    const execute = button('确认执行', async () => {
      busy = true; execute.disabled = true; back.disabled = true; updateSelection();
      try {
        const done = await request('organizationExecute', { ...base(), targetId: active.model.targetId,
          previewToken: active.previewToken, executionId: active.executionId });
        if (done.requiresUndo) throw new Error(done.error);
        closeDialog(); editor = null; source = null;
        $('organizationSource').textContent = '整理完成；下次操作将重新读取脑图选卡。';
        $('organizationCandidates').replaceChildren();
        status.textContent = done.indexWarning || '整理完成。';
        const locate = button('⌖', () => postToAddon('focusCardInMindMap', { noteId: done.targetId }), '定位处理后的卡片');
        status.append(' ', locate);
      } catch (error) { body.append(el('p', error.message, 'organization-removal'), button('关闭预览', cancel)); status.textContent = error.message; }
      finally { busy = false; updateSelection(); }
    });
    const back = button(editor.intent === 'classification' ? '返回配对' : '取消', () => editor.intent === 'classification' ? renderReview() : cancel());
    body.append(execute, back);
  }
  window.MNKBOrganizationUI = {
    takePayload(id) { const payload = payloads.get(id); payloads.delete(id); return payload ? JSON.stringify(payload) : ''; },
    complete(result) { const waiter = pending.get(result.requestId); if (!waiter) return false;
      clearTimeout(waiter.timer); pending.delete(result.requestId);
      if (result.success === false) waiter.reject(new Error(result.error || '整理操作未完成')); else waiter.resolve(result); return true; },
    updateSelection, readSource, find, start, cancel, cancelSearch,
  };
  $('organizationReadSource').addEventListener('click', () => readSource().catch(fail));
  $('organizationFindEqual').addEventListener('click', () => find('equivalent').catch(fail));
  $('organizationFindParent').addEventListener('click', () => find('container', !!source).catch(fail));
  $('organizationMerge').addEventListener('click', () => start('merge').catch(fail));
  $('organizationMove').addEventListener('click', () => start('move').catch(fail));
  $('organizationProof').addEventListener('click', () => start('proof').catch(fail));
  $('organizationModels').addEventListener('click', () => { dom.aiCardSearchPanel.hidden = false; requestAICardSearchModelCatalog(); });
  $('organizationDialog').addEventListener('cancel', event => { event.preventDefault(); if (!busy) cancel(); });
  const custom = $('organizationCustom');
  document.querySelectorAll('[data-operation-group="merge"], [data-operation-group="move"], [data-operation-group="template"]').forEach(group => custom.append(group));
  custom.querySelectorAll('.sidebar-merge-card-desc').forEach(node => { node.textContent = '本次自定义；切换目标后恢复默认设置。'; });
  updateSelection();
})();
