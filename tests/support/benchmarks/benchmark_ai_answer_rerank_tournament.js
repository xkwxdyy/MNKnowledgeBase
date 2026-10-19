// Offline-only scoring helpers retained from the original benchmark code.
const crypto = require('node:crypto');
const apiKey = '';
const requestTimeoutMs = 65000;
const stage1Size = 16;
const finalistSize = 6;
const semifinalSize = 16;

function filterTextModels(models) {
  return Array.from(new Set((models || [])
    .map((model) => String(model || '').trim())
    .filter(Boolean)
    .filter((model) => !/image/i.test(model))));
}

function finalEligible(summary) {
  return summary.completionRate >= 0.9
    && summary.jsonValidRate >= 0.9
    && summary.candidateIdSafeRate >= 0.9
    && summary.top1Rate >= 0.8
    && summary.top3Rate >= 0.9
    && Number(summary.p95LatencyMs || Infinity) <= 60000;
}

module.exports = { filterTextModels, finalEligible };
