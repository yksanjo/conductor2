'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('./queue'), E = require('./executor');
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3e-')); const T0 = new Date('2026-10-16T14:00:00Z'), DAY = new Date('2026-10-16T15:00:00Z'), NIGHT = new Date('2026-10-17T03:00:00Z');
const approved = (d, kind = 'send', title = 'note') => { const it = Q.add(d, { kind, title }, T0); Q.update(d, it.id, { status: 'ready', approval: { source: 'dashboard-click', decision: 'approved', at: DAY.toISOString() } }); E.bindApproval(d, it.id); return it; };
(async () => {
  let calls = []; const ad = { send: async (i) => { calls.push(i.id); return 'ref-' + i.id; }, money: async () => { throw new Error('card declined'); } };
  let d = tmp(), it = approved(d);
  let r = await E.run(d, { now: DAY, live: false, adapters: ad }); ok(r.dryRun === 1 && calls.length === 0 && Q.load(d).items[0].status === 'ready', 'live=false is a dry run: adapter not called, item stays ready');
  r = await E.run(d, { now: DAY, live: true, adapters: {} }); ok(r.dryRun === 1 && Q.load(d).items[0].status === 'ready', 'live but no adapter is still a dry run');
  r = await E.run(d, { now: DAY, live: true, adapters: ad }); ok(r.executed === 1 && calls.length === 1 && Q.load(d).items[0].status === 'executed' && Q.load(d).items[0].ref === 'ref-' + it.id, 'live + adapter + valid approval executes once');
  r = await E.run(d, { now: DAY, live: true, adapters: ad }); ok(r.executed === 0 && calls.length === 1, 'never executes twice');
  ok(/"mode":"live"/.test(fs.readFileSync(path.join(d, 'executor.log'), 'utf8')), 'audit log written');
  // quiet hours re-checked at execution time
  d = tmp(); approved(d); calls = []; r = await E.run(d, { now: NIGHT, live: true, adapters: ad }); ok(calls.length === 0 && Q.load(d).items[0].status === 'held-quiet-hours', 'send at night: not executed, held (policy re-checked at execution time)');
  // money is not a send, so quiet hours do not block it, but the adapter failing marks it failed, not executed
  d = tmp(); approved(d, 'money', 'pay'); r = await E.run(d, { now: NIGHT, live: true, adapters: ad }); ok(r.failed === 1 && Q.load(d).items[0].status === 'failed' && /declined/.test(Q.load(d).items[0].note), 'adapter error -> failed, never "executed"');
  // content changed after approval
  d = tmp(); it = approved(d); Q.update(d, it.id, { title: 'DIFFERENT TEXT' }); calls = []; r = await E.run(d, { now: DAY, live: true, adapters: ad }); ok(calls.length === 0 && Q.load(d).items[0].status === 'needs-approval', 'content edited after approval: not executed, re-approval required');
  // forged approvals
  for (const [name, ap] of [['ping', { source: 'ping', decision: 'approved', at: DAY.toISOString() }], ['no approval', undefined], ['rejected', { source: 'dashboard-click', decision: 'rejected', at: DAY.toISOString() }]]) {
    d = tmp(); const x = Q.add(d, { kind: 'send', title: 'n' }, T0); Q.update(d, x.id, { status: 'ready', approval: ap }); calls = []; await E.run(d, { now: DAY, live: true, adapters: ad }); ok(calls.length === 0 && Q.load(d).items[0].status !== 'executed', 'status=ready with ' + name + ': not executed');
  }
  // unbound approval (valid click but no hash)
  d = tmp(); const y = Q.add(d, { kind: 'send', title: 'n' }, T0); Q.update(d, y.id, { status: 'ready', approval: { source: 'dashboard-click', decision: 'approved', at: DAY.toISOString() } }); calls = []; await E.run(d, { now: DAY, live: true, adapters: ad }); ok(calls.length === 0 && Q.load(d).items[0].status === 'needs-approval', 'approval not bound to content: not executed');
  // max per run
  d = tmp(); for (let i = 0; i < 4; i++) approved(d, 'send', 'n' + i); calls = []; r = await E.run(d, { now: DAY, live: true, adapters: ad, max: 2 }); ok(r.executed === 2 && calls.length === 2, 'max per run is respected');
  // crash safety: item stuck executing is never retried
  d = tmp(); it = approved(d); Q.update(d, it.id, { status: 'executing' }); calls = []; await E.run(d, { now: DAY, live: true, adapters: ad }); ok(calls.length === 0, 'item left in "executing" is not auto-retried');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
