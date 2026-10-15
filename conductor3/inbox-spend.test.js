'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const state = require('./state'), spend = require('./spend'), inbox = require('./inbox');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3s-'));
// spend guard
const d = tmp(), D = new Date('2026-10-15T12:00:00Z');
ok(spend.check(d, 5, D).ok && spend.spent(d, D) === 0, 'empty day is under cap');
spend.record(d, 2.5, D); spend.record(d, 2, D);
ok(spend.check(d, 5, D).ok && spend.check(d, 5, D).remaining === 0.5, 'spend accumulates, remaining is correct');
spend.record(d, 0.5, D);
ok(!spend.check(d, 5, D).ok, 'stops at the cap (spent >= cap)');
ok(spend.check(d, 5, new Date('2026-10-16T12:00:00Z')).ok, 'new day starts at zero');
ok(!spend.check(d, 0, D).ok && !spend.check(d, undefined, D).ok && !spend.check(d, NaN, D).ok, 'missing/invalid cap fails closed');
let threw = 0; for (const bad of [-1, NaN, '3', Infinity]) { try { spend.record(d, bad, D); } catch { threw++; } }
ok(threw === 4, 'negative, NaN, string and Infinity costs rejected');
fs.appendFileSync(path.join(d, 'spend-2026-10-15.txt'), 'garbage\n-4\n');
ok(spend.spent(d, D) === 5, 'garbage and negative lines in the file are ignored');
// inbox
const runs = tmp();
const mk = (name, st, note) => { let r = state.create(name); if (st !== 'queued') { r = state.transition(r, 'running'); if (st === 'needs-input') r = state.transition(r, 'needs-input', note); if (st === 'failed') r = state.transition(r, 'failed', note); if (st === 'verified') { r = state.transition(r, 'ready-for-review'); r = state.transition(r, 'verified', note); } }
  fs.mkdirSync(path.join(runs, r.runId)); fs.writeFileSync(path.join(runs, r.runId, 'run.json'), JSON.stringify(r)); return r; };
const a = mk('m-ok', 'verified', 'sections present'), b = mk('m-fail', 'failed', 'budget: wall clock exceeded'), c = mk('m-ask', 'needs-input', 'which region?'), q = mk('m-wait', 'queued');
fs.mkdirSync(path.join(runs, 'broken')); fs.writeFileSync(path.join(runs, 'broken', 'run.json'), '{not json');
const md = inbox.render(inbox.load(runs));
ok(/5 run\(s\)|4 item\(s\) need you/.test(md) && /4 item\(s\) need you. 1 run/.test(md), 'counts: 4 need a decision (incl. unreadable), 1 quiet');
ok(md.indexOf('Needs your input') < md.indexOf('Failed') && md.indexOf('Failed') < md.indexOf('Ready for review'), 'ordered: needs-input, failed, ready');
ok(md.includes(a.runId) && md.includes(b.runId) && md.includes(c.runId) && !md.includes(q.runId), 'queued run is not listed; others are');
ok(/which region\?/.test(md) && /unreadable run.json/.test(md), 'notes shown, unreadable run.json surfaced as failed');
ok(/Nothing was sent, published or paid/.test(md), 'states nothing was sent');
ok(inbox.load(path.join(runs, 'nope')).length === 0, 'missing runs dir is empty, not a crash');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
