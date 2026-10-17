'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('../queue/queue'), O = require('./overseer'), W = require('./worker'), D = require('../queue/dashboard');
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3w-'));
const T = new Date('2026-10-17T05:00:00Z');
const seed = (dir, s) => { const it = Q.add(dir, { lane: s.lane || 'research', title: s.title, kind: s.kind || 'draft', detail: s.detail || '' }, T); Q.update(dir, it.id, { status: s.status || 'drafted', owner: s.owner || 'w1', ...(s.artifacts ? { artifacts: s.artifacts } : {}) }); return it; };
const get = (dir, id) => Q.load(dir).items.find((i) => i.id === id);

// full loop: thin draft -> returned -> worker folds in workpad -> re-reviewed -> endorsed
let d = tmp();
fs.mkdirSync(path.join(d, 'drop'));
const thin = seed(d, { title: 'Goalhanger brief', detail: 'They raised money.', owner: 'agent-a' });
fs.writeFileSync(path.join(d, 'drop', thin.id + '.md'), 'Goalhanger raised from The Chernin Group for US expansion. 12 shows, top show ~700k weekly listeners. Next step: draft the intro note. https://www.goalhanger.com');
let a = O.tick(d, { now: T });
ok(get(d, thin.id).overseer.verdict === 'returned' && get(d, thin.id).overseer.returns === 1, 'thin draft returned, return count 1');
a = W.workTick(d, { now: T });
ok(a.length === 1 && a[0].answered >= 1 && a[0].stuck === 0, 'worker answered from its workpad');
ok(get(d, thin.id).overseer.verdict === 'reworked' && get(d, thin.id).overseer.returns === 1, 'resubmitted as reworked, return count preserved');
ok(/goalhanger\.com/.test(get(d, thin.id).detail) && get(d, thin.id).detail.length > 100, 'detail now carries the workpad material incl. the source link');
a = O.tick(d, { now: new Date(T.getTime() + 60000) });
ok(get(d, thin.id).overseer.verdict === 'endorsed', 'reworked item passes re-review: endorsed');

// stuck loop terminates in escalation, never in a fake answer
d = tmp();
const bare = seed(d, { title: 'bare claim', detail: 'Something happened.', owner: 'agent-b' });
O.tick(d, { now: T }); // returned, returns 1
let acts = W.workTick(d, { now: T });
ok(acts[0].stuck === 1 && acts[0].answered === 0, 'worker with an empty workpad says it is stuck instead of inventing detail');
ok(/do not have that/.test(get(d, bare.id).worker.stuck[0]), 'stuck reason is stated plainly');
O.tick(d, { now: new Date(T.getTime() + 60000) }); // returned again, returns 2
ok(get(d, bare.id).overseer.verdict === 'returned' && get(d, bare.id).overseer.returns === 2, 'second return recorded');
W.workTick(d, { now: new Date(T.getTime() + 120000) });
O.tick(d, { now: new Date(T.getTime() + 180000) });
ok(get(d, bare.id).overseer.verdict === 'escalated', 'after two failed returns the item escalates to the human');

// worker fixes a missing title from its own detail, and never touches approvals
d = tmp();
const noTitle = seed(d, { title: 'placeholder', detail: 'Deadstock reseller list with eleven storefronts and buying history. https://example.com/list', owner: 'agent-c' });
Q.update(d, noTitle.id, { title: '' });
O.tick(d, { now: T });
ok(get(d, noTitle.id).overseer.verdict === 'returned' && get(d, noTitle.id).overseer.questions.some((q) => q.rule === 'r-malformed'), 'missing title returned as r-malformed');
W.workTick(d, { now: T });
ok(get(d, noTitle.id).title.startsWith('Deadstock reseller list'), 'worker derived a title from the detail, not from thin air');

// gated items and untouched statuses are out of scope for the worker
d = tmp();
const gated = seed(d, { title: 'send note', kind: 'send', detail: 'To: jane@example.com - follow-up with the two links she asked for last week, one paragraph.', status: 'needs-approval', owner: 'agent-d' });
const quiet = seed(d, { title: 'untouched', detail: 'x', status: 'queued', owner: 'agent-d' });
O.tick(d, { now: T });
ok(W.workTick(d, { now: T }).length === 0, 'worker ignores annotated gated items and queued items');
ok(!get(d, gated.id).approval && get(d, gated.id).status === 'needs-approval', 'worker never writes approvals or changes gated status');

// artifact paths from item.artifacts are read too
d = tmp();
const pad = path.join(d, 'pad.md'); fs.writeFileSync(pad, 'Findings with a link https://example.com/findings and enough text to matter.');
const withArt = seed(d, { title: 'sourceless draft', detail: 'A finding that is long enough to pass the length bar but has no link in it at all.', owner: 'agent-e', artifacts: [pad] });
O.tick(d, { now: T });
if (get(d, withArt.id).overseer.verdict === 'returned') { W.workTick(d, { now: T }); ok(/Source: https:\/\/example\.com\/findings/.test(get(d, withArt.id).detail), 'worker pulled the source URL from item.artifacts'); }
else ok(get(d, withArt.id).overseer.verdict === 'endorsed', 'lenient overseer accepted the draft without artifacts (valid path)');

// dashboard renders overseer notes and the roster, escaped
(async () => {
  d = tmp();
  const shown = seed(d, { title: '<b>shown</b>', detail: 'short', owner: 'agent-f' });
  O.tick(d, { now: T });
  const { srv, token, port } = await D.serve(d, { port: 0, now: () => T });
  const html = await new Promise((r) => { require('http').get({ host: '127.0.0.1', port, path: '/?t=' + token }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => r(b)); }); });
  ok(/Overseers \(simulated - they never approve\)/.test(html), 'dashboard has the overseer section with the never-approve label');
  ok(/\((returned|endorsed|annotated)\): /.test(html), 'dashboard shows the persona verdict line');
  ok(!/<b>shown<\/b>/.test(html) && /&lt;b&gt;shown/.test(html), 'overseer-rendered content stays html-escaped');
  ok(/asked: /.test(html), 'dashboard shows the questions the overseer asked');
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
