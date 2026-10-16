'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const Q = require('./queue'), P = require('./policy'), { tick } = require('./tick'), D = require('./dashboard');
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3q-'));
const DAY = new Date('2026-10-16T15:00:00Z'), NIGHT = new Date('2026-10-17T03:00:00Z'); // 11am and 11pm New York
ok(!P.quietHours(DAY) && P.quietHours(NIGHT), 'quiet hours 9pm-8am New York');
ok(P.quietHours(new Date('2026-10-16T01:00:00Z')) && !P.quietHours(new Date('2026-10-16T12:30:00Z')) && !P.quietHours(new Date('2026-10-16T00:59:00Z')), 'edge hours: 8:59pm open, 9pm quiet, 8:30am open');
const mk = (kind, approval) => ({ kind, createdAt: '2026-10-16T10:00:00Z', approval });
const click = { source: 'dashboard-click', decision: 'approved', at: '2026-10-16T11:00:00Z' };
ok(P.decide(mk('draft'), DAY).action === 'draft', 'drafts need no approval');
for (const k of ['send', 'money', 'commitment']) ok(P.decide(mk(k), DAY).action === 'park-approval', k + ' without approval is parked');
ok(P.decide(mk('send', click), DAY).action === 'ready', 'approved send in daytime is ready');
ok(P.decide(mk('send', click), NIGHT).action === 'hold-quiet-hours', 'approved send at night is held');
ok(P.decide(mk('money', click), NIGHT).action === 'ready', 'approved money item is not a send, so quiet hours do not apply');
for (const bad of [{ ...click, source: 'whatsapp' }, { ...click, source: 'agent' }, { ...click, source: 'ping' }, { ...click, decision: 'yes' }, { ...click, at: 'nonsense' }, { ...click, at: '2026-10-16T09:00:00Z' }, {}, 'approved', null])
  ok(P.decide(mk('send', bad), DAY).action === 'park-approval', 'invalid approval rejected: ' + JSON.stringify(bad));
ok(P.decide({ kind: 'wire-funds' }, DAY).action === 'park-approval' && P.decide(null, DAY).action === 'park-approval' && P.decide({}, DAY).action === 'park-approval', 'unknown/malformed fails closed');
// queue + tick
const d = tmp(); const a = Q.add(d, { lane: 'job', title: 'draft note', kind: 'draft' }), b = Q.add(d, { lane: 'job', title: 'send note', kind: 'send' });
let threw = false; try { Q.add(d, { title: 'x', kind: 'nuke' }); } catch { threw = true; } ok(threw, 'unknown kind rejected at add');
ok(Q.claim(d, 'w1', DAY).id === a.id && Q.claim(d, 'w2', DAY).id === b.id && Q.claim(d, 'w3', DAY) === null, 'claims are exclusive, no double take');
ok(Q.claim(d, 'w3', new Date(DAY.getTime() + 11 * 60000)).id === a.id, 'expired lease is reclaimable');
const d2 = tmp(); Q.add(d2, { title: 'draft', kind: 'draft' }); Q.add(d2, { title: 'wire', kind: 'money' });
tick(d2, { now: DAY }); tick(d2, { now: DAY });
let q = Q.load(d2); ok(q.items[0].status === 'drafted' && q.items[1].status === 'needs-approval' && q.lastTick === DAY.toISOString(), 'tick drafts, parks money, records lastTick');
ok(tick(d2, { now: DAY }).length === 0, 'tick is idempotent when nothing is left');
Q.update(d2, q.items[1].id, { status: 'approved', approval: { source: 'ping', decision: 'approved', at: DAY.toISOString() } });
tick(d2, { now: DAY }); ok(Q.load(d2).items[1].status === 'needs-approval', 'a non-dashboard "approval" is bounced back to needs-approval');
// dashboard
(async () => {
  const d3 = tmp(); Q.add(d3, { lane: 'job', title: '<b>x</b> send', kind: 'send' }); tick(d3, { now: DAY }); const id = Q.load(d3).items[0].id;
  const { srv, token, port } = await D.serve(d3, { port: 0, now: () => DAY });
  const req = (method, p, headers = {}) => new Promise((r) => { const q = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => r({ s: res.statusCode, b })); }); q.end(); });
  const home = await req('GET', '/'); ok(home.s === 200 && /Waiting on you \(1\)/.test(home.b) && !/<b>x<\/b>/.test(home.b) && /&lt;b&gt;x/.test(home.b), 'page shows waiting item, html escaped');
  ok((await req('POST', '/api/approve/' + id)).s === 403, 'approve without token is refused');
  ok((await req('POST', '/api/approve/' + id, { 'x-token': 'wrong' })).s === 403, 'approve with wrong token is refused');
  ok((await req('POST', '/api/approve/' + id, { 'x-token': token, origin: 'http://evil.example' })).s === 403, 'approve from foreign origin is refused');
  ok((await req('GET', '/', { host: 'evil.example' })).s === 403, 'foreign Host header refused (DNS rebinding)');
  ok((await req('POST', '/api/approve/' + id, { 'x-token': token })).s === 200 && Q.load(d3).items[0].approval.source === 'dashboard-click', 'approve with token records a dashboard-click approval');
  tick(d3, { now: DAY }); ok(Q.load(d3).items[0].status === 'ready', 'next tick moves it to ready (still not sent)');
  ok((await req('POST', '/api/approve/' + id, { 'x-token': token })).s === 409, 'cannot re-approve a non-waiting item');
  srv.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
