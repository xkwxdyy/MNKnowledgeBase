(function(global) {
  'use strict';

  function getNodeList(model) {
    const source = model || {};
    const nodes = [];
    const seen = new Set();
    [source.rootQuestion]
      .concat(Array.isArray(source.ideas) ? source.ideas : [])
      .concat(Array.isArray(source.summaries) ? source.summaries : [])
      .concat([source.entry])
      .forEach((node) => {
        const noteId = node && node.noteId ? String(node.noteId) : '';
        if (!noteId || seen.has(noteId)) return;
        seen.add(noteId);
        nodes.push(node);
      });
    return nodes;
  }

  function commentKey(noteId, index) {
    return `${String(noteId || '')}:${Number(index)}`;
  }

  function getEditableComments(model) {
    const comments = [];
    getNodeList(model).forEach((node) => {
      (Array.isArray(node.fields) ? node.fields : []).forEach((field) => {
        (Array.isArray(field.comments) ? field.comments : []).forEach((comment) => {
          if (!comment || comment.editable !== true) return;
          comments.push({ node, field, comment });
        });
      });
    });
    return comments;
  }

  function collectUpdates(model, drafts) {
    const updates = [];
    getEditableComments(model).forEach(({ node, comment }) => {
      const key = commentKey(node.noteId, comment.index);
      if (!drafts.has(key)) return;
      const text = String(drafts.get(key));
      const baseText = String(comment.text || '');
      if (text === baseText) return;
      updates.push({
        noteId: String(node.noteId),
        index: Number(comment.index),
        baseRevision: String(node.revision || ''),
        baseText,
        text,
        markdown: comment.markdown === true,
      });
    });
    return updates;
  }

  function makeRequestId(prefix) {
    return `${prefix || 'research'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  global.ResearchWorkbenchCore = {
    getNodeList,
    getEditableComments,
    commentKey,
    collectUpdates,
    makeRequestId,
  };
})(window);
