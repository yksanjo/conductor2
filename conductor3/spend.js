'use strict';
// Daily spend ledger with a hard cap. Workers that use paid APIs call record() with their cost;
// the nightly script calls check() before each run and stops when the cap is reached.
// One file per day (spend-YYYY-MM-DD.txt), one number per line. Append-only.
const fs = require('fs'), path = require('path');
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const file = (dir, d) => path.join(dir, `spend-${day(d)}.txt`);
function spent(dir, d) {
  const f = file(dir, d); if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).map(Number).filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => a + b, 0);
}
function record(dir, usd, d) {
  if (!(typeof usd === 'number' && usd >= 0 && Number.isFinite(usd))) throw new Error('cost must be a non-negative number');
  fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(file(dir, d), usd + '\n'); return spent(dir, d);
}
// check: ok=false once spent >= cap. A missing or invalid cap fails closed.
function check(dir, cap, d) {
  if (!(typeof cap === 'number' && cap > 0)) return { ok: false, spent: spent(dir, d), cap, reason: 'no valid cap set' };
  const s = spent(dir, d); return { ok: s < cap, spent: s, cap, remaining: Math.max(0, cap - s), reason: s < cap ? 'under cap' : 'cap reached' };
}
module.exports = { spent, record, check };
if (require.main === module) {
  const [cmd, dir, v] = process.argv.slice(2);
  if (cmd === 'check') { const r = check(dir, Number(v)); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 3); }
  if (cmd === 'record') { console.log(record(dir, Number(v))); process.exit(0); }
  console.error('usage: spend.js check <dir> <capUSD> | record <dir> <costUSD>'); process.exit(2);
}
