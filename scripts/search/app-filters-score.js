'use strict';

function evaluateCard(card, tokensLower) {
  return evaluateCardWithNormalizedType(card, tokensLower, card?.type);
}

function normalizeSearchFieldText(text) {
  if (!text) return '';
  const lower = String(text).toLowerCase();
  const { normalized } = normalizeIntervals(lower);
  return normalized;
}

function normalizeCollapsedPhraseText(text) {
  return normalizeSearchFieldText(text).replace(/[\s;；:：,，.。!！?？'"“”‘’`~\-—_()[\]{}<>《》\/\\|]+/g, '');
}

function createCachedSearchField(text, baseWeight) {
  const normalizedText = normalizeSearchFieldText(text);
  return {
    text: normalizedText,
    compactText: normalizedText.replace(/\s+/g, ''),
    collapsedText: normalizeCollapsedPhraseText(normalizedText),
    baseWeight,
  };
}

function uniqueStructuredTerms(terms) {
  const seen = new Set();
  const output = [];
  (terms || []).forEach((term) => {
    const value = String(term || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    output.push(value);
  });
  return output;
}

function splitStructuredTitleTerms(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (/[;；]/.test(raw)) {
    return uniqueStructuredTerms(raw.split(/\s*[;；]\s*/));
  }
  return uniqueStructuredTerms([raw]);
}

function extractDefinitionTitleContent(card) {
  const rawTitle = String(card?.title || '').trim();
  if (!rawTitle) return '';

  let match = rawTitle.match(/^【定义\s*(?:>>|：)\s*.*?】(.*)$/);
  if (match) {
    return String(match[1] || '').replace(/^\s*[;；]\s*/, '').trim();
  }

  match = rawTitle.match(/^【定义】(.*)$/);
  if (match) {
    return String(match[1] || '').replace(/^\s*[;；]\s*/, '').trim();
  }

  return rawTitle.replace(/^\s*[;；]\s*/, '').trim();
}

function extractDefinitionSearchTerms(card, normalizedType) {
  if (normalizedType !== '定义') {
    return {
      coreTerm: '',
      titleLinkWords: '',
    };
  }

  const explicitTerms = splitStructuredTitleTerms(card?.titleLinkWords || '');
  const fallbackTerms = explicitTerms.length > 0
    ? explicitTerms
    : splitStructuredTitleTerms(extractDefinitionTitleContent(card));
  const coreTerm = fallbackTerms.length > 0 ? fallbackTerms[0] : '';

  return {
    coreTerm: normalizeSearchFieldText(coreTerm),
    titleLinkWords: normalizeSearchFieldText(fallbackTerms.join('; ')),
  };
}

function getCachedSearchFields(card, normalizedType) {
  if (!card || typeof card !== 'object') {
    return {
      coreTerm: createCachedSearchField('', 0),
      titleLinkWords: createCachedSearchField('', 0),
      title: createCachedSearchField('', 60),
      searchText: createCachedSearchField('', 25),
      keywords: createCachedSearchField('', 20),
      prefix: createCachedSearchField('', 18),
      subtype: createCachedSearchField('', 14),
      type: createCachedSearchField(normalizedType, 12),
      snippet: createCachedSearchField('', 8),
    };
  }

  const cached = normalizedCardFieldCache.get(card);
  if (cached && cached.normalizedType === normalizedType) {
    return cached.fields;
  }

  const definitionTerms = extractDefinitionSearchTerms(card, normalizedType);
  const isDefinition = normalizedType === '定义';
  const fields = {
    coreTerm: createCachedSearchField(definitionTerms.coreTerm, isDefinition ? 92 : 0),
    titleLinkWords: createCachedSearchField(definitionTerms.titleLinkWords, isDefinition ? 70 : 0),
    title: createCachedSearchField(card.title, isDefinition ? 42 : 60),
    searchText: createCachedSearchField(card.searchText, isDefinition ? 18 : 25),
    keywords: createCachedSearchField(card.keywords, 20),
    prefix: createCachedSearchField(card.prefix, isDefinition ? 8 : 18),
    subtype: createCachedSearchField(card.classificationSubtype, 14),
    type: createCachedSearchField(normalizedType, isDefinition ? 10 : 12),
    snippet: createCachedSearchField(card.snippet, isDefinition ? 6 : 8),
  };

  normalizedCardFieldCache.set(card, {
    normalizedType,
    fields,
    fieldEntries: Object.entries(fields),
    coarseText: [
      fields.coreTerm.text,
      fields.titleLinkWords.text,
      fields.title.text,
      fields.searchText.text,
      fields.keywords.text,
      fields.prefix.text,
      fields.subtype.text,
      fields.type.text,
      fields.snippet.text,
    ].filter(Boolean).join(' '),
  });

  return fields;
}

function getCachedSearchRecord(card, normalizedType) {
  getCachedSearchFields(card, normalizedType);
  return normalizedCardFieldCache.get(card) || {
    normalizedType,
    fields: getCachedSearchFields(null, normalizedType),
    fieldEntries: [],
    coarseText: '',
  };
}

function getDensityMultiplier(density) {
  if (density < 0.1) return 0.8;
  if (density < 0.3) return 1.0;
  if (density < 0.5) return 1.0 + (density - 0.3) * 2.5;
  return 1.5 + density;
}

function getSearchFieldLengthBonus(totalLength) {
  if (totalLength < 20) return 1.3;
  if (totalLength > 100) return 0.85;
  return 1.0;
}

function calculateUsageContribution(usageScore) {
  const normalized = Math.min(1000, Math.max(0, Number(usageScore) || 0));
  if (normalized <= 0) return 0;
  return 40 * normalized / (normalized + 100);
}

function getTokenOccurrenceDecayFactor(occurrenceCount) {
  if (occurrenceCount === 1) return 1.0;
  if (occurrenceCount === 2) return 0.6;
  if (occurrenceCount === 3) return 0.4;
  return 0.2;
}

function calculateMatchedFieldWeight(fieldText, token, baseWeight, occurrenceCount) {
  const matchedLength = token.length;
  const totalLength = fieldText.length;
  const density = totalLength > 0 ? matchedLength / totalLength : 0;
  const densityMultiplier = getDensityMultiplier(density);
  const lengthBonus = getSearchFieldLengthBonus(totalLength);
  const decayFactor = getTokenOccurrenceDecayFactor(occurrenceCount);
  return baseWeight * densityMultiplier * lengthBonus * decayFactor;
}

function evaluateTokenAcrossFields(token, fieldEntries, tokenOccurrences, options = {}) {
  let hit = false;
  let scoreDelta = 0;
  const ignoreWhitespace = options.ignoreWhitespace === true;
  const comparableToken = ignoreWhitespace
    ? normalizeWhitespaceInsensitiveSearchText(token)
    : token;
  if (!comparableToken) return { hit, scoreDelta };
  const occurrenceKey = ignoreWhitespace ? `phrase:${comparableToken}` : comparableToken;

  for (const [, fieldData] of fieldEntries) {
    const { text: fieldText, compactText, baseWeight } = fieldData;
    const comparableFieldText = ignoreWhitespace
      ? compactText
      : fieldText;
    if (!comparableFieldText || !comparableFieldText.includes(comparableToken)) continue;

    const occurrenceCount = (tokenOccurrences.get(occurrenceKey) || 0) + 1;
    tokenOccurrences.set(occurrenceKey, occurrenceCount);
    scoreDelta += calculateMatchedFieldWeight(
      comparableFieldText,
      comparableToken,
      baseWeight,
      occurrenceCount,
    );
    hit = true;
  }

  return { hit, scoreDelta };
}

function copyTokenOccurrences(source) {
  return new Map(source || []);
}

function replaceTokenOccurrences(target, source) {
  target.clear();
  source.forEach((value, key) => {
    target.set(key, value);
  });
}

function normalizeEvaluationTokenGroups(tokensLower, options = {}) {
  if (options.tokenGroupsAreNormalized === true && Array.isArray(options.tokenGroupsLower)) {
    return options.tokenGroupsLower;
  }
  if (Array.isArray(options.tokenGroupsLower) && options.tokenGroupsLower.length > 0) {
    return options.tokenGroupsLower
      .map((group) => (Array.isArray(group) ? group : [group])
        .map((token) => String(token || '').trim().toLowerCase())
        .filter(Boolean))
      .filter((group) => group.length > 0);
  }

  return (tokensLower || [])
    .map((token) => String(token || '').trim().toLowerCase())
    .filter(Boolean)
    .map((token) => [token]);
}

function evaluateTokenGroupAcrossFields(tokenGroup, fieldEntries, tokenOccurrences, options = {}) {
  if (tokenGroup.length === 1) {
    const token = tokenGroup[0];
    const result = evaluateTokenAcrossFields(token, fieldEntries, tokenOccurrences, options);
    return {
      hit: result.hit,
      scoreDelta: result.scoreDelta,
      token: result.hit ? token : '',
    };
  }

  let bestResult = { hit: false, scoreDelta: 0, token: '' };
  let bestOccurrences = null;

  tokenGroup.forEach((token, index) => {
    if (!token) return;
    const trialOccurrences = copyTokenOccurrences(tokenOccurrences);
    const result = evaluateTokenAcrossFields(token, fieldEntries, trialOccurrences, options);
    if (!result.hit) return;

    const synonymWeight = index === 0 ? 1 : 0.86;
    const weightedScore = result.scoreDelta * synonymWeight;
    if (!bestResult.hit || weightedScore > bestResult.scoreDelta) {
      bestResult = {
        hit: true,
        scoreDelta: weightedScore,
        token,
      };
      bestOccurrences = trialOccurrences;
    }
  });

  if (bestOccurrences) {
    replaceTokenOccurrences(tokenOccurrences, bestOccurrences);
  }

  return bestResult;
}

function calculateCoverageBonus(matchedCount, totalTokens) {
  if (!totalTokens) return 0;
  const coverageRatio = matchedCount / totalTokens;
  return {
    coverageRatio,
    coverageBonus: coverageRatio * 30,
  };
}

function getPhraseTokenGroupIndexes(options = {}) {
  if (options.phraseTokenGroupIndexSet instanceof Set) {
    return options.phraseTokenGroupIndexSet;
  }
  return new Set(
    Array.isArray(options.phraseTokenGroupIndexes) ? options.phraseTokenGroupIndexes : [],
  );
}

function calculateDefinitionPhraseBonusForQuery(fields, rawQueryCollapsed, tokenCount) {
  const coreCollapsed = fields.coreTerm.collapsedText;
  const titleLinkCollapsed = fields.titleLinkWords.collapsedText;
  const titleCollapsed = fields.title.collapsedText;
  const searchCollapsed = fields.searchText.collapsedText;
  const prefixCollapsed = fields.prefix.collapsedText;

  const coreMatches = coreCollapsed.includes(rawQueryCollapsed);
  const titleLinkMatches = titleLinkCollapsed.includes(rawQueryCollapsed);
  const titleMatches = titleCollapsed.includes(rawQueryCollapsed);
  const searchMatches = searchCollapsed.includes(rawQueryCollapsed);
  const prefixMatches = prefixCollapsed.includes(rawQueryCollapsed);

  let bonus = 0;

  if (coreCollapsed === rawQueryCollapsed) {
    bonus += 260;
  } else if (coreMatches) {
    bonus += 190;
  }

  if (titleLinkMatches) {
    bonus += 150;
  }

  if (titleMatches) {
    bonus += 45;
  }

  if (searchMatches) {
    bonus += 18;
  }

  if (prefixMatches) {
    bonus += (coreMatches || titleLinkMatches) ? 8 : 2;
  }

  if (prefixMatches && !coreMatches && !titleLinkMatches) {
    bonus -= 28;
  }

  if (tokenCount <= 1) {
    if (coreCollapsed === rawQueryCollapsed) {
      bonus += 180;
    } else if (titleLinkCollapsed === rawQueryCollapsed) {
      bonus += 120;
    } else if (coreMatches || titleLinkMatches) {
      bonus += 60;
    } else if (prefixMatches) {
      bonus -= 36;
    }
  }

  return bonus;
}

function calculateDefinitionPhraseBonus(fields, options = {}) {
  const tokenCount = Number(options.tokenCount) || 0;
  const variants = Array.isArray(options.rawQueryCollapsedVariants) && options.rawQueryCollapsedVariants.length > 0
    ? options.rawQueryCollapsedVariants
    : [options.rawQueryCollapsed];
  let bestBonus = 0;

  variants.forEach((variant) => {
    const rawQueryCollapsed = String(variant || '').trim();
    if (!rawQueryCollapsed) return;
    bestBonus = Math.max(bestBonus, calculateDefinitionPhraseBonusForQuery(fields, rawQueryCollapsed, tokenCount));
  });

  return bestBonus;
}

function evaluateCardWithNormalizedType(card, tokensLower, normalizedType, options = {}) {
  const tokenGroupsLower = normalizeEvaluationTokenGroups(tokensLower, options);
  if (tokenGroupsLower.length === 0) {
    return { score: card.score || 0, matchCount: 0, matchedTokens: new Set() };
  }

  let score = 0;
  const matchedTokens = new Set();
  const searchRecord = getCachedSearchRecord(card, normalizedType);
  const fields = searchRecord.fields;
  const fieldEntries = searchRecord.fieldEntries;
  const tokenOccurrences = new Map();
  const phraseTokenGroupIndexes = getPhraseTokenGroupIndexes(options);

  tokenGroupsLower.forEach((tokenGroup, index) => {
    const { hit, scoreDelta, token } = evaluateTokenGroupAcrossFields(
      tokenGroup,
      fieldEntries,
      tokenOccurrences,
      { ignoreWhitespace: phraseTokenGroupIndexes.has(index) },
    );
    score += scoreDelta;
    if (hit && token) matchedTokens.add(token);
  });

  const { coverageRatio, coverageBonus } = calculateCoverageBonus(matchedTokens.size, tokenGroupsLower.length);
  score += coverageBonus;
  if (normalizedType === '定义') {
    score += calculateDefinitionPhraseBonus(fields, options);
  }

  return {
    score,
    matchCount: matchedTokens.size,
    matchedTokens,
    coverageRatio,
  };
}

function extractSnippet(text, tokensLower) {
  if (!text) return '';
  if (!tokensLower || tokensLower.length === 0) {
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }

  const lower = text.toLowerCase();
  let firstIndex = -1;
  tokensLower.forEach((token) => {
    const idx = lower.indexOf(token);
    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
      firstIndex = idx;
    }
  });

  if (firstIndex === -1) {
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }

  const start = Math.max(0, firstIndex - 30);
  const end = Math.min(text.length, firstIndex + 80);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
