#!/usr/bin/env node
'use strict';
// End-to-end demo of the whole night shift, all local, no AI workers, no spend:
//   mission -> runner (with a fake launcher) -> run folder -> autofile -> queue
//   -> overseer review -> worker pass -> overseer re-review -> morning shift report.
// The fake launcher just writes a deliverable; it stands in for conductor2's swarm,
// which the runner does not call yet. Nothing here sends, publishes or pays.
//   node conductor3/demo-shift.js
const fs = require('fs'), os = require('os'), path = require('path');
const mission = require('./mission'), runner = require('./runner');
const Q = require('./queue/queue'), A = require('./autofile');
const O = require('./overseer/overseer'), W = require('./overseer/worker');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-shift-'));
  const runsRoot = path.join(root, 'runs'), queueDir = path.join(root, 'queue');
  const NIGHT = new Date('2026-10-18T07:00:00Z'); // 3am New York
  const m = mission.load(path.join(__dirname, 'missions', 'nightly-repo-health.json'));

  // 1. run the mission with an injected fake launcher (real one would fire a swarm)
  const fakeLaunch = async (mission, run, runDir) => {
    fs.writeFileSync(path.join(runDir, mission.deliverable.file),
      `# Repo health - ${run.runId}\n\n## Summary\nAll 175 tests pass on a fresh clone; one stale branch.\n\n## Findings\n- conductor3/autofile awaits merge as PR #6. https://github.com/yksanjo/conductor2/pull/6\n- reviewer-hardening PR #2 is 5 days old.\n\n## Proposed actions\n- Merge #6 after review; rebase or close #2.\n`);
    return { status: 'done', detail: 'fake launcher wrote the deliverable' };
  };
  const fakeVerify = async () => ({ ok: true, detail: 'fake verifier green' });
  const { run } = await runner.runMission(m, { launch: fakeLaunch, verify: fakeVerify }, { root: runsRoot, now: () => NIGHT });
  console.log(`1. mission run: ${run.runId} -> ${run.state}`);

  // 2. autofile the terminal run into the queue
  const filed = A.fileRuns(queueDir, runsRoot, NIGHT, { missionsDir: path.join(__dirname, 'missions') });
  console.log(`2. autofile: ${filed.length} run(s) filed -> ${filed.map((i) => i.id).join(', ')}`);

  // 3. overseers review; workers answer; rested overseers finish the shift
  console.log('3. overseer pass 1:');
  for (const a of O.tick(queueDir, { now: NIGHT })) console.log(`   ${a.item}: ${a.overseer} -> ${a.verdict}${a.questions ? ' (' + a.questions.join(',') + ')' : ''}`);
  const worked = W.workTick(queueDir, { now: new Date(NIGHT.getTime() + 30 * 60000) });
  console.log(`   worker pass: ${worked.length} reworked`);
  console.log('   overnight rest, overseer pass 2 (+9h):');
  for (const a of O.tick(queueDir, { now: new Date(NIGHT.getTime() + 9 * 36e5) })) console.log(`   ${a.item}: ${a.overseer} -> ${a.verdict}`);

  // 4. the morning shift report
  console.log('\n===== MORNING SHIFT REPORT =====\n');
  process.stdout.write(O.report(queueDir));
  console.log('(demo root left at ' + root + ' - delete it any time)');
})();
