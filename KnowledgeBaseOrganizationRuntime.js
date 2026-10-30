/* Native adapter: preview is read-only; all writes occur after plan validation. */
(function(root) {
  'use strict';
  const Core = root.KnowledgeBaseOrganization;
  const sessions = new WeakMap();
  const string = value => String(value == null ? '' : value);
  function hash(value) {
    const text = JSON.stringify(value); let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16) + ':' + text.length;
  }
  function session(controller) {
    if (!sessions.has(controller)) sessions.set(controller, { receipts: new Map(), busy: false, generation: 0 });
    return sessions.get(controller);
  }
  function note(id) {
    const native = MNUtil.getNoteById(string(id), false);
    const result = native && (typeof MNNote === 'function' ? new MNNote(native, 'MbBookNote') : MNNote.new(string(id), false));
    if (!result || !result.noteId) throw new Error('卡片不存在或已被移除，请刷新');
    return result;
  }
  function type(n) {
    const T = KnowledgeBaseTemplate;
    if (T.isRequiredPropositionsClassification(n)) return '归类';
    return T.getNoteTypeByColor(n.colorIndex) || T.getNoteType(n, true) || T.getNoteType(n) || '';
  }
  function children(n) { return Array.from(n.childNotes || []); }
  function revision(n) {
    const instance = root.MNKnowledgeBaseInstance;
    const comments = KnowledgeBaseTemplate.getSafeComments(n, false);
    const values = comments.map(c => {
      try { return JSON.parse(JSON.stringify(c)); } catch (_) { return string(c); }
    });
    return hash([n.noteId, n.title || n.noteTitle, n.colorIndex, n.parentNote && n.parentNote.noteId,
      n.indexInBrotherNotes, n.excerptText, n.excerptPic, n.docMd5, n.startPage,
      instance && typeof instance.getCommentRevisionForManager === 'function' ? instance.getCommentRevisionForManager(n) : '',
      values, children(n).map(c => string(c.noteId))]);
  }
  function knowledgePath(n) {
    const titles = [], seen = new Set();
    for (let current = n; current; current = current.parentNote) {
      const id = string(current.noteId);
      if (seen.has(id) || seen.size > 100) throw new Error('卡片父级路径存在循环或过深');
      seen.add(id); titles.unshift(string(current.noteTitle || current.title) || '无标题');
    }
    return titles.join(' / ');
  }
  function describe(n, path) {
    const parsed = KnowledgeBaseTemplate.parseNoteComments(n);
    const fields = (parsed.htmlCommentsObjArr || []).map(f => ({ name: string(f.text), count: f.excludingFieldBlockIndexArr.length }));
    const excerptCount = (parsed.htmlCommentsObjArr[0]?.index || (!fields.length ? KnowledgeBaseTemplate.getSafeComments(n, true).length : 0))
      + (n.excerptText || n.excerptPic ? 1 : 0);
    if (excerptCount) fields.unshift({ name: '摘录', count: excerptCount });
    const comments = KnowledgeBaseTemplate.getSafeComments(n, true);
    return { id: string(n.noteId), title: string(n.noteTitle || n.title), type: type(n), color: n.colorIndex,
      parentId: string(n.parentNote && n.parentNote.noteId), path: path || knowledgePath(n), revision: revision(n),
      children: children(n).map(c => string(c.noteId)), fields,
      excerpt: string(n.excerptText).slice(0, 2400),
      content: comments.map(c => KnowledgeBaseTemplate.getSafeCommentText(c)).filter(Boolean).join('\n').slice(0, 6000),
      legacy: KnowledgeBaseTemplate.isOldTemplateCard(n) ? KnowledgeBaseTemplate.previewOldTemplateCard(n) : null };
  }
  function tree(rootNote, excludedId) {
    const result = [], seen = new Set();
    const visit = (n, path) => {
      if (string(n.noteId) === excludedId) return;
      if (seen.has(string(n.noteId))) throw new Error('子树存在循环或重复归属，未执行整理');
      if (seen.size >= 5000) throw new Error('子树过大，请先选择较小的整理范围');
      seen.add(string(n.noteId));
      const fullPath = [path, string(n.noteTitle || n.title) || '无标题'].filter(Boolean).join(' / ');
      const entry = describe(n, fullPath);
      if (excludedId) entry.children = entry.children.filter(id => id !== excludedId);
      result.push(entry);
      children(n).forEach(child => visit(child, fullPath));
    };
    visit(rootNote, rootNote.parentNote ? knowledgePath(rootNote.parentNote) : ''); return result;
  }
  function context(controller) {
    const selected = MNNote.getFocusNote();
    const source = selected && selected.noteId ? selected : note(controller.searchFocusNoteId);
    const result = describe(source);
    controller.searchFocusNoteId = result.id;
    session(controller).generation++;
    session(controller).source = result;
    return result;
  }
  function verifySource(controller, payload) {
    const saved = session(controller).source;
    if (!saved || payload.sourceId !== saved.id || payload.sourceRevision !== saved.revision) throw new Error('整理来源已变化，请重新读取脑图选卡');
    const current = note(saved.id);
    if (revision(current) !== saved.revision) throw new Error('来源卡片已变化，请重新读取');
    const focused = MNNote.getFocusNote();
    if (focused && focused.noteId && string(focused.noteId) !== saved.id) throw new Error('脑图选卡已变化，请重新读取整理来源');
    return current;
  }
  function model(controller, payload) {
    const source = verifySource(controller, payload), target = note(payload.targetId);
    const sourceNodes = tree(source), targetNodes = tree(target, source.noteId);
    const result = { sourceId: string(source.noteId), targetId: string(target.noteId), sourceNodes, targetNodes };
    result.revision = hash([sourceNodes.map(n => [n.id, n.revision]), targetNodes.map(n => [n.id, n.revision])]);
    return result;
  }
  function relink(n, preserveTitle = false) {
    const T = KnowledgeBaseTemplate;
    T.classificationParentCache.delete(n);
    T.noteTypeCache.delete(n);
    if (!preserveTitle && type(n) && type(n) !== '归类') T.changeTitle(n, true, null, { syncIndex: false, syncContainLinks: false });
    T.linkParentNote(n, true, false);
  }
  function move(child, parent, changed) {
    if (string(child.parentNote && child.parentNote.noteId) === string(parent.noteId)) return;
    const oldParent = child.parentNote;
    if (changed && oldParent) changed.add(string(oldParent.noteId));
    parent.addChild(child);
    if (string(note(child.noteId).parentNote && note(child.noteId).parentNote.noteId) !== string(parent.noteId)) throw new Error('子树移动校验失败');
    if (oldParent && type(oldParent) === '归类') {
      KnowledgeBaseTemplate.cleanupClassificationContainLink(oldParent, child);
    }
    relink(child);
  }
  function contentSignature(comment) {
    const fields = ['type', 'text', 'markdown', 'paint', 'drawing', 'audio', 'q_htext', 'q_hpic', 'q_hblank', 'html', 'htmlText'];
    if (comment.type === 'LinkNote') fields.push('noteid', 'noteId');
    const normalize = value => {
      if (value == null) return '';
      if (Array.isArray(value)) return value.map(normalize);
      if (typeof value === 'object') return Object.keys(value).sort().map(key => [key, normalize(value[key])]);
      return value;
    };
    return JSON.stringify(fields.map(key => normalize(comment[key])));
  }
  function appendVerified(extracted, target) {
    const expected = new Map();
    [...KnowledgeBaseTemplate.getSafeComments(target, false), ...KnowledgeBaseTemplate.getSafeComments(extracted, false)]
      .forEach(comment => { const key = contentSignature(comment); expected.set(key, (expected.get(key) || 0) + 1); });
    extracted.title = ''; extracted.mergeInto(target);
    KnowledgeBaseTemplate.getSafeComments(target, false).forEach(comment => {
      const key = contentSignature(comment); expected.set(key, (expected.get(key) || 0) - 1);
    });
    if ([...expected.values()].some(count => count > 0)) throw new Error('目标内容迁移校验失败，未移除原内容');
  }
  function mergeContents(source, target, intent, changed, intermediate = false, beforeRetire = null) {
    const T = KnowledgeBaseTemplate;
    const targetType = type(target), sourceType = type(source);
    const excerptField = intent === 'proof' ? T.resolveFieldName('证明', targetType) : '摘录';
    // Transfer complete native comments. Neither AI nor string reconstruction writes content.
    const parsed = T.parseNoteComments(source), all = T.getSafeComments(source, true);
    const fields = parsed.htmlCommentsObjArr || [];
    const groups = fields.map(f => ({ name: T.normalizeFieldName(f.text), indices: f.includingFieldBlockIndexArr.slice(), body: f.excludingFieldBlockIndexArr.slice() }));
    const start = fields.length ? fields[0].index : all.length;
    if (start) {
      const indices = Array.from({ length: start }, (_, i) => i);
      const application = intermediate && intent !== 'proof' ? indices.filter(i => T.getStandaloneNoteLinkInfoFromComment(all[i])) : [];
      const excerpt = indices.filter(i => !application.includes(i));
      if (excerpt.length) groups.unshift({ name: '摘录', indices: excerpt, body: excerpt });
      if (application.length) groups.unshift({ name: '应用', indices: application, body: application });
    }
    if (intermediate && T.isIntermediateKnowledge(source)) T.completeIntermediateKnowledge(source);
    if (intent !== 'proof' && !intermediate) T.mergeTitleLinkWords(target, source, { allowAllSourceTypes: true });
    T.updateAllIncomingLinks(source.noteURL, target.noteURL, { refresh: false, onUpdated: n => changed && changed.add(string(n.noteId)) });
    // Extraction copies comments; remove original indices only after every copy verifies.
    const transferred = [];
    groups.sort((a, b) => b.indices[0] - a.indices[0]).forEach(group => {
      const rawIndices = T.getRawCommentIndicesForManagerIndices(source, group.indices);
      if (rawIndices.length !== group.indices.length) throw new Error('评论位置无法唯一确认，未移除原内容');
      const structural = ['所属', '包含'].includes(group.name);
      if (structural) {
        // Keep non-link annotations from structural fields in an explicit archive child.
        const meaningful = group.body.filter(i => !T.getStandaloneNoteLinkInfoFromComment(all[i]));
        if (meaningful.length) {
          const archive = T.extractComments(source, meaningful, { createChildUndoGrouping: false, cloneChildren: false, inheritLinks: false });
          archive.title = '历史内容：' + group.name;
          move(archive, target, changed);
          if (changed) changed.add(string(archive.noteId));
        }
      } else if (group.body.length) {
        const field = group.name === '摘录' ? excerptField : T.resolveFieldName(group.name, targetType);
        const existing = T.findFieldObjectByNormalizedName(target, field);
        const copyIndices = (field === '摘录' || existing) ? group.body : group.indices;
        const extracted = T.extractComments(source, copyIndices, { createChildUndoGrouping: false, cloneChildren: false, inheritLinks: false });
        appendVerified(extracted, target);
        if (field === '摘录' || existing) T.autoMoveNewContentToField(target, field, true, false, false);
      } else if (!structural && group.indices.length) {
        // Unknown HTML can itself hold valuable content even without following comments.
        const comment = all[group.indices[0]];
        if (!T.legacyFieldName(comment)) {
          const extracted = T.extractComments(source, group.indices, { createChildUndoGrouping: false, cloneChildren: false, inheritLinks: false });
          appendVerified(extracted, target);
        }
      }
      transferred.push(...rawIndices);
    });
    source.removeCommentsByIndexArr([...new Set(transferred)].sort((a, b) => b - a));
    if (source.comments.length || children(source).length) throw new Error('来源仍有未迁移内容，已停止移除');
    // Native merge retires the logical source and retains any native backing excerpt
    // and host-managed references; direct delete would lose primary excerpts.
    source.title = '';
    if (beforeRetire) beforeRetire();
    source.mergeInto(target);
  }
  function preparePinMigrations(plan) {
    if (!plan.merges.length) return new Map();
    if (typeof KnowledgeBaseMergeTransaction === 'undefined'
      || typeof KnowledgeBaseMergeTransaction.resolvePinMigrationAPI !== 'function') {
      throw new Error('缺少共享 Pin 接口解析器，请同步更新配套插件');
    }
    const pinAPI = KnowledgeBaseMergeTransaction.resolvePinMigrationAPI();
    if (pinAPI === null) return new Map();
    if (!pinAPI || typeof pinAPI.prepareCardPinsNoteIdMigration !== 'function'
      || typeof KnowledgeBaseMergeTransaction.registerExternalUndoReceipt !== 'function') {
      throw new Error('已安装的 Pin 插件缺少可核验迁移接口，请同步更新配套插件');
    }
    return new Map(plan.merges.map(pair => {
      const migration = pinAPI.prepareCardPinsNoteIdMigration(pair.sourceId, pair.targetId);
      if (!migration || ['apply', 'verify', 'rollback', 'commit'].some(name => typeof migration[name] !== 'function')) throw new Error('Pin 迁移接口不完整');
      return [pair.sourceId, { sourceNoteId: pair.sourceId, targetNoteId: pair.targetId, pinMigration: migration,
        isSourceActive(nativeSource) {
          if (!nativeSource) return false;
          const value = string(nativeSource.groupNoteId);
          const group = ['', 'null', '<null>', 'NSNull', '[object NSNull]'].includes(value) ? '' : value;
          return !group || group === string(nativeSource.noteId || nativeSource.noteid || pair.sourceId);
        } }];
    }));
  }
  function checkedPin(receipt, method) {
    if (!receipt) return;
    const result = receipt.pinMigration[method]();
    if (!result || result.success !== true) throw new Error('Pin ' + method + ' 未返回可核验的成功结果');
  }
  async function execute(controller, payload) {
    const state = session(controller), receiptId = string(payload.executionId);
    if (!/^[\w.:-]{1,160}$/.test(receiptId)) throw new Error('缺少有效执行编号');
    if (state.receipts.has(receiptId)) return state.receipts.get(receiptId);
    if (state.busy) throw new Error('已有整理操作正在执行');
    const saved = state.preview;
    if (!saved || saved.token !== payload.previewToken) throw new Error('合并预览已失效，请重新审阅');
    const current = model(controller, payload);
    if (current.revision !== saved.model.revision) throw new Error('卡片内容或结构已变化，请重新审阅');
    const plan = Core.buildPlan(current, saved.plan.intent, saved.plan.choices);
    // Complete all predictable checks before any mutation.
    if (plan.intent === 'proof') {
      const target = note(plan.targetId), field = KnowledgeBaseTemplate.resolveFieldName('证明', type(target));
      if (!KnowledgeBaseTemplate.findFieldObjectByNormalizedName(target, field)) throw new Error('目标缺少证明字段，请先完成目标制卡');
    }
    if (plan.intent !== 'proof') for (const pair of plan.merges) {
      const source = note(pair.sourceId), target = note(pair.targetId);
      if (KnowledgeBaseTemplate.isIntermediateKnowledge(source)) {
        const fields = KnowledgeBaseTemplate.parseNoteComments(source).htmlCommentsObjArr;
        const comments = KnowledgeBaseTemplate.getSafeComments(source, true).slice(0, fields.length ? fields[0].index : undefined);
        if (comments.some(comment => KnowledgeBaseTemplate.getStandaloneNoteLinkInfoFromComment(comment))
          && !KnowledgeBaseTemplate.findFieldObjectByNormalizedName(target, '应用')) throw new Error('目标缺少应用字段，请先完成目标制卡');
      }
    }
    const pinMigrations = preparePinMigrations(plan), appliedPins = [];
    state.busy = true;
    const changed = new Set([plan.targetId]), deleted = new Set(), replacement = new Map();
    let result, writesStarted = false;
    try {
      if (plan.merges.length) {
        await KnowledgeBaseTemplate.prepareCardMigrationSelection([note(plan.sourceId)], note(plan.targetId));
        const sourceNodes = tree(note(plan.sourceId)), targetNodes = tree(note(plan.targetId), plan.sourceId);
        if (hash([sourceNodes.map(n => [n.id, n.revision]), targetNodes.map(n => [n.id, n.revision])]) !== current.revision) throw new Error('卡片内容或结构已变化，请重新审阅');
      }
      let callbackError, callbackComplete = false, callbackStarted = false, acceptingCallback = true;
      try {
        MNUtil.undoGrouping(() => {
          if (!acceptingCallback || callbackStarted) return;
          callbackStarted = true;
          writesStarted = true;
          try {
            if (plan.intent === 'move') {
              const source = note(plan.sourceId); move(source, note(plan.targetId), changed); changed.add(source.noteId);
            } else {
              for (const pair of plan.merges) {
                let source = note(replacement.get(pair.sourceId) || pair.sourceId);
                const target = note(pair.targetId), originalId = string(source.noteId);
                const originalURL = source.noteURL;
                const pinReceipt = pinMigrations.get(pair.sourceId);
                if (pinReceipt) {
                  appliedPins.push(pinReceipt);
                  checkedPin(pinReceipt, 'apply'); checkedPin(pinReceipt, 'verify');
                  KnowledgeBaseMergeTransaction.registerExternalUndoReceipt(pinReceipt);
                }
                if (source.parentNote) {
                  changed.add(string(source.parentNote.noteId));
                  if (type(source.parentNote) === '归类') KnowledgeBaseTemplate.cleanupClassificationContainLink(source.parentNote, source);
                }
                const wasLegacy = KnowledgeBaseTemplate.isOldTemplateCard(source);
                const intermediate = KnowledgeBaseTemplate.isIntermediateKnowledge(source);
                KnowledgeBaseTemplate.updateAllIncomingLinks(originalURL, target.noteURL, { refresh: false, onUpdated: n => changed.add(string(n.noteId)) });
                source = KnowledgeBaseTemplate.toNoExcerptVersion(source, source.parentNote, {
                  allowTextExcerpt: true, allowMediaExcerpt: true, allowTopLevel: true, createChildUndoGrouping: false
                });
                if (!source || !source.noteId || string(source.noteId) === pair.targetId) throw new Error('摘录转换未返回有效来源卡片');
                if (wasLegacy) source = KnowledgeBaseTemplate.processOldTemplateCard(source, { refresh: false });
                if (source.noteId !== originalId) KnowledgeBaseTemplate.updateAllIncomingLinks(originalURL, target.noteURL, { refresh: false });
                if (source.noteId !== originalId) { replacement.set(originalId, source.noteId); deleted.add(originalId); }
                // Source archives created during migration are included here.
                children(source).forEach(child => { move(child, target, changed); changed.add(string(child.noteId)); });
                checkedPin(pinReceipt, 'verify');
                mergeContents(source, target, plan.intent, changed, intermediate, () => {
                  if (pinReceipt) pinReceipt.nativeRetirementRequested = true;
                });
                checkedPin(pinReceipt, 'verify'); checkedPin(pinReceipt, 'commit');
                deleted.add(string(source.noteId)); changed.add(string(target.noteId));
                relink(target, true);
              }
            }
            deleted.forEach(id => changed.delete(id));
            // MNUtil refreshes the UI after this group. A local note.refresh()
            // writes comments and may use another runtime's undo depth.
            callbackComplete = true;
          } catch (error) { callbackError = error; }
        });
      } finally { acceptingCallback = false; }
      if (callbackError) throw callbackError;
      if (!callbackComplete) throw new Error('原生撤销分组未同步完成，整理已停止');
      result = { success: true, targetId: plan.intent === 'move' ? plan.sourceId : plan.targetId,
        changedIds: [...changed], deletedIds: [...deleted] };
    } catch (error) {
      const pinErrors = [];
      appliedPins.slice().reverse().forEach(receipt => {
        try {
          // Native retirement may be buffered until commit. Never reverse Pins
          // merely because the source is still visible after the request was sent.
          if (receipt.nativeRetirementRequested) return;
          const nativeSource = MNUtil.getNoteById(receipt.sourceNoteId, false);
          if (receipt.isSourceActive(nativeSource)) {
            checkedPin(receipt, 'rollback');
            KnowledgeBaseMergeTransaction.forgetUndoReceipt(receipt);
          }
        } catch (pinError) { pinErrors.push(string(pinError.message || pinError)); }
      });
      result = { success: false, requiresUndo: writesStarted, error: string(error.message || error)
        + (pinErrors.length ? '；Pin 恢复需检查：' + pinErrors.join('；') : '') + (writesStarted ? '；操作可能已部分执行，请撤销一次后刷新。' : '；尚未开始卡片迁移。') };
    }
    state.receipts.set(receiptId, result);
    state.preview = null;
    // Do not auto-retry mutations after refresh/index failures.
    try {
      const instance = root.MNKnowledgeBaseInstance;
      if (instance && typeof instance.refreshSearchCardIndex === 'function') {
        for (const id of changed) {
          const refreshed = await instance.refreshSearchCardIndex(id, { showErrorHUD: false, showSuccessHUD: false, reason: 'organization', allowCardMutation: false });
          if (refreshed && refreshed.success === false) result.indexWarning = '卡片已处理，部分搜索索引需要刷新';
        }
        for (const id of deleted) {
          if (typeof instance.removeSearchCardIndex !== 'function') { result.indexWarning = '卡片已处理，来源搜索索引需要移除'; continue; }
          const removed = await instance.removeSearchCardIndex(id, { showHUD: false, reason: 'organization' });
          if (removed && removed.success === false) result.indexWarning = '卡片已处理，来源搜索索引需要移除';
        }
      }
    } catch (_) { result.indexWarning = '卡片已处理，搜索索引需要刷新'; }
    finally { state.busy = false; }
    return result;
  }
  function compact(entry) {
    return { id: entry.id, title: entry.title, type: entry.type, path: entry.path,
      excerpt: entry.excerpt.slice(0, 1200), content: entry.content.slice(0, 3000), fields: entry.fields };
  }
  async function search(controller, payload) {
    const state = session(controller), generation = ++state.generation;
    if (!['equivalent', 'container'].includes(payload.stage)) throw new Error('整理检索意图无效');
    let source = describe(verifySource(controller, payload));
    let candidates;
    if (payload.pairSourceId) {
      const current = model(controller, payload);
      const reviewed = Core.review(current, payload.choices || {});
      const row = reviewed.rows.find(row => row.source.id === payload.pairSourceId);
      if (!row) throw new Error('归类审阅范围已变化');
      source = row.source; candidates = row.candidates;
    } else {
      if (!Array.isArray(payload.candidateIds) || payload.candidateIds.length > 48) throw new Error('候选范围无效');
      candidates = [...new Set(payload.candidateIds)].filter(id => id !== source.id).map(id => describe(note(id)));
      candidates = candidates.filter(n => payload.stage === 'container' ? n.type === '归类' : n.type === source.type);
    }
    candidates = Core.rankCandidates(source, candidates, 40);
    if (!candidates.length) return { success: true, ranked: [], stage: payload.stage };
    if (!KnowledgeBaseNetwork.isMNAIModelAvailable(payload.modelSource, payload.model)) {
      return { success: true, local: true, error: '未选择可用模型，候选关系尚未判定',
        ranked: candidates.map(n => ({ id: n.id, relation: 'uncertain', reason: '本地候选，需人工核对内容与范围' })) };
    }
    const result = await KnowledgeBaseNetwork.callMNAIWithNotification(Core.prompt(compact(source), candidates.map(compact), payload.stage), {
      source: payload.modelSource, model: payload.model, timeoutSeconds: 45,
      shouldCancel: () => state.generation !== generation || controller.currentHTMLType !== 'search',
      suppressMNUtilsNotification: true, suppressFinishBroadcast: true, awaitNotificationClose: true,
      sourceAddon: 'mnknowledgebase', requestId: string(payload.requestId)
    });
    if (state.generation !== generation) throw new Error('整理检索已取消');
    verifySource(controller, payload);
    return { success: true, ranked: Core.parseRelations(result, candidates, payload.stage), stage: payload.stage };
  }
  async function handle(controller, action, params) {
    if (controller.currentHTMLType !== 'search' || controller.isCommentController) return;
    const requestId = string(params.requestId);
    if (!/^[\w.:-]{1,160}$/.test(requestId)) return;
    let result;
    try {
      const raw = await controller.runJavaScript(`window.MNKBOrganizationUI.takePayload(${JSON.stringify(requestId)})`);
      if (typeof raw !== 'string' || raw.length > 250000) throw new Error('整理请求无效或过大');
      const payload = JSON.parse(raw);
      if (payload.requestId !== requestId) throw new Error('整理请求身份不一致');
      switch (action) {
        case 'organizationcontext': result = { success: true, source: context(controller) }; break;
        case 'organizationmodel': result = { success: true, model: model(controller, payload) }; break;
        case 'organizationsearch': result = await search(controller, payload); break;
        case 'organizationpreview': {
          const current = model(controller, payload);
          if (current.revision !== payload.revision) throw new Error('审阅内容已变化，请刷新');
          const plan = Core.buildPlan(current, payload.intent, payload.choices || {});
          const entries = new Map([...current.sourceNodes, ...current.targetNodes].map(n => [n.id, n]));
          plan.fields.forEach(item => {
            const targetType = entries.get(item.targetId).type;
            item.fields = item.fields.map(field => ({ ...field, destination:
              item.legacy && item.legacy.childFields.includes(field.name) ? '历史内容子卡片：' + field.name
              : targetType === '归类' && ['所属', '包含'].includes(field.name) ? '重建结构链接，正文转存为历史内容子卡片'
              : KnowledgeBaseTemplate.resolveFieldName(field.name, targetType) }));
          });
          const token = requestId + ':' + current.revision;
          session(controller).preview = { model: current, plan, token };
          result = { success: true, plan, previewToken: token }; break;
        }
        case 'organizationexecute': result = await execute(controller, payload); break;
        case 'organizationcancel': session(controller).generation++; session(controller).preview = null; result = { success: true }; break;
        default: throw new Error('未知整理请求');
      }
    } catch (error) { result = { success: false, error: string(error.message || error) }; }
    await controller.runJavaScript(`window.MNKBOrganizationUI && window.MNKBOrganizationUI.complete(${JSON.stringify({ ...result, requestId })})`);
  }
  root.KnowledgeBaseOrganizationRuntime = { handle, model, execute, describe, mergeContents, context, search };
})(typeof globalThis !== 'undefined' ? globalThis : this);
