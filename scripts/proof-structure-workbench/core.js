(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProofStructureCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  const hierarchyTypes = ['goal', 'level1', 'level2', 'level3', 'level4', 'level5'];
  const semanticTypes = ['method', 'idea', 'key', 'question', 'alert', 'danger', 'case', 'step', 'check', 'sketch', 'remark'];
  const knownHtmlMDTypes = new Set(hierarchyTypes.concat(semanticTypes));
  const structuralTypes = new Set(hierarchyTypes.concat(['step']));
  const typeIcons = {
    root: '▣', goal: '◎', level1: '1', level2: '2', level3: '3', level4: '4', level5: '5',
    method: 'M', idea: 'I', key: 'K', question: '?', alert: '!', danger: '!!', case: 'C', step: 'S',
    check: '✓', sketch: 'P', remark: 'R', textComment: 'T', markdownComment: 'T',
    mergedTextComment: '▤', mergedMarkdownComment: '▤', mergedImageComment: '▧', mergedImageCommentWithDrawing: '▧',
    linkComment: '↗', drawingComment: '✎', imageComment: '▧',
    imageCommentWithDrawing: '▧', audioComment: '▶', blankTextComment: '∅', unknown: '?',
  };

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function stripHtml(value) {
    return text(value)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(?:nbsp|#160);/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanHtmlMDContent(value) {
    // Preserve paragraphs, Markdown and TeX in the reading body. Only the
    // navigation title is flattened; flattening here used to destroy proofs.
    let content = text(value).trim();
    ['❗❗❗', '🚩', '▸', '▪', '•', '·', '🔑', '⚠️', '📝', '🎯', '❓', '💡', '✨', '🔍', '✏️', '📋', '👣']
      .forEach((prefix) => {
        if (content.startsWith(prefix)) content = content.slice(prefix.length).trim();
      });
    ['思路：', '方法：', 'CHECK: ', 'CHECK', 'SKETCH: ', 'SKETCH'].forEach((prefix) => {
      if (content.startsWith(prefix)) content = content.slice(prefix.length).trim();
    });
    return content;
  }

  function parseHtmlMD(comment) {
    if (!comment) return null;
    const raw = text(comment.text).trim().replace(/^-\s+/, '');
    const match = raw.match(/^<span\s+[^>]*id=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>$/i);
    const explicitType = text(comment.htmlMarkdownType).trim();
    if (explicitType) {
      return {
        type: explicitType,
        content: cleanHtmlMDContent(match && match[1].trim() === explicitType
          ? match[2] : (comment.htmlMarkdownContent || comment.text)),
        known: knownHtmlMDTypes.has(explicitType),
      };
    }
    if (!match) return null;
    const type = text(match[1]).trim();
    return { type, content: cleanHtmlMDContent(match[2]), known: knownHtmlMDTypes.has(type) };
  }

  function describeComment(comment) {
    const source = comment || {};
    const htmlMD = parseHtmlMD(source);
    const detailedType = text(source.detailedType || source.type || 'unknownComment');
    const item = {
      id: `comment-${Number(source.index)}`,
      sourceIndex: Number(source.index),
      originalType: text(source.originalType),
      detailedType,
      htmlMDType: htmlMD ? htmlMD.type : '',
      rawText: text(source.text || source.htmlText),
      body: htmlMD ? htmlMD.content : text(source.htmlText || source.text),
      markdown: !!source.markdown || /[Mm]arkdownComment/.test(detailedType) || !!htmlMD,
      imageBase64: text(source.imageBase64),
      imageMimeType: text(source.imageMimeType || 'image/jpeg'),
      drawingPreviewDataURI: text(source.drawingPreviewDataURI),
      drawingPreviewPending: source.drawingPreviewPending === true,
      drawingPreviewError: text(source.drawingPreviewError),
      linkedNoteId: text(source.linkedNoteId),
      linkedNoteTitle: text(source.linkedNoteTitle),
      title: '',
      preview: '',
      icon: typeIcons[htmlMD && htmlMD.type] || typeIcons[detailedType] || typeIcons.unknown,
      role: 'content',
      decision: 'content',
      reason: '按原始顺序归入最近的 step；没有 step 时归入最近的 level。',
      diagnostics: [],
    };

    if (htmlMD && htmlMD.known) {
      item.title = stripHtml(htmlMD.content) || `${htmlMD.type}（空内容）`;
      item.preview = `HtmlMD · ${htmlMD.type}`;
      if (hierarchyTypes.includes(htmlMD.type)) {
        item.role = htmlMD.type === 'goal' ? 'goal' : 'level';
        item.decision = 'structured';
        item.reason = htmlMD.type === 'goal'
          ? 'goal 位于 level1 之上，作为当前字段的总目标。'
          : `${htmlMD.type} 的数字决定树深度；父节点取最近的更浅 level。`;
      } else if (htmlMD.type === 'step') {
        item.role = 'step';
        item.decision = 'structured';
        item.reason = 'step 是当前 level 的直接子节点；连续 step 互为同级。';
      } else {
        item.role = 'semantic';
        item.reason = '该 HtmlMD 类型提供内容语义，但不改变 level / step 树结构。';
      }
      return item;
    }

    if (htmlMD && !htmlMD.known) {
      item.title = stripHtml(htmlMD.content) || '未识别 HtmlMD';
      item.preview = `未知 span id="${htmlMD.type || '(空)'}"`;
      item.role = 'unknown-htmlmd';
      item.decision = 'degraded';
      item.reason = '形态像 HtmlMD，但类型未注册；只作为最近结构节点的内容。';
      item.diagnostics.push('UNKNOWN_HTMLMD_TYPE');
      return item;
    }

    const titles = {
      textComment: stripHtml(source.text) || '普通文本',
      markdownComment: stripHtml(source.text) || 'Markdown 文本',
      mergedTextComment: stripHtml(source.text) || '合并文本摘录',
      mergedMarkdownComment: stripHtml(source.text) || '合并 Markdown 摘录',
      mergedImageComment: '图片摘录',
      mergedImageCommentWithDrawing: '图片摘录与手写',
      linkComment: source.linkedNoteTitle || '卡片链接',
      drawingComment: '纯手写评论',
      imageComment: '图片评论',
      imageCommentWithDrawing: '图片 + 手写评论',
      audioComment: '音频评论',
      blankTextComment: '空白评论',
    };
    item.title = text(titles[detailedType] || stripHtml(source.text) || detailedType || '未知评论');
    item.preview = detailedType;
    if (detailedType === 'linkComment') {
      item.role = 'reference';
      item.reason = '链接保留目标卡与回源能力，并归入最近结构节点。';
    } else if (source.imageBase64 || source.drawingHash || source.drawingPreviewDataURI ||
      ['drawingComment', 'imageComment', 'imageCommentWithDrawing', 'mergedImageComment', 'mergedImageCommentWithDrawing'].includes(detailedType)) {
      item.role = 'media';
      item.reason = '手写或图片保持媒体身份，并归入最近结构节点。';
    } else if (detailedType === 'audioComment') {
      item.role = 'media';
      item.decision = 'degraded';
      item.reason = '只保留音频身份，不伪造转写或结构。';
      item.diagnostics.push('AUDIO_TEXT_UNAVAILABLE');
    } else if (!stripHtml(source.text || source.htmlText)) {
      item.role = 'blank';
      item.decision = 'ignored';
      item.reason = '空白评论保留索引用于审计，但不产生结构节点。';
      item.diagnostics.push('BLANK_COMMENT');
    }
    return item;
  }

  function makeRoot(payload, items) {
    const field = payload.field || {};
    return {
      id: 'proof-root',
      sourceIndex: Number(field.index),
      originalType: 'HtmlNote',
      detailedType: 'HtmlComment',
      htmlMDType: '',
      rawText: text(field.text),
      title: text(field.name || '证明'),
      preview: `${items.length} 条字段内容`,
      icon: typeIcons.root,
      role: 'root',
      decision: 'boundary',
      reason: '字段头只划定范围；树结构来自字段内的 goal、level 与 step。',
      diagnostics: [],
      evidence: [],
      children: [],
    };
  }

  function buildProofTree(payload, items) {
    const root = makeRoot(payload, items);
    const levelStack = [];
    let currentGoal = null;
    let currentLevel = null;
    let currentStep = null;

    items.forEach((item) => {
      if (item.htmlMDType === 'goal') {
        const node = Object.assign({}, item, { evidence: [], children: [] });
        root.children.push(node);
        currentGoal = node;
        currentLevel = null;
        currentStep = null;
        levelStack.length = 0;
        return;
      }
      if (/^level[1-5]$/.test(item.htmlMDType)) {
        const rank = Number(item.htmlMDType.slice(5));
        let parent = currentGoal || root;
        for (let depth = rank - 1; depth >= 1; depth -= 1) {
          if (levelStack[depth]) {
            parent = levelStack[depth];
            break;
          }
        }
        const node = Object.assign({}, item, { rank, evidence: [], children: [] });
        if (rank > 1 && !levelStack[rank - 1]) {
          node.diagnostics.push('LEVEL_GAP');
          node.reason += ' 检测到跳级，已挂到最近可用祖先。';
        }
        parent.children.push(node);
        levelStack[rank] = node;
        levelStack.length = rank + 1;
        currentLevel = node;
        currentStep = null;
        return;
      }
      if (item.htmlMDType === 'step') {
        const parent = currentLevel || currentGoal || root;
        const node = Object.assign({}, item, { evidence: [], children: [] });
        if (!currentLevel) {
          node.diagnostics.push('STEP_WITHOUT_LEVEL');
          node.reason += ' 当前没有 level，因此降级挂在字段根节点。';
        }
        parent.children.push(node);
        currentStep = node;
        return;
      }
      (currentStep || currentLevel || currentGoal || root).evidence.push(item);
    });
    return root;
  }

  function flatten(tree, parent, depth, result) {
    const output = result || [];
    const level = Number(depth || 0);
    if (!tree) return output;
    output.push({ node: tree, parent: parent || null, depth: level });
    (tree.children || []).forEach((child) => flatten(child, tree, level + 1, output));
    return output;
  }

  function parsePayload(payload) {
    const comments = Array.isArray(payload && payload.comments) ? payload.comments : [];
    const items = comments.map(describeComment);
    const tree = buildProofTree(payload || {}, items);
    const itemById = new Map(items.map(item => [item.id, item]));
    flatten(tree).forEach(({ node, parent, depth }) => {
      const original = itemById.get(node.id);
      if (original) Object.assign(original, { parentId: parent.id, depth, diagnostics: node.diagnostics });
      node.evidence.forEach(item => Object.assign(item, { parentId: node.id, depth: depth + 1 }));
    });
    return {
      items,
      tree,
      structuralCount: items.filter((item) => structuralTypes.has(item.htmlMDType)).length,
      contentCount: items.filter((item) => !structuralTypes.has(item.htmlMDType) && item.decision !== 'ignored').length,
      diagnosticCount: items.reduce((sum, item) => sum + item.diagnostics.length, 0),
    };
  }

  return {
    hierarchyTypes,
    structuralTypes,
    typeIcons,
    stripHtml,
    parseHtmlMD,
    describeComment,
    buildProofTree,
    flatten,
    parsePayload,
  };
});
