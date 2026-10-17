'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('../queue/queue'), O = require('./overseer'), { ROSTER } = require('./personas');
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3o-'));
const T = new Date('2026-10-17T05:00:00Z');
const GOOD = 'A solid finding with a next step and a link: https://example.com/report plus context on why it matters.';
const seedItem = (dir, s) => { const it = Q.add(dir, { lane: s.lane || 'research', title: s.title, kind: s.kind || 'draft', detail: s.detail || '' }, T); Q.update(dir, it.id, { status: s.status || 'drafted', owner: s.owner || 'w1' }); return it; };

// roster + assignment
ok(ROSTER.length >= 3 && ROSTER.every((p) => p.id && p.name && p.strictness >= 0 && p.strictness <= 1 && p.attention > 0 && p.voice), 'roster personas are well-formed');
ok(new Set(ROSTER.map((p) => p.id)).size === ROSTER.length, 'persona ids unique');
ok(O.assign('worker-a').id === O.assign('worker-a').id, 'assignment is stable for the same agent');
ok(typeof O.assign('worker-a').id === 'string' && typeof O.assign('').id === 'string', 'assignment handles odd agent ids');

// rules
const strict = ROSTER.find((p) => p.strictness >= 0.9), lenient = ROSTER.reduce((a, b) => (a.strictness < b.strictness ? a : b));
ok(O.check({ title: 'x', kind: 'draft', detail: GOOD }, strict).length === 0, 'clean draft with URL passes a strict overseer');
ok(O.check({ title: 'x', kind: 'draft', detail: 'short' }, strict).some((p) => p.rule === 'r-thin-detail'), 'thin detail is questioned');
ok(O.check({ title: 'x', kind: 'draft', detail: 'Long enough detail to pass the length bar but with no link anywhere at all in it.' }, strict).some((p) => p.rule === 'r-no-source'), 'strict overseer demands a URL');
ok(O.check({ title: 'x', kind: 'draft', detail: 'Long enough detail to pass the length bar, source: internal tracker notes.' }, lenient).length === 0, 'lenient overseer accepts a named source');
ok(O.check({ title: '', kind: 'draft', detail: GOOD }, strict).some((p) => p.rule === 'r-malformed'), 'missing title is questioned');

// decision readiness for gated kinds
ok(O.decisionReady({ kind: 'money', detail: 'Renewal is $99 for the year, charged to the card on file. We used it weekly this year and it underpins two lanes.' }, strict).length === 0, 'money item with amount is decision-ready');
ok(O.decisionReady({ kind: 'money', detail: 'Renews tomorrow, seems useful, we talked about keeping it going for now.' }, strict).includes('no amount stated'), 'money item without amount is not ready');
ok(O.decisionReady({ kind: 'send', detail: 'To: jane@example.com - thanks for the call, one careful paragraph follow-up with the two links she asked for.' }, strict).length === 0, 'send item with recipient is decision-ready');
ok(O.decisionReady({ kind: 'commitment', detail: 'Accept the calendar invite for the intro call Wed Oct 21, 9:00-9:30am ET, Google Meet link included.' }, strict).length === 0, 'non-monetary commitment does not need an amount');
ok(O.decisionReady({ kind: 'send', detail: 'A short reply to her about the thing we discussed last week sometime soon.' }, strict).includes('no recipient stated'), 'send item without recipient is not ready');

// tick behavior
let d = tmp();
const clean = seedItem(d, { title: 'clean draft', detail: GOOD, owner: 'agent-clean' });
const thin = seedItem(d, { title: 'thin draft', detail: 'meh', owner: 'agent-thin' });
const gated = seedItem(d, { title: 'send note', kind: 'send', detail: 'To: jane@example.com - a careful follow-up paragraph with the two links she asked for last week.', status: 'needs-approval', owner: 'agent-gated' });
const queuedIt = seedItem(d, { title: 'not yet worked', detail: GOOD, status: 'queued', owner: 'agent-clean' });
let acts = O.tick(d, { now: T });
let q = Q.load(d);
const get = (id) => q.items.find((i) => i.id === id);
ok(get(clean.id).overseer.verdict === 'endorsed', 'clean item endorsed');
ok(get(thin.id).overseer.verdict === 'returned' && get(thin.id).overseer.questions.some((p) => p.rule === 'r-thin-detail'), 'thin item returned with the rule named');
ok(get(gated.id).overseer.verdict === 'annotated' && get(gated.id).overseer.ready === true, 'gated item annotated as decision-ready');
ok(get(gated.id).status === 'needs-approval' && !get(gated.id).approval, 'overseer never approves: status untouched, no approval written');
ok(get(queuedIt.id).overseer === undefined, 'queued (unworked) items are not reviewed');
ok(acts.length === 3, 'tick reports exactly what it did');
ok(O.tick(d, { now: T }).length === 0, 'second tick is idempotent');

// fatigue and deferral
d = tmp();
const lowAttention = [{ id: 't1', name: 'T', role: 'r', strictness: 0.5, attention: 2, restHours: 8, voice: ROSTER[0].voice }];
for (let i = 0; i < 4; i++) seedItem(d, { title: 'item ' + i, detail: GOOD, owner: 'same-agent' });
acts = O.tick(d, { now: T, roster: lowAttention });
ok(acts.filter((a) => a.verdict === 'endorsed').length === 2 && acts.filter((a) => a.verdict === 'deferred').length === 2, 'attention budget caps reviews, the rest defer');
let later = new Date(T.getTime() + 8 * 36e5);
acts = O.tick(d, { now: later, roster: lowAttention });
ok(acts.filter((a) => a.verdict === 'endorsed').length === 2, 'a rested overseer picks the deferred items back up');

// return cap -> escalation
d = tmp();
const stubborn = seedItem(d, { title: 'bad', detail: 'x', owner: 'agent-x' });
for (let i = 0; i < 3; i++) { const it = Q.load(d).items[0]; if (it.overseer && it.overseer.verdict === 'returned') delete it.overseer, Q.save(d, Q.load(d)); O.tick(d, { now: new Date(T.getTime() + i * 60000) }); if (i < 2) { const qq = Q.load(d); delete qq.items[0].overseer; qq.items[0].overseer = { returns: i + 1, verdict: 'deferred' }; Q.save(d, qq); } }
q = Q.load(d);
ok(q.items[0].overseer.verdict === 'escalated', 'after two returns the item escalates to the human instead of looping');

// state persistence
d = tmp(); seedItem(d, { title: 'one', detail: GOOD, owner: 'agent-p' });
O.tick(d, { now: T });
const st = O.loadState(d);
ok(Object.keys(st.overseers).length === 1 && st.overseers[Object.keys(st.overseers)[0]].reviewed === 1, 'overseer state persists across loads');

// report
d = tmp();
seedItem(d, { title: 'clean draft', detail: GOOD, owner: 'agent-clean' });
seedItem(d, { title: 'thin draft', detail: 'meh', owner: 'agent-thin' });
seedItem(d, { title: 'send note', kind: 'send', detail: 'To: jane@example.com - a careful follow-up paragraph with the two links she asked for last week.', status: 'needs-approval', owner: 'agent-gated' });
O.tick(d, { now: T });
const r = O.report(d);
ok(/# Overseer shift report/.test(r) && /Endorsed - ready to use \(1\)/.test(r) && /Returned to the worker \(1\)/.test(r) && /Annotated - your decision, not theirs \(1\)/.test(r), 'report has all sections with counts');
ok(/Nothing was approved, sent, published or paid/.test(r), 'report states the invariant up front');
ok(/decision-ready/.test(r), 'gated annotation says decision-ready');
ok(!/Deferred - the overseer ran out of attention/.test(r), 'report omits the deferred section when nothing is deferred');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
