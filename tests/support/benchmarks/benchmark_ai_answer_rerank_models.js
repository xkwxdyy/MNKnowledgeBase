// Offline-only scoring helpers retained from the original benchmark code.
const crypto = require('node:crypto');
const apiKey = '';
const requestTimeoutMs = 65000;
const stage1Size = 16;
const finalistSize = 6;
const semifinalSize = 16;

function sanitizeErrorMessage(value) {
  let text = String(value || '');
  if (apiKey) text = text.split(apiKey).join('[redacted-key]');
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted-token]')
    .replace(/sk-[A-Za-z0-9_*.-]+/g, '[redacted-token]');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_—–]+/g, ' ')
    .trim();
}

function cardText(card) {
  return normalize([
    card.type,
    card.classificationSubtype,
    card.prefix,
    card.title,
    card.titleLinkWords,
    card.content,
    card.searchText,
  ].filter(Boolean).join(' '));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function lexicalScore(card, testCase) {
  const text = cardText(card);
  let score = 0;
  (testCase.recallTerms || []).forEach((term, index) => {
    const normalized = normalize(term);
    if (!normalized || !text.includes(normalized)) return;
    score += 80 - Math.min(40, index * 4) + Math.min(40, normalized.length * 2);
  });
  const queryParts = normalize(testCase.query).split(' ').filter((part) => part.length >= 2);
  queryParts.forEach((part) => {
    if (text.includes(part)) score += 8;
  });
  if ((testCase.queryPlan?.preferredCardTypes || []).includes(card.type)) score += 24;
  return score;
}

function candidateLimitForType(type, preferredTypes) {
  if (preferredTypes.includes(type)) return type === '命题' ? 14 : 8;
  if (type === '命题') return 10;
  if (type === '反例') return 6;
  if (type === '定义') return 5;
  if (type === '归类') return 6;
  return 3;
}

function compactCandidate(card, localRank) {
  return {
    id: String(card.id || ''),
    localRank,
    type: String(card.type || ''),
    classificationSubtype: String(card.classificationSubtype || ''),
    prefix: String(card.prefix || ''),
    title: String(card.title || ''),
    titleLinkWords: String(card.titleLinkWords || ''),
    content: String(card.content || ''),
  };
}

function buildCandidates(cards, byId, testCase, limit = 32) {
  const preferredTypes = Array.isArray(testCase.queryPlan?.preferredCardTypes)
    ? testCase.queryPlan.preferredCardTypes
    : [];
  const scored = cards
    .map((card) => ({ card, score: lexicalScore(card, testCase) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || stableHash(`${testCase.id}\u0001${a.card.id}`).localeCompare(stableHash(`${testCase.id}\u0001${b.card.id}`))
    ));
  const typeCounts = new Map();
  const selected = [];
  scored.forEach((item) => {
    if (selected.length >= limit) return;
    const type = String(item.card.type || '');
    const count = typeCounts.get(type) || 0;
    if (count >= candidateLimitForType(type, preferredTypes)) return;
    typeCounts.set(type, count + 1);
    selected.push(item.card);
  });

  const expectedIds = new Set((testCase.expectedIds || []).map(String));
  expectedIds.forEach((id) => {
    if (selected.some((card) => String(card.id) === id)) return;
    const expectedCard = byId.get(id);
    if (!expectedCard) throw new Error(`金标准卡片不在索引中：${testCase.id} ${id}`);
    if (selected.length >= limit) {
      const replaceIndex = selected.map((card) => String(card.id)).findLastIndex((cardId) => !expectedIds.has(cardId));
      if (replaceIndex >= 0) selected.splice(replaceIndex, 1);
    }
    selected.push(expectedCard);
  });

  const blinded = selected.slice().sort((a, b) => (
    stableHash(`blind\u0001${testCase.id}\u0001${a.id}`)
      .localeCompare(stableHash(`blind\u0001${testCase.id}\u0001${b.id}`))
  ));
  return blinded.map((card, index) => compactCandidate(card, index + 1));
}

module.exports = { buildCandidates, sanitizeErrorMessage };
