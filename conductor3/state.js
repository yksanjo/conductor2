'use strict';
// Run-state model. A run is one execution of a mission, with a unique id.
// queued -> running -> (needs-input | ready-for-review | failed)
// needs-input -> running (after a human answers) | failed
// ready-for-review -> verified (verifier green) | failed (verifier red, retries exhausted) | queued (retry)
// verified and failed are terminal.

const STATES = ['queued', 'running', 'needs-input', 'ready-for-review', 'verified', 'failed'];
const TERMINAL = new Set(['verified', 'failed']);
const NEXT = {
  queued: ['running', 'failed'],
  running: ['needs-input', 'ready-for-review', 'failed'],
  'needs-input': ['running', 'failed'],
  'ready-for-review': ['verified', 'queued', 'failed'],
  verified: [],
  failed: [],
};

function newRunId(missionName, now = new Date()) {
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = require('crypto').randomBytes(3).toString('hex');
  return `${missionName}-${ts}-${rand}`; // unique per run: reused folders can never inherit a stale report
}

function create(missionName, now = new Date()) {
  return { runId: newRunId(missionName, now), mission: missionName, state: 'queued', attempt: 1, history: [{ state: 'queued', at: now.toISOString() }] };
}

function transition(run, to, note, now = new Date()) {
  if (!STATES.includes(to)) throw new Error(`unknown state: ${to}`);
  if (!NEXT[run.state].includes(to)) throw new Error(`illegal transition ${run.state} -> ${to}`);
  const next = { ...run, state: to, history: [...run.history, { state: to, at: now.toISOString(), ...(note ? { note } : {}) }] };
  if (run.state === 'ready-for-review' && to === 'queued') next.attempt = run.attempt + 1;
  return next;
}

module.exports = { STATES, TERMINAL, NEXT, newRunId, create, transition };
