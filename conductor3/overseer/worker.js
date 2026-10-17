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

module.exports = { workTick, artifactText };
