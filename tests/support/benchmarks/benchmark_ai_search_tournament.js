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

function stableModelOrder(models) {
  const hash = (value) => Array.from(value).reduce(
    (result, char) => Math.imul(result ^ char.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
  return models.slice().sort((a, b) => hash(a) - hash(b) || a.localeCompare(b));
}

function selectStageModels(report, limit, predicate) {
  const summaries = (report.models || []).map((item) => item.summary);
  const eligible = summaries.filter(predicate);
  const eligibleNames = new Set(eligible.map((summary) => summary.model));
  const pool = eligible.concat(summaries.filter((summary) => !eligibleNames.has(summary.model)));
  return pool.slice(0, limit).map((summary) => summary.model);
}

module.exports = { filterTextModels, stableModelOrder, selectStageModels };
