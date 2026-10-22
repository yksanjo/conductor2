#!/usr/bin/env node
'use strict';
// One command for the whole shift on a real queue: drain pending queue work,
// overseers review, workers answer, rested overseers finish, report written.
// Free, local; nothing sends, publishes or pays. Gated items stay gated.
//   node conductor3/shift.js <queueDir> [--report out.md] [--rest-hours N]
// --rest-hours simulates overnight rest before the final pass (default 0 = no simulation;
// the morning cron should pass none - real time has passed by then).
const fs = require('fs');
const { tick } = require('./queue/tick');
const O = require('./overseer/overseer'), W = require('./overseer/worker');
const C = require('./compose'), Q = require('./queue/queue');

function shift(dir, { now = new Date(), restHours = 0 } = {}) {
  let drained = 0; while (tick(dir, { now }).length && drained++ < 200) {} // one item per tick; drain
  const composed = C.tick(dir, { now }); // placeholders become real drafts before review
  const reviewed = O.tick(dir, { now });
  const reworked = W.workTick(dir, { now });
  const second = restHours > 0 ? O.tick(dir, { now: new Date(now.getTime() + restHours * 36e5) }) : [];
  return { drained, composed, reviewed, reworked, second, report: O.report(dir) + draftSection(dir) };
}

// Morning-visible list of what got composed overnight. Drafts only; nothing sent.
function draftSection(dir) {
  const items = Q.load(dir).items.filter((i) => i.draft && i.draft.type);
  if (!items.length) return '';
  const L = ['', '## Drafts composed - review before any use, nothing sent', ''];
  for (const i of items) L.push(`- **${i.draft.subject}** [${i.draft.type}]${i.draft.recipient ? ' to ' + i.draft.recipient : ''}`);
  return L.join('\n');
}

module.exports = { shift };
if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir) { console.error('usage: shift.js <queueDir> [--report out.md] [--rest-hours N]'); process.exit(2); }
  const ri = args.indexOf('--report'), hi = args.indexOf('--rest-hours');
  const restHours = hi >= 0 ? Number(args[hi + 1]) || 0 : 0;
  const r = shift(dir, { restHours });
  if (ri >= 0) { fs.writeFileSync(args[ri + 1], r.report); console.log('report written to ' + args[ri + 1]); }
  else process.stdout.write(r.report);
  console.error(`drained ${r.drained}, composed ${r.composed.length}, reviewed ${r.reviewed.length}, reworked ${r.reworked.length}, second-pass ${r.second.length}`);
}
