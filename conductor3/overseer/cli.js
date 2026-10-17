#!/usr/bin/env node
'use strict';
// Overseer CLI.
//   node conductor3/overseer/cli.js <dir> roster            who is on shift and who they watch
//   node conductor3/overseer/cli.js <dir> tick [--now ISO]  one review pass over the queue
//   node conductor3/overseer/cli.js <dir> work [--now ISO]  workers answer returned questions, resubmit
//   node conductor3/overseer/cli.js <dir> status            energy + counts per overseer
//   node conductor3/overseer/cli.js <dir> report            the morning shift report (markdown)
const O = require('./overseer');
const { ROSTER } = require('./personas');
const [dir, cmd, ...rest] = process.argv.slice(2);
const usage = 'usage: cli.js <dir> roster|tick|status|report [--now ISO]';
if (!dir || !cmd) { console.error(usage); process.exit(2); }
const nowIdx = rest.indexOf('--now');
const now = nowIdx >= 0 ? new Date(rest[nowIdx + 1]) : new Date();
if (cmd === 'roster') {
  const Q = require('../queue/queue');
  const agents = [...new Set(Q.load(dir).items.map((i) => i.owner || i.lane))];
  for (const p of ROSTER) console.log(`${p.name} (${p.role}) - strictness ${p.strictness}, attention ${p.attention}/shift`);
  console.log('');
  for (const a of agents) { const p = O.assign(a); console.log(`${a} -> ${p.name}`); }
} else if (cmd === 'tick') {
  const actions = O.tick(dir, { now });
  for (const a of actions) console.log(`${a.item}: ${a.overseer} -> ${a.verdict}${a.questions ? ' (' + a.questions.join(',') + ')' : ''}${a.ready === false ? ' [not decision-ready]' : ''}`);
  console.log(`${actions.length} review(s) this pass.`);
} else if (cmd === 'work') {
  const W = require('./worker');
  const actions = W.workTick(dir, { now });
  for (const a of actions) console.log(`${a.item}: answered ${a.answered}, stuck ${a.stuck}`);
  console.log(`${actions.length} item(s) reworked this pass.`);
} else if (cmd === 'status') {
  const s = O.loadState(dir);
  for (const p of ROSTER) { const ps = s.overseers[p.id]; if (ps) console.log(`${p.name}: energy ${(ps.energy * 100).toFixed(0)}%, reviewed ${ps.reviewed}, endorsed ${ps.endorsed}, returned ${ps.returned}, annotated ${ps.annotated}, deferred ${ps.deferred}`); }
} else if (cmd === 'report') {
  process.stdout.write(O.report(dir));
} else { console.error(usage); process.exit(2); }
