'use strict';
// Auto-file mission deliverables into the queue. Closes the loop:
// missions produce run folders (runner.js) -> this files them as queue items ->
// overseers review -> morning shift report. Free, local, no send/publish/pay.
//
//   const { fileRuns } = require('./autofile');
//   fileRuns(queueDir, runsRoot)            // file every unfiled run
//   node conductor3/autofile.js <queueDir> <runsRoot>
//
// verified runs    -> drafted item, deliverable attached as an artifact (the worker's workpad)
// needs-input runs -> drafted item titled "Needs your input", deliverable attached if present
// failed runs      -> drafted item titled "FAILED", so the morning report shows it
// Idempotent: a run already in the queue (item.runId) is never filed twice.
const fs = require('fs'), path = require('path');
const Q = require('./queue/queue');
const inbox = require('./inbox');

function alreadyFiled(dir) {
  return new Set(Q.load(dir).items.map((i) => i.runId).filter(Boolean));
}

function findDeliverable(runDir, mission) {
  if (mission && mission.deliverable && mission.deliverable.file) {
    const p = path.join(runDir, mission.deliverable.file);
    if (fs.existsSync(p)) return p;
  }
  // fallback: newest markdown file in the run folder (run.json is not a deliverable)
  try {
    const mds = fs.readdirSync(runDir).filter((f) => f.endsWith('.md')).map((f) => path.join(runDir, f));
    if (!mds.length) return null;
    return mds.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  } catch { return null; }
}

function fileRun(dir, run, runsRoot, now = new Date(), mission = null) {
  const runDir = path.join(runsRoot, run.runId);
  const h = run.history && run.history[run.history.length - 1];
  const note = (h && (h.note || h.detail)) || '';
  const artifacts = [];
  const deliverable = findDeliverable(runDir, mission);
  if (deliverable) artifacts.push(deliverable);
  const firstLines = deliverable ? fs.readFileSync(deliverable, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 4).join(' ').slice(0, 350) : '';
  const label = run.state === 'verified' ? '' : run.state === 'needs-input' ? 'Needs your input: ' : 'FAILED: ';
  const item = Q.add(dir, {
    lane: 'missions',
    kind: 'draft',
    title: `${label}${run.mission || run.runId}`,
    detail: `Run ${run.runId} ended "${run.state}". ${note}${firstLines ? ' Deliverable excerpt: ' + firstLines : ''}${deliverable ? ' Source: ' + deliverable : ''}`,
  }, now);
  Q.update(dir, item.id, { status: 'drafted', owner: 'mission:' + (run.mission || 'unknown'), runId: run.runId, artifacts });
  return item;
}

// File every terminal run under runsRoot that is not already in the queue. Returns the new items.
// opts.missionsDir: when given, mission definitions are loaded by name for exact deliverable paths.
function fileRuns(dir, runsRoot, now = new Date(), opts = {}) {
  const filed = alreadyFiled(dir);
  const out = [];
  for (const run of inbox.load(runsRoot)) {
    if (!['verified', 'needs-input', 'failed'].includes(run.state)) continue;
    if (filed.has(run.runId)) continue;
    let mission = null;
    if (opts.missionsDir && run.mission) {
      try { mission = require('./mission').load(path.join(opts.missionsDir, run.mission + '.json')); } catch {}
    }
    out.push(fileRun(dir, run, runsRoot, now, mission));
  }
  return out;
}

module.exports = { fileRuns, fileRun };
if (require.main === module) {
  const [dir, runsRoot] = process.argv.slice(2);
  if (!dir || !runsRoot) { console.error('usage: autofile.js <queueDir> <runsRoot>'); process.exit(2); }
  const items = fileRuns(dir, runsRoot, new Date(), { missionsDir: path.join(__dirname, 'missions') });
  for (const i of items) console.log(`filed ${i.runId} -> ${i.id} (${i.title})`);
  console.log(`${items.length} run(s) filed.`);
  }
