'use strict';
// One idempotent step. Run it from any scheduler (cron, launchd, the Instinct's own wake). It never sends anything.
// draftFn(item) -> string draft text (injected; default stores a placeholder so the loop is testable offline).
const Q = require('./queue'), P = require('./policy');
function tick(dir, { now = new Date(), owner = 'tick', draftFn = (i) => `[draft pending] ${i.title}` } = {}) {
  const log = [];
  // 1. re-evaluate approvals that have been recorded (e.g. quiet hours ended)
  for (const it of Q.load(dir).items) {
    if (it.status === 'approved' || it.status === 'held-quiet-hours') {
      const d = P.decide(it, now); const st = d.action === 'ready' ? 'ready' : d.action === 'hold-quiet-hours' ? 'held-quiet-hours' : 'needs-approval';
      if (st !== it.status) { Q.update(dir, it.id, { status: st, note: d.reason }); log.push(`${it.id} -> ${st}`); }
    }
  }
  // 2. claim and process one queued item
  const it = Q.claim(dir, owner, now);
  if (it) {
    const d = P.decide(it, now);
    if (d.action === 'draft') { Q.update(dir, it.id, { status: 'drafted', draft: draftFn(it), note: d.reason, leaseUntil: undefined }); log.push(`${it.id} -> drafted`); }
    else { Q.update(dir, it.id, { status: 'needs-approval', note: d.reason, leaseUntil: undefined }); log.push(`${it.id} -> needs-approval`); }
  }
  Q.setLastTick(dir, now); return log;
}
module.exports = { tick };
if (require.main === module) { const dir = process.argv[2]; if (!dir) { console.error('usage: tick.js <dir>'); process.exit(2); } console.log(JSON.stringify(require('./tick').tick(dir))); }
