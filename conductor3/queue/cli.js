#!/usr/bin/env node
'use strict';
// c3q: the Instinct-facing CLI. Never sends. There is deliberately NO approve command: approvals come only from dashboard clicks.
//   cli.js add <dir> --lane L --kind draft|send|money|commitment --title "..." [--detail "..."]
//   cli.js drop <dir> <dropDir>     enqueue every *.json (one item or an array) in dropDir, then move it to dropDir/done or dropDir/rejected
//   cli.js tick <dir>               one tick, prints ONE line
//   cli.js approvals <dir>          plain-text list of what waits on Yoshi, written to relay on WhatsApp
const fs = require('fs'), path = require('path');
const Q = require('./queue'), { tick } = require('./tick'), P = require('./policy');
const arg = (a, k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
function enqueue(dir, o, now) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('item must be an object');
  if ('status' in o || 'approval' in o) throw new Error('status/approval cannot be set from a drop; only the dashboard approves');
  return Q.add(dir, { lane: String(o.lane || 'general').slice(0, 40), kind: o.kind || 'draft', title: String(o.title || '').slice(0, 200), detail: String(o.detail || '').slice(0, 2000) }, now);
}
function drop(dir, dropDir, now = new Date()) {
  const out = { added: 0, rejected: 0 }; fs.mkdirSync(path.join(dropDir, 'done'), { recursive: true }); fs.mkdirSync(path.join(dropDir, 'rejected'), { recursive: true });
  for (const f of fs.readdirSync(dropDir).filter((n) => n.endsWith('.json')).sort()) {
    const p = path.join(dropDir, f); let n = 0;
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); const items = Array.isArray(j) ? j : [j]; items.forEach((o) => { if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad item'); if ('status' in o || 'approval' in o) throw new Error('status/approval not allowed'); if (!Q.KINDS.includes(o.kind || 'draft') || !o.title) throw new Error('bad kind/title'); }); items.forEach((o) => { enqueue(dir, o, now); n++; }); fs.renameSync(p, path.join(dropDir, 'done', f)); out.added += n; }
    catch { fs.renameSync(p, path.join(dropDir, 'rejected', f)); out.rejected++; } // validated first, so a bad file adds nothing
  }
  return out;
}
function tickLine(dir, now = new Date()) {
  const log = tick(dir, { now }); const q = Q.load(dir); const w = q.items.filter((i) => i.status === 'needs-approval').length;
  const last = log.find((l) => /-> (drafted|needs-approval)$/.test(l)); const moved = log.filter((l) => /-> (ready|held-quiet-hours)$/.test(l)).length;
  return `tick ${now.toISOString()}: ${last ? 'processed ' + last.replace(' ->', ' ->') : 'nothing to claim'}${moved ? `; ${moved} approved item(s) changed state` : ''}; ${w} waiting on Yoshi; ${P.quietHours(now) ? 'quiet hours' : 'daytime'}`;
}
function approvalsText(dir, now = new Date()) {
  const q = Q.load(dir), w = q.items.filter((i) => i.status === 'needs-approval'), h = q.items.filter((i) => i.status === 'held-quiet-hours');
  if (!w.length && !h.length) return 'Nothing is waiting on your approval.';
  const L = [];
  if (w.length) { L.push(`${w.length} item(s) need your OK. Approve or reject in the dashboard (a text reply here does not count):`); w.forEach((i, n) => L.push(`${n + 1}. [${i.lane}] ${i.title} (${i.kind})`)); }
  if (h.length) L.push(`${h.length} approved send(s) are held until 8am (quiet hours).`);
  return L.join('\n');
}
module.exports = { enqueue, drop, tickLine, approvalsText };
if (require.main === module) {
  const [cmd, dir, ...a] = process.argv.slice(2);
  try {
    if (!dir) throw new Error('usage: cli.js add|drop|tick|approvals <dir> ...');
    if (cmd === 'add') { const it = enqueue(dir, { lane: arg(a, 'lane'), kind: arg(a, 'kind'), title: arg(a, 'title'), detail: arg(a, 'detail') }); console.log(`queued ${it.id}`); }
    else if (cmd === 'drop') { const r = drop(dir, a[0]); console.log(`dropped: ${r.added} added, ${r.rejected} rejected`); }
    else if (cmd === 'tick') console.log(tickLine(dir));
    else if (cmd === 'approvals') console.log(approvalsText(dir));
    else throw new Error('unknown command (there is no approve command by design)');
  } catch (e) { console.error(e.message); process.exit(2); }
}
