'use strict';

(function exposeMathTermSearch(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MNKBMathTermSearch = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMathTermSearchAPI() {
  const RUNTIME_SCHEMA = 'mnkb.math-term-corpus.runtime.v1';
  const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;
  const LATIN_TOKEN_CHAR_RE = /[A-Za-z0-9_]/;
  const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
  const CONVERGENCE_CUES = ['收敛', 'convergence', 'converges', 'tends to', '→'];
  const QUERY_PUNCTUATION_RE = /[\s;；:：,，.。!！?？'"“”‘’`~\-—_()[\]{}<>《》/\\|]+/g;
  const GENERIC_SURFACES = new Set(['定义', '归类', '命题', '定理', '拓扑', '收敛', '空间', '函数', '算子']);
  const TYPE_ROLE = Object.freeze({
    '定义': { key: 'definition', label: '精准定义', tier: 1, limit: 12 },
    '归类': { key: 'classification', label: '相关归类', tier: 2, limit: 20 },
    '命题': { key: 'proposition', label: '关键命题', tier: 3, limit: 28 },
    '例子': { key: 'example', label: '相关例子', tier: 4, limit: 10 },
    '反例': { key: 'counterexample', label: '相关反例', tier: 4, limit: 10 },
    '思想方法': { key: 'method', label: '思想方法', tier: 5, limit: 10 },
    '问题': { key: 'question', label: '相关问题', tier: 5, limit: 10 },
  });

  function normalizeText(value) {
    let text = value === null || typeof value === 'undefined' ? '' : String(value);
    text = text.replace(ZERO_WIDTH_RE, '');
    if (typeof text.normalize === 'function') {
      text = text.normalize('NFC');
    }
    return text
      .replace(/[‐‑‒–—﹘－]/g, '-')
      .replace(/[’‘＇]/g, "'")
      .replace(/[\u00A0\u202F\u2007]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function compactText(value) {
    return normalizeText(value).replace(QUERY_PUNCTUATION_RE, '');
  }

  function containsCJK(value) {
    return CJK_RE.test(String(value || ''));
  }

  function tokenBoundaryOK(text, start, end, term) {
    if (containsCJK(term)) return true;
    const left = start > 0 ? text[start - 1] : '';
    const right = end < text.length ? text[end] : '';
    const first = term ? term[0] : '';
    const last = term ? term[term.length - 1] : '';
    if (first && LATIN_TOKEN_CHAR_RE.test(first) && left && LATIN_TOKEN_CHAR_RE.test(left)) return false;
    if (last && LATIN_TOKEN_CHAR_RE.test(last) && right && LATIN_TOKEN_CHAR_RE.test(right)) return false;
    return true;
  }

  function termOccursOutsideSpan(queryNormalized, cue, start, end) {
    const normalizedCue = normalizeText(cue);
    if (!normalizedCue) return false;
    let position = queryNormalized.indexOf(normalizedCue);
    while (position >= 0) {
      const cueEnd = position + normalizedCue.length;
      if (cueEnd <= start || position >= end) return true;
      position = queryNormalized.indexOf(normalizedCue, position + 1);
    }
    return false;
  }

  function chooseLongestNonOverlapping(matches) {
    const occupied = [];
    const selected = [];
    matches
      .slice()
      .sort((a, b) => {
        const lengthDiff = (b.end - b.start) - (a.end - a.start);
        if (lengthDiff !== 0) return lengthDiff;
        if (a.start !== b.start) return a.start - b.start;
        return a.normalized.localeCompare(b.normalized);
      })
      .forEach((match) => {
        const overlaps = occupied.some(([start, end]) => !(match.end <= start || match.start >= end));
        if (overlaps) return;
        occupied.push([match.start, match.end]);
        selected.push(match);
      });
    return selected.sort((a, b) => a.start - b.start || a.end - b.end || a.normalized.localeCompare(b.normalized));
  }

  function createRuntimeEngine(runtime) {
    if (!runtime || runtime.$schema !== RUNTIME_SCHEMA || !Array.isArray(runtime.concepts)) {
      throw new Error('数学术语库格式不受支持');
    }

    const concepts = runtime.concepts.filter((concept) => concept && concept.id && concept.normalized);
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    const surfaceIndex = new Map();
    const appendSurface = (surface, hit) => {
      const normalized = normalizeText(surface);
      if (!normalized) return;
      if (!surfaceIndex.has(normalized)) surfaceIndex.set(normalized, []);
      surfaceIndex.get(normalized).push(hit);
    };

    concepts.forEach((concept) => {
      appendSurface(concept.normalized, {
        conceptId: concept.id,
        text: concept.canonical,
        relation: 'canonical',
        direction: 'bidirectional',
        confidence: 1,
        expandable: true,
        requiresAny: [],
        rejectWhenAny: [],
        senseIds: (concept.senses || []).map((sense) => sense.id),
      });
      (concept.aliases || []).forEach((alias) => {
        appendSurface(alias.normalized || alias.text, {
          conceptId: concept.id,
          ...alias,
        });
      });
    });

    const reverseRelations = new Map();
    concepts.forEach((concept) => {
      (concept.relations || []).forEach((relation) => {
        if (!relation || !relation.target) return;
        if (!reverseRelations.has(relation.target)) reverseRelations.set(relation.target, []);
        reverseRelations.get(relation.target).push({
          type: relation.type,
          conceptId: concept.id,
        });
      });
    });

    return {
      schema: runtime.$schema,
      version: runtime.version || runtime.corpusVersion || '',
      concepts,
      byId,
      surfaceIndex,
      surfaces: Array.from(surfaceIndex.keys()).sort((a, b) => b.length - a.length || a.localeCompare(b)),
      reverseRelations,
    };
  }

  function findRuntimeMatches(engine, queryNormalized) {
    const matches = [];
    engine.surfaces.forEach((surface) => {
      let start = queryNormalized.indexOf(surface);
      while (start >= 0) {
        const end = start + surface.length;
        if (tokenBoundaryOK(queryNormalized, start, end, surface)) {
          matches.push({ start, end, normalized: surface, surface: queryNormalized.slice(start, end) });
        }
        start = queryNormalized.indexOf(surface, start + 1);
      }
    });
    return chooseLongestNonOverlapping(matches);
  }

  function collectLexicalCandidates(engine, queryNormalized, selectedMatches) {
    const candidates = [];
    const rejectedCandidates = [];
    const matchedConceptIds = new Set();

    selectedMatches.forEach((match) => {
      const hits = engine.surfaceIndex.get(match.normalized) || [];
      hits.forEach((hit) => {
        const concept = engine.byId.get(hit.conceptId);
        if (!concept) return;
        const requires = Array.isArray(hit.requiresAny) ? hit.requiresAny : [];
        const rejects = Array.isArray(hit.rejectWhenAny) ? hit.rejectWhenAny : [];
        const satisfiedRequires = requires.filter((cue) => (
          termOccursOutsideSpan(queryNormalized, cue, match.start, match.end)
        ));
        const hitRejects = rejects.filter((cue) => (
          termOccursOutsideSpan(queryNormalized, cue, match.start, match.end)
        ));
        const requiresSatisfied = requires.length === 0 || satisfiedRequires.length > 0;

        if (hitRejects.length > 0) {
          rejectedCandidates.push({
            matchedSurface: match.surface,
            conceptId: concept.id,
            canonical: concept.canonical,
            matchedRelation: hit.relation,
            rejectedBy: hitRejects,
          });
          return;
        }

        const allowedSenseIds = new Set(
          Array.isArray(hit.senseIds) && hit.senseIds.length > 0
            ? hit.senseIds
            : (concept.senses || []).map((sense) => sense.id),
        );
        const activeSenses = [];
        (concept.senses || []).forEach((sense) => {
          if (!allowedSenseIds.has(sense.id)) return;
          const contextHits = (sense.contextTerms || []).filter((cue) => (
            termOccursOutsideSpan(queryNormalized, cue, match.start, match.end)
          ));
          const senseRejects = (sense.rejectTerms || []).filter((cue) => (
            termOccursOutsideSpan(queryNormalized, cue, match.start, match.end)
          ));
          if (senseRejects.length > 0) {
            rejectedCandidates.push({
              matchedSurface: match.surface,
              conceptId: concept.id,
              canonical: concept.canonical,
              senseId: sense.id,
              matchedRelation: hit.relation,
              rejectedBy: senseRejects,
            });
            return;
          }
          activeSenses.push({
            sense,
            contextHits,
            resolved: requiresSatisfied && (contextHits.length > 0 || allowedSenseIds.size === 1),
          });
        });

        const multipleSenses = activeSenses.length > 1;
        activeSenses.forEach(({ sense, contextHits, resolved }) => {
          let expandable = !!hit.expandable && requiresSatisfied && (resolved || !multipleSenses);
          if ((hit.relation === 'ambiguousSurface' || hit.relation === 'contextualSynonym') && !requiresSatisfied) {
            expandable = false;
          }
          if (multipleSenses && contextHits.length === 0) expandable = false;

          let score = 1 + Math.min(0.5, (match.end - match.start) / 30);
          score += Number(hit.confidence || 1) / 10;
          score += Number(sense.priority || 0);
          if (contextHits.length > 0) score += 0.35;
          if (requires.length > 0 && satisfiedRequires.length > 0) score += 0.25;

          candidates.push({
            matchedSurface: match.surface,
            matchedNormalized: match.normalized,
            conceptId: concept.id,
            canonical: concept.canonical,
            senseId: sense.id,
            senseKind: sense.kind,
            matchedRelation: hit.relation,
            direction: hit.direction || 'bidirectional',
            expandable,
            resolved: !!(resolved && (!multipleSenses || contextHits.length > 0)),
            satisfiedRequiresAny: satisfiedRequires,
            matchedSenseContext: contextHits,
            sourceNoteIds: Array.from(new Set(sense.sourceNoteIds || [])).sort(),
            score: Number(score.toFixed(4)),
          });
          matchedConceptIds.add(concept.id);
        });
      });
    });

    return { candidates, rejectedCandidates, matchedConceptIds };
  }

  function appendStructuralConvergenceCandidates(engine, queryNormalized, lexical) {
    const convergencePresent = CONVERGENCE_CUES.some((cue) => queryNormalized.includes(normalizeText(cue)));
    if (!convergencePresent) return;

    Array.from(lexical.matchedConceptIds).forEach((matchedId) => {
      (engine.reverseRelations.get(matchedId) || []).forEach((relation) => {
        if (relation.type !== 'convergenceOf') return;
        const concept = engine.byId.get(relation.conceptId);
        if (!concept) return;
        (concept.senses || []).forEach((sense) => {
          lexical.candidates.push({
            matchedSurface: queryNormalized.includes('收敛') ? '收敛' : 'convergence',
            matchedNormalized: queryNormalized.includes('收敛') ? '收敛' : 'convergence',
            conceptId: concept.id,
            canonical: concept.canonical,
            senseId: sense.id,
            senseKind: sense.kind,
            matchedRelation: 'convergenceOf',
            direction: 'queryToCanonical',
            expandable: true,
            resolved: true,
            satisfiedRequiresAny: [queryNormalized.includes('收敛') ? '收敛' : 'convergence'],
            matchedSenseContext: [],
            sourceNoteIds: Array.from(new Set(sense.sourceNoteIds || [])).sort(),
            score: 2.25,
          });
        });
      });
    });
  }

  function deduplicateCandidates(candidates) {
    const deduplicated = new Map();
    candidates.forEach((candidate) => {
      const key = `${candidate.conceptId}\u0001${candidate.senseId}`;
      const previous = deduplicated.get(key);
      const candidateRank = [candidate.score, candidate.expandable ? 1 : 0, candidate.resolved ? 1 : 0];
      const previousRank = previous
        ? [previous.score, previous.expandable ? 1 : 0, previous.resolved ? 1 : 0]
        : null;
      const outranksPrevious = !previousRank
        || candidateRank[0] > previousRank[0]
        || (candidateRank[0] === previousRank[0] && candidateRank[1] > previousRank[1])
        || (
          candidateRank[0] === previousRank[0]
          && candidateRank[1] === previousRank[1]
          && candidateRank[2] > previousRank[2]
        );
      if (!previous || outranksPrevious) {
        deduplicated.set(key, { ...candidate });
        return;
      }
      previous.sourceNoteIds = Array.from(new Set([
        ...(previous.sourceNoteIds || []),
        ...(candidate.sourceNoteIds || []),
      ])).sort();
    });
    return Array.from(deduplicated.values()).sort((a, b) => (
      b.score - a.score || a.canonical.localeCompare(b.canonical) || a.senseId.localeCompare(b.senseId)
    ));
  }

  function addExpansionTerms(engine, queryNormalized, candidates) {
    candidates.forEach((candidate) => {
      const expansionTerms = [];
      if (candidate.expandable) {
        const concept = engine.byId.get(candidate.conceptId);
        expansionTerms.push(concept.canonical);
        (concept.aliases || []).forEach((alias) => {
          if (!(alias.senseIds || []).includes(candidate.senseId)) return;
          if (!alias.expandable || alias.direction !== 'bidirectional') return;
          const requires = alias.requiresAny || [];
          const rejects = alias.rejectWhenAny || [];
          if (requires.length > 0 && !requires.some((cue) => queryNormalized.includes(normalizeText(cue)))) return;
          if (rejects.some((cue) => queryNormalized.includes(normalizeText(cue)))) return;
          expansionTerms.push(alias.text);
        });
      }
      candidate.expansionTerms = Array.from(new Set(expansionTerms)).sort((a, b) => (
        normalizeText(a).localeCompare(normalizeText(b)) || a.localeCompare(b)
      ));
    });
  }

  function collectRelatedConcepts(engine, candidates) {
    const related = new Map();
    const activeIds = new Set(candidates.map((candidate) => candidate.conceptId));
    Array.from(activeIds).sort().forEach((conceptId) => {
      const concept = engine.byId.get(conceptId);
      (concept?.relations || []).forEach((relation) => {
        if (['synonym', 'translation', 'abbreviation', 'notation', 'spellingVariant', 'contextualSynonym', 'ambiguousSurface'].includes(relation.type)) return;
        const target = engine.byId.get(relation.target);
        if (!target) return;
        const key = `${conceptId}\u0001${relation.type}\u0001${target.id}`;
        related.set(key, {
          fromConceptId: conceptId,
          type: relation.type,
          conceptId: target.id,
          canonical: target.canonical,
        });
      });
    });
    return Array.from(related.values()).sort((a, b) => (
      a.fromConceptId.localeCompare(b.fromConceptId)
      || a.type.localeCompare(b.type)
      || a.conceptId.localeCompare(b.conceptId)
    ));
  }

  function queryRuntime(engine, query) {
    const queryNormalized = normalizeText(query);
    const matches = findRuntimeMatches(engine, queryNormalized);
    const lexical = collectLexicalCandidates(engine, queryNormalized, matches);
    appendStructuralConvergenceCandidates(engine, queryNormalized, lexical);
    const candidates = deduplicateCandidates(lexical.candidates);
    addExpansionTerms(engine, queryNormalized, candidates);

    return {
      query: String(query || ''),
      normalized: queryNormalized,
      matches,
      candidates,
      recallCandidates: selectCandidatesForRecall(candidates),
      rejectedCandidates: lexical.rejectedCandidates.sort((a, b) => (
        String(a.canonical || '').localeCompare(String(b.canonical || ''))
        || String(a.senseId || '').localeCompare(String(b.senseId || ''))
      )),
      relatedConcepts: collectRelatedConcepts(engine, candidates),
    };
  }

  function matchSynonymPattern(query, pattern, caseSensitive) {
    const parts = pattern.split('{{}}');
    if (parts.length < 2) return null;
    const captures = [];
    let cursor = 0;
    // Match ordered literal pieces. Chained (.*?) captures can backtrack
    // exponentially when a final literal is missing from a short query.
    for (let index = 0; index < parts.length; index += 1) {
      const literal = parts[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = `${index === 0 ? '^' : ''}${literal}${index === parts.length - 1 ? '$' : ''}`;
      const match = new RegExp(expression, caseSensitive ? '' : 'i').exec(query.slice(cursor));
      if (!match) return null;
      if (index > 0) captures.push(query.slice(cursor, cursor + match.index));
      cursor += match.index + match[0].length;
    }
    return captures;
  }

  function augmentQueryWithSynonyms(query, groups = []) {
    const original = String(query || '').trim();
    if (!original || !Array.isArray(groups) || groups.length === 0) return original;
    const terms = [original];
    const appended = new Set();
    groups.forEach((group) => {
      if (!group || group.enabled === false || !Array.isArray(group.words)) return;
      const words = group.words.filter((word) => typeof word === 'string').map((word) => word.trim()).filter(Boolean);
      const caseSensitive = group.caseSensitive === true;
      const comparableQuery = caseSensitive ? original : original.toLowerCase();
      const occurs = (word) => hasBoundedTerm(comparableQuery, caseSensitive ? word : word.toLowerCase());
      const append = (word) => {
        const key = caseSensitive ? word : word.toLowerCase();
        if (!word || occurs(word) || appended.has(key)) return;
        appended.add(key);
        terms.push(word);
      };
      const triggers = Array.isArray(group.contextTriggers)
        ? group.contextTriggers.filter((trigger) => typeof trigger === 'string').map((trigger) => trigger.trim()).filter(Boolean)
        : [];
      if (Array.isArray(group.contextTriggers) && group.contextTriggers.length > 0 && triggers.length === 0) return;
      if (triggers.length > 0) {
        const context = group.contextMode === 'all'
          ? triggers.every(occurs)
          : triggers.some(occurs);
        if (!context) return;
      }
      const literalWords = words.filter((word) => group.patternMode !== true || !word.includes('{{}}'));
      const matched = literalWords.some(occurs);
      if (matched) {
        literalWords.forEach(append);
      }
      if (group.patternMode === true) {
        words.forEach((pattern) => {
          if (!pattern.includes('{{}}')) return;
          const captures = matchSynonymPattern(original, pattern, caseSensitive);
          if (!captures) return;
          words.forEach((target) => {
            if (target === pattern) return;
            let captureIndex = 0;
            const variant = target.replace(/\{\{\}\}/g, () => captures[captureIndex++] || '');
            append(variant);
          });
        });
      }
    });
    return terms.join(' ');
  }

  function fieldValues(value) {
    const values = Array.isArray(value) ? value : [value];
    const output = [];
    values.forEach((item) => {
      const text = String(item || '').trim();
      if (!text) return;
      output.push(text);
      text.split(/\s*[;；]\s*/).forEach((part) => {
        if (part && part !== text) output.push(part);
      });
    });
    return Array.from(new Set(output));
  }

  function cardFields(card) {
    const fields = {
      titleLinkWords: fieldValues(card.titleLinkWords),
      prefix: fieldValues(card.prefix),
      content: fieldValues(card.content),
      keywords: fieldValues(card.keywords),
      title: fieldValues(card.title),
      searchText: fieldValues(card.searchText),
    };
    Object.keys(fields).forEach((field) => {
      fields[field] = fields[field].map((value) => {
        const normalized = normalizeText(value);
        return { normalized, compact: normalized.replace(QUERY_PUNCTUATION_RE, '') };
      });
    });
    return fields;
  }

  function selectCandidatesForRecall(candidates) {
    const allCandidates = Array.isArray(candidates) ? candidates : [];
    const specificResolved = allCandidates.filter((candidate) => (
      (candidate.resolved || candidate.expandable)
      && (
        candidate.matchedRelation === 'convergenceOf'
        || !GENERIC_SURFACES.has(normalizeText(candidate.matchedNormalized))
      )
    ));
    if (specificResolved.length > 0) return specificResolved;

    const resolved = allCandidates.filter((candidate) => candidate.resolved || candidate.expandable);
    return resolved.length > 0 ? resolved : allCandidates.slice(0, 8);
  }

  function createSearchTerms(analysis, query) {
    const terms = new Map();
    const append = (text, weight, source) => {
      const normalized = normalizeText(text);
      if (!normalized) return;
      const previous = terms.get(normalized);
      if (!previous || weight > previous.weight) {
        terms.set(normalized, { text: String(text), normalized, compact: compactText(text), weight, source });
      }
    };

    const normalizedQuery = normalizeText(query);
    if (normalizedQuery.length >= 2) append(query, 1.15, 'query');
    selectCandidatesForRecall(analysis.candidates).slice(0, 12).forEach((candidate) => {
      const weight = candidate.resolved ? 1.1 : (candidate.expandable ? 0.95 : 0.58);
      append(candidate.canonical, weight, candidate.matchedRelation === 'canonical' ? 'canonical' : 'concept');
      if (
        (candidate.resolved || candidate.expandable)
        && !GENERIC_SURFACES.has(normalizeText(candidate.matchedSurface))
      ) {
        append(candidate.matchedSurface, 0.82, 'matchedSurface');
      }
      (candidate.expansionTerms || []).forEach((term) => append(term, 0.9, 'safeAlias'));
    });
    (analysis.relatedConcepts || []).slice(0, 8).forEach((relation) => {
      append(relation.canonical, 0.45, 'related');
    });
    return Array.from(terms.values()).sort((a, b) => b.weight - a.weight || b.normalized.length - a.normalized.length);
  }

  function hasBoundedTerm(text, term) {
    if (!term) return false;
    let position = text.indexOf(term);
    while (position >= 0) {
      if (tokenBoundaryOK(text, position, position + term.length, term)) return true;
      position = text.indexOf(term, position + 1);
    }
    return false;
  }

  function bestFieldMatch(values, term) {
    let best = '';
    const termCompact = term.compact;
    values.forEach(({ normalized, compact }) => {
      if (!normalized) return;
      if (normalized === term.normalized || (termCompact && compact === termCompact)) {
        best = 'exact';
        return;
      }
      const normalizedContains = hasBoundedTerm(normalized, term.normalized);
      if (best !== 'exact' && term.normalized.length >= 2 && normalizedContains) {
        best = 'contains';
        return;
      }
      const compactContains = hasBoundedTerm(compact, termCompact);
      if (best === '' && termCompact.length >= 2 && compactContains) {
        best = 'contains';
      }
    });
    return best;
  }

  function roleForType(type, exactSource) {
    const base = Object.prototype.hasOwnProperty.call(TYPE_ROLE, type)
      ? TYPE_ROLE[type]
      : { key: 'other', label: '其它相关', tier: 5, limit: 10 };
    if (!exactSource) return base;
    if (type === '定义') return { ...base, tier: 0, label: '精准定义' };
    if (type === '命题') return { ...base, tier: 0, label: '精准命题' };
    return { ...base, tier: 0, label: '精准卡片' };
  }

  function scoreCard(card, terms, sourceEvidence) {
    const fields = cardFields(card);
    const reasonCodes = new Set();
    const concepts = new Set();
    let score = 0;
    let structuredScore = 0;
    let bestTerm = '';
    let bestTermSource = '';
    let bestSignalDelta = 0;
    const source = sourceEvidence.get(String(card.id || ''));
    if (source) {
      score += source.score;
      reasonCodes.add('sourceEvidence');
      source.concepts.forEach((concept) => concepts.add(concept));
    }

    const fieldWeights = {
      titleLinkWords: { exact: 320, contains: 170 },
      prefix: { exact: 250, contains: 135 },
      content: { exact: 230, contains: 120 },
      keywords: { exact: 170, contains: 90 },
      title: { exact: 155, contains: 80 },
      searchText: { exact: 42, contains: 24 },
    };

    terms.forEach((term) => {
      const genericFactor = GENERIC_SURFACES.has(term.normalized) ? 0.32 : 1;
      Object.keys(fieldWeights).forEach((fieldName) => {
        const match = bestFieldMatch(fields[fieldName], term);
        if (!match) return;
        const delta = fieldWeights[fieldName][match] * term.weight * genericFactor;
        if (fieldName !== 'searchText') structuredScore += delta;
        score += delta;
        if (delta > bestSignalDelta) {
          bestSignalDelta = delta;
          bestTerm = term.text;
          bestTermSource = term.source;
        }
        if (match === 'exact' && term.source === 'canonical') reasonCodes.add('canonicalExact');
        if (match === 'exact' && term.source === 'safeAlias') reasonCodes.add('aliasExact');
        if (fieldName !== 'searchText') reasonCodes.add(match === 'exact' ? 'structuredExact' : 'structuredContains');
        if (fieldName === 'searchText') reasonCodes.add('searchTextFallback');
        if (term.source === 'related') reasonCodes.add('relatedConcept');
      });
    });

    if (!source && structuredScore < 45) return null;
    if (source && structuredScore > 0) score += 80;

    const exactSource = !!source;
    let role = roleForType(String(card.type || '').trim(), exactSource);
    if (source?.structuralConvergence) {
      role = { ...role, tier: -1 };
    }
    if (!exactSource && bestTermSource === 'related') {
      role = { ...role, tier: Math.max(5, role.tier) };
    }
    return {
      card,
      score,
      tier: role.tier,
      role,
      exactSource,
      reasonCodes: Array.from(reasonCodes),
      concepts: Array.from(concepts),
      bestTerm,
      bestTermSource,
    };
  }

  function buildSourceEvidence(candidates) {
    const evidence = new Map();
    selectCandidatesForRecall(candidates).forEach((candidate) => {
      (candidate.sourceNoteIds || []).forEach((noteId) => {
        const key = String(noteId || '');
        if (!key) return;
        const current = evidence.get(key) || { score: 0, concepts: new Set(), structuralConvergence: false };
        const candidateScore = 1050
          + (candidate.resolved ? 220 : 0)
          + (candidate.expandable ? 100 : 0)
          + (candidate.matchedRelation === 'convergenceOf' ? 180 : 0)
          + candidate.score * 20;
        current.score = Math.max(current.score, candidateScore);
        current.structuralConvergence = current.structuralConvergence || candidate.matchedRelation === 'convergenceOf';
        current.concepts.add(candidate.canonical);
        evidence.set(key, current);
      });
    });
    return evidence;
  }

  function reasonLabel(scored) {
    const codes = new Set(scored.reasonCodes || []);
    if (codes.has('sourceEvidence')) return `术语库来源${scored.concepts.length ? ` · ${scored.concepts.slice(0, 2).join(' / ')}` : ''}`;
    if (scored.bestTermSource === 'related') return `结构关联概念${scored.bestTerm ? ` · ${scored.bestTerm}` : ''}`;
    if (codes.has('canonicalExact')) return `规范术语命中${scored.bestTerm ? ` · ${scored.bestTerm}` : ''}`;
    if (codes.has('aliasExact')) return `安全同义词命中${scored.bestTerm ? ` · ${scored.bestTerm}` : ''}`;
    if (codes.has('structuredExact')) return `标题字段精确命中${scored.bestTerm ? ` · ${scored.bestTerm}` : ''}`;
    if (codes.has('structuredContains')) return `知识主题相关${scored.bestTerm ? ` · ${scored.bestTerm}` : ''}`;
    if (codes.has('relatedConcept')) return '结构关联概念';
    return '补充字段相关';
  }

  function rankKnowledgeCards(cards, analysis, query, options = {}) {
    const terms = createSearchTerms(analysis, query);
    const sourceEvidence = buildSourceEvidence(analysis.candidates);
    const allowedTypes = Array.isArray(options.allowedTypes) && options.allowedTypes.length > 0
      ? new Set(options.allowedTypes)
      : null;
    const subtype = String(options.classificationSubtype || 'all');
    const scored = [];
    const seenIds = new Set();

    (Array.isArray(cards) ? cards : []).forEach((card) => {
      if (!card || !isStableCardId(card.id) || seenIds.has(card.id)) return;
      seenIds.add(card.id);
      const type = String(card.type || '').trim();
      if (allowedTypes && !allowedTypes.has(type)) return;
      if (subtype !== 'all' && type === '归类' && card.classificationSubtype !== subtype) return;
      const result = scoreCard(card, terms, sourceEvidence);
      if (result) scored.push(result);
    });

    scored.sort((a, b) => (
      a.tier - b.tier
      || b.score - a.score
      || String(a.card.title || '').localeCompare(String(b.card.title || ''))
    ));

    const maxCards = boundedCardLimit(options.maxCards, 80, 240);
    const roleCounts = new Map();
    const selected = [];
    scored.forEach((item) => {
      if (selected.length >= maxCards) return;
      const countKey = item.exactSource ? 'exactSource' : item.role.key;
      const count = roleCounts.get(countKey) || 0;
      const limit = item.exactSource ? 16 : item.role.limit;
      if (count >= limit) return;
      roleCounts.set(countKey, count + 1);
      selected.push(item);
    });

    const highlightTokens = terms
      .filter((term) => term.weight >= 0.8 && !GENERIC_SURFACES.has(term.normalized))
      .slice(0, 10)
      .map((term) => term.text);

    return {
      terms,
      cards: selected.map((item) => ({
        ...item.card,
        score: Number(item.score.toFixed(2)),
        __mnkbHighlightTokens: highlightTokens,
        __mnkbHighlightKey: `ai:${highlightTokens.map(normalizeText).join('\u0002')}`,
        __mnkbAISearch: {
          roleKey: item.role.key,
          roleLabel: item.role.label,
          reason: reasonLabel(item),
          reasonCodes: item.reasonCodes,
          conceptLabels: item.concepts,
          exactSource: item.exactSource,
          score: Number(item.score.toFixed(2)),
        },
      })),
      sourceEvidenceCount: sourceEvidence.size,
    };
  }

  function clipCandidateText(value, maxLength) {
    const text = Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean).join('; ')
      : String(value || '').trim();
    if (!text || text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
  }

  function candidateEvidence(card, field) {
    const evidence = Array.isArray(card?.searchEvidence) ? card.searchEvidence : [];
    const item = evidence.find((entry) => String(entry?.field || '') === field);
    return item ? item.text : '';
  }

  function buildAnswerQueryPlan(query, analysis = {}) {
    const text = String(query || '').trim();
    const concepts = [];
    const seenConcepts = new Set();
    (analysis.recallCandidates || analysis.candidates || []).forEach((candidate) => {
      const canonical = String(candidate?.canonical || '').trim();
      if (!canonical || seenConcepts.has(canonical)) return;
      seenConcepts.add(canonical);
      concepts.push(canonical);
    });

    let intent = 'find_related';
    let relation = '';
    let preferredCardTypes = [];
    if (/(什么是|是什么|何谓)/.test(text)) {
      intent = 'find_definition';
      preferredCardTypes = ['定义'];
    } else if (/(反之|逆命题|反过来|反向)/.test(text)) {
      intent = 'verify_converse';
      relation = 'converse';
      preferredCardTypes = ['命题', '反例'];
    } else if (/(推出|蕴含|意味着|能否得到|能否推出|可以得到|可得)/.test(text)) {
      intent = 'verify_implication';
      relation = 'implication';
      preferredCardTypes = ['命题', '反例'];
    } else if (/(怎样|如何|怎么|判定|判断|条件|刻画|准则|充要)/.test(text)) {
      intent = 'find_criterion';
      preferredCardTypes = ['命题', '反例'];
    } else if (/(吗|是否|一定|性质|总是|必然|成立)/.test(text)) {
      intent = 'verify_property';
      preferredCardTypes = ['命题', '反例'];
    } else if (/(定义|概念)/.test(text)) {
      intent = 'find_definition';
      preferredCardTypes = ['定义'];
    }

    return {
      intent,
      subject: concepts.slice(0, 4).join(' / ') || text,
      predicate: text,
      relation,
      polarity: /(并非|不是|不能|未必|不一定|不成立|不满足|不存在|不收敛|不连续|不有界|不完备|不紧致|反例)/.test(text)
        ? 'negative'
        : (/(一定|必然|总是)/.test(text) ? 'positive' : 'unknown'),
      preferredCardTypes,
    };
  }

  function candidateTypeGroup(type) {
    const value = String(type || '').trim();
    if (value.includes('反例')) return '反例';
    if (/(命题|定理|引理|推论|性质)/.test(value)) return '命题';
    if (/(定义|概念)/.test(value)) return '定义';
    if (/(归类|分类)/.test(value)) return '归类';
    return '其他';
  }

  function candidateLimitForType(type, preferredTypes) {
    if (preferredTypes.has(type)) return type === '命题' ? 14 : 8;
    if (type === '命题') return 10;
    if (type === '反例') return 6;
    if (type === '定义') return 5;
    if (type === '归类') return 6;
    return 3;
  }

  function isStableCardId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 256
      && id === id.trim() && !/[\u0000-\u001F\u007F]/.test(id);
  }

  function boundedCardLimit(value, fallback, maximum) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? Math.max(1, Math.min(maximum, Math.floor(number)))
      : fallback;
  }

  function buildAIRerankCandidates(cards, options = {}) {
    const limit = boundedCardLimit(options.limit, 36, 48);
    const seenIds = new Set();
    const localCards = (Array.isArray(cards) ? cards : [])
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => {
        if (!card || !isStableCardId(card.id) || seenIds.has(card.id)) return false;
        seenIds.add(card.id);
        return true;
      });
    const preferredTypes = new Set(
      (Array.isArray(options.queryPlan?.preferredCardTypes) ? options.queryPlan.preferredCardTypes : [])
        .map((type) => candidateTypeGroup(type)),
    );
    const typeCounts = new Map();
    const selected = [];
    const selectedIds = new Set();
    const append = (item) => {
      if (!item || selected.length >= limit || selectedIds.has(item.card.id)) return;
      const group = candidateTypeGroup(item.card.type);
      typeCounts.set(group, (typeCounts.get(group) || 0) + 1);
      selected.push(item);
      selectedIds.add(item.card.id);
    };

    // Keep query-relevant card shapes available even with a small model budget.
    preferredTypes.forEach((type) => {
      append(localCards.find((item) => candidateTypeGroup(item.card.type) === type));
    });

    localCards.forEach((item) => {
      if (selected.length >= limit || selectedIds.has(item.card.id)) return;
      const typeGroup = candidateTypeGroup(item.card.type);
      const count = typeCounts.get(typeGroup) || 0;
      if (count >= candidateLimitForType(typeGroup, preferredTypes)) return;
      append(item);
    });
    localCards.forEach(append);
    selected.sort((a, b) => a.index - b.index);

    return selected.map(({ card, index }) => ({
      id: String(card.id || ''),
      localRank: index + 1,
      type: clipCandidateText(card.type, 16),
      classificationSubtype: clipCandidateText(card.classificationSubtype, 24),
      prefix: clipCandidateText(card.prefix, 180),
      title: clipCandidateText(card.title, 220),
      titleLinkWords: clipCandidateText(card.titleLinkWords, 220),
      content: clipCandidateText(card.content, 220),
      excerptArea: clipCandidateText(card.excerptArea || candidateEvidence(card, 'excerptArea'), 420),
      keywords: clipCandidateText(card.keywords || candidateEvidence(card, 'keywords'), 260),
      searchEvidence: (Array.isArray(card.searchEvidence) ? card.searchEvidence : [])
        .slice(0, 4)
        .map((entry) => ({
          field: String(entry?.field || '').slice(0, 32),
          text: clipCandidateText(entry?.text, 420),
        }))
        .filter((entry) => entry.field && entry.text),
      exactSource: !!card.__mnkbAISearch?.exactSource,
      localReason: clipCandidateText(card.__mnkbAISearch?.reason, 80),
    }));
  }

  function applyAIRerank(cards, modelResult, options = {}) {
    const seenIds = new Set();
    const localCards = (Array.isArray(cards) ? cards : []).filter((card) => {
      if (!card || !isStableCardId(card.id) || seenIds.has(card.id)) return false;
      seenIds.add(card.id);
      return true;
    });
    const localById = new Map(localCards.map((card, index) => [String(card.id || ''), { card, index }]));
    const allowedIds = Array.isArray(options.candidateIds)
      ? new Set(options.candidateIds.filter(isStableCardId))
      : new Set(localById.keys());
    const allowedRoles = new Set(['direct', 'counterexample', 'supporting', 'related']);
    const rankedItems = Array.isArray(modelResult?.ranked) ? modelResult.ranked : [];
    const modelOrder = new Map();
    rankedItems.forEach((item, index) => {
      const id = item?.id;
      if (!isStableCardId(id) || !localById.has(id) || !allowedIds.has(id) || modelOrder.has(id)) return;
      if (typeof item.relevance !== 'number' || !Number.isFinite(item.relevance)) return;
      modelOrder.set(id, {
        index,
        relevance: Math.max(0, Math.min(100, Math.round(item.relevance))),
        answerRole: allowedRoles.has(item.answerRole) ? item.answerRole : 'related',
        reason: typeof item.reason === 'string' ? clipCandidateText(item.reason, 48) : '',
      });
    });

    if (modelOrder.size === 0) return localCards;

    const compare = (a, b) => {
      const aModel = modelOrder.get(String(a.id || ''));
      const bModel = modelOrder.get(String(b.id || ''));
      if (aModel && bModel) return aModel.index - bModel.index;
      if (aModel) return -1;
      if (bModel) return 1;
      return localById.get(String(a.id || '')).index - localById.get(String(b.id || '')).index;
    };

    const modelLabel = clipCandidateText(options.modelLabel || modelResult?.modelLabel, 80);
    const decorate = (card) => {
      const model = modelOrder.get(String(card.id || ''));
      if (!model) return card;
      const previous = card.__mnkbAISearch || {};
      return {
        ...card,
        __mnkbAISearch: {
          ...previous,
          modelReranked: true,
          modelLabel,
          modelRelevance: model.relevance,
          answerRole: model.answerRole || 'related',
          modelReason: model.reason,
          reason: model.reason
            ? `AI 精排 · ${model.reason}`
            : (previous.reason || 'AI 精排'),
        },
      };
    };

    return localCards.sort(compare).map(decorate);
  }

  return {
    RUNTIME_SCHEMA,
    normalizeText,
    compactText,
    tokenBoundaryOK,
    createRuntimeEngine,
    queryRuntime,
    augmentQueryWithSynonyms,
    rankKnowledgeCards,
    buildAnswerQueryPlan,
    buildAIRerankCandidates,
    applyAIRerank,
  };
});
