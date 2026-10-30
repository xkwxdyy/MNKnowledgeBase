/* Duplicate knowledge merge: plan in JavaScript, retain the source as native excerpt backing. */
var KnowledgeBaseMergeTransaction = (() => {
  const receipts = [];
  const pendingRemovals = new WeakMap();
  const preparedMerges = new WeakMap();
  const text = value => value === undefined || value === null || String(value) === '[object NSNull]' ? '' : String(value);
  const id = note => text(note && note.noteId);
  const normId = value => text(value).toUpperCase();
  const raw = note => Array.from(note && note.comments || []);
  const managed = (Template, note) => Template.getSafeComments(note, true);
  const fail = message => { throw new Error(message); };
  const canonical = value => {
    if (value === undefined || value === null || String(value) === '[object NSNull]') return '';
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return value.map(canonical);
    return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
  };
  function key(comment, options = {}) {
    const fields = ['type', 'text', 'markdown', 'paint', 'drawing', 'audio', 'q_htext', 'q_hpic', 'q_hblank', 'html', 'htmlText', 'size', 'tag', 'collapsed'];
    if (!options.ignoreProvenance || text(comment && comment.type) === 'LinkNote') fields.push('noteid', 'noteId');
    if (!options.ignoreIdentity) fields.push('commentId');
    return JSON.stringify(fields.map(field => canonical(comment && comment[field])));
  }
  const contentKey = comment => key(comment, { ignoreIdentity: true, ignoreProvenance: true });
  function sameKeys(actual, expected) { return actual.length === expected.length && actual.every((item, index) => key(item) === expected[index]); }
  function nativeNote(noteId) {
    if (typeof MNUtil === 'undefined' || typeof MNUtil.getNoteById !== 'function') fail('无法核验原生卡片状态，合并未执行');
    return MNUtil.getNoteById(noteId, false);
  }
  function unwrap(noteId) { return MNNote.new(noteId, false); }
  function rawIndices(Template, note, index) {
    const result = Template.getRawCommentIndicesForManagerIndices(note, [index]);
    if (!Array.isArray(result) || result.length !== 1 || !Number.isInteger(result[0])) fail('评论位置无法唯一确认，合并未执行');
    return result[0];
  }
  function fields(Template, note) {
    return (Template.parseNoteComments(note).htmlCommentsObjArr || []).map(field => ({
      name: Template.normalizeFieldName(field.text),
      index: rawIndices(Template, note, field.index),
      managerIndices: field.excludingFieldBlockIndexArr || [],
    }));
  }
  function assertChildren(parent, expected) {
    const actual = Array.from(parent.childNotes || []).map(id);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) fail('子卡片迁移结果与原有顺序不一致');
  }
  function checkedNativeNote(noteId) {
    const note = nativeNote(noteId);
    if (!note || normId(id(note)) !== normId(noteId)) fail(`原生卡片不存在或身份无法核验：${noteId}`);
    return note;
  }
  function assertNativeChildren(noteId, expected) {
    const parent = checkedNativeNote(noteId);
    assertChildren(parent, expected);
    for (const childId of expected) {
      const child = checkedNativeNote(childId);
      if (normId(id(child.parentNote)) !== normId(noteId)) fail(`子卡片原生父关系无法核验：${childId}`);
    }
  }
  function guardRelation(target, source) {
    if (!id(target) || !id(source) || normId(id(target)) === normId(id(source))) fail('合并需要不同的来源卡片与目标卡片');
    const visited = new Set();
    let current = target;
    while (current) {
      if (normId(id(current)) === normId(id(source))) fail('目标卡片位于来源子树中，无法合并');
      if (visited.has(id(current))) fail('卡片父级存在循环关系，无法合并');
      visited.add(id(current)); current = current.parentNote;
    }
  }
  function resolvePinMigrationAPI() {
    const publicAPI = typeof mnpinnerPublicApi !== 'undefined' ? mnpinnerPublicApi :
      (typeof globalThis !== 'undefined' ? globalThis.mnpinnerPublicApi : null);
    if (publicAPI && typeof publicAPI.prepareCardPinsNoteIdMigration === 'function') return publicAPI;
    if (typeof pinnerUtils !== 'undefined' && pinnerUtils && typeof pinnerUtils.prepareCardPinsNoteIdMigration === 'function') return pinnerUtils;
    let installed = !!publicAPI || typeof pinnerUtils !== 'undefined' || typeof pinnerConfig !== 'undefined';
    if (!installed && typeof KnowledgeBaseUtils !== 'undefined' && KnowledgeBaseUtils.mainPath && typeof NSFileManager !== 'undefined') {
      const directory = String(KnowledgeBaseUtils.mainPath).replace(/\/+$/, '').replace(/\/[^/]+$/, '');
      installed = !!NSFileManager.defaultManager().fileExistsAtPath(directory + '/marginnote.extension.mnpinner/mnaddon.json');
    }
    if (installed) fail('MNPinner 未提供可核验的卡片迁移接口，请更新 MNPinner 后重试');
    return null;
  }
  function pinMigration(source, target) {
    const api = resolvePinMigrationAPI();
    if (!api) return null;
    const migration = api.prepareCardPinsNoteIdMigration(id(source), id(target));
    if (!migration || ['apply', 'verify', 'rollback', 'commit'].some(name => typeof migration[name] !== 'function')) fail('MNPinner 卡片迁移事务不可用');
    return migration;
  }
  function checkedPin(migration, method) {
    if (!migration) return;
    const result = migration[method]();
    if (!result || result.success !== true) fail(`MNPinner ${method} 未确认成功`);
  }
  function snapshotTree(noteId) {
    const seen = new Set();
    const visit = currentId => {
      const normalizedId = normId(currentId);
      if (seen.has(normalizedId)) fail('卡片子树存在循环或重复关系，合并未执行');
      seen.add(normalizedId);
      const note = checkedNativeNote(currentId);
      const children = Array.from(note.childNotes || []);
      for (const child of children) {
        if (normId(id(checkedNativeNote(id(child)).parentNote)) !== normalizedId) fail('卡片子树父关系无法核验');
      }
      return { noteId: id(note), parentNoteId: id(note.parentNote), title: text(note.noteTitle),
        comments: raw(note).map(comment => key(comment)), tags: Array.from(note.tags || []).map(text),
        excerptText: text(note.excerptText), excerptPic: canonical(note.excerptPic),
        groupNoteId: text(note.groupNoteId), originNoteId: text(note.originNoteId),
        children: children.map(child => visit(id(child))) };
    };
    return JSON.stringify(visit(noteId));
  }
  function prepareBeforeUndoGroup(Template, target, source, options = {}) {
    guardRelation(target, source);
    const intermediate = !!(Template.isIntermediateKnowledge && Template.isIntermediateKnowledge(source));
    if (!intermediate && !Array.from(source.childNotes || []).length && !resolvePinMigrationAPI()) return null;
    resolvePinMigrationAPI();
    if (text(source.groupNoteId) && normId(source.groupNoteId) !== normId(id(source))) fail('来源卡片已作为其他卡片的摘录保留，不能再次合并该来源');
    const sourceSnapshot = snapshotTree(id(source));
    const targetSnapshot = snapshotTree(id(target));
    const plan = planSource(Template, target, source, options, intermediate);
    const prepared = { sourceNoteId: id(source), targetNoteId: id(target), nativeMutationFree: true };
    preparedMerges.set(prepared, { Template, sourceSnapshot, targetSnapshot, plan, optionsKey: planningOptionsKey(options) });
    return prepared;
  }
  function consumePrepared(Template, target, source, prepared) {
    const record = prepared && preparedMerges.get(prepared);
    if (!record || record.Template !== Template ||
        normId(prepared.sourceNoteId) !== normId(id(source)) || normId(prepared.targetNoteId) !== normId(id(target))) fail('合并准备记录无效、已使用或对应其他卡片');
    preparedMerges.delete(prepared);
    if (snapshotTree(id(source)) !== record.sourceSnapshot || snapshotTree(id(target)) !== record.targetSnapshot) fail('合并准备已经过期：卡片内容或子树发生变化，请重新准备');
    return record;
  }
  function planningOptionsKey(options) {
    return JSON.stringify(canonical({ keepOnlyExcerpt: !!options.keepOnlyExcerpt, mergeRelatedLinks: options.mergeRelatedLinks === true, skipFields: options.skipFields || [] }));
  }
  function applicationIds(Template, target) {
    const set = new Set();
    const field = Template.findFieldObjectByNormalizedName(target, '应用');
    const comments = managed(Template, target);
    for (const index of field && field.excludingFieldBlockIndexArr || []) {
      const link = Template.getStandaloneNoteLinkInfoFromComment(comments[index]);
      if (link) set.add(normId(link.noteId));
    }
    return set;
  }
  function planSource(Template, target, source, options, intermediate) {
    const targetFields = fields(Template, target);
    const targetNames = new Set(targetFields.map(field => field.name));
    const stageComments = managed(Template, source);
    const stageFields = fields(Template, source);
    const mapping = Template.buildFieldMapping(Template.getNoteType(source), Template.getNoteType(target));
    const skipped = new Set((options.skipFields || []).map(name => Template.normalizeFieldName(text(name))));
    if (options.mergeRelatedLinks !== true) skipped.add('相关链接');
    const assignments = new Map();
    const directClassifications = new Set(Array.from(source.childNotes || []).filter(child =>
      Template.getNoteType(child) === '归类' || (Template.isRequiredPropositionsClassification && Template.isRequiredPropositionsClassification(child))).map(child => normId(id(child))));
    for (let index = 0; index < stageComments.length; index++) {
      assignments.set(rawIndices(Template, source, index), '摘录');
    }
    for (const field of stageFields) {
      assignments.set(field.index, null);
      const destination = Template.normalizeFieldName(Template.resolveFieldName(mapping[field.name] || field.name, Template.getNoteType(target)));
      for (const index of field.managerIndices) {
        assignments.set(rawIndices(Template, source, index), options.keepOnlyExcerpt || skipped.has(field.name) ? null : destination);
      }
    }
    const seenApplications = applicationIds(Template, target);
    stageComments.forEach((comment, index) => {
      const rawIndex = rawIndices(Template, source, index);
      const link = Template.getStandaloneNoteLinkInfoFromComment(comment);
      if (intermediate && assignments.get(rawIndex) === '摘录' && link) assignments.set(rawIndex, '应用');
      if (link && directClassifications.has(normId(link.noteId)) && ['摘录', '应用'].includes(assignments.get(rawIndex))) assignments.set(rawIndex, '相关链接');
      if (assignments.get(rawIndex) !== '应用' || !link) return;
      const linkId = normId(link.noteId);
      if (linkId === normId(id(source)) || linkId === normId(id(target)) || seenApplications.has(linkId)) {
        assignments.set(rawIndex, null);
      } else {
        seenApplications.add(linkId);
      }
    });
    const rawComments = raw(source);
    const destinations = [];
    rawComments.forEach((comment, index) => {
      if (!assignments.has(index)) fail('存在无法映射的评论，合并未执行');
      const destination = assignments.get(index);
      if (destination === null) {
        if (text(comment.type) === 'LinkNote' && (comment.q_htext || comment.q_hpic || comment.q_hblank)) fail('待跳过的原生摘录链接可能拥有底层卡片，不能安全删除，合并未执行');
        destinations.push(null); return;
      }
      if (!['摘录', '摘录区'].includes(destination) && !targetNames.has(destination)) fail(`目标卡片缺少字段“${destination}”，合并未执行`);
      destinations.push(destination === '摘录区' ? '摘录' : destination);
    });
    return { destinations, targetFields };
  }
  function incomingPlan(Template, source, target) {
    const candidates = new Set([id(target)]);
    for (const comment of managed(Template, source)) {
      const link = Template.getStandaloneNoteLinkInfoFromComment(comment);
      if (link) candidates.add(text(link.noteId));
      if (['markdownComment', 'mergedMarkdownComment', 'textComment', 'linkComment'].includes(Template.getSafeCommentType(comment))) {
        for (const linked of Template.extractNoteIdsFromMarginNoteLinks(Template.getSafeCommentText(comment))) candidates.add(linked);
      }
    }
    const changes = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (normId(candidate) === normId(id(source)) || seen.has(normId(candidate))) continue;
      seen.add(normId(candidate));
      const note = normId(candidate) === normId(id(target)) ? target : unwrap(candidate);
      if (!note) continue;
      managed(Template, note).forEach((comment, managerIndex) => {
        const type = Template.getSafeCommentType(comment);
        if (!['markdownComment', 'mergedMarkdownComment', 'linkComment', 'textComment'].includes(type)) return;
        const index = rawIndices(Template, note, managerIndex);
        const original = raw(note)[index];
        const originalType = text(original && original.type);
        const oldText = originalType === 'TextNote' && !original.q_htext && !original.q_hpic ? text(original.text) : Template.getSafeCommentText(comment);
        const nextText = Template.replaceMarginNoteLinksByNoteId(oldText, id(source), target.noteURL);
        if (oldText === nextText) return;
        const mergedMarkdown = type === 'mergedMarkdownComment' && originalType === 'LinkNote';
        if (mergedMarkdown) {
          const backing = comment.note;
          if (!backing || !nativeNote(id(backing)) || normId(id(backing)) === normId(id(source))) fail('合并证明的摘录来源无法安全更新，来源卡片已保留');
        } else if (originalType === 'LinkNote' && (original.q_htext || original.q_hpic)) fail('摘录链接需要保留原来源，当前合并不能替换该引用');
        const noteFields = fields(Template, note);
        const containingField = noteFields.filter(field => field.index < index).pop();
        // Native appendNoteLink may be represented as a whole-URL TextNote/linkComment.
        // Use the semantic standalone-link parser, not the raw storage type.
        const standaloneLink = Template.getStandaloneNoteLinkInfoFromComment(comment);
        const plainNativeLink = !!standaloneLink && normId(standaloneLink.noteId) === normId(id(source)) &&
          !original.q_htext && !original.q_hpic && !original.q_hblank;
        const parentRelationship = plainNativeLink && id(note.parentNote) === id(source) && containingField && containingField.name === '所属';
        changes.push({ note, originalIndex: index, index, oldText, nextText, nativeLink: originalType === 'LinkNote',
          plainNativeLink, parentRelationship, fieldName: containingField ? containingField.name : null,
          targetNote: target, targetNoteId: id(target),
          topicId: text(target.notebookId || (typeof MNUtil !== 'undefined' && MNUtil.currentNotebookId)),
          markdown: type === 'markdownComment' || original.markdown === true, mergedMarkdown, beforeKey: key(original), beforeContent: contentKey(original), applied: false });
      });
    }
    return changes;
  }
  function currentManagedComment(Template, note, index) {
    const candidates = managed(Template, note);
    return candidates.find((comment, managerIndex) => rawIndices(Template, note, managerIndex) === index);
  }
  function applyIncoming(Template, change) {
    if (change.parentRelationship) return;
    let before = raw(change.note);
    const readableText = (comment, index) => comment && text(comment.type) === 'TextNote' && !comment.q_htext && !comment.q_hpic
      ? text(comment.text) : Template.getSafeCommentText(currentManagedComment(Template, change.note, index));
    const matchesTarget = (comment, index) => {
      if (readableText(comment, index) === change.nextText) return true;
      if (!change.plainNativeLink || !comment || text(comment.type) !== 'LinkNote' || comment.q_htext || comment.q_hpic) return false;
      const linkedId = text(comment.noteid || comment.noteId);
      if (normId(linkedId) === normId(change.targetNoteId)) return true;
      const linked = linkedId && nativeNote(linkedId);
      if (!linked) return false;
      if (normId(linked.groupNoteId) === normId(change.targetNoteId)) return true;
      return typeof linked.realGroupNoteIdForTopicId === 'function' && !!change.topicId &&
        normId(linked.realGroupNoteIdForTopicId(change.topicId)) === normId(change.targetNoteId);
    };
    if (matchesTarget(before[change.index], change.index)) {
      change.afterKey = key(before[change.index]);
      return; // Native merge or another rendering of the same excerpt already updated it.
    }
    if (key(before[change.index]) !== change.beforeKey) {
      const originals = before.map((comment, index) => key(comment) === change.beforeKey ? index : -1).filter(index => index >= 0);
      if (originals.length === 1) change.index = originals[0];
      else if (change.plainNativeLink && originals.length === 0) {
        const existing = before.findIndex(matchesTarget);
        if (existing >= 0) { change.index = existing; change.afterKey = key(before[existing]); return; }
        const currentFields = fields(Template, change.note);
        const fieldIndex = currentFields.findIndex(field => field.name === change.fieldName);
        if (change.fieldName && fieldIndex < 0) fail('原引用所在字段已经变化，不能重建链接');
        const insertAt = change.fieldName ? (currentFields[fieldIndex + 1] ? currentFields[fieldIndex + 1].index : before.length)
          : (currentFields.length ? currentFields[0].index : before.length);
        change.note.appendNoteLink(change.targetNote, 'To');
        if (raw(change.note).length !== before.length + 1) fail('原生移除后的引用重建失败');
        change.note.moveComment(raw(change.note).length - 1, insertAt, false);
        change.index = insertAt; change.applied = true;
        if (!matchesTarget(raw(change.note)[insertAt], insertAt)) fail('原生移除后的引用重建无法核验');
        change.afterKey = key(raw(change.note)[insertAt]); return;
      } else fail('引用评论已经变化，合并已停止');
    }
    before = raw(change.note);
    const current = currentManagedComment(Template, change.note, change.index);
    if (key(before[change.index]) !== change.beforeKey) fail('引用评论已经变化，合并已停止');
    change.beforeCount = before.length;
    change.beforeContents = before.map(contentKey);
    change.applied = true;
    if (change.mergedMarkdown) current.text = change.nextText;
    else change.note.replaceWithMarkdownComment(change.nextText, change.index);
    const after = raw(change.note);
    if (after.length !== before.length || readableText(after[change.index], change.index) !== change.nextText) fail('引用更新结果无法核验');
    change.afterKey = key(after[change.index]);
  }
  function buildOrder(base, additions, targetFields, toBottom) {
    const buckets = new Map();
    additions.forEach(token => {
      let boundary;
      if (token.destination === '摘录') boundary = toBottom ? (targetFields.length ? targetFields[0].index : base.length) : 0;
      else {
        const fieldIndex = targetFields.findIndex(field => field.name === token.destination);
        if (fieldIndex < 0) fail('目标字段在合并期间发生变化');
        boundary = toBottom ? (targetFields[fieldIndex + 1] ? targetFields[fieldIndex + 1].index : base.length) : targetFields[fieldIndex].index + 1;
      }
      if (!buckets.has(boundary)) buckets.set(boundary, []);
      buckets.get(boundary).push(token);
    });
    const ordered = [];
    for (let index = 0; index <= base.length; index++) {
      ordered.push(...(buckets.get(index) || []));
      if (index < base.length) ordered.push(base[index]);
    }
    return ordered;
  }
  function reconcileTokens(note, tokens) {
    const current = raw(note);
    if (current.length !== tokens.length) fail('评论数量与合并记录不一致，无法安全回退');
    const buckets = new Map();
    tokens.forEach(token => {
      if (!buckets.has(token.key)) buckets.set(token.key, []);
      buckets.get(token.key).push(token);
    });
    return current.map(comment => {
      const bucket = buckets.get(key(comment));
      if (!bucket || !bucket.length) fail('原评论被外部修改，无法安全回退合并');
      return bucket.shift();
    });
  }
  function appendAndArrange(target, source, plan, original, state, toBottom) {
    const sourceCommentKeys = raw(source).map(contentKey);
    const sourceHasExcerpt = text(source.excerptText).trim() || (source.excerptPic && text(source.excerptPic));
    const before = raw(target);
    if (!sameKeys(before, original.map(token => token.key))) fail('目标评论在合并前已发生变化');
    let mergeError;
    state.nativeMergeAttempted = true;
    try { target.merge(source); } catch (error) { mergeError = error; }
    if (!mergeError && nativeNote(id(source)) && source.parentNote) source.removeFromParent();
    const after = raw(target);
    if (!sameKeys(after.slice(0, before.length), original.map(token => token.key))) fail('原生合并修改了目标原内容');
    state.tokens = original.concat(after.slice(before.length).map((comment, index) => ({ kind: 'new', key: key(comment), serial: index })));
    if (mergeError) throw mergeError;
    const extra = after.length - before.length - sourceCommentKeys.length;
    if (extra !== 0 && extra !== 1) fail('原生合并返回的评论数量异常');
    if (sourceHasExcerpt && extra !== 1) fail('来源主摘录未出现在合并结果中');
    if (extra === 1) {
      const shell = after[before.length];
      if (text(shell.type) !== 'LinkNote' || normId(shell.noteid || shell.noteId) !== normId(id(source))) fail('原生合并摘录来源无法核验');
    }
    if (sourceCommentKeys.some((fingerprint, index) => fingerprint !== contentKey(after[before.length + extra + index]))) fail('原生合并未完整保留来源评论');
    state.tokens.slice(before.length).forEach((token, index) => { token.destination = index < extra ? '摘录' : plan.destinations[index - extra]; });
    for (let index = state.tokens.length - 1; index >= before.length; index--) {
      if (state.tokens[index].destination !== null) continue;
      const comment = raw(target)[index];
      if (text(comment.type) === 'LinkNote' && (comment.q_htext || comment.q_hpic || comment.q_hblank)) fail('新增摘录链接可能拥有底层卡片，不能安全删除');
      const expected = state.tokens.slice(); expected.splice(index, 1);
      target.removeCommentByIndex(index);
      if (!sameKeys(raw(target), expected.map(token => token.key))) fail('新增字段内容移除结果无法核验');
      state.tokens = expected;
    }
    const ordered = buildOrder(original, state.tokens.slice(before.length), plan.targetFields, toBottom);
    // Without IDs, an identical old/new comment swap cannot be verified. Refuse before reordering.
    const oldKeys = new Set(original.map(token => token.key));
    if (state.tokens.slice(before.length).some(token => oldKeys.has(token.key))) fail('重复评论缺少可区分标识');
    const destinations = state.tokens.map(token => ordered.indexOf(token));
    let sortError;
    try { target.sortCommentsByNewIndices(destinations); } catch (error) { sortError = error; }
    state.tokens = reconcileTokens(target, state.tokens);
    if (sortError) throw sortError;
    if (state.tokens.some((token, index) => token !== ordered[index])) fail('新增内容未移动到指定字段');
  }
  function checkedIndex(Template, note, options) {
    const result = Template.syncFinalMakeCardIndex(note, { showErrorHUD: false, publishPatch: false, ...options });
    if (!result || result.success !== true) fail(`卡片索引保存失败：${result && result.error || id(note)}`);
    return result;
  }
  function sourceIsRetired(sourceId, targetId, topicId) {
    const source = nativeNote(sourceId);
    if (!source) return true; // Native merge consumes plain notes without a main excerpt.
    if (normId(id(source)) !== normId(sourceId)) fail('来源卡片原生身份无法核验');
    if (normId(source.groupNoteId) === normId(targetId)) return true;
    if (typeof source.realGroupNoteIdForTopicId === 'function' && topicId) {
      return normId(source.realGroupNoteIdForTopicId(topicId)) === normId(targetId);
    }
    return false;
  }
  function makeReceipt(Template, sourceId, targetId, migration, topicId, changedIncomingIds, sourceSnapshot, targetSnapshot) {
    return {
      sourceNoteId: sourceId, targetNoteId: targetId, pinMigration: migration,
      isSourceActive() {
        if (sourceIsRetired(sourceId, targetId, topicId)) return false;
        return snapshotTree(sourceId) === sourceSnapshot && snapshotTree(targetId) === targetSnapshot;
      },
      onStateReconciled(direction) {
        const target = MNNote.new(checkedNativeNote(targetId), false);
        if (!target) fail('撤销后的目标卡片无法读取');
        if (direction === 'restored') {
          const source = MNNote.new(checkedNativeNote(sourceId), false);
          if (!source) fail('撤销后的来源卡片无法读取');
          checkedIndex(Template, source, {});
          checkedIndex(Template, target, {});
        } else if (direction === 'merged') checkedIndex(Template, target, { staleIds: [sourceId] });
        else fail('未知的合并索引恢复方向');
        for (const noteId of changedIncomingIds) {
          const note = MNNote.new(checkedNativeNote(noteId), false);
          if (!note) fail('引用卡片无法读取，索引恢复未完成');
          checkedIndex(Template, note, {});
        }
      },
    };
  }
  function run(Template, target, source, options = {}, legacyCallback) {
    guardRelation(target, source);
    const intermediate = !!(Template.isIntermediateKnowledge && Template.isIntermediateKnowledge(source));
    const pinnerPresent = !!resolvePinMigrationAPI();
    if (!options._preparedMerge && !intermediate && !Array.from(source.childNotes || []).length && !pinnerPresent && typeof legacyCallback === 'function') {
      return legacyCallback(target, source, options);
    }
    checkedNativeNote(id(source)); checkedNativeNote(id(target));
    if (text(source.groupNoteId) && normId(source.groupNoteId) !== normId(id(source))) fail('来源卡片已作为其他卡片的摘录保留，不能再次合并该来源');
    for (const [note, names] of [[source, ['addChild', 'removeFromParent']], [target, ['merge', 'sortCommentsByNewIndices', 'removeCommentByIndex', 'addChild']]]) {
      if (names.some(name => typeof note[name] !== 'function')) fail('当前宿主缺少安全合并所需的接口');
    }
    const prepared = options._preparedMerge ? consumePrepared(Template, target, source, options._preparedMerge) : null;
    if (prepared && prepared.optionsKey !== planningOptionsKey(options)) fail('合并准备选项已经变化，请重新准备');
    const plan = prepared ? prepared.plan : planSource(Template, target, source, options, intermediate);
    const sourceSnapshot = prepared ? prepared.sourceSnapshot : snapshotTree(id(source));
    const targetSnapshot = prepared ? prepared.targetSnapshot : snapshotTree(id(target));
    const migration = pinMigration(source, target);
    const originalTitle = text(target.noteTitle);
    const originalTags = Array.from(target.tags || []).map(text);
    const original = raw(target).map((comment, index) => ({ kind: 'old', originalIndex: index, key: key(comment) }));
    const sourceChildren = Array.from(source.childNotes || []);
    const targetChildren = Array.from(target.childNotes || []).map(id);
    const mergedChildren = targetChildren.filter(childId => normId(childId) !== normId(id(source))).concat(sourceChildren.map(id));
    const incoming = incomingPlan(Template, source, target);
    const state = { tokens: null, nativeMergeAttempted: false };
    const warnings = [];
    let pinAttempted = false, childrenAttempted = false, failure = null, indexResult;
    try {
      childrenAttempted = true;
      for (const child of sourceChildren) target.addChild(child);
      assertNativeChildren(id(source), []);
      assertNativeChildren(id(target), targetChildren.concat(sourceChildren.map(id)));
      pinAttempted = true;
      checkedPin(migration, 'apply'); checkedPin(migration, 'verify');
      appendAndArrange(target, source, plan, original, state, options.toBottom !== false);
      target.noteTitle = originalTitle;
      if (!intermediate && options.removeTitle !== true) Template.mergeTitleLinkWords(target, source);
      const mergedTags = Array.from(target.tags || []).map(text);
      if (originalTags.some(tag => !mergedTags.includes(tag))) fail('原生合并丢失了目标原有标签');
      for (const change of incoming) {
        if (id(change.note) === id(target)) change.index = state.tokens.findIndex(token => token.kind === 'old' && token.originalIndex === change.originalIndex);
        applyIncoming(Template, change);
        if (id(change.note) === id(target)) state.tokens[change.index].key = change.afterKey;
      }
      const parentLinked = new Set();
      for (const change of incoming) {
        if (!change.parentRelationship || parentLinked.has(id(change.note))) continue;
        if (typeof Template.linkParentNote !== 'function') fail('当前环境无法重建子卡片所属关系');
        parentLinked.add(id(change.note));
        Template.linkParentNote(change.note);
        const parentField = Template.findFieldObjectByNormalizedName(change.note, '所属');
        const comments = managed(Template, change.note);
        const linked = parentField && parentField.excludingFieldBlockIndexArr.some(index => {
          const info = Template.getStandaloneNoteLinkInfoFromComment(comments[index]);
          return info && normId(info.noteId) === normId(id(target));
        });
        if (!linked) fail('子卡片所属关系重建未通过核验');
        change.applied = true;
      }
      checkedPin(migration, 'verify');
      assertNativeChildren(id(target), mergedChildren);
      indexResult = checkedIndex(Template, target, { staleIds: [id(source)] });
      const indexedIncomingIds = new Set([id(target), id(source)]);
      for (const change of incoming) {
        if (!(change.applied || change.afterKey) || indexedIncomingIds.has(id(change.note))) continue;
        indexedIncomingIds.add(id(change.note));
        checkedIndex(Template, MNNote.new(checkedNativeNote(id(change.note)), false), {});
      }
    } catch (error) {
      if (state.nativeMergeAttempted) {
        // Native merge owns A as excerpt backing. Removing appended LinkNotes or reversing
        // children/Pins can destroy that ownership. Recovery must use the native undo group.
        failure = error;
      } else {
        const rollbackErrors = [];
        try {
          checkedNativeNote(id(source));
          if (childrenAttempted) sourceChildren.forEach(child => source.addChild(child));
          assertNativeChildren(id(source), sourceChildren.map(id));
          assertNativeChildren(id(target), targetChildren);
        } catch (problem) { rollbackErrors.push(problem.message || String(problem)); }
        if (pinAttempted) {
          try { checkedNativeNote(id(source)); checkedPin(migration, 'rollback'); }
          catch (problem) { rollbackErrors.push(problem.message || String(problem)); }
        }
        const result = new Error(`${error.message || error}${rollbackErrors.length ? `；部分恢复失败：${rollbackErrors.join('；')}` : '；来源卡片及原有内容已保留'}`);
        result.mergeRollbackIncomplete = rollbackErrors.length > 0;
        throw result;
      }
    }
    try { checkedPin(migration, 'commit'); } catch (error) { warnings.push(`Pin 刷新失败：${error.message || error}`); }
    try {
      if (options.refreshTarget !== false && typeof target.refresh === 'function') target.refresh();
      incoming.forEach(change => { if (id(change.note) !== id(target) && typeof change.note.refresh === 'function') change.note.refresh(); });
      if (!failure && options.focusAfterMerge !== false && typeof target.focusInMindMap === 'function') target.focusInMindMap(0.4);
      if (indexResult && typeof Template.publishFinalMakeCardIndexPatch === 'function') Template.publishFinalMakeCardIndexPatch(indexResult, { indexSource: indexResult.indexSource, staleIds: [id(source)] });
    } catch (error) { warnings.push(`合并后刷新失败：${error.message || error}`); }
    const topicId = text(target.notebookId || (target.note && target.note.notebookId) || (typeof MNUtil !== 'undefined' && MNUtil.currentNotebookId));
    const changedIncomingIds = Array.from(new Set(incoming.filter(change => change.applied || change.afterKey).map(change => id(change.note))))
      .filter(noteId => noteId !== id(source) && noteId !== id(target));
    const receipt = makeReceipt(Template, id(source), id(target), migration, topicId, changedIncomingIds, sourceSnapshot, targetSnapshot);
    const result = { success: false, committed: true, requiresUndo: !!failure, preparedBeforeUndoGroup: !!prepared,
      pendingVerification: true, sourceRemovalUnverified: true, sourceRetirementUnverified: true,
      postcommitStructureUnverified: true, sourceNoteId: id(source), targetNoteId: id(target), warnings, _undoReceipt: receipt,
      error: failure ? `原生合并后处理失败，请执行原生撤销并核验卡片及 Pin：${failure.message || failure}` : '原生合并已提交，需在撤销分组结束后核验来源摘录归属' };
    pendingRemovals.set(result, { receipt, topicId, targetChildren: mergedChildren, failure });
    if ((migration || typeof receipt.onStateReconciled === 'function') && !receipts.includes(receipt)) receipts.push(receipt);
    return result;
  }
  // Compatibility name: verify retirement into B, never physical deletion of A.
  // Call after the outer native undo group has returned, or retry on a later turn.
  function finalizeSourceRemoval(result) {
    if (!result || !result.pendingVerification) return result;
    const pending = pendingRemovals.get(result);
    if (!pending) fail('合并归属核验记录不可用，请检查原生卡片状态');
    try {
      if (!sourceIsRetired(result.sourceNoteId, result.targetNoteId, pending.topicId)) {
        result.sourceRemovalUnverified = result.sourceRetirementUnverified = true;
        if (!result.requiresUndo) result.error = '来源摘录归属尚未核验，请在撤销分组结束后重试核验；子树和 Pin 保持指向目标卡片';
        return result;
      }
      result.sourceRemovalUnverified = result.sourceRetirementUnverified = false;
      // Failed post-merge work still needs native undo; registering this receipt only
      // after native retirement is observed prevents layout refresh from resembling undo.
      if ((pending.receipt.pinMigration || typeof pending.receipt.onStateReconciled === 'function') && !receipts.includes(pending.receipt)) receipts.push(pending.receipt);
      result._undoReceipt = pending.receipt;
      if (pending.failure) {
        result.pendingVerification = false;
        pendingRemovals.delete(result);
        return result;
      }
      assertNativeChildren(result.targetNoteId, pending.targetChildren);
      result.postcommitStructureUnverified = false;
      checkedPin(pending.receipt.pinMigration, 'verify');
    } catch (error) {
      if (!result.requiresUndo) result.error = `合并归属尚未核验，请稍后重试核验：${error.message || error}；子树和 Pin 不自动迁回来源卡片`;
      return result;
    }
    result.success = true;
    result.pendingVerification = false;
    delete result.error;
    pendingRemovals.delete(result);
    return result;
  }
  function registerExternalUndoReceipt(receipt) {
    if (!receipt || !receipt.sourceNoteId || !receipt.targetNoteId || receipt.sourceNoteId === receipt.targetNoteId ||
        !receipt.pinMigration || typeof receipt.isSourceActive !== 'function') throw new Error('外部合并撤销记录无效');
    if (!receipts.includes(receipt)) receipts.push(receipt);
    return receipt;
  }
  return { run, prepareBeforeUndoGroup, finalizeSourceRemoval, resolvePinMigrationAPI, registerExternalUndoReceipt, getUndoReceipts: () => receipts.slice(), forgetUndoReceipt: receipt => { const index = receipts.indexOf(receipt); if (index >= 0) receipts.splice(index, 1); } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = KnowledgeBaseMergeTransaction;
