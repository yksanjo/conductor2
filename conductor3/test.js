'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const state = require('./state'), mission = require('./mission'), { runMission } = require('./runner');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const good = mission.load(path.join(__dirname, 'missions/nightly-repo-health.json'));
ok(true, 'example mission validates');
const rel = mission.load(path.join(__dirname, 'missions/relationship-ops-nightly.json'));
ok(rel.allowedOps.every((o) => !mission.GATED.includes(o)), 'relationship-ops mission validates and grants no gated op');
ok(mission.validate({ ...good, allowedOps: ['read', 'send'] }).some((e) => /gated/.test(e)), 'send is rejected as gated');
ok(mission.validate({ ...good, deliverable: { file: '../x', requiredSections: [] } }).length > 0, 'path escape rejected');
const r = state.create('m');
ok(r.state === 'queued', 'new run is queued');
let threw = false; try { state.transition(r, 'verified'); } catch { threw = true; }
ok(threw, 'queued -> verified is illegal');
ok(state.create('m').runId !== state.create('m').runId, 'run ids are unique');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3-'));
const report = (ok) => (m, run, dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'REPORT.md'), ok ? '# Summary\n# Findings\n# Proposed actions\n' : '# Summary\n'); return Promise.resolve({ status: 'done' }); };
(async () => {
  let o = await runMission(good, { launch: report(true), verify: async () => ({ ok: true, detail: 'npm test green' }) }, { root: tmp() });
  ok(o.run.state === 'verified' && o.inbox[0].kind === 'review', 'happy path ends verified with an inbox item');
  o = await runMission(good, { launch: report(false), verify: async () => ({ ok: true, detail: '' }) }, { root: tmp() });
  ok(o.run.state === 'failed' && o.run.attempt === 2, 'missing sections: retried once, then failed');
  o = await runMission(good, { launch: async () => ({ status: 'needs-input', detail: 'permission prompt' }), verify: async () => ({ ok: true }) }, { root: tmp() });
  ok(o.run.state === 'needs-input' && o.inbox[0].kind === 'needs-input', 'needs-input surfaces to inbox');
  o = await runMission(good, { launch: async () => ({ status: 'timeout' }), verify: async () => ({ ok: true }) }, { root: tmp() });
  ok(o.run.state === 'failed', 'timeout fails the run');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
