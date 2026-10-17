#!/usr/bin/env node
'use strict';
// Self-contained demo: seeds a queue the way a night shift would leave it, runs one
// overseer pass, and prints the shift report. Uses a temp dir; touches nothing real.
//   node conductor3/overseer/demo.js
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('../queue/queue');
const O = require('./overseer');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-overseer-demo-'));
const NIGHT = new Date('2026-10-17T05:00:00Z'); // 1am New York
const seed = [
  { lane: 'research', owner: 'worker-research-1', kind: 'draft', title: 'Goalhanger US expansion brief', detail: 'Goalhanger raised from The Chernin Group for US expansion; 12 shows, top show 700k weekly listeners. Source: https://www.goalhanger.com - next step: draft intro note.', status: 'drafted' },
  { lane: 'research', owner: 'worker-research-1', kind: 'draft', title: 'PRX revenue breakdown', detail: '78% fees, 22% grants.', status: 'drafted' },
  { lane: 'deadstock', owner: 'worker-deadstock-1', kind: 'draft', title: 'Vintage Supreme reseller list', detail: 'Eleven US resellers with storefronts and buying history compiled from public listings and forum posts; no contact details guessed, only published addresses.', status: 'drafted' },
  { lane: 'job', owner: 'worker-job-1', kind: 'send', title: 'Follow-up to recruiter at Subaru of America', detail: 'To: recruiter@subaru.com - polite nudge on the licensing coordinator application, references HR screen Sep 29. Quiet hours respected: not before 8am.', status: 'needs-approval' },
  { lane: 'job', owner: 'worker-job-1', kind: 'money', title: 'Renew job board subscription', detail: 'auto-renews tomorrow', status: 'needs-approval' },
  { lane: 'advisory', owner: 'worker-advisory-1', kind: 'draft', title: 'Podcast network landscape', detail: 'Mapped 9 mid-size US podcast networks with public revenue signals, ownership, and whether they buy or build. Source: https://example.com/landscape - recommendation inside.', status: 'drafted' },
];
for (const s of seed) { const it = Q.add(dir, s, NIGHT); Q.update(dir, it.id, { status: s.status, owner: s.owner }); }
console.log('Seeded ' + seed.length + ' items into ' + dir);
console.log('\n--- tick ---');
for (const a of O.tick(dir, { now: NIGHT })) console.log(`${a.item}: ${a.overseer} -> ${a.verdict}${a.questions ? ' (' + a.questions.join(',') + ')' : ''}${a.ready === false ? ' [not decision-ready]' : ''}`);
console.log('\n--- shift report ---');
process.stdout.write(O.report(dir));
console.log('(demo dir left at ' + dir + ' - delete it any time)');
