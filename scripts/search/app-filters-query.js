'use strict';

// U+2061–U+2064 are invisible mathematical operators. Treat them like other
// invisible formatting characters so copied formulas can match visible titles.
const SEARCH_IGNORED_INVISIBLE_CHARACTERS = /[\u00AD\u034F\u061C\u180E\u200B-\u200D\u2060-\u2064\uFEFF]/g;

function normalizeSearchText(text) {
  return String(text || '').replace(SEARCH_IGNORED_INVISIBLE_CHARACTERS, '');
}

function scheduleSearch(options = {}) {
  if (
    options.preserveAICardSearch !== true
    && state.aiCardSearch?.active
    && typeof deactivateAICardSearch === 'function'
  ) {
    deactivateAICardSearch();
    lastExecutedSearchFingerprint = '';
  }
  if (typeof updateFilterToggleLabel === 'function') {
    updateFilterToggleLabel();
  }
  const perfStart = getPerfNow();
  const normalizedOptions = {
    ...options,
    lowPriority: options.lowPriority === true,
  };

  if (pendingSearchPerfStart === 0) {
    pendingSearchPerfStart = perfStart;
  }
  pendingSearchDispatchOptions = mergeScheduleOptions(pendingSearchDispatchOptions || {}, normalizedOptions);

  if (pendingSearchDispatchHandle !== null) {
    logPerfMetric('scheduleSearch(merged)', perfStart);
    return;
  }

  pendingSearchDispatchHandle = queueFilterFrame(flushScheduledSearchDispatch);
}

function buildQueryPayload() {
  const currentType = getCurrentTypePreset();
  const includePresets = Array.from(state.activePresets);
  const excludePresets = Array.from(state.activeNegativePresets);
  const baseTerms = deriveQueryTerms(state.userInput, includePresets);
  const baseTokens = baseTerms.map((term) => term.value);
  const phraseTokenGroupIndexes = baseTerms
    .map((term, index) => (term.quoted ? index : -1))
    .filter((index) => index >= 0);
  const tokenGroups = buildSearchTokenGroups(baseTokens, phraseTokenGroupIndexes, state.userInput);
  const highlightTokens = flattenTokenGroups(tokenGroups);
  const manualExclusionTerms = parseQueryTerms(state.manualExclusionInput);

  return {
    rawInput: state.userInput,
    manualExclusionInput: state.manualExclusionInput,
    manualExclusionTerms,
    includePresets,
    excludePresets,
    typeKey: currentType.key,
    typeList: currentType.types ? currentType.types.slice() : null,
    classificationSubtype: state.currentClassificationSubtype,
    highlightTokens,
    tokensLower: highlightTokens.map((token) => token.toLowerCase()),
    tokenGroupsLower: tokenGroups.map((group) => group.map((token) => token.toLowerCase())),
    phraseTokenGroupIndexes,
    baseTokens,
    timestamp: Date.now(),
  };
}

/**
 * 识别并标准化数学区间符号
 * 支持格式：[a, b]、(a, b)、[a, b)、(a, b]
 * @param {string} text - 待处理的文本
 * @returns {Object} { normalized: 标准化后的文本, intervals: 提取的区间数组 }
 */
function normalizeIntervals(text) {
  const source = normalizeSearchText(text);
  if (!source) return { normalized: source, intervals: [] };

  const intervals = [];
  const placeholders = new Map();
  let counter = 0;

  // 匹配数学区间：[\(\[].*?[\)\]]
  // 支持 [...]、(...)、[...)、(...] 四种格式
  const intervalRegex = /[\[\(][^\[\]\(\)]*?[\]\)]/g;

  const normalized = source.replace(intervalRegex, (match) => {
    // 标准化区间内部：移除逗号和分号周围的空格
    const standardized = match.replace(/\s*([,;])\s*/g, '$1');

    // 如果标准化后与原始不同，记录下来
    if (standardized !== match) {
      const placeholder = `__INTERVAL_${counter}__`;
      placeholders.set(placeholder, standardized);
      intervals.push({ original: match, normalized: standardized });
      counter++;
      return placeholder;
    }

    return match;
  });

  // 还原占位符
  let result = normalized;
  placeholders.forEach((value, key) => {
    result = result.replace(key, value);
  });

  return { normalized: result, intervals };
}

const QUERY_QUOTE_PAIRS = {
  '"': '"',
  '“': '”',
  '＂': '＂',
};

function isEscapedQueryCharacter(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findClosingQueryQuote(text, startIndex, closeQuote) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === closeQuote && !isEscapedQueryCharacter(text, index)) {
      return index;
    }
  }
  return -1;
}

function unescapeQuotedQueryValue(value) {
  return String(value || '').replace(/\\(["“”＂\\])/g, '$1');
}

function splitQueryInputSegments(rawInput) {
  const { normalized } = normalizeIntervals(rawInput);
  const segments = [];
  let buffer = '';

  const appendBuffer = () => {
    if (!buffer) return;
    segments.push({ value: buffer, quoted: false });
    buffer = '';
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const closeQuote = QUERY_QUOTE_PAIRS[character];
    if (!closeQuote || isEscapedQueryCharacter(normalized, index)) {
      buffer += character;
      continue;
    }

    const closeIndex = findClosingQueryQuote(normalized, index + 1, closeQuote);
    if (closeIndex < 0) {
      // 输入尚未闭合时忽略孤立引号，让实时搜索仍能继续工作。
      continue;
    }

    appendBuffer();
    segments.push({
      value: unescapeQuotedQueryValue(normalized.slice(index + 1, closeIndex)),
      quoted: true,
    });
    index = closeIndex;
  }

  appendBuffer();
  return segments;
}

function parseQueryTerms(rawInput, options = {}) {
  const segments = splitQueryInputSegments(rawInput);
  const preserveLegacySingleSpaces = options.legacyDoubleSpaceGrouping === true
    && segments.some((segment) => !segment.quoted && /\s{2,}/.test(segment.value));
  const terms = [];
  const seen = new Set();

  const appendTerm = (rawValue, quoted) => {
    const value = quoted
      ? String(rawValue || '').replace(/\s+/g, ' ').trim()
      : String(rawValue || '').trim();
    const key = `${quoted ? 'phrase' : 'term'}:${value.toLowerCase()}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    terms.push({ value, quoted: !!quoted });
  };

  segments.forEach((segment) => {
    if (segment.quoted) {
      appendTerm(segment.value, true);
      return;
    }

    const separator = preserveLegacySingleSpaces ? /\s{2,}/ : /\s+/;
    segment.value.split(separator).forEach((part) => appendTerm(part, false));
  });

  return terms;
}

function deriveQueryTerms(rawInput, includePresets) {
  const terms = parseQueryTerms(rawInput, { legacyDoubleSpaceGrouping: true });
  const seen = new Set(terms.map((term) => `${term.quoted ? 'phrase' : 'term'}:${term.value.toLowerCase()}`));

  (includePresets || []).forEach((part) => {
    const value = normalizeSearchText(part).trim();
    const key = `term:${value.toLowerCase()}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    terms.push({ value, quoted: false });
  });

  return terms;
}

function deriveTokens(rawInput, includePresets) {
  return deriveQueryTerms(rawInput, includePresets).map((term) => term.value);
}

function normalizeWhitespaceInsensitiveSearchText(text) {
  return normalizeSearchText(text).toLowerCase().replace(/\s+/g, '');
}

function normalizeSynonymWord(word) {
  return normalizeSearchText(word).trim();
}

function normalizeSynonymGroup(group) {
  if (!group || group.enabled === false || !Array.isArray(group.words)) return null;

  const seen = new Set();
  const words = [];
  group.words.forEach((word) => {
    const value = normalizeSynonymWord(word);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    words.push(value);
  });

  if (words.length < 2) return null;
  return {
    ...group,
    words,
  };
}

function getSearchSynonymGroups() {
  const groups = [];
  const seenGroups = new Set();
  const appendGroup = (group) => {
    if (group && group.enabled === false) return;
    const normalized = normalizeSynonymGroup(group);
    if (!normalized) return;
    const key = normalized.words.map((word) => word.toLowerCase()).sort().join('\u0001');
    if (seenGroups.has(key)) return;
    seenGroups.add(key);
    groups.push(normalized);
  };

  (Array.isArray(DEFAULT_SEARCH_SYNONYM_GROUPS) ? DEFAULT_SEARCH_SYNONYM_GROUPS : []).forEach(appendGroup);
  (Array.isArray(state.config?.synonymGroups) ? state.config.synonymGroups : []).forEach(appendGroup);

  return groups;
}

function groupContainsToken(group, token) {
  const tokenLower = String(token || '').toLowerCase();
  if (!tokenLower) return false;
  return group.words.some((word) => {
    if (group.caseSensitive) return word === token;
    return word.toLowerCase() === tokenLower;
  });
}

function synonymGroupContextAllowed(group, context = '') {
  const triggers = Array.isArray(group?.contextTriggers) ? group.contextTriggers : [];
  if (triggers.length === 0) return true;
  const text = String(context || '').toLowerCase();
  if (!text) return false;
  if (group.contextMode === 'all') return triggers.every((trigger) => text.includes(String(trigger || '').toLowerCase()));
  return triggers.some((trigger) => text.includes(String(trigger || '').toLowerCase()));
}

function buildPatternVariants(token, group) {
  if (!group?.patternMode || !Array.isArray(group.words)) return [];
  const output = new Set();
  const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  group.words.forEach((pattern) => {
    if (!String(pattern).includes('{{}}')) return;
    const expression = String(pattern).split('{{}}').map(escapeRegex).join('(.*?)');
    const flags = group.caseSensitive ? '' : 'i';
    const match = String(token || '').match(new RegExp(`^${expression}$`, flags));
    if (!match) return;
    group.words.forEach((target) => {
      if (target === pattern) return;
      let captureIndex = 1;
      const variant = String(target).replace(/\{\{\}\}/g, () => match[captureIndex++] || '');
      if (variant) output.add(variant);
    });
  });
  return Array.from(output);
}

function buildSearchTokenGroup(token, synonymGroups, context = '') {
  const seen = new Set();
  const output = [];
  const append = (value) => {
    const normalized = normalizeSynonymWord(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  };

  append(token);
  synonymGroups.forEach((group) => {
    if (!synonymGroupContextAllowed(group, context)) return;
    const tokenMatch = groupContainsToken(group, token);
    const phraseMatch = group.words.some((word) => (
      /\s/.test(word)
      && String(context || '').toLowerCase().includes(word.toLowerCase())
    ));
    const patternVariants = buildPatternVariants(token, group);
    if (!tokenMatch && !phraseMatch && patternVariants.length === 0) return;
    if (tokenMatch || phraseMatch) group.words.forEach(append);
    patternVariants.forEach(append);
  });

  return output;
}

function buildSearchTokenGroups(tokens, phraseTokenGroupIndexes = [], context = '') {
  const synonymGroups = getSearchSynonymGroups();
  const phraseIndexes = new Set(phraseTokenGroupIndexes || []);
  return (tokens || []).map((token, index) => {
    if (phraseIndexes.has(index)) return [normalizeSynonymWord(token)].filter(Boolean);
    return buildSearchTokenGroup(token, synonymGroups, context);
  });
}

function flattenTokenGroups(tokenGroups) {
  const seen = new Set();
  const output = [];
  (tokenGroups || []).forEach((group) => {
    (group || []).forEach((token) => {
      const value = normalizeSynonymWord(token);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
  });
  return output;
}

function buildCollapsedQueryText(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return '';
  const { normalized } = normalizeIntervals(raw);
  return normalized.replace(/[\s;；:：,，.。!！?？'"“”‘’`~\-—_()[\]{}<>《》\/\\|]+/g, '');
}

function buildCollapsedQueryVariants(rawInput, tokenGroupsLower) {
  const variants = new Set();
  const rawCollapsed = buildCollapsedQueryText(rawInput || '');
  if (rawCollapsed) variants.add(rawCollapsed);

  if (Array.isArray(tokenGroupsLower) && tokenGroupsLower.length === 1) {
    tokenGroupsLower[0].forEach((token) => {
      const collapsed = buildCollapsedQueryText(token);
      if (collapsed) variants.add(collapsed);
    });
  }

  return Array.from(variants);
}

function getCurrentTypePreset() {
  const filters = state.config.typeFilters || [];
  const fallback = filters[0] || { key: 'all', label: '全部类型', types: null };
  return filters.find((filter) => filter.key === state.currentTypeKey) || fallback;
}

function clearLocateStateBeforeFiltering(keepLocate) {
  if (!keepLocate && state.locateOnlyId) {
    state.locateOnlyId = null;
    state.locateTargetId = null;
  }
}

function normalizeFilterCardType(card) {
  return card && card.type && String(card.type).trim() ? card.type : RAW_TYPE_LABEL;
}

function createPreparedFilterCard(card, normalizedType, highlightTokens, highlightKey, matchCount, score) {
  const canReuseCard = normalizedType === card.type
    && (!highlightTokens || highlightTokens.length === 0)
    && matchCount === 0
    && score === (card.score || 0);
  if (canReuseCard) {
    return card;
  }

  return {
    id: card.id,
    title: card.title || '',
    type: normalizedType,
    classificationSubtype: card.classificationSubtype,
    color: card.color,
    colorIndex: card.colorIndex,
    matchCount,
    score,
    usageScore: Number(card.usageScore) || 0,
    usageContribution: calculateUsageContribution(card.usageScore),
    indexSource: card.indexSource,
    isRaw: !card.type,
    __mnkbHighlightTokens: highlightTokens,
    __mnkbHighlightKey: highlightKey,
  };
}

function createFilterContext(query, taskToken, perfStart) {
  const cards = Array.isArray(state.cards) ? state.cards : [];
  const tokensLower = Array.isArray(query.tokensLower) ? query.tokensLower : [];
  const tokenGroupsLower = Array.isArray(query.tokenGroupsLower) && query.tokenGroupsLower.length > 0
    ? query.tokenGroupsLower
    : tokensLower.map((token) => [token]);
  const subtypeFilter = query.classificationSubtype;
  const phraseTokenGroupIndexes = new Set(
    Array.isArray(query.phraseTokenGroupIndexes) ? query.phraseTokenGroupIndexes : [],
  );
  const highlightTokens = Array.isArray(query.highlightTokens) ? query.highlightTokens : [];
  const rawQueryCollapsed = buildCollapsedQueryText(query.rawInput || '');
  const rawQueryCollapsedVariants = buildCollapsedQueryVariants(query.rawInput || '', tokenGroupsLower);
  const evaluationOptions = {
    rawQueryCollapsed,
    rawQueryCollapsedVariants,
    tokenCount: tokenGroupsLower.length,
    tokenGroupsLower,
    tokenGroupsAreNormalized: true,
    phraseTokenGroupIndexes: Array.from(phraseTokenGroupIndexes),
    phraseTokenGroupIndexSet: phraseTokenGroupIndexes,
  };

  return {
    taskToken,
    perfStart,
    query,
    cards,
    results: [],
    allowedTypes: query.typeList ? new Set(query.typeList) : null,
    negatives: (query.excludePresets || []).map((word) => word.toLowerCase()),
    manualExclusionTerms: Array.isArray(query.manualExclusionTerms) ? query.manualExclusionTerms : [],
    tokensLower,
    tokenGroupsLower,
    phraseTokenGroupIndexes,
    highlightTokens,
    highlightKey: highlightTokens.join('\u0002'),
    rawQueryCollapsed,
    rawQueryCollapsedVariants,
    evaluationOptions,
    subtypeFilter,
    enforceSubtype: subtypeFilter && subtypeFilter !== 'all',
    useAdaptiveCoarse: shouldUseAdaptiveCoarseFilter(tokenGroupsLower, cards.length),
    useChunkedLoop: shouldUseChunkedFilterLoop(cards.length) && !state.locateOnlyId,
    activeExclusions: state.activeExclusions,
    coarseRejectedCount: 0,
  };
}

function sortFilteredResults(results) {
  results.sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.title || '').localeCompare(b.title || '');
  });
}

function moveLocateTargetToFront(results, locateId) {
  if (!locateId) return;
  const locateIndex = results.findIndex((item) => item && String(item.id) === locateId);
  if (locateIndex > 0) {
    const [target] = results.splice(locateIndex, 1);
    results.unshift(target);
  }
}

function buildApplyFiltersLogDetails(context, skippedRender) {
  const adaptiveDetails = context.useAdaptiveCoarse
    ? ` adaptive=on rejected=${context.coarseRejectedCount}`
    : ' adaptive=off';
  const chunkDetails = context.useChunkedLoop ? ' chunk=on' : ' chunk=off';
  return `results=${context.results.length}${adaptiveDetails}${chunkDetails} skippedRender=${skippedRender ? 'on' : 'off'}`;
}

function logSearchRankingSnapshot(context) {
  if (typeof emitSearchDebugLog !== 'function') return;
  if (!context || !context.query || !context.query.rawInput) return;

  const clip = (text, maxLen = 32) => {
    const raw = String(text || '').trim();
    if (!raw) return '-';
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
  };

  const topItems = (context.results || []).slice(0, 4).map((item, index) => {
    const fields = getCachedSearchFields(item, item.type);
    return {
      rank: index + 1,
      score: Number(Number(item.score || 0).toFixed(2)),
      title: clip(item.title, 28),
      core: clip(fields.coreTerm.text, 18),
      prefix: clip(fields.prefix.text, 18),
    };
  });

  emitSearchDebugLog(
    `query=${context.query.rawInput} count=${context.results.length}`,
    JSON.stringify({
      query: context.query.rawInput,
      count: context.results.length,
      top: topItems,
    }),
  );
}

function finalizeFilterResults(context) {
  if (context.taskToken !== activeFilterTaskToken) return;
  state.isFilteringResults = false;

  pruneSelectionForCurrentCards();
  sortFilteredResults(context.results);
  logSearchRankingSnapshot(context);

  const locateId = state.locateTargetId ? String(state.locateTargetId) : '';
  moveLocateTargetToFront(context.results, locateId);

  const nextResultRenderSignatures = context.results.map((item) => buildCardRenderSignature(item));
  const canSkipRender = !locateId
    && areRenderSignatureListsEqual(nextResultRenderSignatures, filteredResultRenderSignatures);

  state.filteredCards = context.results;
  rebuildFilteredCardLookup(context.results);
  filteredResultRenderSignatures = nextResultRenderSignatures;

  if (canSkipRender) {
    if (state.selectedCardId) {
      setSelectedCardElement(getRenderedCardElementById(state.selectedCardId));
    }
    updateSearchCount(state.displayedCards.length);
    updateSelectionInfo();
    updateActionButtonsState();
    updateLoadMoreButton();
    logPerfMetric('applyFilters', context.perfStart, buildApplyFiltersLogDetails(context, true));
    return;
  }

  const initialCards = resetPaginationState(context.results);
  renderResults(initialCards);

  if (locateId) {
    requestAnimationFrame(() => {
      scrollToCardById(locateId);
    });
    state.locateTargetId = null;
  }

  updateLoadMoreButton();
  logPerfMetric('applyFilters', context.perfStart, buildApplyFiltersLogDetails(context, false));
  if (typeof window.mnkbStartupPerfMark === 'function' && window.__MNKB_STARTUP_FIRST_FILTER_DONE__ !== true) {
    window.__MNKB_STARTUP_FIRST_FILTER_DONE__ = true;
    window.mnkbStartupPerfMark('applyFilters(first done)', buildApplyFiltersLogDetails(context, false));
  }
}

function processCardForFilter(card, context) {
  if (!card || !card.id) return;

  // 局部搜索守卫：仅匹配子孙卡片
  if (state.localSearchRootId && state.localSearchDescendantIds) {
    if (!state.localSearchDescendantIds.has(String(card.id))) {
      return;
    }
  }

  const normalizedType = normalizeFilterCardType(card);

  if (context.allowedTypes && context.allowedTypes.size > 0 && !context.allowedTypes.has(normalizedType)) {
    return;
  }

  if (context.enforceSubtype && normalizedType === '归类') {
    if (!card.classificationSubtype || card.classificationSubtype !== context.subtypeFilter) {
      return;
    }
  }

  if (!passesNegativeFilter(card, context.negatives)) return;
  if (!passesManualTitleExclusion(card, context.manualExclusionTerms)) return;

  if (context.activeExclusions && context.activeExclusions.groups.length > 0) {
    if (shouldExcludeCard(card, context.activeExclusions)) {
      return;
    }
  }

  if (context.useAdaptiveCoarse && !maybeCoarseMatchCard(
    card,
    context.tokenGroupsLower,
    normalizedType,
    context.phraseTokenGroupIndexes,
  )) {
    context.coarseRejectedCount += 1;
    return;
  }

  const evaluation = context.tokenGroupsLower.length === 0
    ? { score: card.score || 0, matchCount: 0 }
    : evaluateCardWithNormalizedType(card, context.tokensLower, normalizedType, context.evaluationOptions);
  if (context.tokenGroupsLower.length > 0 && evaluation.matchCount < context.tokenGroupsLower.length) return;
  const finalScore = evaluation.score + calculateUsageContribution(card.usageScore);

  context.results.push(
    createPreparedFilterCard(
      card,
      normalizedType,
      context.highlightTokens,
      context.highlightKey,
      evaluation.matchCount,
      finalScore,
    ),
  );
}

function applyLocateOnlyFilter(context) {
  const locateId = String(state.locateOnlyId);
  const card = context.cards.find((item) => item && String(item.id) === locateId);
  if (card && card.id) {
    context.results.push(
      createPreparedFilterCard(
        card,
        normalizeFilterCardType(card),
        context.highlightTokens,
        context.highlightKey,
        1,
        (typeof card.score === 'number' ? card.score : 0)
          + calculateUsageContribution(card.usageScore),
      ),
    );
  }
  finalizeFilterResults(context);
}

function scheduleChunkedFilterLoop(context) {
  const chunkBudgetMs = getChunkedFilterBudgetMs();
  let cursor = 0;

  const runChunk = () => {
    if (context.taskToken !== activeFilterTaskToken) return;

    const chunkStart = getPerfNow();
    try {
      while (cursor < context.cards.length && (getPerfNow() - chunkStart) <= chunkBudgetMs) {
        processCardForFilter(context.cards[cursor], context);
        cursor += 1;
      }
    } catch (error) {
      console.error('分帧筛选失败:', error);
      state.isFilteringResults = false;
      updateSearchCount(0, { phase: 'error' });
      showToast('筛选失败，请重试');
      logPerfMetric('applyFilters(error)', context.perfStart, 'chunk');
      pendingFilterTaskHandle = null;
      return;
    }

    if (context.taskToken !== activeFilterTaskToken) return;

    if (cursor < context.cards.length) {
      pendingFilterTaskHandle = queueFilterFrame(runChunk);
      return;
    }

    pendingFilterTaskHandle = null;
    finalizeFilterResults(context);
  };

  pendingFilterTaskHandle = queueFilterFrame(runChunk);
}

function applyFilters(payload, options = {}) {
  const perfStart = getPerfNow();
  const taskToken = ++activeFilterTaskToken;
  cancelPendingFilterTask();
  state.isFilteringResults = true;
  updateSearchCount(0, { phase: 'pending' });
  try {
    const query = payload || state.lastQueryPayload || buildQueryPayload();
    if (typeof window.mnkbStartupPerfMark === 'function' && window.__MNKB_STARTUP_FIRST_FILTER_STARTED__ !== true) {
      window.__MNKB_STARTUP_FIRST_FILTER_STARTED__ = true;
      window.mnkbStartupPerfMark('applyFilters(first start)', `cards=${Array.isArray(state.cards) ? state.cards.length : 0}`);
    }
    clearLocateStateBeforeFiltering(options.keepLocate === true);

    const explicitTokensLower = Array.isArray(query.baseTokens)
      ? query.baseTokens.map((token) => String(token || '').toLowerCase()).filter(Boolean)
      : query.tokensLower;
    state.activeExclusions = getActiveExclusions(explicitTokensLower);
    const context = createFilterContext(query, taskToken, perfStart);

    if (state.locateOnlyId) {
      applyLocateOnlyFilter(context);
      return;
    }

    if (!context.useChunkedLoop) {
      context.cards.forEach((card) => {
        processCardForFilter(card, context);
      });
      finalizeFilterResults(context);
      return;
    }

    scheduleChunkedFilterLoop(context);
  } catch (error) {
    console.error('应用筛选器失败:', error);
    state.isFilteringResults = false;
    updateSearchCount(0, { phase: 'error' });
    showToast('筛选失败，请重试');
    pendingFilterTaskHandle = null;
    logPerfMetric('applyFilters(error)', perfStart);
  }
}

function passesNegativeFilter(card, negativeTokens) {
  if (!negativeTokens || negativeTokens.length === 0) return true;

  if (card.excludedGroups && Array.isArray(card.excludedGroups) && card.excludedGroups.length > 0) {
    const hit = card.excludedGroups.some((group) => {
      if (!group) return false;
      const pool = [
        group.groupName || '',
        ...(group.excludeWords || []),
        ...(group.affectedTriggers || []),
      ]
        .join(' ')
        .toLowerCase();
      return negativeTokens.some((token) => pool.includes(token));
    });
    if (hit) return false;
  }

  const text = [
    card.title || '',
    card.searchText || '',
    card.snippet || '',
    card.content || '',
  ]
    .join(' ')
    .toLowerCase();

  return !negativeTokens.some((token) => token && text.includes(token));
}

function passesManualTitleExclusion(card, exclusionTerms) {
  if (!Array.isArray(exclusionTerms) || exclusionTerms.length === 0) return true;

  const title = normalizeSearchText(card?.title).toLowerCase();
  const whitespaceInsensitiveTitle = normalizeWhitespaceInsensitiveSearchText(title);

  return !exclusionTerms.some((term) => {
    const value = normalizeSearchText(term?.value).trim().toLowerCase();
    if (!value) return false;
    if (term.quoted) {
      const phrase = normalizeWhitespaceInsensitiveSearchText(value);
      return !!phrase && whitespaceInsensitiveTitle.includes(phrase);
    }
    return title.includes(value);
  });
}

function tokenGroupMatchesCoarseText(tokenGroup, coarseText, ignoreWhitespace) {
  const variants = Array.isArray(tokenGroup) ? tokenGroup : [tokenGroup];
  const comparableText = ignoreWhitespace
    ? normalizeWhitespaceInsensitiveSearchText(coarseText)
    : coarseText;

  return variants.some((token) => {
    if (!token) return false;
    const comparableToken = ignoreWhitespace
      ? normalizeWhitespaceInsensitiveSearchText(token)
      : token;
    return !!comparableToken && comparableText.includes(comparableToken);
  });
}

function maybeCoarseMatchCard(card, tokenGroupsLower, normalizedType, phraseTokenGroupIndexes = new Set()) {
  if (!tokenGroupsLower || tokenGroupsLower.length === 0) return true;

  const coarseText = getCachedSearchRecord(card, normalizedType).coarseText;

  if (!coarseText) return false;
  return tokenGroupsLower.every((group, index) => {
    return tokenGroupMatchesCoarseText(group, coarseText, phraseTokenGroupIndexes.has(index));
  });
}

/**
 * 获取激活的排除词组信息
 * @param {Array<string>} keywords - 搜索关键词数组
 * @returns {Object} 包含 excludeWords 和 groups 的对象
*/
function matchesExclusionTrigger(keyword, group) {
  return (group.triggerWords || []).find((trigger) => {
    const triggerLower = (trigger || '').toLowerCase();
    if (!triggerLower) return false;
    if (keyword === triggerLower) return true;
    if (keyword.includes(triggerLower)) return true;
    if (triggerLower.includes(keyword)) return true;
    return false;
  });
}

function getCleanedExcludeWords(group, keywordSet) {
  return (group.excludeWords || []).filter((word) => {
    if (!word) return false;
    return !keywordSet.has(word.toLowerCase());
  });
}

function getExclusionGroupKey(group) {
  return (
    group.id ||
    group.name ||
    (group.triggerWords || []).join('|') ||
    JSON.stringify(group)
  );
}

function mergeActiveExclusionGroup(groupMap, group, cleanedExcludeWords) {
  const groupKey = getExclusionGroupKey(group);
  const existing = groupMap.get(groupKey);
  if (existing) {
    existing.excludeWords = Array.from(new Set([...existing.excludeWords, ...cleanedExcludeWords]));
    return;
  }
  groupMap.set(groupKey, {
    ...group,
    excludeWords: cleanedExcludeWords.slice(),
  });
}

function getActiveExclusions(keywords) {
  const keywordSet = new Set((keywords || []).filter(Boolean));
  if (keywordSet.size === 0 || !state.exclusionGroups || state.exclusionGroups.length === 0) {
    return { excludeWords: [], groups: [] };
  }

  const exclusions = new Set();
  const groupMap = new Map();

  for (const keyword of keywordSet) {
    for (const group of state.exclusionGroups) {
      if (!group || group.enabled === false) continue;
      if (!matchesExclusionTrigger(keyword, group)) continue;

      const cleanedExcludeWords = getCleanedExcludeWords(group, keywordSet);
      if (cleanedExcludeWords.length === 0) continue;

      cleanedExcludeWords.forEach((word) => exclusions.add(word));
      mergeActiveExclusionGroup(groupMap, group, cleanedExcludeWords);
    }
  }

  return {
    excludeWords: Array.from(exclusions),
    groups: Array.from(groupMap.values()),
  };
}

/**
 * 实时判断卡片是否应该被排除（降级逻辑，用于缺少 excludedGroups 字段的卡片）
 * @param {Object} card - 卡片对象
 * @param {Object} activeExclusions - 激活的排除词信息
 * @returns {boolean} true 表示应该排除
 */
function buildRealtimeExclusionSearchText(card) {
  return [
    card.title || '',
    card.searchText || '',
    card.snippet || '',
    card.content || '',
  ].join(' ').toLowerCase();
}

function hasRealtimeExcludeWord(searchText, activeExclusions) {
  const excludeWords = Array.isArray(activeExclusions.excludeWords)
    ? activeExclusions.excludeWords
    : [];

  return excludeWords.some((excludeWord) => {
    if (!excludeWord) return false;
    return searchText.includes(excludeWord.toLowerCase());
  });
}

function stripExcludeWordsFromText(text, excludeWords) {
  let result = text;
  (excludeWords || [])
    .map((word) => (word || '').toLowerCase())
    .filter(Boolean)
    .forEach((excludeWord) => {
      let index = result.indexOf(excludeWord);
      while (index !== -1) {
        result = result.slice(0, index) + result.slice(index + excludeWord.length);
        index = result.indexOf(excludeWord, index);
      }
    });
  return result;
}

function containsRealtimeTriggerIndependently(searchText, activeExclusions) {
  const activeGroups = Array.isArray(activeExclusions.groups)
    ? activeExclusions.groups
    : [];

  return activeGroups.some((group) => {
    const triggerWords = Array.isArray(group?.triggerWords)
      ? group.triggerWords
      : [];
    const groupExcludeWords = Array.isArray(group?.excludeWords)
      ? group.excludeWords
      : [];
    const strippedText = stripExcludeWordsFromText(searchText, groupExcludeWords);

    return triggerWords.some((trigger) => {
      const triggerLower = (trigger || '').toLowerCase();
      if (!triggerLower) return false;
      return strippedText.includes(triggerLower);
    });
  });
}

function shouldExcludeCardRealtime(card, activeExclusions) {
  if (!activeExclusions || activeExclusions.excludeWords.length === 0) {
    return false;
  }

  const searchText = buildRealtimeExclusionSearchText(card);
  if (!hasRealtimeExcludeWord(searchText, activeExclusions)) {
    return false;
  }

  return !containsRealtimeTriggerIndependently(searchText, activeExclusions);
}

/**
 * 判断卡片是否应该被排除
 * @param {Object} card - 卡片对象
 * @param {Object} activeExclusions - 激活的排除词信息
 * @returns {boolean} true 表示应该排除
 */
function hasAffectedTriggerMatch(activeGroup, cardGroup) {
  return activeGroup.triggerWords.some((trigger) =>
    (cardGroup.affectedTriggers || []).includes(trigger)
  );
}

function shouldExcludeCardByPrecomputedGroups(card, activeExclusions) {
  for (const activeGroup of activeExclusions.groups) {
    for (const cardGroup of card.excludedGroups) {
      if (cardGroup.groupId !== activeGroup.id) continue;
      if (hasAffectedTriggerMatch(activeGroup, cardGroup)) {
        return true;
      }
    }
  }
  return false;
}

function shouldExcludeCard(card, activeExclusions) {
  if (!card.excludedGroups || card.excludedGroups.length === 0) {
    return shouldExcludeCardRealtime(card, activeExclusions);
  }
  return shouldExcludeCardByPrecomputedGroups(card, activeExclusions);
}
