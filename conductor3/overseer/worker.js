'use strict';
// The worker half of the overseer loop. Consumes the questions an overseer left on a
// returned item and resubmits the item for re-review.
//
// Honest by construction: the worker can only fix what it has evidence for. It folds in
// material from the item's own artifacts - files the worker actually wrote, listed in
// item.artifacts or dropped at <dir>/drop/<itemId>.md|txt. It never invents a source,
// a fact or a title. What it cannot answer it says so plainly (item.worker.stuck), the
// overseer re-reviews, and after two failed returns the item escalates to the human.
const fs = require('fs'), path = require('path');
const Q = require('../queue/queue');

function artifactText(dir, item) {
  const texts = [];
  for (const p of item.artifacts || []) { try { texts.push(fs.readFileSync(p, 'utf8')); } catch {} }
  if (fs.existsSync(path.join(dir, 'drop'))) {
    for (const f of fs.readdirSync(path.join(dir, 'drop'))) {
      if (f.startsWith(item.id) && /\.(md|txt)$/.test(f)) { try { texts.push(fs.readFileSync(path.join(dir, 'drop', f), 'utf8')); } catch {} }
    }
  }
  return texts.join('\n');
}

function answer(item, q, workpad) {
  if (q.rule === 'r-malformed') {
    const d = String(item.detail || '').trim();
    if (d) { item.title = d.split('\n')[0].slice(0, 60); return 'titled it from the first line of the detail'; }
    return null;
  }
  if (q.rule === 'r-no-source') {
    const m = workpad.match(/https?:\/\/[^\s)\]]+/);
    if (m) { item.detail = String(item.detail || '').trim() + `\nSource: ${m[0]}`; return `added the source link from my workpad (${m[0]})`; }
    return null;
  }
  if (q.rule === 'r-thin-detail') {
    const extra = workpad.trim();
    if (extra) { item.detail = String(item.detail || '').trim() + `\nMore from the workpad: ${extra.slice(0, 400)}`; return 'folded in the workpad detail'; }
    return null;
  }
  return null; // unknown rule: stuck, do not fake an answer
}

// One work pass over returned items. Returns the list of actions taken.
function workTick(dir, { now = new Date() } = {}) {
  const q = Q.load(dir);
  const actions = [];
  for (const item of q.items) {
    if (!item.overseer || item.overseer.verdict !== 'returned') continue;
    const questions = item.overseer.questions || [];
    if (!questions.length) continue;
    const workpad = artifactText(dir, item);
    const answered = [], stuck = [];
    for (const qu of questions) {
      const how = answer(item, qu, workpad);
      (how ? answered : stuck).push(how ? `${qu.rule}: ${how}` : `${qu.rule}: I do not have that - nothing in my workpad answers it`);
    }
    item.worker = { by: item.owner || 'unassigned', answered, stuck, at: now.toISOString() };
    // resubmit for re-review, preserving the return count so the escalation cap still fires
    item.overseer = { by: item.overseer.by, verdict: 'reworked', returns: item.overseer.returns, note: stuck.length ? 'reworked, but the worker is stuck on part of it' : 'reworked with answers', at: now.toISOString() };
    actions.push({ item: item.id, answered: answered.length, stuck: stuck.length });
  }
  Q.save(dir, q);
  return actions;
}


// Optional LLM rework (iteration 8). Runs AFTER the mechanical pass, only on items
// still stuck. The model gets ONLY the item's own fields and workpad material and is
// told to say when the answer is not there. Its answers are tagged [llm] so the human
// can tell machine-drafted rework from evidence-based rework, and the item still goes
// back through the deterministic overseer and, for gated kinds, the dashboard gate.
// completeImpl injectable for tests; in production conductor3/llm.complete is used.
const LLM_NA = 'not in the material';
async function llmReworkPass(dir, { now = new Date(), llmCfg = null, completeImpl = null } = {}) {
  const L = require('../llm');
  const cfg = llmCfg || L.loadConfig(dir);
  const call = completeImpl || L.complete;
  if (!L.available(cfg)) return [];
  const q = Q.load(dir);
  const actions = [];
  for (const item of q.items) {
    if (!item.worker || !item.worker.stuck || !item.worker.stuck.length) continue;
    if (!item.overseer || item.overseer.verdict !== 'reworked') continue;
    const workpad = artifactText(dir, item);
    const material = `Title: ${item.title}\nDetail: ${item.detail || ''}\nWorkpad:\n${workpad}`.slice(0, 6000);
    const stillStuck = [];
    for (const s of item.worker.stuck) {
      const rule = s.split(':')[0];
      const system = 'You answer questions about a work item using ONLY the material provided. Never invent facts, sources, names or figures. If the material does not contain the answer, reply with exactly: ' + LLM_NA;
      const prompt = `Overseer question (${rule}): ${s}\n\nMaterial:\n${material}\n\nAnswer in at most 400 characters, or reply exactly: ${LLM_NA}`;
      const out = await call(cfg, { system, prompt });
      if (out && !out.includes(LLM_NA) && out.length <= 400) {
        item.detail = String(item.detail || '').trim() + `\n[llm] ${out}`;
        item.worker.answered.push(`${rule}: [llm] ${out}`);
        actions.push({ item: item.id, rule, llm: true });
      } else stillStuck.push(s);
    }
    item.worker.stuck = stillStuck;
    item.worker.at = now.toISOString();
    item.overseer = { by: item.overseer.by, verdict: 'reworked', returns: item.overseer.returns, note: stillStuck.length ? 'reworked, llm answered part; still stuck on the rest' : 'reworked with llm answers - review tagged lines', at: now.toISOString() };
  }
  if (actions.length) Q.save(dir, q);
  return actions;
}
module.exports = { workTick, artifactText, llmReworkPass };
