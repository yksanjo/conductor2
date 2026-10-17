'use strict';
// Mission file format: JSON (zero-dep posture, no YAML parser). See docs/CONDUCTOR3.md.

const OPS = ['read', 'research', 'draft', 'write-workspace'];      // what night workers may do
const GATED = ['send', 'publish', 'pay', 'delete', 'deploy'];       // never allowed in a mission; executor-only
const KNOWN_TOPOLOGIES = ['hierarchical', 'pipeline', 'mesh'];

function validate(m) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(m && typeof m === 'object', 'mission must be an object');
  if (errs.length) return errs;
  need(/^[a-z0-9][a-z0-9-]{0,47}$/.test(m.name || ''), 'name: lowercase letters, digits, dashes (max 48)');
  need(m.trigger && (m.trigger.cron || m.trigger.manual === true), 'trigger: { cron: "m h * * *" } or { manual: true }');
  need(m.swarm && KNOWN_TOPOLOGIES.includes(m.swarm.topology), `swarm.topology: one of ${KNOWN_TOPOLOGIES.join('/')}`);
  need(m.swarm && Number.isInteger(m.swarm.size) && m.swarm.size >= 1 && m.swarm.size <= 8, 'swarm.size: integer 1-8');
  need(typeof m.purpose === 'string' && m.purpose.length > 0, 'purpose: non-empty string');
  need(Array.isArray(m.inputs), 'inputs: array of { name, path|url }');
  need(Array.isArray(m.allowedOps) && m.allowedOps.length > 0, 'allowedOps: non-empty array');
  for (const op of m.allowedOps || []) {
    if (GATED.includes(op)) errs.push(`allowedOps: "${op}" is gated and cannot be granted to a night worker; route it through the executor`);
    else if (!OPS.includes(op)) errs.push(`allowedOps: unknown op "${op}" (allowed: ${OPS.join(', ')})`);
  }
  need(m.budget && m.budget.minutes > 0, 'budget.minutes: positive number (enforced: wall clock)');
  need(m.budget && (m.budget.tokens === undefined || m.budget.tokens > 0), 'budget.tokens: positive number if set (NOT enforced yet, advisory)');
  const d = m.deliverable;
  need(d && typeof d.file === 'string' && !d.file.includes('..') && !d.file.startsWith('/'), 'deliverable.file: relative path inside the run folder');
  need(d && Array.isArray(d.requiredSections), 'deliverable.requiredSections: array of heading names the report must contain');
  need(m.verifier && (typeof m.verifier.command === 'string' || m.verifier.sections === true), 'verifier: { command } and/or { sections: true }');
  const r = m.retry || {};
  need(r.max === undefined || (Number.isInteger(r.max) && r.max >= 0 && r.max <= 3), 'retry.max: integer 0-3');
  need(!m.escalate || m.escalate.to === 'inbox', 'escalate.to: only "inbox" is supported');
  return errs;
}

function load(file) {
  const m = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  const errs = validate(m);
  if (errs.length) { const e = new Error('invalid mission:\n - ' + errs.join('\n - ')); e.errors = errs; throw e; }
  return m;
}

module.exports = { OPS, GATED, validate, load };
