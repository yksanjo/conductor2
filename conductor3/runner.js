'use strict';
// Minimal mission runner (DRAFT). Pure orchestration logic with injected side effects, so it is
// testable without tmux or Claude. It does NOT yet call conductor2's fire() - see docs/CONDUCTOR3.md
// "What works / what doesn't".
//
//   deps.launch(mission, run, runDir) -> Promise<{ status: 'done'|'needs-input'|'timeout', detail? }>
//   deps.verify(mission, run, runDir) -> Promise<{ ok: boolean, detail: string }>

const fs = require('fs');
const path = require('path');
const state = require('./state');

function runDirFor(root, run) { return path.join(root, run.runId); } // fresh folder per run, never reused

function checkSections(mission, runDir) {
  const f = path.join(runDir, mission.deliverable.file);
  if (!fs.existsSync(f)) return { ok: false, detail: `missing ${mission.deliverable.file}` };
  const text = fs.readFileSync(f, 'utf8');
  const missing = mission.deliverable.requiredSections.filter((s) => !new RegExp(`^#{1,4}\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').test(text));
  return missing.length ? { ok: false, detail: `missing sections: ${missing.join(', ')}` } : { ok: true, detail: 'all sections present' };
}

async function runMission(mission, deps, { root, now = () => new Date() }) {
  let run = state.create(mission.name, now());
  const maxAttempts = 1 + ((mission.retry || {}).max || 0);
  const inbox = [];
  const save = () => { fs.mkdirSync(runDirFor(root, run), { recursive: true }); fs.writeFileSync(path.join(runDirFor(root, run), 'run.json'), JSON.stringify(run, null, 2)); };
  save();
  for (;;) {
    const dir = runDirFor(root, run);
    run = state.transition(run, 'running', `attempt ${run.attempt}`, now()); save();
    const res = await deps.launch(mission, run, dir);
    if (res.status === 'needs-input') { run = state.transition(run, 'needs-input', res.detail, now()); save(); inbox.push({ runId: run.runId, kind: 'needs-input', detail: res.detail }); return { run, inbox }; }
    if (res.status === 'timeout') { run = state.transition(run, 'failed', 'budget: wall clock exceeded', now()); save(); inbox.push({ runId: run.runId, kind: 'failed', detail: 'timeout' }); return { run, inbox }; }
    run = state.transition(run, 'ready-for-review', res.detail, now()); save();
    const sec = mission.verifier.sections ? checkSections(mission, dir) : { ok: true, detail: 'skipped' };
    const cmd = sec.ok && mission.verifier.command ? await deps.verify(mission, run, dir) : { ok: true, detail: 'skipped' };
    if (sec.ok && cmd.ok) { run = state.transition(run, 'verified', `${sec.detail}; ${cmd.detail}`, now()); save(); inbox.push({ runId: run.runId, kind: 'review', detail: 'verified; deliverable awaiting your decision' }); return { run, inbox }; }
    const why = sec.ok ? cmd.detail : sec.detail;
    if (run.attempt < maxAttempts) { run = state.transition(run, 'queued', `verifier red: ${why}`, now()); save(); continue; }
    run = state.transition(run, 'failed', `verifier red after ${run.attempt} attempt(s): ${why}`, now()); save();
    inbox.push({ runId: run.runId, kind: 'failed', detail: why });
    return { run, inbox };
  }
}

module.exports = { runMission, checkSections, runDirFor };
