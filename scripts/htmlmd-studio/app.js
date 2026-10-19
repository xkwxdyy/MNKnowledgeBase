(function() {
  const COMMENT_SCHEME = 'mnknowledgebase-comment';

  const BUILTIN_TYPES = [
    { id: 'remark', label: '备注', icon: '📝', prefix: '', baseType: 'remark' },
    { id: 'method', label: '方法', icon: '✨', prefix: '方法：', baseType: 'method' },
    { id: 'key', label: '关键', icon: '🔑', prefix: '', baseType: 'key' },
    { id: 'question', label: '问题', icon: '❓', prefix: '', baseType: 'question' },
    { id: 'alert', label: '警告', icon: '⚠️', prefix: '', baseType: 'alert' },
    { id: 'danger', label: '危险', icon: '❗❗❗', prefix: '', baseType: 'danger' },
    { id: 'case', label: '案例', icon: '📋', prefix: '', baseType: 'case' },
    { id: 'step', label: '步骤', icon: '👣', prefix: '', baseType: 'step' },
    { id: 'goal', label: '目标', icon: '🎯', prefix: '', baseType: 'goal', isLevel: true },
    { id: 'level1', label: '一级', icon: '🚩', prefix: '', baseType: 'level1', isLevel: true },
    { id: 'level2', label: '二级', icon: '▸', prefix: '', baseType: 'level2', isLevel: true },
    { id: 'level3', label: '三级', icon: '▪', prefix: '', baseType: 'level3', isLevel: true },
    { id: 'level4', label: '四级', icon: '•', prefix: '', baseType: 'level4', isLevel: true },
    { id: 'level5', label: '五级', icon: '·', prefix: '', baseType: 'level5', isLevel: true },
    { id: 'check', label: '检查', icon: '🔍', prefix: 'CHECK', baseType: 'check' },
    { id: 'sketch', label: '草稿', icon: '✏️', prefix: 'SKETCH', baseType: 'sketch' },
    { id: 'idea', label: '思路', icon: '💡', prefix: '思路：', baseType: 'idea' },
  ];

  const BUILTIN_STYLE_MAP = {
    danger: 'font-weight:700;color:#6A0C0C;background:#FFC9C9;border-left:6px solid #A93226;font-size:1em;padding:8px 15px;display:inline-block;transform:skew(-3deg);box-shadow:2px 2px 5px rgba(0,0,0,0.1);',
    alert: 'background:#FFF;color:#FF8C5A;border:2px solid currentColor;border-radius:3px;padding:6px 12px;font-weight:600;box-shadow:0 1px 3px rgba(255,140,90,0.2);display:inline-block;',
    key: 'color:#B33F00;background:#FFF1E6;border-left:6px solid #FF6B35;padding:16px 12px 1px;line-height:2;position:relative;top:6px;display:inline-block;font-family:monospace;margin-top:-2px;',
    level1: 'font-weight:600;color:#1E40AF;background:linear-gradient(15deg,#EFF6FF 30%,#DBEAFE);border:2px solid #3B82F6;border-radius:12px;padding:10px 18px;display:inline-block;box-shadow:2px 2px 0px #BFDBFE,4px 4px 8px rgba(59,130,246,0.12);position:relative;margin:4px 8px;',
    level2: 'font-weight:600;color:#4F79A3;background:linear-gradient(90deg,#F3E5F5 50%,#ede0f7);font-size:1.1em;padding:6px 12px;border-left:4px solid #7A9DB7;transform:skew(-1.5deg);box-shadow:1px 1px 3px rgba(0,0,0,0.05);margin-left:40px;position:relative;',
    level3: 'font-weight:500;color:#7A9DB7;background:#E8F0FE;padding:4px 10px;border-radius:12px;border:1px solid #B3D4FF;font-size:0.95em;margin-left:80px;position:relative;',
    level4: 'font-weight:400;color:#9DB7CA;background:#F8FBFF;padding:3px 8px;border-left:2px dashed #B3D4FF;font-size:0.9em;margin-left:120px;position:relative;',
    level5: 'font-weight:300;color:#B3D4FF;background:#FFFFFF;padding:2px 6px;border-radius:8px;border:1px dashed #B3D4FF;font-size:0.85em;margin-left:160px;position:relative;',
    remark: 'background:#F5E6C9;color:#6d4c41;display:inline-block;border-left:5px solid #D4AF37;padding:2px 8px 3px 12px;border-radius:0 4px 4px 0;box-shadow:1px 1px 3px rgba(0,0,0,0.08);margin:0 2px;line-height:1.3;vertical-align:baseline;position:relative;',
    goal: 'font-weight:900;font-size:0.7em;color:#8B2635;background:linear-gradient(135deg,#F87171 0%,#FCA5A5 25%,#FECACA 60%,#FEF2F2 100%);padding:12px 24px;border-radius:50px;display:inline-block;position:relative;box-shadow:0 4px 8px rgba(248,113,113,0.25),inset 0 1px 0 rgba(255,255,255,0.5);text-shadow:0 1px 1px rgba(255,255,255,0.4);border:2px solid rgba(248,113,113,0.4);',
    question: 'font-weight:700;color:#3D1A67;background:linear-gradient(15deg,#F8F4FF 30%,#F1E8FF);border:3px double #8B5CF6;border-radius:16px 4px 16px 4px;padding:14px 22px;display:inline-block;box-shadow:4px 4px 0px #DDD6FE,8px 8px 12px rgba(99,102,241,0.12);position:relative;margin:4px 8px;',
    idea: 'font-weight:600;color:#4A4EB2;background:linear-gradient(15deg,#F0F4FF 30%,#E6EDFF);border:2px dashed #7B7FD1;border-radius:12px;padding:10px 18px;display:inline-block;box-shadow:0 0 0 2px rgba(123,127,209,0.2),inset 0 0 10px rgba(123,127,209,0.1);position:relative;margin:4px 8px;',
    method: 'display:block;font-weight:700;color:#1B4332;background:linear-gradient(135deg,#74C69D 0%,#95D5B2 25%,#C7F0DB 60%,#E8F5E8 100%);font-size:1.3em;padding:12px 20px 12px 24px;border-left:10px solid #2D6A4F;margin:0 0 12px 0;border-radius:0 6px 6px 0;box-shadow:0 4px 12px rgba(116,198,157,0.2),inset 0 1px 0 rgba(255,255,255,0.5);text-shadow:0 1px 1px rgba(255,255,255,0.4);position:relative;',
    check: 'font-weight:600;color:#34A853;background:#E6F7EE;border:2px solid #34A853;border-radius:4px;padding:4px 8px;display:inline-block;box-shadow:0 1px 2px rgba(52,168,83,0.2);margin:0 2px;line-height:1.3;vertical-align:baseline;position:relative;',
    sketch: 'background:transparent;color:#5D4037;display:inline-block;border-bottom:2px dotted #FF9800;padding:0 4px 2px;margin:0 2px;line-height:1.2;vertical-align:baseline;position:relative;font-size:0.9em;font-style:italic;',
    case: 'font-weight:600;color:#2563EB;background:linear-gradient(135deg,#EFF6FF,#DBEAFE);border:2px solid #3B82F6;border-radius:8px;padding:8px 16px;display:inline-block;box-shadow:0 2px 4px rgba(37,99,235,0.2);margin:4px 0;',
    step: 'font-weight:500;color:#059669;background:#ECFDF5;border-left:4px solid #10B981;padding:6px 12px;display:inline-block;border-radius:0 4px 4px 0;margin:4px 0;',
  };

  const TONE_OPTIONS = [
    { value: 'default', label: '默认' },
    { value: 'slate', label: '石板灰' },
    { value: 'blue', label: '理性蓝' },
    { value: 'green', label: '知识绿' },
    { value: 'orange', label: '提醒橙' },
    { value: 'red', label: '强调红' },
    { value: 'purple', label: '推导紫' },
  ];
  const SIZE_OPTIONS = [
    { value: 'default', label: '默认' },
    { value: 's', label: 'S' },
    { value: 'm', label: 'M' },
    { value: 'l', label: 'L' },
    { value: 'xl', label: 'XL' },
  ];
  const HIGHLIGHT_OPTIONS = [
    { value: 'default', label: '默认' },
    { value: 'none', label: '无' },
    { value: 'yellow', label: '浅黄' },
    { value: 'blue', label: '浅蓝' },
    { value: 'green', label: '浅绿' },
    { value: 'pink', label: '浅粉' },
  ];
  const EMPHASIS_OPTIONS = [
    { value: 'default', label: '默认' },
    { value: 'none', label: '无' },
    { value: 'bold', label: '加粗' },
    { value: 'leftbar', label: '粗左边框' },
    { value: 'outline', label: '描边' },
    { value: 'pill', label: '胶囊块' },
  ];

  const LEVEL_ORDER = ['goal', 'level1', 'level2', 'level3', 'level4', 'level5'];
  const PRIMARY_TYPE_IDS = [
    'remark',
    'key',
    'question',
    'idea',
    'method',
    'sketch',
    'alert',
    'case',
    'step',
  ];
  const EMPTY_CONTENT_TYPES = new Set(['check', 'sketch']);
  const STYLE_PARSE_CACHE = {};
  const TONE_VALUE_MAP = {
    slate: '#334155',
    blue: '#1d4ed8',
    green: '#047857',
    orange: '#c2410c',
    red: '#b91c1c',
    purple: '#7c3aed',
  };
  const SIZE_VALUE_MAP = {
    s: '0.9em',
    m: '1em',
    l: '1.15em',
    xl: '1.3em',
  };
  const HIGHLIGHT_VALUE_MAP = {
    none: 'none',
    yellow: '#fff4bf',
    blue: '#dbeafe',
    green: '#dcfce7',
    pink: '#fce7f3',
  };
  const APPEARANCE_LABELS = {
    tone: {
      slate: '石板灰',
      blue: '理性蓝',
      green: '知识绿',
      orange: '提醒橙',
      red: '强调红',
      purple: '推导紫',
    },
    size: {
      s: 'S',
      m: 'M',
      l: 'L',
      xl: 'XL',
    },
    highlight: {
      none: '无高亮',
      yellow: '浅黄',
      blue: '浅蓝',
      green: '浅绿',
      pink: '浅粉',
    },
    emphasis: {
      none: '无强调',
      bold: '加粗',
      leftbar: '粗左边框',
      outline: '描边',
      pill: '胶囊块',
    },
  };

  const dom = {};
  const state = {
    noteId: '',
    noteTitle: '',
    comments: [],
    candidates: [],
    selectedIndices: new Set(),
    activeIndex: null,
    workflowMode: 'new',
    uiContext: {},
    embeddedTypes: [],
    drafts: {
      new: null,
      edit: null,
    },
  };

  function createDefaultDraft() {
    return {
      typeId: 'remark',
      content: '',
      leadingDash: false,
      preserveLegacy: false,
      legacyStyle: '',
      overrides: {
        tone: 'default',
        size: 'default',
        highlight: 'default',
        emphasis: 'default',
      },
    };
  }

  function activeDraft() {
    const draftKey = state.workflowMode === 'edit' ? 'edit' : 'new';
    if (!state.drafts[draftKey]) {
      state.drafts[draftKey] = createDefaultDraft();
    }
    return state.drafts[draftKey];
  }

  function setActiveDraft(nextDraft) {
    const draftKey = state.workflowMode === 'edit' ? 'edit' : 'new';
    state.drafts[draftKey] = {
      ...createDefaultDraft(),
      ...nextDraft,
      overrides: {
        ...createDefaultDraft().overrides,
        ...(nextDraft && nextDraft.overrides ? nextDraft.overrides : {}),
      },
    };
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setupDom() {
    [
      'noteTitle',
      'modeBadge',
      'studioMain',
      'newModeBtn',
      'editModeBtn',
      'candidateCountBadge',
      'candidatePanel',
      'copyMarkupBtn',
      'candidateSummary',
      'candidateList',
      'selectAllBtn',
      'clearSelectionBtn',
      'modeSummary',
      'composerHeading',
      'newDraftBtn',
      'resetOverridesBtn',
      'typePicker',
      'primaryTypeList',
      'secondaryTypeList',
      'moreTypeSummaryLabel',
      'sizeSelect',
      'toneSelect',
      'highlightSelect',
      'emphasisSelect',
      'leadingDashToggle',
      'preserveLegacyToggle',
      'preserveLegacyItem',
      'sourceTextarea',
      'sourceHint',
      'characterCount',
      'batchSection',
      'batchCopy',
      'levelUpBtn',
      'levelDownBtn',
      'applyBtn',
      'appendBtn',
      'applyBatchBtn',
      'previewCanvas',
      'markupOutput',
      'appearanceSummary',
      'selectionStatus',
      'toast',
    ].forEach((id) => {
      dom[id] = byId(id);
    });
  }

  function showToast(message) {
    const text = typeof message === 'string' ? message : String(message || '');
    if (!dom.toast) return;
    dom.toast.textContent = text;
    dom.toast.classList.remove('show');
    window.clearTimeout(showToast._timer);
    void dom.toast.offsetWidth;
    dom.toast.classList.add('show');
    showToast._timer = window.setTimeout(() => {
      dom.toast.classList.remove('show');
    }, 2200);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
  }

  function decodeHtml(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text == null ? '' : String(text);
    return textarea.value;
  }

  function normalizeNoteLinkText(text) {
    return typeof text === 'string' ? text.trim() : '';
  }

  function isPureNoteLinkComment(text) {
    const normalized = normalizeNoteLinkText(text);
    return /^marginnote\d*(?:app)?:\/\/note\/[^)\s]+$/i.test(normalized);
  }

  function stripLeadingDash(text) {
    const raw = typeof text === 'string' ? text : '';
    if (raw.startsWith('- ')) {
      return {
        leadingDash: true,
        cleanText: raw.slice(2),
      };
    }
    return {
      leadingDash: false,
      cleanText: raw,
    };
  }

  function isHtmlMDText(text) {
    return typeof text === 'string' && text.trim().startsWith('<span');
  }

  function looksLikeMarkdown(text, comment) {
    if (Array.isArray(comment && comment.markdownLinks) && comment.markdownLinks.length > 0) return true;
    const raw = typeof text === 'string' ? text : '';
    return /(^|\n)([-*+]\s|\d+\.\s)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`/.test(raw);
  }

  function extractAttrValue(text, attrName) {
    const regex = new RegExp(`${attrName}="([^"]*)"`);
    const match = String(text || '').match(regex);
    return match && match[1] ? decodeHtml(match[1]) : '';
  }

  function normalizeCssValue(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s*,\s*/g, ',')
      .replace(/\s+/g, ' ');
  }

  function splitStyleDeclarations(styleText) {
    const source = String(styleText || '');
    const declarations = [];
    let current = '';
    let depth = 0;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '(') depth += 1;
      if (char === ')') depth = Math.max(0, depth - 1);

      if (char === ';' && depth === 0) {
        if (current.trim()) declarations.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }

    if (current.trim()) declarations.push(current.trim());
    return declarations;
  }

  function parseStyleTextToMap(styleText) {
    const map = {};
    splitStyleDeclarations(styleText).forEach((declaration) => {
      const colonIndex = declaration.indexOf(':');
      if (colonIndex <= 0) return;
      const property = declaration.slice(0, colonIndex).trim().toLowerCase();
      const value = declaration.slice(colonIndex + 1).trim();
      if (!property || !value) return;
      map[property] = value;
    });
    return map;
  }

  function serializeStyleMap(styleMap) {
    return Object.keys(styleMap || {})
      .filter((key) => key && styleMap[key])
      .map((key) => `${key}:${styleMap[key]}`)
      .join(';');
  }

  function cloneStyleMap(styleMap) {
    return Object.keys(styleMap || {}).reduce((result, key) => {
      result[key] = styleMap[key];
      return result;
    }, {});
  }

  function getBaseStyleMap(typeId) {
    const baseType = getTypeDefinition(typeId).baseType || typeId || 'remark';
    if (!STYLE_PARSE_CACHE[baseType]) {
      STYLE_PARSE_CACHE[baseType] = parseStyleTextToMap(BUILTIN_STYLE_MAP[baseType] || BUILTIN_STYLE_MAP.remark);
    }
    return cloneStyleMap(STYLE_PARSE_CACHE[baseType]);
  }

  function removeStyleKeys(styleMap, keys) {
    keys.forEach((key) => {
      delete styleMap[key];
    });
  }

  function resolveOptionByStyleValue(valueMap, cssValue) {
    const normalized = normalizeCssValue(cssValue);
    const matched = Object.keys(valueMap).find((key) => normalizeCssValue(valueMap[key]) === normalized);
    return matched || '';
  }

  function diffStyleMap(baseMap, currentMap) {
    const residue = {};
    Object.keys(currentMap || {}).forEach((key) => {
      const currentValue = normalizeCssValue(currentMap[key]);
      const baseValue = normalizeCssValue(baseMap[key]);
      if (currentValue !== baseValue) {
        residue[key] = currentMap[key];
      }
    });
    return residue;
  }

  function inferOverridesFromStyle(typeId, styleText) {
    const currentMap = parseStyleTextToMap(styleText);
    const baseMap = getBaseStyleMap(typeId);
    const residueMap = diffStyleMap(baseMap, currentMap);
    const overrides = {
      tone: 'default',
      size: 'default',
      highlight: 'default',
      emphasis: 'default',
    };

    const tone = resolveOptionByStyleValue(TONE_VALUE_MAP, residueMap.color);
    if (tone) {
      overrides.tone = tone;
      removeStyleKeys(residueMap, ['color']);
    }

    const size = resolveOptionByStyleValue(SIZE_VALUE_MAP, residueMap['font-size']);
    if (size) {
      overrides.size = size;
      removeStyleKeys(residueMap, ['font-size']);
    }

    const highlight = resolveOptionByStyleValue(
      HIGHLIGHT_VALUE_MAP,
      residueMap.background || residueMap['background-color']
    );
    if (highlight) {
      overrides.highlight = highlight;
      removeStyleKeys(residueMap, ['background', 'background-color']);
    }

    if (residueMap.outline || residueMap['outline-offset']) {
      overrides.emphasis = 'outline';
      removeStyleKeys(residueMap, ['outline', 'outline-offset']);
    } else if (normalizeCssValue(residueMap['border-radius']) === '999px') {
      overrides.emphasis = 'pill';
      removeStyleKeys(residueMap, ['border-radius', 'padding']);
    } else if (
      normalizeCssValue(residueMap['border-left-width']) === '8px' ||
      normalizeCssValue(residueMap['border-left-style']) === 'solid'
    ) {
      overrides.emphasis = 'leftbar';
      removeStyleKeys(residueMap, ['border-left-width', 'border-left-style']);
    } else if (normalizeCssValue(residueMap['font-weight']) === '700') {
      overrides.emphasis = 'bold';
      removeStyleKeys(residueMap, ['font-weight']);
    } else if (normalizeCssValue(residueMap['font-weight']) === '400') {
      overrides.emphasis = 'none';
      removeStyleKeys(residueMap, ['font-weight']);
    }

    return {
      overrides,
      legacyStyle: serializeStyleMap(residueMap),
    };
  }

  function getAllTypes() {
    const map = new Map();
    BUILTIN_TYPES.forEach((item) => map.set(item.id, item));
    state.embeddedTypes.forEach((item) => {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    });
    return Array.from(map.values());
  }

  function getTypeDefinition(typeId) {
    const fallback = BUILTIN_TYPES.find((item) => item.id === 'remark');
    const allTypes = getAllTypes();
    return allTypes.find((item) => item.id === typeId) || fallback;
  }

  function collectEmbeddedType(typeId, attrs) {
    if (!attrs || attrs.custom !== '1' || !typeId) return;
    if (state.embeddedTypes.some((item) => item.id === typeId)) return;
    state.embeddedTypes.push({
      id: typeId,
      label: attrs.label || typeId,
      icon: attrs.icon || '🧩',
      prefix: attrs.prefix || '',
      baseType: attrs.base || 'remark',
      custom: true,
      embeddedOnly: true,
    });
  }

  function parseHtmlMDComment(comment) {
    const stripped = stripLeadingDash(comment.text || '');
    const cleanText = stripped.cleanText.trim();
    const typeId = comment.htmlMarkdownType || extractAttrValue(cleanText, 'id') || 'remark';
    const style = extractAttrValue(cleanText, 'style');
    const attrs = {
      tone: extractAttrValue(cleanText, 'data-hmd-tone') || 'default',
      size: extractAttrValue(cleanText, 'data-hmd-size') || 'default',
      highlight: extractAttrValue(cleanText, 'data-hmd-highlight') || 'default',
      emphasis: extractAttrValue(cleanText, 'data-hmd-emphasis') || 'default',
      custom: extractAttrValue(cleanText, 'data-hmd-custom'),
      label: extractAttrValue(cleanText, 'data-hmd-label'),
      icon: extractAttrValue(cleanText, 'data-hmd-icon'),
      prefix: extractAttrValue(cleanText, 'data-hmd-prefix'),
      base: extractAttrValue(cleanText, 'data-hmd-base'),
    };
    collectEmbeddedType(typeId, attrs);
    const styleParseResult = inferOverridesFromStyle(typeId, style);

    const contentMatch = cleanText.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    let content = contentMatch && contentMatch[1] ? decodeHtml(contentMatch[1]) : cleanText;
    const definition = getTypeDefinition(typeId);
    if (definition.icon && content.startsWith(definition.icon)) {
      content = content.slice(definition.icon.length).trim();
    }
    if (definition.prefix && content.startsWith(definition.prefix)) {
      content = content.slice(definition.prefix.length).trim();
    }

    return {
      kind: 'htmlmd',
      typeId,
      content,
      leadingDash: stripped.leadingDash,
      legacyStyle: styleParseResult.legacyStyle || '',
      overrides: {
        tone: attrs.tone || styleParseResult.overrides.tone,
        size: attrs.size || styleParseResult.overrides.size,
        highlight: attrs.highlight || styleParseResult.overrides.highlight,
        emphasis: attrs.emphasis || styleParseResult.overrides.emphasis,
      },
    };
  }

  function classifyCandidate(comment) {
    if (!comment || comment.text == null) return null;
    if (comment.originalType !== 'TextNote') return null;
    if (isPureNoteLinkComment(comment.text)) return null;

    const stripped = stripLeadingDash(comment.text);
    if (isHtmlMDText(stripped.cleanText.trim())) {
      const parsed = parseHtmlMDComment(comment);
      return {
        ...comment,
        candidateKind: 'htmlmd',
        title: `[${parsed.typeId}] ${parsed.content || '(空内容)'}`,
        parsedHtmlMD: parsed,
      };
    }

    const markdown = looksLikeMarkdown(comment.text, comment);
    return {
      ...comment,
      candidateKind: markdown ? 'markdown' : 'text',
      title: markdown ? 'Markdown 评论' : '文本评论',
    };
  }

  function summarizeText(text, length = 72) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= length) return normalized;
    return normalized.slice(0, length - 1) + '…';
  }

  function getCandidateByIndex(index) {
    return state.candidates.find((item) => item.index === index) || null;
  }

  function focusPreferredCandidate() {
    if (state.candidates.length === 0) {
      state.selectedIndices = new Set();
      state.activeIndex = null;
      return false;
    }

    const preferredCommentIndex = state.uiContext && typeof state.uiContext.preferredCommentIndex === 'number'
      ? state.uiContext.preferredCommentIndex
      : -1;

    if (preferredCommentIndex < 0) {
      return false;
    }

    const target = state.candidates.find((item) => item.index === preferredCommentIndex) || null;
    if (!target) {
      return false;
    }

    state.workflowMode = 'edit';
    state.selectedIndices = new Set([target.index]);
    state.activeIndex = target.index;
    syncDraftFromSelection();
    return true;
  }

  function setWorkflowMode(nextMode, options = {}) {
    state.workflowMode = nextMode === 'edit' ? 'edit' : 'new';
    if (state.workflowMode === 'new' && options.resetDraft === true) {
      state.drafts.new = options.draft || createDefaultDraft();
    }
    if (state.workflowMode === 'edit' && state.selectedIndices.size > 0) {
      syncDraftFromSelection();
      return;
    }
    if (state.workflowMode === 'edit' && !state.drafts.edit) {
      state.drafts.edit = createDefaultDraft();
    }
    render();
  }

  function clearEditSelection() {
    state.selectedIndices = new Set();
    state.activeIndex = null;
    state.drafts.edit = createDefaultDraft();
    render();
  }

  function createDraftFromCandidate(candidate) {
    if (!candidate) return createDefaultDraft();
    if (candidate.parsedHtmlMD) {
      return {
        typeId: candidate.parsedHtmlMD.typeId,
        content: candidate.parsedHtmlMD.content,
        leadingDash: candidate.parsedHtmlMD.leadingDash,
        preserveLegacy: !!candidate.parsedHtmlMD.legacyStyle,
        legacyStyle: candidate.parsedHtmlMD.legacyStyle || '',
        overrides: {
          ...candidate.parsedHtmlMD.overrides,
        },
      };
    }

    const stripped = stripLeadingDash(candidate.text || '');
    return {
      typeId: 'remark',
      content: stripped.cleanText,
      leadingDash: stripped.leadingDash,
      preserveLegacy: false,
      legacyStyle: '',
      overrides: {
        tone: 'default',
        size: 'default',
        highlight: 'default',
        emphasis: 'default',
      },
    };
  }

  function syncDraftFromSelection() {
    state.workflowMode = 'edit';
    const selected = Array.from(state.selectedIndices);
    if (selected.length === 1) {
      const candidate = getCandidateByIndex(selected[0]);
      state.activeIndex = candidate ? candidate.index : null;
      setActiveDraft(createDraftFromCandidate(candidate));
    } else if (selected.length > 1) {
      const first = getCandidateByIndex(selected[0]);
      state.activeIndex = first ? first.index : null;
      const firstDraft = createDraftFromCandidate(first);
      setActiveDraft({
        typeId: firstDraft.typeId,
        content: '',
        leadingDash: false,
        preserveLegacy: false,
        legacyStyle: '',
        overrides: firstDraft.overrides,
      });
    } else {
      state.activeIndex = null;
      setActiveDraft(createDefaultDraft());
    }
    render();
  }

  function getMode() {
    if (state.workflowMode === 'new') return 'new';
    const count = state.selectedIndices.size;
    if (count > 1) return 'batch';
    if (count === 0) return 'edit-empty';
    return 'single';
  }

  function fillSelect(select, options, placeholder) {
    if (!select) return;
    const html = [];
    if (placeholder) {
      html.push(`<option value="">${escapeHtml(placeholder)}</option>`);
    }
    options.forEach((item) => {
      html.push(`<option value="${escapeAttr(item.value)}">${escapeHtml(item.label)}</option>`);
    });
    select.innerHTML = html.join('');
  }

  function renderTypeButtons() {
    const draft = activeDraft();
    const mode = getMode();
    const locked = mode === 'edit-empty';
    const allTypes = getAllTypes();
    const renderButton = (item) => {
      const active = item.id === draft.typeId;
      return `
        <button
          type="button"
          class="type-option${active ? ' active' : ''}"
          data-role="type-option"
          data-type="${escapeAttr(item.id)}"
          aria-pressed="${active ? 'true' : 'false'}"
          title="${escapeAttr(item.label + ' (' + item.id + ')')}"
          ${locked ? 'disabled' : ''}
        >
          <span class="type-option-icon" aria-hidden="true">${escapeHtml(item.icon || '🧩')}</span>
          <span>${escapeHtml(item.label)}</span>
        </button>
      `;
    };
    const primaryTypes = PRIMARY_TYPE_IDS
      .map((typeId) => allTypes.find((item) => item.id === typeId))
      .filter(Boolean);
    const secondaryTypes = allTypes.filter((item) => !PRIMARY_TYPE_IDS.includes(item.id));
    const markerTypes = ['danger', 'check']
      .map((typeId) => secondaryTypes.find((item) => item.id === typeId))
      .filter(Boolean);
    const structureTypes = LEVEL_ORDER
      .map((typeId) => secondaryTypes.find((item) => item.id === typeId))
      .filter(Boolean);
    const compatibilityTypes = secondaryTypes.filter((item) => (
      !markerTypes.some((marker) => marker.id === item.id) &&
      !structureTypes.some((structure) => structure.id === item.id)
    ));
    const renderGroup = (label, items) => {
      if (items.length === 0) return '';
      return `
        <div class="secondary-type-group">
          <div class="secondary-type-label">${escapeHtml(label)}</div>
          <div class="type-list">${items.map(renderButton).join('')}</div>
        </div>
      `;
    };

    dom.primaryTypeList.innerHTML = primaryTypes.map(renderButton).join('');
    dom.secondaryTypeList.innerHTML = [
      renderGroup('其他标记', markerTypes),
      renderGroup('自动层级', structureTypes),
      renderGroup('旧评论兼容类型', compatibilityTypes),
    ].join('');

    const activeSecondary = secondaryTypes.find((item) => item.id === draft.typeId);
    dom.moreTypeSummaryLabel.textContent = activeSecondary
      ? `更多类型 · ${activeSecondary.icon || ''} ${activeSecondary.label}`.trim()
      : '更多类型';
  }

  function renderCandidateList() {
    const selectedCount = state.selectedIndices.size;
    dom.candidateSummary.textContent = selectedCount > 0
      ? `${state.candidates.length} 条候选评论，已选 ${selectedCount} 条`
      : `${state.candidates.length} 条候选评论，未选中`;
    if (state.candidates.length === 0) {
      dom.candidateList.innerHTML = '<div class="empty-state">当前卡片没有可编辑 / 可转换的 HtmlMD 候选评论。</div>';
      return;
    }

    dom.candidateList.innerHTML = state.candidates.map((candidate) => {
      const selected = state.selectedIndices.has(candidate.index);
      const kindLabel = candidate.candidateKind === 'htmlmd'
        ? 'HtmlMD'
        : (candidate.candidateKind === 'markdown' ? 'Markdown' : 'Text');
      const snippet = candidate.candidateKind === 'htmlmd' && candidate.parsedHtmlMD
        ? candidate.parsedHtmlMD.content
        : candidate.text;

      return `
        <div class="candidate-item${selected ? ' selected' : ''}">
          <label class="candidate-check-wrap" title="加入批量选择">
            <span class="sr-only">选择评论 #${candidate.index}</span>
            <input class="candidate-check" type="checkbox" data-role="candidate-checkbox" data-index="${candidate.index}" ${selected ? 'checked' : ''} />
          </label>
          <button type="button" class="candidate-select" data-role="candidate-select" data-index="${candidate.index}">
            <span class="candidate-meta">
              <span class="candidate-kind">${escapeHtml(kindLabel)}</span>
              <span class="candidate-index">#${candidate.index}</span>
            </span>
            <span class="candidate-snippet">${escapeHtml(summarizeText(snippet, 110))}</span>
          </button>
        </div>
      `;
    }).join('');
  }

  function getAppearanceSummary(draft) {
    const parts = [];
    ['size', 'tone', 'highlight', 'emphasis'].forEach((key) => {
      const value = draft.overrides && draft.overrides[key] ? draft.overrides[key] : 'default';
      if (value !== 'default') {
        parts.push(APPEARANCE_LABELS[key][value] || value);
      }
    });
    if (draft.leadingDash) parts.push('前导 -');
    if (draft.preserveLegacy && draft.legacyStyle) parts.push('历史样式');
    return parts.length > 0 ? `已调整：${parts.join(' · ')}` : '使用类型默认外观';
  }

  function renderEditorControls() {
    const draft = activeDraft();
    const mode = getMode();
    const selectedCount = state.selectedIndices.size;
    const hasLegacy = !!draft.legacyStyle;
    const isBatch = mode === 'batch';
    const isEditEmpty = mode === 'edit-empty';

    dom.noteTitle.textContent = state.noteTitle || '当前卡片';
    dom.candidateCountBadge.textContent = String(state.candidates.length);
    dom.studioMain.classList.toggle('editing', state.workflowMode === 'edit');
    dom.candidatePanel.classList.toggle('hidden', state.workflowMode !== 'edit');
    dom.newModeBtn.classList.toggle('active', state.workflowMode === 'new');
    dom.newModeBtn.setAttribute('aria-pressed', state.workflowMode === 'new' ? 'true' : 'false');
    dom.editModeBtn.classList.toggle('active', state.workflowMode === 'edit');
    dom.editModeBtn.setAttribute('aria-pressed', state.workflowMode === 'edit' ? 'true' : 'false');

    if (mode === 'new') {
      dom.modeBadge.textContent = '新建模式';
      dom.composerHeading.textContent = '创建 HtmlMD 评论';
      dom.modeSummary.textContent = '输入内容并选择语义类型；不会改动已有评论。';
      dom.sourceHint.textContent = '支持 Markdown，打开时始终从空白开始。';
      dom.selectionStatus.textContent = '将创建一条新评论';
    } else if (mode === 'single') {
      dom.modeBadge.textContent = '编辑模式';
      dom.composerHeading.textContent = '编辑已有评论';
      dom.modeSummary.textContent = `正在编辑评论 #${state.activeIndex}${hasLegacy ? '；检测到历史残留样式' : ''}。`;
      dom.sourceHint.textContent = '修改正文或切换语义类型后，应用到当前评论。';
      dom.selectionStatus.textContent = `将更新评论 #${state.activeIndex}`;
    } else if (mode === 'batch') {
      dom.modeBadge.textContent = '批量模式';
      dom.composerHeading.textContent = '批量调整已有评论';
      dom.modeSummary.textContent = `已选中 ${selectedCount} 条评论；正文保持不变。`;
      dom.sourceHint.textContent = '批量模式只更新外层 HtmlMD 语义与外观。';
      dom.selectionStatus.textContent = `将更新 ${selectedCount} 条评论`;
    } else {
      dom.modeBadge.textContent = '编辑模式';
      dom.composerHeading.textContent = '编辑已有评论';
      dom.modeSummary.textContent = '从左侧选择一条评论编辑，或勾选多条进行批量调整。';
      dom.sourceHint.textContent = '选择评论后将在这里加载正文。';
      dom.selectionStatus.textContent = '尚未选择评论';
    }

    dom.toneSelect.value = draft.overrides.tone || 'default';
    dom.sizeSelect.value = draft.overrides.size || 'default';
    dom.highlightSelect.value = draft.overrides.highlight || 'default';
    dom.emphasisSelect.value = draft.overrides.emphasis || 'default';
    dom.leadingDashToggle.checked = !!draft.leadingDash;
    dom.preserveLegacyToggle.checked = !!draft.preserveLegacy;
    dom.sourceTextarea.value = draft.content || '';
    dom.sourceTextarea.disabled = isEditEmpty;
    dom.sourceTextarea.classList.toggle('hidden', isBatch);
    dom.batchSection.classList.toggle('hidden', !isBatch);
    dom.preserveLegacyItem.classList.toggle('hidden', !hasLegacy);
    dom.preserveLegacyToggle.disabled = !hasLegacy || isEditEmpty;
    dom.appearanceSummary.textContent = getAppearanceSummary(draft);
    dom.characterCount.textContent = `${String(draft.content || '').length} 字`;
    dom.newDraftBtn.classList.toggle('hidden', mode !== 'new');
    dom.appendBtn.classList.toggle('hidden', mode !== 'new');
    dom.applyBtn.classList.toggle('hidden', mode !== 'single');
    dom.applyBatchBtn.classList.toggle('hidden', mode !== 'batch');
    dom.batchCopy.textContent = '正文不会被批量改写；当前类型和外观将套用到每条所选评论。';
    syncActionState();
  }

  function syncActionState() {
    const mode = getMode();
    const selectedCount = state.selectedIndices.size;
    const canGenerate = canGenerateMarkup(activeDraft());
    const controlsLocked = mode === 'edit-empty';

    dom.levelUpBtn.disabled = mode !== 'batch' || selectedCount === 0;
    dom.levelDownBtn.disabled = mode !== 'batch' || selectedCount === 0;
    dom.copyMarkupBtn.disabled = !canGenerate || controlsLocked;
    dom.applyBtn.disabled = mode !== 'single' || state.activeIndex == null || !canGenerate;
    dom.appendBtn.disabled = mode !== 'new' || !state.noteId || !canGenerate;
    dom.applyBatchBtn.disabled = mode !== 'batch' || selectedCount === 0;
    dom.resetOverridesBtn.disabled = controlsLocked;
    dom.sizeSelect.disabled = controlsLocked;
    dom.toneSelect.disabled = controlsLocked;
    dom.highlightSelect.disabled = controlsLocked;
    dom.emphasisSelect.disabled = controlsLocked;
    dom.leadingDashToggle.disabled = controlsLocked;
  }

  function mergeStyles(parts) {
    return parts
      .filter((part) => typeof part === 'string' && part.trim())
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .join(';')
      .replace(/;;+/g, ';')
      .replace(/;+$/g, '');
  }

  function buildOverrideStyle(overrides) {
    const declarations = [];

    switch (overrides.tone) {
      case 'slate':
        declarations.push('color:#334155');
        break;
      case 'blue':
        declarations.push('color:#1d4ed8');
        break;
      case 'green':
        declarations.push('color:#047857');
        break;
      case 'orange':
        declarations.push('color:#c2410c');
        break;
      case 'red':
        declarations.push('color:#b91c1c');
        break;
      case 'purple':
        declarations.push('color:#7c3aed');
        break;
      default:
        break;
    }

    switch (overrides.size) {
      case 's':
        declarations.push('font-size:0.9em');
        break;
      case 'm':
        declarations.push('font-size:1em');
        break;
      case 'l':
        declarations.push('font-size:1.15em');
        break;
      case 'xl':
        declarations.push('font-size:1.3em');
        break;
      default:
        break;
    }

    switch (overrides.highlight) {
      case 'none':
        declarations.push('background:none');
        break;
      case 'yellow':
        declarations.push('background:#fff4bf');
        break;
      case 'blue':
        declarations.push('background:#dbeafe');
        break;
      case 'green':
        declarations.push('background:#dcfce7');
        break;
      case 'pink':
        declarations.push('background:#fce7f3');
        break;
      default:
        break;
    }

    switch (overrides.emphasis) {
      case 'none':
        declarations.push('font-weight:400');
        break;
      case 'bold':
        declarations.push('font-weight:700');
        break;
      case 'leftbar':
        declarations.push('border-left-width:8px');
        declarations.push('border-left-style:solid');
        break;
      case 'outline':
        declarations.push('outline:2px solid currentColor');
        declarations.push('outline-offset:2px');
        break;
      case 'pill':
        declarations.push('border-radius:999px');
        declarations.push('padding:8px 18px');
        break;
      default:
        break;
    }

    return declarations.join(';');
  }

  function buildRenderModel(inputDraft) {
    const draft = {
      ...createDefaultDraft(),
      ...inputDraft,
      overrides: {
        ...createDefaultDraft().overrides,
        ...(inputDraft && inputDraft.overrides ? inputDraft.overrides : {}),
      },
    };
    const definition = getTypeDefinition(draft.typeId);
    const baseType = definition.baseType || definition.id || 'remark';
    const baseStyle = BUILTIN_STYLE_MAP[baseType] || BUILTIN_STYLE_MAP.remark;
    const overrideStyle = buildOverrideStyle(draft.overrides);
    const finalStyle = mergeStyles([
      baseStyle,
      draft.preserveLegacy ? draft.legacyStyle : '',
      overrideStyle,
    ]);
    const contentValue = draft.content || '';
    const needsBody = contentValue.trim().length > 0 || EMPTY_CONTENT_TYPES.has(draft.typeId);
    const bodyText = needsBody
      ? `${definition.icon || ''}${definition.icon ? ' ' : ''}${definition.prefix || ''}${contentValue}`.trimEnd()
      : '';

    return {
      definition,
      finalStyle,
      bodyText,
      leadingDash: !!draft.leadingDash,
      overrides: draft.overrides,
    };
  }

  function renderMarkdownInline(text) {
    let raw = String(text || '');
    const tokens = [];

    function stash(html) {
      const key = `__HMD_TOKEN_${tokens.length}__`;
      tokens.push({ key, html });
      return key;
    }

    raw = raw.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
    raw = raw.replace(/\[([^\]]+?)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g, (_, label, url) => {
      const trimmedUrl = String(url || '').trim();
      return stash(`<a href="${escapeAttr(trimmedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    });

    let html = escapeHtml(raw);
    html = html
      .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/___([^_]+?)___/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
      .replace(/~~([^~]+?)~~/g, '<del>$1</del>')
      .replace(/\n/g, '<br>');

    tokens.forEach((token) => {
      html = html.replace(token.key, token.html);
    });

    return html;
  }

  function renderMarkdownBlocks(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    function readUntilBlank(startIndex) {
      const paragraphLines = [];
      let cursor = startIndex;
      while (cursor < lines.length && lines[cursor].trim()) {
        paragraphLines.push(lines[cursor]);
        cursor += 1;
      }
      return {
        html: `<p>${renderMarkdownInline(paragraphLines.join('\n'))}</p>`,
        nextIndex: cursor,
      };
    }

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        const fence = trimmed.slice(3).trim();
        const codeLines = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index].trim())) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const languageAttr = fence ? ` data-lang="${escapeAttr(fence)}"` : '';
        blocks.push(`<pre${languageAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        blocks.push(`<h${level}>${renderMarkdownInline(headingMatch[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        blocks.push(`<blockquote>${renderMarkdownBlocks(quoteLines.join('\n'))}</blockquote>`);
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        const items = [];
        while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
          items.push(`<li>${renderMarkdownInline(lines[index].trim().replace(/^[-*+]\s+/, ''))}</li>`);
          index += 1;
        }
        blocks.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
          items.push(`<li>${renderMarkdownInline(lines[index].trim().replace(/^\d+\.\s+/, ''))}</li>`);
          index += 1;
        }
        blocks.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      const paragraph = readUntilBlank(index);
      blocks.push(paragraph.html);
      index = paragraph.nextIndex;
    }

    return blocks.join('') || '<p>&nbsp;</p>';
  }

  function renderPreviewBody(text) {
    return renderMarkdownBlocks(text);
  }

  function buildHtmlMDMarkup(inputDraft) {
    const model = buildRenderModel(inputDraft);
    const bodyMarkup = escapeHtml(model.bodyText).replace(/\r?\n/g, '&#10;');
    const attrs = [
      `id="${escapeAttr(model.definition.id)}"`,
      `style="${escapeAttr(model.finalStyle)}"`,
    ];

    if (model.overrides.tone !== 'default') attrs.push(`data-hmd-tone="${escapeAttr(model.overrides.tone)}"`);
    if (model.overrides.size !== 'default') attrs.push(`data-hmd-size="${escapeAttr(model.overrides.size)}"`);
    if (model.overrides.highlight !== 'default') attrs.push(`data-hmd-highlight="${escapeAttr(model.overrides.highlight)}"`);
    if (model.overrides.emphasis !== 'default') attrs.push(`data-hmd-emphasis="${escapeAttr(model.overrides.emphasis)}"`);

    if (model.definition.custom) {
      attrs.push('data-hmd-custom="1"');
      attrs.push(`data-hmd-label="${escapeAttr(model.definition.label || model.definition.id)}"`);
      attrs.push(`data-hmd-icon="${escapeAttr(model.definition.icon || '')}"`);
      attrs.push(`data-hmd-prefix="${escapeAttr(model.definition.prefix || '')}"`);
      attrs.push(`data-hmd-base="${escapeAttr(model.definition.baseType || 'remark')}"`);
    }

    const span = `<span ${attrs.join(' ')}>${bodyMarkup}</span>`;
    return model.leadingDash ? `- ${span}` : span;
  }

  function canGenerateMarkup(inputDraft) {
    const draft = inputDraft || activeDraft();
    const content = typeof draft.content === 'string' ? draft.content.trim() : '';
    return content.length > 0 || EMPTY_CONTENT_TYPES.has(draft.typeId);
  }

  function renderPreview() {
    const mode = getMode();
    const draft = activeDraft();
    const hasDraftPreview = canGenerateMarkup(draft);

    if (mode !== 'batch' && !hasDraftPreview) {
      dom.previewCanvas.innerHTML = '<div class="empty-state">输入正文后将在这里显示预览。</div>';
      dom.markupOutput.value = '';
      return;
    }

    if (mode === 'batch') {
      const previewMarkup = buildHtmlMDMarkup({
        ...draft,
        content: '批量模式只预览外层骨架，实际会保留各评论自己的正文内容。',
      });
      const model = buildRenderModel({
        ...draft,
        content: '批量模式只预览外层骨架，实际会保留各评论自己的正文内容。',
      });
      dom.previewCanvas.innerHTML = `<div class="preview-note"><div class="preview-body" style="${escapeAttr(model.finalStyle)}">${renderPreviewBody(model.bodyText)}</div></div>`;
      dom.markupOutput.value = previewMarkup;
      return;
    }

    const markup = buildHtmlMDMarkup(draft);
    const model = buildRenderModel(draft);
    dom.previewCanvas.innerHTML = `<div class="preview-note"><div class="preview-body" style="${escapeAttr(model.finalStyle)}">${renderPreviewBody(model.bodyText)}</div></div>`;
    dom.markupOutput.value = markup;
  }

  function render() {
    renderCandidateList();
    renderEditorControls();
    renderTypeButtons();
    renderPreview();
  }

  function selectSingle(index) {
    if (state.selectedIndices.size === 1 && state.selectedIndices.has(index)) {
      clearEditSelection();
      return;
    }
    state.workflowMode = 'edit';
    state.selectedIndices = new Set([index]);
    state.activeIndex = index;
    syncDraftFromSelection();
  }

  function toggleSelection(index) {
    if (state.selectedIndices.has(index)) {
      state.selectedIndices.delete(index);
    } else {
      state.selectedIndices.add(index);
    }
    if (state.selectedIndices.size === 0) {
      clearEditSelection();
      return;
    }
    syncDraftFromSelection();
  }

  function bindCandidateEvents() {
    dom.candidateList.addEventListener('click', (event) => {
      const checkbox = event.target.closest('[data-role="candidate-checkbox"]');
      if (checkbox) {
        const index = parseInt(checkbox.dataset.index, 10);
        if (!Number.isNaN(index)) {
          toggleSelection(index);
        }
        return;
      }

      const selectButton = event.target.closest('[data-role="candidate-select"]');
      if (!selectButton) return;
      const index = parseInt(selectButton.dataset.index, 10);
      if (!Number.isNaN(index)) {
        selectSingle(index);
      }
    });
  }

  function copyText(text) {
    const value = typeof text === 'string' ? text : String(text || '');
    if (!value) {
      showToast('没有可复制内容');
      return;
    }

    try {
      if (window.Bridge && typeof window.Bridge.copyText === 'function') {
        window.Bridge.copyText(value);
        showToast('已复制');
        return;
      }
    } catch (_) {}

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(() => showToast('已复制')).catch(() => showToast('复制失败'));
      return;
    }
    postToNative('copyText', { text: value });
    showToast('已发送复制请求');
  }

  function postToNative(action, params) {
    const query = Object.keys(params || {}).map((key) => {
      const value = typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key];
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }).join('&');
    const target = `${COMMENT_SCHEME}://${action}${query ? '?' + query : ''}`;
    window.location.href = target;
  }

  function extractContentForUpdate(candidate) {
    if (!candidate) return '';
    if (candidate.parsedHtmlMD) return candidate.parsedHtmlMD.content || '';
    const stripped = stripLeadingDash(candidate.text || '');
    return stripped.cleanText;
  }

  function buildUpdatesForSelection(options = {}) {
    const selected = Array.from(state.selectedIndices);
    const draft = activeDraft();
    const isBatchMode = selected.length > 1;

    return selected.map((index) => {
      const candidate = getCandidateByIndex(index);
      if (!candidate) return null;
      const candidateDraft = createDraftFromCandidate(candidate);

      const content = options.forceContent != null
        ? options.forceContent
        : extractContentForUpdate(candidate);
      const nextMarkup = buildHtmlMDMarkup({
        ...draft,
        content,
        legacyStyle: candidate.parsedHtmlMD ? candidate.parsedHtmlMD.legacyStyle : '',
        preserveLegacy: candidate.parsedHtmlMD ? draft.preserveLegacy : false,
        leadingDash: isBatchMode ? candidateDraft.leadingDash : draft.leadingDash,
      });

      return {
        index,
        text: nextMarkup,
      };
    }).filter(Boolean);
  }

  function applySingle() {
    if (state.activeIndex == null || !state.noteId) {
      showToast('没有可应用的评论');
      return;
    }
    const markup = buildHtmlMDMarkup(activeDraft());
    postToNative('applyHtmlMDCommentUpdates', {
      id: state.noteId,
      updates: JSON.stringify([{ index: state.activeIndex, text: markup }]),
    });
    showToast('已发送更新请求');
  }

  function appendNewComment() {
    if (!state.noteId) {
      showToast('缺少卡片 ID');
      return;
    }
    if (!canGenerateMarkup(activeDraft())) {
      showToast('请先输入正文再创建评论');
      return;
    }
    postToNative('appendHtmlMDComment', {
      id: state.noteId,
      text: buildHtmlMDMarkup(activeDraft()),
    });
    showToast('已发送新建请求');
  }

  function applyBatch() {
    if (!state.noteId || state.selectedIndices.size === 0) {
      showToast('没有选中评论');
      return;
    }
    const updates = buildUpdatesForSelection();
    if (updates.length === 0) {
      showToast('没有可更新内容');
      return;
    }
    postToNative('applyHtmlMDCommentUpdates', {
      id: state.noteId,
      updates: JSON.stringify(updates),
    });
    showToast(`已发送 ${updates.length} 条批量更新`);
  }

  function resetOverridesToDefault() {
    const draft = activeDraft();
    draft.overrides = {
      tone: 'default',
      size: 'default',
      highlight: 'default',
      emphasis: 'default',
    };
    draft.preserveLegacy = false;
    render();
  }

  function shiftLevel(direction) {
    const selected = Array.from(state.selectedIndices);
    if (selected.length === 0) {
      showToast('请先选择要调整层级的评论');
      return;
    }

    const mode = getMode();
    const updates = selected.map((index) => {
      const candidate = getCandidateByIndex(index);
      if (!candidate || !candidate.parsedHtmlMD) return null;
      const currentType = candidate.parsedHtmlMD.typeId;
      const levelIndex = LEVEL_ORDER.indexOf(currentType);
      if (levelIndex < 0) return null;

      const nextIndex = direction === 'up'
        ? Math.max(0, levelIndex - 1)
        : Math.min(LEVEL_ORDER.length - 1, levelIndex + 1);
      const nextType = LEVEL_ORDER[nextIndex];
      const sourceDraft = mode === 'single'
        ? activeDraft()
        : createDraftFromCandidate(candidate);
      const nextMarkup = buildHtmlMDMarkup({
        ...sourceDraft,
        typeId: nextType,
        content: candidate.parsedHtmlMD.content,
        legacyStyle: candidate.parsedHtmlMD.legacyStyle,
        preserveLegacy: sourceDraft.preserveLegacy,
        leadingDash: candidate.parsedHtmlMD.leadingDash,
      });
      return {
        index,
        text: nextMarkup,
      };
    }).filter(Boolean);

    if (updates.length === 0) {
      showToast('当前选择里没有可调层级的 HtmlMD');
      return;
    }
    postToNative('applyHtmlMDCommentUpdates', {
      id: state.noteId,
      updates: JSON.stringify(updates),
    });
    showToast(`已发送 ${updates.length} 条层级调整`);
  }

  let clearDraftConfirmArmed = false;
  let clearDraftConfirmTimer = null;

  function disarmClearDraftConfirm() {
    clearDraftConfirmArmed = false;
    clearTimeout(clearDraftConfirmTimer);
    if (dom.newDraftBtn) {
      dom.newDraftBtn.classList.remove('is-confirming');
      dom.newDraftBtn.textContent = '清空内容';
    }
  }

  function bindControls() {
    dom.newModeBtn.addEventListener('click', () => {
      disarmClearDraftConfirm();
      setWorkflowMode('new');
    });
    dom.editModeBtn.addEventListener('click', () => {
      disarmClearDraftConfirm();
      setWorkflowMode('edit');
    });
    dom.selectAllBtn.addEventListener('click', () => {
      disarmClearDraftConfirm();
      state.workflowMode = 'edit';
      state.selectedIndices = new Set(state.candidates.map((item) => item.index));
      syncDraftFromSelection();
    });
    dom.clearSelectionBtn.addEventListener('click', () => {
      disarmClearDraftConfirm();
      clearEditSelection();
    });
    dom.newDraftBtn.addEventListener('click', () => {
      const hasContent = String(activeDraft().content || '').trim().length > 0;
      if (hasContent && !clearDraftConfirmArmed) {
        clearDraftConfirmArmed = true;
        dom.newDraftBtn.classList.add('is-confirming');
        dom.newDraftBtn.textContent = '再点一次清空';
        showToast('再点一次「清空内容」确认清空草稿');
        clearTimeout(clearDraftConfirmTimer);
        clearDraftConfirmTimer = setTimeout(disarmClearDraftConfirm, 2400);
        return;
      }
      disarmClearDraftConfirm();
      setWorkflowMode('new', { resetDraft: true });
      dom.sourceTextarea.focus();
      showToast('已清空正文');
    });
    dom.resetOverridesBtn.addEventListener('click', resetOverridesToDefault);
    dom.typePicker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-role="type-option"]');
      if (!button || button.disabled) return;
      activeDraft().typeId = button.dataset.type || 'remark';
      render();
    });
    dom.toneSelect.addEventListener('change', (event) => {
      activeDraft().overrides.tone = event.target.value || 'default';
      render();
    });
    dom.sizeSelect.addEventListener('change', (event) => {
      activeDraft().overrides.size = event.target.value || 'default';
      render();
    });
    dom.highlightSelect.addEventListener('change', (event) => {
      activeDraft().overrides.highlight = event.target.value || 'default';
      render();
    });
    dom.emphasisSelect.addEventListener('change', (event) => {
      activeDraft().overrides.emphasis = event.target.value || 'default';
      render();
    });
    dom.leadingDashToggle.addEventListener('change', (event) => {
      activeDraft().leadingDash = !!event.target.checked;
      render();
    });
    dom.preserveLegacyToggle.addEventListener('change', (event) => {
      activeDraft().preserveLegacy = !!event.target.checked;
      render();
    });
    dom.sourceTextarea.addEventListener('input', (event) => {
      disarmClearDraftConfirm();
      activeDraft().content = event.target.value;
      dom.characterCount.textContent = `${String(event.target.value || '').length} 字`;
      syncActionState();
      renderPreview();
    });
    dom.sourceTextarea.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && clearDraftConfirmArmed) {
        event.preventDefault();
        disarmClearDraftConfirm();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        const mode = currentMode();
        if (mode === 'new' && !dom.appendBtn.disabled) {
          appendNewComment();
        } else if (mode === 'single' && !dom.applyBtn.disabled) {
          applySingle();
        }
      }
    });
    dom.applyBtn.addEventListener('click', applySingle);
    dom.applyBatchBtn.addEventListener('click', applyBatch);
    dom.copyMarkupBtn.addEventListener('click', () => copyText(dom.markupOutput.value || ''));
    dom.levelUpBtn.addEventListener('click', () => shiftLevel('up'));
    dom.levelDownBtn.addEventListener('click', () => shiftLevel('down'));
    dom.appendBtn.addEventListener('click', appendNewComment);
  }

  function loadDataFromNative(data) {
    const previousNoteId = state.noteId;
    const nextNoteId = data && data.noteId ? String(data.noteId) : '';
    const switchedNote = previousNoteId && nextNoteId && previousNoteId !== nextNoteId;

    state.noteId = nextNoteId;
    state.noteTitle = data && data.noteTitle ? String(data.noteTitle) : '';
    state.comments = Array.isArray(data && data.comments) ? data.comments : [];
    state.uiContext = data && data.uiContext ? data.uiContext : {};
    state.embeddedTypes = [];
    state.candidates = state.comments.map(classifyCandidate).filter(Boolean);

    if (switchedNote) {
      state.workflowMode = 'new';
      state.selectedIndices = new Set();
      state.activeIndex = null;
      state.drafts.new = createDefaultDraft();
      state.drafts.edit = createDefaultDraft();
    }

    if (focusPreferredCandidate()) {
      return;
    }

    if (state.selectedIndices.size > 0) {
      const nextSelected = new Set();
      Array.from(state.selectedIndices).forEach((index) => {
        if (state.candidates.some((item) => item.index === index)) {
          nextSelected.add(index);
        }
      });
      state.selectedIndices = nextSelected;
      if (state.workflowMode === 'edit' && nextSelected.size === 0) {
        clearEditSelection();
      } else if (state.workflowMode === 'edit') {
        syncDraftFromSelection();
      } else {
        render();
      }
      return;
    }

    render();
  }

  function initOptions() {
    fillSelect(dom.sizeSelect, SIZE_OPTIONS);
    fillSelect(dom.toneSelect, TONE_OPTIONS);
    fillSelect(dom.highlightSelect, HIGHLIGHT_OPTIONS);
    fillSelect(dom.emphasisSelect, EMPHASIS_OPTIONS);
  }

  function boot() {
    setupDom();
    initOptions();
    bindControls();
    bindCandidateEvents();
    render();
    postToNative('ready', {});
  }

  window.loadDataFromNative = loadDataFromNative;
  window.Bridge = {
    ...(window.Bridge || {}),
    copyText(text) {
      postToNative('copyText', { text });
    },
    loadCommentData(data) {
      loadDataFromNative(data);
    },
  };
  window.addEventListener('load', boot);
})();
