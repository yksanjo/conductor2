'use strict';

// Conductor V2 tests — real modules, real files, real HTTP; tmux integration runs only when
// tmux is installed. Run: npm test
//
// HOME is pointed at a throwaway dir BEFORE any module loads, so the swarm/registry paths
// (~/.conductor2/…) land in the sandbox, never in the real home.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor2-test-'));
process.env.HOME = SANDBOX;
process.env.USERPROFILE = SANDBOX; // windows safety

const topologies = require('./topologies');
const presets = require('./presets');
const swarm = require('./swarm');
const manage = require('./manage');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg); }
}

// --- topologies ------------------------------------------------------------------------------
console.log('\ntopologies');
{
  const h = topologies.get('hierarchical');
  const roles = h.roles(5, ['alpha', 'beta']);
  ok(roles.length === 5 && roles[0].slot === 'orc' && roles[0].initiator, 'hierarchical: orc + 4 workers, orc initiates');
  ok(roles[1].role === 'alpha' && roles[2].role === 'beta' && roles[3].role === 'worker 3', 'hierarchical: role hints applied, then defaults');

  const ctx = (key, n) => {
    const t = topologies.get(key);
    const agents = t.roles(n).map((r) => ({ ...r, window: `sw-${r.slot}` }));
    return { t, ctx: { swarm: 'sw', topology: key, purpose: 'PURPOSE-X', dir: '/tmp/sw', sayPath: '/tmp/say', agents } };
  };

  const hc = ctx('hierarchical', 3);
  const orcBrief = hc.t.briefing(hc.ctx, hc.ctx.agents[0]);
  const wBrief = hc.t.briefing(hc.ctx, hc.ctx.agents[1]);
  ok(orcBrief.includes('ORCHESTRATOR') && orcBrief.includes('REPORT.md') && orcBrief.includes('PURPOSE-X'), 'orc briefing: role, mission, final report');
  ok(wBrief.includes('WAIT') && wBrief.includes('sw-orc'), 'worker briefing: waits for the orchestrator');

  const pc = ctx('pipeline', 3);
  const s1 = pc.t.briefing(pc.ctx, pc.ctx.agents[0]);
  const s3 = pc.t.briefing(pc.ctx, pc.ctx.agents[2]);
  ok(s1.includes('begin IMMEDIATELY') && s1.includes('sw-s2'), 'pipeline: stage 1 starts and hands off to stage 2');
  ok(s3.includes('FINAL stage') && s3.includes('REPORT.md'), 'pipeline: last stage owns REPORT.md');
  ok(pc.t.roles(3)[0].initiator && !pc.t.roles(3)[1].initiator, 'pipeline: only stage 1 initiates');

  const mc = ctx('mesh', 4);
  const p1 = mc.t.briefing(mc.ctx, mc.ctx.agents[0]);
  const p2 = mc.t.briefing(mc.ctx, mc.ctx.agents[1]);
  ok(p1.includes('SCRIBE') && !p2.includes('SCRIBE'), 'mesh: only peer 1 is scribe');
  ok(p2.includes('claims.md') && p2.includes('sw-p1') && p2.includes('sw-p3'), 'mesh: peers claim angles and know each other');

  let threw = false;
  try { topologies.get('star'); } catch { threw = true; }
  ok(threw, 'unknown topology throws');
}

// --- presets ---------------------------------------------------------------------------------
console.log('\npresets');
{
  ok(presets.list().length === 3, 'three premade setups');
  for (const p of presets.list()) {
    ok(!!(p.title && p.desc && p.purpose && p.topology && p.agents >= 2 && p.roleHints.length), `preset ${p.key}: complete`);
    topologies.get(p.topology); // throws if a preset points at a bad topology
  }
  ok(presets.get('web3-security').topology === 'pipeline', 'web3-security rides the pipeline');
  ok(/READ-ONLY/.test(presets.get('market-bots').purpose), 'market-bots is observe-and-report, not touch-the-bots');
}

// --- swarm.plan ------------------------------------------------------------------------------
console.log('\nswarm.plan');
{
  const p = swarm.plan({ preset: 'deep-research', purpose: 'research X thoroughly' });
  ok(p.topology === 'hierarchical' && p.agents.length === 5, 'preset resolves topology + crew size');
  ok(p.model === 'claude-fable-5', 'model locked to claude-fable-5');
  ok(p.agents.every((a) => a.claudeArgs.join(' ').includes('--model claude-fable-5')), 'every agent launches with --model claude-fable-5');
  ok(p.agents.every((a) => a.claudeArgs.join(' ').includes('--permission-mode acceptEdits')), 'default permission mode is acceptEdits');
  ok(p.launchOrder[p.launchOrder.length - 1] === 'deep-research-orc', 'initiator (orc) launches LAST, after its workers exist');
  ok(p.warnings.length === 0, 'explicit purpose → no placeholder warning');

  const tpl = swarm.plan({ preset: 'deep-research' });
  ok(tpl.warnings.length === 1 && /placeholder/.test(tpl.warnings[0]), 'template purpose → placeholder warning');

  const mesh = swarm.plan({ name: 'My Swarm!!', topology: 'mesh', purpose: 'explore', agents: 3, permissionMode: 'default' });
  ok(mesh.swarm === 'my-swarm', 'swarm name sanitized');
  ok(!mesh.agents[0].claudeArgs.includes('--permission-mode'), 'permissionMode default → no flag');
  ok(mesh.launchOrder.length === 3, 'mesh: everyone launches (all initiators)');
  ok(mesh.agents.every((a) => a.kickoff.length < 250 && !a.kickoff.includes('\n')), 'kickoff is a short single line (tmux-safe)');

  let threw = false;
  try { swarm.plan({ name: 'x', topology: 'mesh' }); } catch (e) { threw = /purpose/.test(e.message); }
  ok(threw, 'no purpose → refuses to plan');
  threw = false;
  try { swarm.plan({ name: 'x', purpose: 'y', permissionMode: 'yolo' }); } catch { threw = true; }
  ok(threw, 'bad permission mode → refuses');
}

// --- swarm files on disk ---------------------------------------------------------------------
console.log('\nswarm files');
{
  const p = swarm.plan({ preset: 'web3-security', purpose: 'review ~/x for leaks', name: 'sec-test' });
  swarm.writeSwarmFiles(p);
  ok(p.dir.startsWith(SANDBOX), 'swarm dir lives under the (sandboxed) home');
  ok(fs.existsSync(path.join(p.dir, 'mission.md')), 'mission.md written');
  ok(fs.readFileSync(path.join(p.dir, 'mission.md'), 'utf8').includes('review ~/x for leaks'), 'mission carries the purpose');
  ok(p.agents.every((a) => fs.existsSync(a.briefingPath)), 'every agent has a briefing file');
  const stat = fs.statSync(p.sayPath);
  ok(!!(stat.mode & 0o100), 'swarm-say helper is executable');
  ok(fs.readFileSync(p.sayPath, 'utf8').includes('conductor2:'), 'swarm-say targets the conductor2 tmux session');
}

// --- regression: the bugs the dogfood swarm found (unit-level, no tmux) ----------------------
console.log('\nregressions (dogfood findings)');
{
  // BUG-1: N windows sharing one cwd must resolve to N DISTINCT sessionIds, not collapse onto the
  // newest transcript. Build a fake registry + transcripts and drive listManaged().
  const cwd = path.join(SANDBOX, 'work'); fs.mkdirSync(cwd, { recursive: true });
  const projDir = path.join(SANDBOX, '.claude', 'projects', cwd.replace(/\//g, '-'));
  fs.mkdirSync(projDir, { recursive: true });
  const base = Date.now() - 5000;
  // three transcripts, staggered mtimes, all newer than the windows' launch
  [['aaa', 0], ['bbb', 1000], ['ccc', 2000]].forEach(([id, dt]) => {
    const f = path.join(projDir, id + '.jsonl');
    fs.writeFileSync(f, '{}\n');
    fs.utimesSync(f, new Date(base + dt) / 1000, new Date(base + dt) / 1000);
  });
  // three managed windows in that cwd, no sessionId yet, launch order aaa<bbb<ccc
  const reg = { windows: {} };
  ['w-s1', 'w-s2', 'w-s3'].forEach((label, i) => {
    reg.windows[label] = { label, target: 'conductor2:' + label, cwd, created: base - 200 + i * 10, sessionId: null, swarm: 'w' };
  });
  // Drive resolveSession exactly as listManaged does: resolve windows in launch order, adding each
  // bound id to the claimed set. The fix must hand back three DISTINCT sessionIds.
  const order = ['w-s1', 'w-s2', 'w-s3'];
  const claimed = new Set();
  const bound = order.map((label) => { const id = manage.resolveSession(reg.windows[label], claimed); if (id) claimed.add(id); return id; });
  ok(bound.every(Boolean) && new Set(bound).size === 3, 'BUG-1: three same-cwd windows resolve to three DISTINCT sessionIds (was: all one)');
  // Without the claimed set (old behavior emulation), they would all grab the same transcript.
  const naive = order.map((label) => manage.resolveSession(reg.windows[label], new Set()));
  ok(new Set(naive).size === 1, 'BUG-1 control: with no claim-tracking all three collapse to one — the bug the fix prevents');

  // BUG-2: pane chrome is matched in the bottom rows only — transcript content mentioning
  // "trust this folder" higher up must NOT be read as the trust prompt.
  const transcriptDiscussingTrust = 'the code checks "trust this folder" in manage.js\n'
    + Array(30).fill('  reading source, taking notes, working the mission...').join('\n')
    + '\n⏺ wrote out/stage-1.md\n❯ \n  ⏵⏵ accept edits on (shift+tab to cycle)';
  ok(!/trust this folder/i.test(manage.tailLines(transcriptDiscussingTrust)), 'BUG-2: trust phrase up in scrollback is excluded by tailLines');
  const actualTrustPrompt = 'some output\n'.repeat(30) + 'Do you trust this folder?\n❯ 1. Yes, I trust';
  ok(/trust this folder/i.test(manage.tailLines(actualTrustPrompt)), 'BUG-2: a real trust prompt at the bottom is still caught');
}

// --- fire + registry (integration, needs tmux) -------------------------------------------------
console.log('\nfire (tmux integration)');
if (!manage.hasTmux()) {
  console.log('  - tmux not installed — skipped');
} else {
  const name = 'v2t' + String(process.pid).slice(-4);
  const r = swarm.fire(
    { name, topology: 'pipeline', purpose: 'integration test — do nothing', agents: 2, permissionMode: 'default' },
    { cmd: 'sleep 30 #', kickoff: false },   // never launches claude; window just sleeps
  );
  ok(r.ok, 'fire launches every window: ' + (r.error || 'ok'));
  const listed = swarm.listSwarms().find((s) => s.swarm === name);
  ok(!!listed && listed.windows.length === 2, 'fired swarm appears in listSwarms with both windows');
  ok(!!listed && listed.topology === 'pipeline', 'registry keeps the topology');
  const dbl = swarm.fire({ name, topology: 'pipeline', purpose: 'x', agents: 2 }, { cmd: 'sleep 1 #', kickoff: false });
  ok(!dbl.ok && /already/.test(dbl.error), 'double-fire into a live swarm refused');
  const stop = swarm.stopSwarm(name);
  ok(stop.ok && stop.stopped.length === 2, 'stopSwarm kills both windows');
  ok(!swarm.listSwarms().find((s) => s.swarm === name), 'stopped swarm leaves the registry');
}

// --- server ----------------------------------------------------------------------------------
console.log('\nserver');
const { handle } = require('./server');
const srv = http.createServer(handle);
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, text: await r.text() }));
  const post = (p, body, hdr = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: JSON.parse(await r.text()) }));

  const pad = await get('/');
  ok(pad.status === 200 && pad.text.includes('Launch Pad') && pad.text.includes('FIRE UP SWARM'), 'GET / serves the launch pad');
  ok(pad.text.includes('deep-research') && pad.text.includes('hierarchical'), 'launch pad embeds presets + topologies');
  ok(pad.text.includes('claude-fable-5'), 'launch pad shows the locked Fable 5 model');

  const board = await get('/board');
  ok(board.status === 200 && board.text.includes('Board') && board.text.includes('Launch pad'), 'GET /board serves the cockpit board');

  const cfg = await get('/api/config');
  const cj = JSON.parse(cfg.text);
  ok(cj.presets.length === 3 && cj.topologies.length === 3 && cj.model === 'claude-fable-5', '/api/config: 3 presets, 3 topologies, fable 5');

  const noHdr = await post('/api/plan', { preset: 'deep-research' });
  ok(noHdr.status === 403, 'POST without X-Conductor header → 403 (CSRF guard)');

  const plan = await post('/api/plan', { preset: 'deep-research', purpose: 'study Y' }, { 'x-conductor': '1' });
  ok(plan.status === 200 && plan.json.ok && plan.json.plan.agents.length === 5, '/api/plan previews the crew');

  const badStop = await post('/api/stop-swarm', { swarm: 'zzz' }, { 'x-conductor': '1' });
  ok(badStop.status === 400 && /confirm/.test(badStop.json.error), 'stop-swarm without confirm token refused');

  srv.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
});
