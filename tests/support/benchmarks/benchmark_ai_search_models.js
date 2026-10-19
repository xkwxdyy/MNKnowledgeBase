// Offline-only scoring helpers retained from the original benchmark code.
const crypto = require('node:crypto');
const apiKey = '';
const requestTimeoutMs = 65000;
const stage1Size = 16;
const finalistSize = 6;
const semifinalSize = 16;
const MNUTILS_DEFAULT_ENDPOINT = 'https://api.feliks.top';

function resolveChatCompletionsUrl(value) {
  if (/\/chat\/completions$/i.test(value)) return value;
  if (/\/v1$/i.test(value)) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
}

function readRawRankedIds(response) {
  try {
    let text = String(response || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return [];
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    const ranked = Array.isArray(parsed?.ranked)
      ? parsed.ranked
      : (Array.isArray(parsed?.results) ? parsed.results : []);
    return ranked.map((item) => String(item?.id || '').trim()).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function scoreCase(parsed, expectedIds, rawRankedIds, candidateIds) {
  const expected = new Set(expectedIds);
  const allowed = new Set(candidateIds);
  const rankedIds = parsed.ranked.map((item) => item.id);
  const firstGoldRank = rankedIds.findIndex((id) => expected.has(id));
  const outsideCandidateIds = Array.from(new Set(rawRankedIds.filter((id) => !allowed.has(id))));
  return {
    jsonValid: !parsed.error && rankedIds.length > 0,
    candidateIdSafe: outsideCandidateIds.length === 0,
    outsideCandidateIds,
    top1: firstGoldRank === 0,
    top3: firstGoldRank >= 0 && firstGoldRank < 3,
    top8: firstGoldRank >= 0 && firstGoldRank < 8,
    firstGoldRank: firstGoldRank >= 0 ? firstGoldRank + 1 : null,
    returnedCount: rankedIds.length,
  };
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1));
  return sorted[position];
}

function latencyUtility(latencyMs) {
  if (!Number.isFinite(latencyMs)) return 0;
  if (latencyMs <= 5000) return 1;
  if (latencyMs >= 30000) return 0;
  return (30000 - latencyMs) / 25000;
}

function summarizeModel(model, cases) {
  const completed = cases.filter((item) => !item.error);
  const count = cases.length || 1;
  const rate = (key) => cases.filter((item) => item.metrics?.[key]).length / count;
  const latencies = completed.map((item) => item.latencyMs).filter(Number.isFinite);
  const averageLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, item) => sum + item, 0) / latencies.length)
    : null;
  const p50LatencyMs = percentile(latencies, 0.5);
  const p95LatencyMs = percentile(latencies, 0.95);
  const qualityScore = Number((
    rate('top1') * 45
    + rate('top3') * 25
    + rate('top8') * 15
    + rate('jsonValid') * 10
    + rate('candidateIdSafe') * 5
  ).toFixed(2));
  const latencyScore = Number((25 * (
    latencyUtility(p50LatencyMs) * 0.65
    + latencyUtility(p95LatencyMs) * 0.35
  )).toFixed(2));
  const overallScore = Number((qualityScore * 0.75 + latencyScore).toFixed(2));
  return {
    model,
    completed: completed.length,
    failed: cases.length - completed.length,
    completionRate: Number((completed.length / count).toFixed(4)),
    top1Rate: Number(rate('top1').toFixed(4)),
    top3Rate: Number(rate('top3').toFixed(4)),
    top8Rate: Number(rate('top8').toFixed(4)),
    jsonValidRate: Number(rate('jsonValid').toFixed(4)),
    candidateIdSafeRate: Number(rate('candidateIdSafe').toFixed(4)),
    averageLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    latencyScore,
    qualityScore,
    overallScore,
  };
}

module.exports = { resolveChatCompletionsUrl, readRawRankedIds, scoreCase, summarizeModel, MNUTILS_DEFAULT_ENDPOINT };
