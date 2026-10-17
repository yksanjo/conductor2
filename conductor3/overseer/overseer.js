'use strict';
// Simulated human overseers - one assigned to each agent.
//
// Conductor 1 was a CLI overseeing agents: one human glancing at a board. conductor3
// flips the ratio: every worker gets its own overseer, a simulated human with a name,
// a standard, and a finite attention budget. Overnight the workers draft; the overseers
// read, ask questions, send sloppy work back, and endorse what is clean - so the morning
// inbox holds a curated batch with notes, not raw output.
//
// Honest limits, stated once: the "judgment" is deterministic rules, not a model. Every
// note names the rule that fired (r-*), so nothing pretends to be smarter than it is.
// Overseers NEVER approve gated kinds (send/money/commitment) - they only check whether
// the item is decision-ready. Approval still comes from one place: Yoshi's dashboard
// click, enforced by ../queue/policy.js, which this module never touches.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Q = require('../queue/queue');
const { ROSTER } = require('./personas');

const GATED = ['send', 'money', 'commitment'];
const STATE_FILE = 'overseers.json';
const MAX_RETURNS = 2; // after two send-backs, stop looping and escalate to the real human

function loadState(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')); } catch { return { overseers: {} }; } }
function saveState(dir, s) { fs.mkdirSync(dir, { recursive: true }); const t = path.join(dir, STATE_FILE) + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(s, null, 2)); fs.renameSync(t, path.join(dir, STATE_FILE)); }

// Stable assignment: the same agent always gets the same overseer, so a worker learns
// its overseer's standard across nights (and one worker cannot shop for a lenient one).
function assign(agentId, roster = ROSTER) {
  const h = crypto.createHash('sha256').update(String(agentId || 'unassigned')).digest();
  return roster[h.readUInt32BE(0) % roster.length];
}

function personaState(state, pid) {
  if (!state.overseers[pid]) state.overseers[pid] = { energy: 1, reviewed: 0, endorsed: 0, returned: 0, annotated: 0, deferred: 0, escalated: 0, lastTickAt: null };
  return state.overseers[pid];
}

const reviewCost = (persona) => 1 / persona.attention;
function recover(ps, persona, now) {
  if (!ps.lastTickAt) return;
  const hours = (now - new Date(ps.lastTickAt)) / 36e5;
  if (hours > 0) ps.energy = Math.min(1, ps.energy + hours / persona.restHours);
}

// The standard, as rules. Each returns { rule, question } or nothing. Questions go back
// to the worker verbatim - they are the "send sloppy work back" half of the job.
function check(item, persona) {
  const problems = [];
  const detail = String(item.detail || '');
  if (!item.title || !String(item.title).trim()) problems.push({ rule: 'r-malformed', question: 'This came through without a title. What is it?' });
  const minLen = 20 + Math.round(persona.strictness * 60);
  if (detail.trim().length < minLen) problems.push({ rule: 'r-thin-detail', question: 'Give me more than a headline. What did you actually find, and what is the next step?' });
  if (item.kind === 'draft' && detail.trim().length >= minLen) {
    const hasUrl = /https?:\/\//.test(detail), hasSource = /\bsource\s*:/i.test(detail);
    const passEvidence = persona.strictness >= 0.7 ? hasUrl : (hasUrl || hasSource);
    if (!passEvidence) problems.push({ rule: 'r-no-source', question: persona.strictness >= 0.7 ? 'Where is the link? I do not sign off on findings without a URL.' : 'What is the source? Add a link or at least name it.' });
  }
  return problems;
}

// Gated items are never endorsed. The overseer only answers: could Yoshi decide this
// from what is written here?
function decisionReady(item, persona) {
  const missing = [];
  const detail = String(item.detail || '');
  const minLen = 20 + Math.round(persona.strictness * 60);
  if (detail.trim().length < minLen) missing.push('detail is too thin to decide from');
  if ((item.kind === 'money' || item.kind === 'commitment') && !/\$\s?\d|\d+\s?(usd|dollars|euros)/i.test(detail)) missing.push('no amount stated');
  if (item.kind === 'send' && !/\b(to|recipient)\s*:/i.test(detail)) missing.push('no recipient stated');
  return missing;
}

function reviewable(item) {
  if (item.status !== 'drafted' && item.status !== 'needs-approval') return false;
  if (!item.overseer) return true;
  return item.overseer.verdict === 'deferred'; // deferred items get another look next tick
}

// One review pass over the queue. Returns the list of actions taken.
function tick(dir, { now = new Date(), roster = ROSTER } = {}) {
  const q = Q.load(dir);
  const state = loadState(dir);
  const actions = [];
  for (const item of q.items) {
    if (!reviewable(item)) continue;
    const persona = assign(item.owner || item.lane, roster);
    const ps = personaState(state, persona.id);
    recover(ps, persona, now);
    if (ps.energy < reviewCost(persona)) {
      item.overseer = { by: persona.id, verdict: 'deferred', note: persona.voice.deferred(), deferredAt: now.toISOString(), returns: (item.overseer && item.overseer.returns) || 0 };
      ps.deferred++; ps.lastTickAt = now.toISOString();
      actions.push({ item: item.id, overseer: persona.id, verdict: 'deferred' });
      continue;
    }
    ps.energy = Math.max(0, ps.energy - reviewCost(persona));
    ps.reviewed++; ps.lastTickAt = now.toISOString();
    const returns = (item.overseer && item.overseer.returns) || 0;
    if (GATED.includes(item.kind)) {
      const missing = decisionReady(item, persona);
      const ready = missing.length === 0;
      item.overseer = { by: persona.id, verdict: 'annotated', ready, note: ready ? persona.voice.annotated() : persona.voice['annotated-unready'](missing.join('; ')), missing, returns, at: now.toISOString() };
      ps.annotated++;
      actions.push({ item: item.id, overseer: persona.id, verdict: 'annotated', ready });
      continue;
    }
    const problems = check(item, persona);
    if (problems.length === 0) {
      item.overseer = { by: persona.id, verdict: 'endorsed', note: persona.voice.endorsed(item.title), returns, at: now.toISOString() };
      ps.endorsed++;
      actions.push({ item: item.id, overseer: persona.id, verdict: 'endorsed' });
    } else if (returns >= MAX_RETURNS) {
      item.overseer = { by: persona.id, verdict: 'escalated', note: persona.voice.escalated(), questions: problems, returns, at: now.toISOString() };
      ps.escalated++;
      actions.push({ item: item.id, overseer: persona.id, verdict: 'escalated' });
    } else {
      item.overseer = { by: persona.id, verdict: 'returned', note: problems.map((p) => p.question).join(' '), questions: problems, returns: returns + 1, at: now.toISOString() };
      ps.returned++;
      actions.push({ item: item.id, overseer: persona.id, verdict: 'returned', questions: problems.map((p) => p.rule) });
    }
  }
  Q.save(dir, q);
  saveState(dir, state);
  return actions;
}

// What the human reads in the morning. Endorsed work is ready to use; annotated gated
// items still need his click; returned items name the questions the worker must answer.
function report(dir, { roster = ROSTER } = {}) {
  const q = Q.load(dir);
  const state = loadState(dir);
  const name = (pid) => { const p = roster.find((r) => r.id === pid); return p ? `${p.name} (${p.role})` : pid; };
  const reviewed = q.items.filter((i) => i.overseer && i.overseer.verdict !== 'deferred');
  const by = (v) => reviewed.filter((i) => i.overseer.verdict === v);
  const L = ['# Overseer shift report', ''];
  L.push(`${reviewed.length} item(s) reviewed, ${q.items.filter((i) => i.overseer && i.overseer.verdict === 'deferred').length} deferred. Nothing was approved, sent, published or paid - gated items below still need your dashboard click.`, '');
  const section = (title, items, line) => {
    if (!items.length) return;
    L.push(`## ${title} (${items.length})`, '');
    for (const i of items) L.push(line(i));
    L.push('');
  };
  section('Endorsed - ready to use', by('endorsed'), (i) => `- **${i.title}** [${i.lane}] - ${name(i.overseer.by)}: ${i.overseer.note}`);
  section('Annotated - your decision, not theirs', by('annotated'), (i) => `- **${i.title}** [${i.kind}] - ${name(i.overseer.by)}: ${i.overseer.ready ? 'decision-ready' : 'NOT ready: ' + (i.overseer.missing || []).join('; ')}`);
  section('Returned to the worker', by('returned'), (i) => `- **${i.title}** [${i.lane}] - ${name(i.overseer.by)} asked: ${(i.overseer.questions || []).map((p) => p.question).join(' ')}`);
  section('Escalated - sent back twice, still not right', by('escalated'), (i) => `- **${i.title}** [${i.lane}] - ${name(i.overseer.by)}: ${(i.overseer.questions || []).map((p) => p.question).join(' ')}`);
  L.push('## Overseers', '');
  for (const p of roster) {
    const ps = state.overseers[p.id];
    if (!ps || !ps.reviewed && !ps.deferred) continue;
    L.push(`- ${name(p.id)}: ${ps.reviewed} reviewed (${ps.endorsed} endorsed, ${ps.returned} returned, ${ps.annotated} annotated${ps.escalated ? `, ${ps.escalated} escalated` : ''}), energy ${(ps.energy * 100).toFixed(0)}%`);
  }
  return L.join('\n') + '\n';
}

module.exports = { tick, report, assign, check, decisionReady, loadState, ROSTER, GATED, MAX_RETURNS };
