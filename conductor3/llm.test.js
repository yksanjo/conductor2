'use strict';
// Iteration 8: optional LLM connection - adapter behavior and fail-closed guarantees.
const fs = require('fs'), os = require('os'), path = require('path');
const L = require('./llm'), Q = require('./queue/queue'), W = require('./overseer/worker');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3llm-'));
async function main() {

// config: missing file -> null; malformed -> null; valid -> object
const d0 = tmp();
ok(L.loadConfig(d0) === null, 'missing llm.json -> null config');
fs.writeFileSync(path.join(d0, 'llm.json'), '{oops');
ok(L.loadConfig(d0) === null, 'malformed llm.json -> null config');

// availability gates
ok(!L.available(null), 'no config -> unavailable');
ok(!L.available({ provider: 'ollama', model: 'm' }), 'enabled not true -> unavailable');
ok(L.available({ provider: 'ollama', model: 'llama3.1', enabled: true }), 'ollama needs no key');
ok(!L.available({ provider: 'openai-compatible', model: 'gpt-x', enabled: true }, {}), 'openai-compatible without C3_LLM_KEY -> unavailable');
ok(L.available({ provider: 'openai-compatible', model: 'gpt-x', enabled: true }, { C3_LLM_KEY: 'k' }), 'openai-compatible available only with key in env');
ok(!L.available({ provider: 'something-else', model: 'm', enabled: true }), 'unknown provider -> unavailable');

// complete: ollama request shape and response extraction
let seen = null;
const fakeOk = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ response: '  hello  ' }) }; };
const out1 = await L.complete({ provider: 'ollama', model: 'llama3.1', enabled: true }, { system: 'S', prompt: 'P' }, {}, fakeOk);
ok(out1 === 'hello', 'ollama text returned trimmed');
ok(seen.url === 'http://127.0.0.1:11434/api/generate' && JSON.parse(seen.opts.body).stream === false && JSON.parse(seen.opts.body).system === 'S', 'ollama request shape correct, default local base');

// complete: openai-compatible sends bearer from env, never for ollama
seen = null;
const fakeOk2 = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) }; };
const out2 = await L.complete({ provider: 'openai-compatible', model: 'gpt-x', enabled: true }, { system: 'S', prompt: 'P' }, { C3_LLM_KEY: 'secret-key' }, fakeOk2);
ok(out2 === 'hi' && seen.opts.headers.authorization === 'Bearer secret-key', 'openai-compatible auth header from env only');

// fail closed: non-200, throw, timeout-abort, empty text -> null
const out3 = await L.complete({ provider: 'ollama', model: 'm', enabled: true }, { system: 'S', prompt: 'P' }, {}, async () => ({ ok: false }));
ok(out3 === null, 'non-200 -> null');
const out4 = await L.complete({ provider: 'ollama', model: 'm', enabled: true }, { system: 'S', prompt: 'P' }, {}, async () => { throw new Error('down'); });
ok(out4 === null, 'unreachable -> null, never throws');
const out5 = await L.complete({ provider: 'ollama', model: 'm', enabled: true }, { system: 'S', prompt: 'P', timeoutMs: 5 }, {}, (url, opts) => new Promise((res, rej) => { const t = setTimeout(() => res({ ok: true, json: async () => ({ response: 'late' }) }), 100); opts.signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); }));
ok(out5 === null, 'timeout abort -> null');
const out6 = await L.complete({ provider: 'ollama', model: 'm', enabled: true }, { system: 'S', prompt: 'P' }, {}, async () => ({ ok: true, json: async () => ({ response: '   ' }) }));
ok(out6 === null, 'empty text -> null');

// worker integration: no config -> no-op, items untouched
const d1 = tmp();
Q.save(d1, { items: [{ id: 'q-1', title: 'T', kind: 'draft', status: 'drafted', detail: 'd', overseer: { by: 'cole', verdict: 'reworked' }, worker: { answered: [], stuck: ['r-thin-detail: missing'] } }], lastTick: null });
const none = await W.llmReworkPass(d1, {});
ok(none.length === 0 && Q.load(d1).items[0].worker.stuck.length === 1, 'no llm config -> no-op, still stuck');

// worker integration: fake model answers from material only, tagged [llm]
const cfg = { provider: 'ollama', model: 'm', enabled: true };
const fake = async (c, { system, prompt }) => {
  ok(system.includes('ONLY the material') && prompt.includes('r-thin-detail'), 'prompt constrains to provided material');
  return 'The source is the firm careers page';
};
const acts = await W.llmReworkPass(d1, { llmCfg: cfg, completeImpl: fake });
const it1 = Q.load(d1).items[0];
ok(acts.length === 1 && it1.worker.stuck.length === 0 && it1.worker.answered[0].startsWith('r-thin-detail: [llm]'), 'llm answer recorded with [llm] tag, stuck cleared');
ok(it1.detail.includes('[llm] The source is the firm careers page'), 'llm answer folded into detail, tagged');
ok(it1.overseer.verdict === 'reworked', 'item resubmitted for deterministic re-review');

// worker integration: model says "not in the material" -> stays stuck, no invention
const d2 = tmp();
Q.save(d2, { items: [{ id: 'q-2', title: 'T2', kind: 'draft', status: 'drafted', detail: 'd', overseer: { by: 'cole', verdict: 'reworked' }, worker: { answered: [], stuck: ['r-no-source: none'] } }], lastTick: null });
const acts2 = await W.llmReworkPass(d2, { llmCfg: cfg, completeImpl: async () => 'not in the material' });
ok(acts2.length === 0 && Q.load(d2).items[0].worker.stuck.length === 1, 'model declining -> stays stuck, nothing invented');

}
main().then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
