#!/usr/bin/env node
'use strict';
// Draft composer: turns drafted queue items into real drafts Yoshi can review.
// Deterministic - no model, no spend, nothing is ever sent here.
//
// Why: until now item.draft was a "[draft pending]" placeholder, so when he asked
// to see the endorsed drafts there was no recipient/subject/body to show. This
// closes that gap honestly: a composed draft uses ONLY the item's own detail and
// artifact text. It never invents a recipient, a fact or a figure.
//
// Scope guard: only kind 'draft' items are composed. send / money / commitment
// items are never touched here - overseers annotate those and policy keeps them
// gated until a dashboard click.
//
// Two honest output types:
//   message  - an email address is literally present in the item's evidence, so
//              the draft has recipient / subject / body (standing rule: published
//              addresses only, never pattern-guessed, so a name alone is NOT a
//              recipient)
//   briefing - no address in evidence; a note for Yoshi himself, marked as such
//
// Idempotent: item.compose.sourceHash covers title + detail + artifact text;
// an unchanged item is skipped on later ticks.
//   const C = require('./compose'); C.tick(dir);
//   node conductor3/compose.js <queueDir>
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Q = require('./queue/queue');

function artifactText(dir, item) {
  const texts = [];
  for (const p of item.artifacts || []) { try { texts.push(fs.readFileSync(p, 'utf8')); } catch {} }
  const drop = path.join(dir, 'drop');
  if (fs.existsSync(drop)) {
    for (const f of fs.readdirSync(drop)) {
      if (f.startsWith(item.id) && /\.(md|txt)$/.test(f)) { try { texts.push(fs.readFileSync(path.join(drop, f), 'utf8')); } catch {} }
    }
  }
  return texts.join('\n');
}

function sourceHash(item, workpad) {
  return crypto.createHash('sha256').update(JSON.stringify([item.title, item.detail, workpad])).digest('hex').slice(0, 16);
}

function findRecipient(evidence) {
  const m = evidence.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : null; // no address in evidence -> no recipient; never guess one
}

function nextStep(detail) {
  const m = String(detail || '').match(/next:\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

function composeItem(dir, item, now = new Date()) {
  const workpad = artifactText(dir, item);
  const evidence = `${item.title}\n${item.detail || ''}\n${workpad}`;
  const recipient = findRecipient(evidence);
  const urls = evidence.match(/https?:\/\/[^\s)\]]+/g) || [];
  const next = nextStep(item.detail) || nextStep(workpad);
  const subject = String(item.title).trim().slice(0, 72);
  const lines = [];
  if (recipient) {
    lines.push(`Hi,`, '', String(item.detail || item.title).trim().split('\n')[0], '');
  } else {
    lines.push(`Briefing for Yoshi - no recipient identified, nothing to send.`, '', String(item.detail || '').trim(), '');
  }
  if (next) lines.push(`Next step: ${next}`, '');
  if (urls.length) lines.push(`Source: ${urls[0]}`, '');
  lines.push(`--`, `Drafted overnight by conductor3 compose. Facts come only from the work record; nothing has been sent. Review before any use.`);
  return {
    type: recipient ? 'message' : 'briefing',
    recipient, // null for a briefing
    subject,
    body: lines.join('\n'),
    composedAt: now.toISOString(),
  };
}

// One compose pass. Returns the list of { item, type } it (re)composed.
function tick(dir, { now = new Date() } = {}) {
  const q = Q.load(dir);
  const done = [];
  for (const item of q.items) {
    if (item.kind !== 'draft' || item.status !== 'drafted') continue; // gated kinds untouched
    const workpad = artifactText(dir, item);
    const h = sourceHash(item, workpad);
    if (item.compose && item.compose.sourceHash === h) continue; // unchanged
    item.draft = composeItem(dir, item, now);
    item.compose = { sourceHash: h, at: now.toISOString() };
    done.push({ item: item.id, type: item.draft.type });
  }
  if (done.length) Q.save(dir, q);
  return done;
}

module.exports = { tick, composeItem, findRecipient, sourceHash };
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: compose.js <queueDir>'); process.exit(2); }
  const done = tick(dir);
  for (const d of done) console.log(`${d.item}: composed ${d.type}`);
  console.error(`composed ${done.length}`);
}
