(function(global) {
  'use strict';

  const Core = global.ResearchWorkbenchCore;
  const state = {
    model: null,
    nodes: [],
    selectedId: '',
    drafts: new Map(),
    pending: null,
    createType: 'idea',
  };

  const dom = {
    contextTitle: document.getElementById('contextTitle'),
    statusText: document.getElementById('statusText'),
    discardBtn: document.getElementById('discardBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    saveBtn: document.getElementById('saveBtn'),
    closeBtn: document.getElementById('closeBtn'),
    loadingView: document.getElementById('loadingView'),
    workbenchView: document.getElementById('workbenchView'),
    orphanNotice: document.getElementById('orphanNotice'),
    nodeCount: document.getElementById('nodeCount'),
    nodeList: document.getElementById('nodeList'),
    emptySelection: document.getElementById('emptySelection'),
    nodeEditor: document.getElementById('nodeEditor'),
    nodeRole: document.getElementById('nodeRole'),
    nodeTitle: document.getElementById('nodeTitle'),
    nodeMeta: document.getElementById('nodeMeta'),
    focusBtn: document.getElementById('focusBtn'),
    fieldsContainer: document.getElementById('fieldsContainer'),
    createTitle: document.getElementById('createTitle'),
    createBody: document.getElementById('createBody'),
    createBtn: document.getElementById('createBtn'),
  };

  let discardConfirmTimer = null;
  let discardConfirmArmed = false;

  function clearDiscardConfirm() {
    if (discardConfirmTimer) {
      global.clearTimeout(discardConfirmTimer);
      discardConfirmTimer = null;
    }
    discardConfirmArmed = false;
    if (dom.discardBtn) {
      dom.discardBtn.classList.remove('is-confirming');
      dom.discardBtn.textContent = '放弃修改';
    }
  }

  function postToNative(action, params) {
    const query = Object.keys(params || {})
      .filter((key) => params[key] !== undefined && params[key] !== null)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
      .join('&');
    global.location.href = `mnknowledgebase-comment://${action}${query ? `?${query}` : ''}`;
    return true;
  }

  function setStatus(text, tone) {
    dom.statusText.textContent = text || '';
    dom.statusText.className = `status${tone ? ` ${tone}` : ''}`;
  }

  function selectedNode() {
    return state.nodes.find((node) => String(node.noteId) === state.selectedId) || null;
  }

  function dirtyUpdates() {
    return state.model ? Core.collectUpdates(state.model, state.drafts) : [];
  }

  function isDirty() {
    return dirtyUpdates().length > 0;
  }

  function canReplaceContext() {
    return !state.pending && !isDirty();
  }

  function roleLabel(node) {
    if (!node) return '';
    if (node.role === 'question') return '问题';
    if (node.role === 'idea') return '思路';
    if (node.role === 'summary') return '总结';
    return node.type || '卡片';
  }

  function syncNavigationDirtyMarkers(updates) {
    const dirtyNoteIds = new Set((updates || []).map((item) => String(item.noteId)));
    state.nodes.forEach((node) => {
      const noteId = String(node.noteId);
      const button = dom.nodeList.querySelector(`[data-note-id="${noteId}"]`);
      if (!button) return;
      const dirty = dirtyNoteIds.has(noteId);
      button.classList.toggle('has-dirty', dirty);
      const meta = button.querySelector('span');
      if (meta) {
        meta.textContent = `${roleLabel(node)} · 深度 ${Number(node.depth) || 0}${dirty ? ' · 未保存' : ''}`;
      }
    });
  }

  function updateControls() {
    const updates = dirtyUpdates();
    const dirtyCount = updates.length;
    const busy = !!state.pending;
    if (dirtyCount === 0) {
      clearDiscardConfirm();
    }
    dom.saveBtn.disabled = busy || dirtyCount === 0;
    if (dom.discardBtn) {
      dom.discardBtn.hidden = dirtyCount === 0;
      dom.discardBtn.disabled = busy || dirtyCount === 0;
    }
    dom.refreshBtn.disabled = busy;
    dom.createBtn.disabled = busy || !selectedNode();
    dom.closeBtn.disabled = false;
    syncNavigationDirtyMarkers(updates);
    if (busy) setStatus('正在处理…', '');
    else if (discardConfirmArmed) setStatus('再点一次「放弃修改」还原全部未保存内容', 'dirty');
    else if (dirtyCount > 0) setStatus(`${dirtyCount} 处未保存`, 'dirty');
    else setStatus('已同步', 'ok');
  }

  function renderNavigation() {
    dom.nodeList.innerHTML = '';
    dom.nodeCount.textContent = `${state.nodes.length} 张`;
    const dirtyNoteIds = new Set(dirtyUpdates().map((item) => String(item.noteId)));
    state.nodes.forEach((node) => {
      const noteId = String(node.noteId);
      const dirty = dirtyNoteIds.has(noteId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `node-button${noteId === state.selectedId ? ' active' : ''}${dirty ? ' has-dirty' : ''}`;
      button.dataset.noteId = noteId;
      const title = document.createElement('strong');
      title.textContent = node.title || '(无标题)';
      const meta = document.createElement('span');
      meta.textContent = `${roleLabel(node)} · 深度 ${Number(node.depth) || 0}${dirty ? ' · 未保存' : ''}`;
      button.append(title, meta);
      dom.nodeList.appendChild(button);
    });
  }

  function renderFields(node) {
    dom.fieldsContainer.innerHTML = '';
    const fields = Array.isArray(node.fields) ? node.fields : [];
    fields.forEach((field) => {
      const card = document.createElement('section');
      card.className = 'field-card';
      const title = document.createElement('div');
      title.className = 'field-title';
      title.textContent = field.name || '未命名字段';
      const body = document.createElement('div');
      body.className = 'field-body';
      const comments = Array.isArray(field.comments) ? field.comments : [];
      if (!comments.length) {
        const empty = document.createElement('div');
        empty.className = 'field-empty';
        empty.textContent = '暂无内容';
        body.appendChild(empty);
      }
      comments.forEach((comment) => {
        const wrapper = document.createElement('div');
        const label = document.createElement('span');
        label.className = 'comment-label';
        label.textContent = `评论 ${Number(comment.index) + 1} · ${comment.type || comment.rawType || '未知类型'}${comment.markdown ? ' · Markdown' : ''}`;
        wrapper.appendChild(label);
        if (comment.editable === true) {
          const textarea = document.createElement('textarea');
          textarea.className = 'comment-editor';
          textarea.dataset.noteId = String(node.noteId);
          textarea.dataset.index = String(comment.index);
          const key = Core.commentKey(node.noteId, comment.index);
          textarea.value = state.drafts.has(key) ? String(state.drafts.get(key)) : String(comment.text || '');
          wrapper.appendChild(textarea);
        } else {
          const readonly = document.createElement('pre');
          readonly.className = 'comment-readonly';
          readonly.textContent = comment.text || `[${comment.type || comment.rawType || '不可编辑评论'}]`;
          wrapper.appendChild(readonly);
        }
        body.appendChild(wrapper);
      });
      card.append(title, body);
      dom.fieldsContainer.appendChild(card);
    });
  }

  function renderSelectedNode() {
    const node = selectedNode();
    dom.emptySelection.hidden = !!node;
    dom.nodeEditor.hidden = !node;
    if (!node) return;
    dom.nodeRole.textContent = roleLabel(node);
    dom.nodeTitle.textContent = node.title || '(无标题)';
    dom.nodeMeta.textContent = `noteId: ${node.noteId} · revision: ${node.revision || '无'}`;
    renderFields(node);
  }

  function render() {
    renderNavigation();
    renderSelectedNode();
    updateControls();
  }

  function loadResearchWorkbenchData(payload, preserveDrafts) {
    clearDiscardConfirm();
    const previousDrafts = state.drafts;
    state.model = payload || {};
    state.nodes = Core.getNodeList(state.model);
    state.drafts = preserveDrafts === true ? previousDrafts : new Map();
    const preferred = String(state.model.preferredSelectedId || '');
    const previousSelected = String(state.selectedId || '');
    state.selectedId = state.nodes.some((node) => String(node.noteId) === preferred)
      ? preferred
      : (state.nodes.some((node) => String(node.noteId) === previousSelected)
        ? previousSelected
        : (state.nodes[0] ? String(state.nodes[0].noteId) : ''));
    const rootTitle = state.model.rootQuestion && state.model.rootQuestion.title
      ? state.model.rootQuestion.title
      : (state.model.entry && state.model.entry.title ? state.model.entry.title : '未识别问题卡片');
    dom.contextTitle.textContent = rootTitle;
    dom.orphanNotice.hidden = state.model.isOrphan !== true;
    dom.loadingView.hidden = true;
    dom.workbenchView.hidden = false;
    render();
    return true;
  }

  function discardChanges() {
    if (state.pending || !isDirty()) return;
    if (!discardConfirmArmed) {
      discardConfirmArmed = true;
      if (dom.discardBtn) {
        dom.discardBtn.classList.add('is-confirming');
        dom.discardBtn.textContent = '再点一次放弃';
      }
      setStatus('再点一次「放弃修改」还原全部未保存内容', 'dirty');
      discardConfirmTimer = global.setTimeout(() => {
        clearDiscardConfirm();
        updateControls();
      }, 2400);
      return;
    }
    clearDiscardConfirm();
    state.drafts.clear();
    render();
    setStatus('已放弃未保存修改', 'ok');
  }

  function saveChanges() {
    if (state.pending) return;
    clearDiscardConfirm();
    const updates = dirtyUpdates();
    if (!updates.length || !state.model || !state.model.entry) return;
    const requestId = Core.makeRequestId('research-save');
    state.pending = { requestId, action: 'save' };
    updateControls();
    postToNative('researchWorkbenchSave', {
      id: state.model.entry.noteId,
      requestId,
      updates: JSON.stringify(updates),
    });
  }

  function createNode() {
    if (state.pending) return;
    const parent = selectedNode();
    const title = String(dom.createTitle.value || '').trim();
    if (!parent || !title || !state.model || !state.model.entry) {
      setStatus(!title ? '请输入新卡片标题' : '缺少父卡片', 'error');
      return;
    }
    if (isDirty()) {
      setStatus('请先保存或放弃已有修改，再创建卡片', 'error');
      return;
    }
    const requestId = Core.makeRequestId('research-create');
    state.pending = { requestId, action: 'create' };
    updateControls();
    postToNative('researchWorkbenchCreateNode', {
      id: state.model.entry.noteId,
      requestId,
      parentNoteId: parent.noteId,
      parentRevision: parent.revision,
      type: state.createType,
      title,
      body: dom.createBody.value || '',
    });
  }

  function completeAction(payload) {
    const result = payload || {};
    if (state.pending && result.requestId && result.requestId !== state.pending.requestId) return false;
    const action = state.pending ? state.pending.action : '';
    state.pending = null;
    if (result.success === true) {
      if (action === 'create') {
        dom.createTitle.value = '';
        dom.createBody.value = '';
      }
      setStatus(action === 'create' ? '子卡片已创建' : '修改已保存', 'ok');
    } else {
      setStatus(result.message || result.error || '操作失败，草稿已保留', 'error');
    }
    updateControls();
    return true;
  }

  function refresh() {
    if (!state.model || !state.model.entry) return;
    if (!canReplaceContext()) {
      setStatus('有未保存修改，请先保存或放弃修改后再刷新', 'error');
      return;
    }
    postToNative('refreshResearchWorkbench', { id: state.model.entry.noteId });
    setStatus('刷新中…', '');
  }

  function requestCloseResearchWorkbench() {
    if (state.pending) {
      setStatus('操作尚未完成，暂时不能关闭', 'error');
      return true;
    }
    if (isDirty()) {
      setStatus('有未保存修改，请保存或点击「放弃修改」后再关闭', 'error');
      return true;
    }
    postToNative('closeResearchWorkbench', {});
    return true;
  }

  dom.nodeList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-id]');
    if (!button) return;
    state.selectedId = String(button.dataset.noteId || '');
    render();
  });

  dom.fieldsContainer.addEventListener('input', (event) => {
    const textarea = event.target.closest('.comment-editor');
    if (!textarea) return;
    clearDiscardConfirm();
    const key = Core.commentKey(textarea.dataset.noteId, Number(textarea.dataset.index));
    state.drafts.set(key, textarea.value);
    updateControls();
  });

  document.querySelectorAll('[data-create-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.createType = button.dataset.createType === 'summary' ? 'summary' : 'idea';
      document.querySelectorAll('[data-create-type]').forEach((item) => {
        const active = item.dataset.createType === state.createType;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
  });

  if (dom.discardBtn) {
    dom.discardBtn.addEventListener('click', discardChanges);
  }
  dom.saveBtn.addEventListener('click', saveChanges);
  dom.refreshBtn.addEventListener('click', refresh);
  dom.closeBtn.addEventListener('click', requestCloseResearchWorkbench);
  dom.createBtn.addEventListener('click', createNode);
  dom.focusBtn.addEventListener('click', () => {
    const node = selectedNode();
    if (node) postToNative('focusCardInMindMap', { id: node.noteId });
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && discardConfirmArmed) {
      event.preventDefault();
      clearDiscardConfirm();
      updateControls();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (isDirty() && !state.pending) saveChanges();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      if (event.target && event.target.closest && event.target.closest('.create-panel')) {
        event.preventDefault();
        createNode();
      } else if (isDirty() && !state.pending) {
        event.preventDefault();
        saveChanges();
      }
    }
  });

  global.Bridge = {
    completeAction,
    requestCloseResearchWorkbench,
    canReplaceContext,
  };
  global.loadResearchWorkbenchData = loadResearchWorkbenchData;
  global.onbeforeunload = function() {
    return canReplaceContext() ? undefined : '问题研究工作台仍有未保存修改';
  };

  postToNative('ready', {});
})(window);
