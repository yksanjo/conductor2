#!/usr/bin/env node
'use strict';

// Conductor V2 — coordination eval.
//
// The product's claim is that a topology + briefings make multi-agent coordination *reliable*
// (not deterministic). This harness MEASURES that, instead of asserting it. The trick: use a
// deterministic RELAY mission where each agent does exactly one trivial step (append your name to
// a baton file, hand off). That isolates the thing under test — the handoff chain over swarm-say +
// the shared directory — from the quality of any real work. We then run it N times and report:
//
//   completion rate   — % of runs where the final REPORT.md appeared within the timeout
//   handoff success   — % of expected handoffs that landed (baton lines / stages reached)
//   median wall-clock  — fire → REPORT.md
//   vs single agent    — the same relay done by ONE agent, as a baseline
//
// Runs unattended: an auto-approver drives each window through trust prompts, resume pickers, and
// permission menus (this is the supervised path the board exposes, automated). Defaults to a cheap
// model via --model — coordination machinery is identical across models, so there's no reason to
// burn Fable 5 tokens measuring tmux handoffs.
//
//   node evals/coordination.mjs [--runs N] [--agents K] [--topology pipeline|hierarchical|mesh]
//                               [--timeout SEC] [--model <id>] [--no-baseline]
//
// Writes evals/RESULTS.md and prints a table. Requires tmux + a working `claude` CLI.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const manage = require('../manage.js');
const swarm = require('../swarm.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { runs: 3, agents: 3, topology: 'pipeline', timeout: 240, model: 'claude-haiku-4-5', baseline: true };
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (v === '--agents') a.agents = parseInt(argv[++i], 10);
    else if (v === '--topology') a.topology = argv[++i];
    else if (v === '--timeout') a.timeout = parseInt(argv[++i], 10);
    else if (v === '--model') a.model = argv[++i];
    else if (v === '--no-baseline') a.baseline = false;
  }
  return a;
}

// The deterministic probe. Trivial per-agent work so we measure the handoff chain, not the model.
const RELAY_PURPOSE =
  'RELAY COORDINATION PROBE — this is a test of handoff reliability, NOT real work. Do EXACTLY '
  + 'this and nothing else, as fast as possible: (1) append a single line "<your-window-name> ok" '
  + 'to out/baton.txt (create it if missing). (2) Do your stage/role per your briefing — but the '
  + 'ONLY action is that append plus the handoff your briefing specifies. The final agent, instead '
  + 'of handing off, writes out/REPORT.md containing the full contents of out/baton.txt. Do not read '
  + 'source code, do not analyze anything, do not write any other files. Speed matters.';

const SINGLE_PURPOSE = (k) =>
  `RELAY COORDINATION PROBE (single-agent baseline). Simulate a ${k}-step relay yourself, fast: append `
  + `${k} lines "step-1 ok" … "step-${k} ok" to out/baton.txt, then write out/REPORT.md containing the `
  + `full contents of out/baton.txt. No other files, no analysis.`;

function tmuxCaptureTail(label) {
  try {
    const out = execFileSync('tmux', ['capture-pane', '-p', '-t', `${manage.SESSION}:${manage.sanitize(label)}`], { encoding: 'utf8' });
    return manage.tailLines(out, 18);
  } catch { return ''; }
}

// One pass of the auto-approver over every live window of a swarm. Returns how many it acted on.
// Menu detection + approval now live in manage.js (classifyPane's 'menu' stage + approveMenu — the
// same logic the board's approve button uses), so the harness and the product can't drift.
function driveApprovals(swarmName) {
  let acted = 0;
  for (const w of manage.listManaged({ readonly: true }).filter((x) => x.swarm === swarmName)) {
    const pane = tmuxCaptureTail(w.label);
    if (!pane) continue;
    const stage = manage.classifyPane(pane);
    if (stage === 'trust') { manage.key(w.label, 'Enter'); acted++; }
    else if (stage === 'resume') { manage.key(w.label, 'Down'); manage.key(w.label, 'Enter'); acted++; }
    else if (stage === 'menu') { manage.approveMenu(w.label); acted++; }
  }
  return acted;
}

function reportPath(dir) { return path.join(dir, 'out', 'REPORT.md'); }
function batonLines(dir) {
  try { return fs.readFileSync(path.join(dir, 'out', 'baton.txt'), 'utf8').split('\n').filter((l) => /\sok$/.test(l.trim())).length; }
  catch { return 0; }
}

// Kickoff watchdog: if NOTHING has happened after this long (zero baton lines) and the chain's
// initiator is sitting idle at a ready prompt, its kickoff line was lost in the TUI startup race
// (see KICKOFF-RETRY in manage.js) — re-deliver it. This re-drives LAUNCH machinery only; lost
// mid-chain handoffs are the thing under test and are never re-driven by the harness.
const KICKOFF_WATCHDOG_MS = 45000;
const KICKOFF_RETRY_GAP_MS = 20000;
const MAX_REKICKS = 2;

// Fire a config, then auto-approve + poll until REPORT.md exists or timeout. Per poll, every
// member window's pane stage is sampled; transitions are written to evals/logs/<name>.log so a
// failed run is attributable (which window stalled, at what stage, when). Returns metrics.
async function oneRun({ name, topology, agents, model, timeout, purpose }) {
  const started = Date.now();
  const fired = swarm.fire({ name, topology, agents, model, purpose, cwd: process.cwd(), permissionMode: 'acceptEdits' });
  if (!fired.ok) return { name, ok: false, error: fired.error, ms: 0, handoffs: 0, expected: agents, rekicks: 0 };
  const dir = fired.dir;
  const initiators = fired.agents.filter((a) => a.initiator);
  const deadlineMs = started + timeout * 1000;
  const log = [];
  const lastStage = {};
  const note = (line) => log.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${line}`);
  let completed = false, rekicks = 0, lastKickMs = started;
  while (Date.now() < deadlineMs) {
    driveApprovals(name);
    for (const w of manage.listManaged({ readonly: true }).filter((x) => x.swarm === name)) {
      const stage = manage.paneStage(w.label);
      if (stage !== lastStage[w.label]) { note(`${w.label} → ${stage}`); lastStage[w.label] = stage; }
    }
    const baton = batonLines(dir);
    if (baton === 0 && rekicks < MAX_REKICKS
        && Date.now() - lastKickMs > (rekicks ? KICKOFF_RETRY_GAP_MS : KICKOFF_WATCHDOG_MS)) {
      for (const a of initiators) {
        if (lastStage[a.window] !== 'ready') continue;   // only an IDLE initiator means a lost kickoff
        const r = manage.deliver(a.window, a.kickoff);
        note(`KICKOFF-RETRY ${a.window} → ${r.status}`);
      }
      rekicks++; lastKickMs = Date.now();
    }
    if (fs.existsSync(reportPath(dir))) { completed = true; break; }
    await sleep(2500);
  }
  const ms = Date.now() - started;
  const handoffs = batonLines(dir);
  note(`end: ${completed ? 'completed' : 'timeout'} · baton ${handoffs}/${agents}`);
  swarm.stopSwarm(name);
  const logDir = path.join(__dirname, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, `${name}.log`), log.join('\n') + '\n');
  return { name, ok: completed, ms, handoffs, expected: agents, rekicks };
}

function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function fmt(ms) { return ms ? (ms / 1000).toFixed(0) + 's' : '—'; }

async function main() {
  const a = parseArgs(process.argv);
  if (!manage.hasTmux()) { console.error('eval needs tmux'); process.exit(1); }
  console.log(`\n🎼 Conductor V2 coordination eval — ${a.runs} run(s) · ${a.topology} · ${a.agents} agents · model ${a.model} · timeout ${a.timeout}s\n`);

  const runs = [];
  for (let i = 0; i < a.runs; i++) {
    const name = `eval${String(Date.now()).slice(-5)}r${i}`;
    process.stdout.write(`  run ${i + 1}/${a.runs} (${name})… `);
    const r = await oneRun({ name, topology: a.topology, agents: a.agents, model: a.model, timeout: a.timeout, purpose: RELAY_PURPOSE });
    runs.push(r);
    console.log((r.ok ? `✓ ${fmt(r.ms)} · ${r.handoffs}/${r.expected} relayed` : `✗ ${r.error || 'no REPORT.md in time'} (${r.handoffs}/${r.expected})`)
      + (r.rekicks ? ` · ${r.rekicks} kickoff retr${r.rekicks === 1 ? 'y' : 'ies'}` : ''));
    await sleep(1500);
  }

  let baseline = null;
  if (a.baseline) {
    const name = `evalbase${String(Date.now()).slice(-4)}`;
    process.stdout.write(`  single-agent baseline (${name})… `);
    baseline = await oneRun({ name, topology: 'pipeline', agents: 1, model: a.model, timeout: a.timeout, purpose: SINGLE_PURPOSE(a.agents) });
    console.log(baseline.ok ? `✓ ${fmt(baseline.ms)}` : `✗ ${baseline.error || 'timeout'}`);
  }

  const done = runs.filter((r) => r.ok);
  const completion = runs.length ? Math.round((done.length / runs.length) * 100) : 0;
  const totalHandoffs = runs.reduce((s, r) => s + r.handoffs, 0);
  const expectedHandoffs = runs.reduce((s, r) => s + r.expected, 0);
  const handoffRate = expectedHandoffs ? Math.round((totalHandoffs / expectedHandoffs) * 100) : 0;
  const medMs = median(done.map((r) => r.ms));

  const stamp = new Date().toISOString();
  const md = `# Conductor V2 — coordination eval results

_Generated ${stamp} · \`node evals/coordination.mjs --runs ${a.runs} --agents ${a.agents} --topology ${a.topology} --model ${a.model}\`_

Deterministic relay probe: each agent appends one baton line and hands off; the final agent writes
\`REPORT.md\`. This measures the handoff chain (swarm-say + shared directory), not model output quality —
so it runs on a cheap model (\`${a.model}\`); the coordination code path is identical on any model.

| metric | value |
|---|---|
| topology · agents | ${a.topology} · ${a.agents} |
| runs | ${runs.length} |
| **completion rate** (REPORT.md within ${a.timeout}s) | **${completion}%** (${done.length}/${runs.length}) |
| handoff success (baton lines / expected) | ${handoffRate}% (${totalHandoffs}/${expectedHandoffs}) |
| median wall-clock (completed runs) | ${fmt(medMs)} |
${baseline ? `| single-agent baseline (same deliverable) | ${baseline.ok ? fmt(baseline.ms) : 'failed'} |` : ''}

### Per run

| run | result | wall-clock | relayed | kickoff retries |
|---|---|---|---|---|
${runs.map((r, i) => `| ${i + 1} | ${r.ok ? '✓ completed' : '✗ ' + (r.error || 'timeout')} | ${fmt(r.ms)} | ${r.handoffs}/${r.expected} | ${r.rekicks || 0} |`).join('\n')}

> Auto-approved unattended (the board's supervised path, automated): trust prompts, resume pickers,
> and permission menus are accepted by the harness. \`acceptEdits\` auto-accepts file writes; the one
> Bash prompt per agent (swarm-say) is approved with "don't ask again".
>
> Per-run pane-stage transition logs are written to \`evals/logs/<run>.log\` so failures are
> attributable. "Kickoff retries" counts harness re-deliveries of a LOST launch kickoff (zero baton
> lines + idle initiator) — launch machinery, not the handoff chain under test, which is never re-driven.
`;
  fs.mkdirSync(path.join(__dirname), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'RESULTS.md'), md);
  console.log(`\n  completion ${completion}% · handoffs ${handoffRate}% · median ${fmt(medMs)}${baseline ? ` · baseline ${baseline.ok ? fmt(baseline.ms) : 'failed'}` : ''}`);
  console.log(`  → evals/RESULTS.md\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
