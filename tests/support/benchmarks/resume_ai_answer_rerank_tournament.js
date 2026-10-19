// Offline-only scoring helpers retained from the original benchmark code.
const crypto = require('node:crypto');
const apiKey = '';
const requestTimeoutMs = 65000;
const stage1Size = 16;
const finalistSize = 6;
const semifinalSize = 16;

function providerExhausted(report) {
  if (report?.providerExhausted === true) return true;
  return (report?.models || []).some((model) => (model.cases || []).some((item) => (
    /额度已用尽|TokenStatusExhausted|RemainQuota/i.test(item.error || '')
  )));
}

module.exports = { providerExhausted };
