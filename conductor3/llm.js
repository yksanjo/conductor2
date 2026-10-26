'use strict';
// Optional LLM connection for conductor3. Off by default: with no config every call
// returns null and the deterministic rules stay the only path.
//
// Free-first: the 'ollama' provider talks to a LOCAL server (default 127.0.0.1:11434).
// No key, no account, no spend - the model runs on the user's own machine.
//
// 'openai-compatible' exists for providers like the OpenAI API. It is billable and
// OFF unless ALL of these are true: enabled in llm.json, a key in the C3_LLM_KEY env
// var (never in a file), and Yoshi has approved the spend. The key is read from the
// environment at call time and is never logged or stored.
//
// Fail closed: missing config, disabled flag, unreachable server, timeout, non-200 or
// empty output all return null - never throw, never fake an answer.
const fs = require('fs'), path = require('path');

const DEFAULTS = { ollama: 'http://127.0.0.1:11434', 'openai-compatible': 'https://api.openai.com' };

function loadConfig(dir) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'llm.json'), 'utf8'));
    if (!c || typeof c !== 'object') return null;
    return c;
  } catch { return null; }
}

// Is this config usable for a real call right now? Key never required for ollama.
function available(cfg, env = process.env) {
  if (!cfg || cfg.enabled !== true) return false;
  if (cfg.provider === 'ollama') return typeof cfg.model === 'string' && cfg.model.length > 0;
  if (cfg.provider === 'openai-compatible') return Boolean(cfg.model && env.C3_LLM_KEY);
  return false;
}

// One completion. Returns the text or null. fetchImpl injectable for tests.
async function complete(cfg, { system, prompt, timeoutMs = 20000 }, env = process.env, fetchImpl = globalThis.fetch) {
  if (!available(cfg, env)) return null;
  const base = String(cfg.baseUrl || DEFAULTS[cfg.provider]).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url, opts;
    if (cfg.provider === 'ollama') {
      url = base + '/api/generate';
      opts = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model, system, prompt, stream: false }) };
    } else {
      url = base + '/v1/chat/completions';
      opts = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.C3_LLM_KEY }, body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }) };
    }
    const res = await fetchImpl(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const text = cfg.provider === 'ollama' ? data.response : data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const out = String(text || '').trim();
    return out || null;
  } catch { return null; } finally { clearTimeout(timer); }
}

module.exports = { loadConfig, available, complete };
