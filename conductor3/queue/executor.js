'use strict';
// Gated executor: the ONLY place an approved item could ever leave the building. Separate from the night workers.
// Safe by default: with no adapter or without live=true it is a dry run and changes nothing outside the queue file.
// Before every execution it re-checks policy at that moment (valid dashboard-click approval, quiet hours, item unchanged since approval).
// adapters: { send: async (item) => ref, money: ..., commitment: ... }  (none are shipped; you supply them deliberately)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Q = require('./queue'), P = require('./policy');
const fp = (i) => crypto.createHash('sha256').update(JSON.stringify([i.kind, i.lane, i.title, i.detail])).digest('hex').slice(0, 16);
// Call at approval time to bind the approval to the exact content he saw.
function bindApproval(dir, id) { const it = Q.load(dir).items.find((i) => i.id === id); return Q.update(dir, id, { approval: { ...it.approval, contentHash: fp(it) } }); }
function audit(dir, rec) { fs.appendFileSync(path.join(dir, 'executor.log'), JSON.stringify(rec) + '\n'); }
async function run(dir, { now = new Date(), live = false, adapters = {}, max = 5 } = {}) {
  const out = { executed: 0, dryRun: 0, skipped: 0, failed: 0, notes: [] }; let n = 0;
  for (const it of Q.load(dir).items.filter((i) => i.status === 'ready')) {
    if (n++ >= max) break;
    const d = P.decide(it, now);
    if (d.action !== 'ready') { out.skipped++; out.notes.push(`${it.id}: ${d.reason}`); Q.update(dir, it.id, { status: d.action === 'hold-quiet-hours' ? 'held-quiet-hours' : 'needs-approval', note: d.reason }); continue; }
    if (!it.approval || it.approval.contentHash !== fp(it)) { out.skipped++; out.notes.push(`${it.id}: approval not bound to current content, re-approve`); Q.update(dir, it.id, { status: 'needs-approval', note: 'content changed or approval unbound; re-approve in the dashboard' }); continue; }
    const ad = adapters[it.kind];
    if (!live || typeof ad !== 'function') { out.dryRun++; out.notes.push(`${it.id}: DRY RUN, would ${it.kind}: ${it.title}`); audit(dir, { at: now.toISOString(), id: it.id, mode: 'dry-run', kind: it.kind }); continue; }
    Q.update(dir, it.id, { status: 'executing', executingAt: now.toISOString() }); // flipped first so a crash cannot double-execute
    try { const ref = await ad(it); Q.update(dir, it.id, { status: 'executed', executedAt: now.toISOString(), ref: String(ref || '') }); audit(dir, { at: now.toISOString(), id: it.id, mode: 'live', kind: it.kind, ref: String(ref || '') }); out.executed++; }
    catch (e) { Q.update(dir, it.id, { status: 'failed', note: 'executor error: ' + String(e.message).slice(0, 200) }); audit(dir, { at: now.toISOString(), id: it.id, mode: 'live', kind: it.kind, error: String(e.message).slice(0, 200) }); out.failed++; }
  }
  return out;
}
module.exports = { run, bindApproval, fp };
