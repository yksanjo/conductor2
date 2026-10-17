'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('./queue/queue'), O = require('./overseer/overseer'), W = require('./overseer/worker'), A = require('./autofile');
const state = require('./state');
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3a-'));
const T = new Date('2026-10-17T21:00:00Z');

// make three run folders: verified with a deliverable, needs-input, failed
const runs = tmp(), qdir = tmp();
function mkRun(name, st, deliverable) {
  let run = state.create(name, T);
  run = state.transition(run, 'running', 'attempt 1', T);
  run = st === 'verified'
    ? state.transition(state.transition(run, 'ready-for-review', 'done', T), 'verified', 'all sections present', T)
    : st === 'needs-input' ? state.transition(run, 'needs-input', 'which budget line?', T) : state.transition(run, 'failed', 'verifier red', T);
  const rd = path.join(runs, run.runId); fs.mkdirSync(rd, { recursive: true });
  fs.writeFileSync(path.join(rd, 'run.json'), JSON.stringify(run, null, 2));
  if (deliverable) fs.writeFileSync(path.join(rd, 'REPORT.md'), deliverable);
  return run;
}
const v = mkRun('nightly-repo-health', 'verified', '# Repo health\n\nAll 165 tests pass on a fresh clone of main. No stale branches.\nNext: wire autofile into nightly.sh. https://github.com/yksanjo/conductor2');
const n = mkRun('lead-extraction-nightly', 'needs-input', null);
const f = mkRun('nightly-repo-health', 'failed', null);

const items = A.fileRuns(qdir, runs, T);
ok(items.length === 3, 'all three terminal runs filed');
const get = (runId) => Q.load(qdir).items.find((i) => i.runId === runId);
ok(get(v.runId).status === 'drafted' && get(v.runId).kind === 'draft', 'verified run lands as a drafted item');
ok(get(v.runId).artifacts.length === 1 && fs.existsSync(get(v.runId).artifacts[0]), 'deliverable attached as the worker workpad artifact');
ok(/All 165 tests pass/.test(get(v.runId).detail), 'detail carries a deliverable excerpt');
ok(/^Needs your input: /.test(get(n.runId).title), 'needs-input run is titled for the morning');
ok(/^FAILED: /.test(get(f.runId).title), 'failed run is titled FAILED');
ok(get(v.runId).owner === 'mission:nightly-repo-health', 'owner is the mission, so overseer assignment is stable per mission');
ok(A.fileRuns(qdir, runs, T).length === 0, 'idempotent: already-filed runs are never filed twice');

// the filed deliverable feeds the worker loop: a thin item gets its workpad folded in
const q = Q.load(qdir);
const thin = q.items.find((i) => i.runId === v.runId);
Q.update(qdir, thin.id, { detail: 'Run ended verified.' }); // simulate a thin filing
O.tick(qdir, { now: T });
const after1 = Q.load(qdir).items.find((i) => i.id === thin.id);
if (after1.overseer.verdict === 'returned') {
  W.workTick(qdir, { now: T });
  O.tick(qdir, { now: new Date(T.getTime() + 60000) });
  const after2 = Q.load(qdir).items.find((i) => i.id === thin.id);
  ok(after2.overseer.verdict === 'endorsed' && /All 165 tests pass/.test(after2.detail), 'worker folds the filed deliverable in when an overseer returns it');
} else {
  ok(after1.overseer.verdict === 'endorsed', 'lenient overseer accepted the thin filing (valid path)');
}
// non-terminal runs are not filed
let run = state.create('nightly-repo-health', T);
const rd = path.join(runs, run.runId); fs.mkdirSync(rd, { recursive: true });
fs.writeFileSync(path.join(rd, 'run.json'), JSON.stringify(state.transition(run, 'running', 'attempt 1', T), null, 2));
ok(A.fileRuns(qdir, runs, T).length === 0, 'in-progress runs are not filed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
