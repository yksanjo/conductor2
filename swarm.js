'use strict';

// Conductor V2 fire control — turn a launch config into a running swarm.
//
//   plan(config)  — pure: resolve preset/topology into the exact agents, windows, briefings
//                   and claude args that WOULD launch. The UI preview and the tests use this.
//   fire(config)  — write the swarm directory + briefings, then launch one managed tmux
//                   window per agent (via manage.run) and kick each off with a one-liner
//                   pointing at its briefing file.
//
// Claude-only, Fable-5-only: every window launches `claude --model claude-fable-5`. That is
// the point of V2 — maximum-power agents, no per-window model bikeshedding. Override only
// via CONDUCTOR2_MODEL (for the day a stronger model ships).

const fs = require('fs');
const path = require('path');
const os = require('os');
const manage = require('./manage');
const topologies = require('./topologies');
const presets = require('./presets');

const HOME = os.homedir();
const V2_DIR = path.join(HOME, '.conductor2');
const SWARMS_DIR = path.join(V2_DIR, 'swarms');
const BIN_DIR = path.join(V2_DIR, 'bin');
const MODEL = process.env.CONDUCTOR2_MODEL || 'claude-fable-5';
const PERMISSION_MODES = ['acceptEdits', 'default', 'plan', 'bypassPermissions'];

function sanitizeSwarm(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

// Resolve a raw config ({ name, preset?, topology?, purpose?, agents?, cwd?, permissionMode? })
// into a complete, validated launch plan. Pure — touches no tmux, writes no files.
function plan(config = {}) {
  const preset = config.preset ? presets.get(config.preset) : null;
  const topoKey = config.topology || (preset && preset.topology) || 'hierarchical';
  const topo = topologies.get(topoKey);

  const swarm = sanitizeSwarm(config.name || (preset && preset.key) || 'swarm');
  if (!swarm) throw new Error('swarm needs a name');

  const purpose = String(config.purpose || (preset && preset.purpose) || '').trim();
  if (!purpose) throw new Error('swarm needs a purpose — what is this fleet for?');

  const n = Math.max(topo.minAgents, Math.min(8, parseInt(config.agents, 10) || (preset && preset.agents) || 4));
  const hints = config.roleHints || (preset && preset.roleHints) || [];

  const permissionMode = config.permissionMode || 'acceptEdits';
  if (!PERMISSION_MODES.includes(permissionMode)) throw new Error(`unknown permission mode "${permissionMode}"`);

  let cwd = String(config.cwd || '').trim() || HOME;
  cwd = cwd.replace(/^~(?=$|\/)/, HOME);

  const dir = path.join(SWARMS_DIR, swarm);
  const sayPath = path.join(BIN_DIR, 'swarm-say');

  // Roles → concrete agents with window names + briefings.
  const roles = topo.roles(n, hints);
  const agents = roles.map((r) => ({ ...r, window: manage.sanitize(`${swarm}-${r.slot}`), role: r.role }));
  const ctx = { swarm, topology: topo.key, purpose, dir, sayPath, agents };

  const claudeArgs = ['--model', MODEL];
  if (permissionMode !== 'default') claudeArgs.push('--permission-mode', permissionMode);

  for (const a of agents) {
    a.briefingPath = path.join(dir, 'prompts', `${a.window}.md`);
    a.briefing = topo.briefing(ctx, a);
    a.kickoff = `You are agent "${a.window}" in swarm "${swarm}". Read ${a.briefingPath} and follow it exactly — it is your role briefing. Begin.`;
    a.claudeArgs = claudeArgs;
  }

  // Launch order: receivers before initiators, so every window an initiator might message
  // already exists when the first message fires.
  const order = [...agents.filter((a) => !a.initiator), ...agents.filter((a) => a.initiator)];

  const placeholders = (purpose.match(/<[A-Z][^>]*>/g) || []);
  return {
    swarm, topology: topo.key, purpose, cwd, permissionMode, model: MODEL,
    dir, sayPath, agents, launchOrder: order.map((a) => a.window),
    warnings: placeholders.length ? [`purpose still contains template placeholder(s): ${placeholders.join(' ')}`] : [],
  };
}

// The messaging helper every briefing references. One line in, tmux send-keys out. Written
// once; rewritten on every fire so upgrades propagate.
const SAY_SCRIPT = `#!/bin/sh
# swarm-say <window> <message...> — deliver a one-line message to a conductor2 swarm agent.
[ -n "$1" ] && [ -n "$2" ] || { echo "usage: swarm-say <window> <message>" >&2; exit 1; }
W="$1"; shift
tmux send-keys -t "conductor2:$W" -l -- "$*" && sleep 0.3 && tmux send-keys -t "conductor2:$W" Enter
`;

// Write the swarm's on-disk home: mission, briefings, helper script, empty work dirs.
function writeSwarmFiles(p) {
  fs.mkdirSync(path.join(p.dir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(p.dir, 'out'), { recursive: true });
  fs.mkdirSync(path.join(p.dir, 'notes'), { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.writeFileSync(p.sayPath, SAY_SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(p.dir, 'mission.md'),
    `# Swarm: ${p.swarm}\n\n- topology: ${p.topology}\n- model: ${p.model}\n- cwd: ${p.cwd}\n- permission mode: ${p.permissionMode}\n- fired: ${new Date().toISOString()}\n\n## Purpose\n${p.purpose}\n\n## Crew\n${p.agents.map((a) => `- ${a.window} — ${a.role}`).join('\n')}\n`);
  for (const a of p.agents) fs.writeFileSync(a.briefingPath, a.briefing);
}

// Fire the swarm. Launches are non-blocking (capture:false) — manage.deliverAdopted walks each
// window through its startup prompts (folder trust) and delivers the kickoff once the prompt
// box is actually ready. Returns per-window results; ok means every window launched.
function fire(config, opts = {}) {
  const p = plan(config);
  if (!manage.hasTmux()) return { ok: false, error: 'tmux is not installed (brew install tmux).', plan: p };

  // Refuse to double-fire into an existing swarm's windows.
  const clash = p.agents.find((a) => manage.listManaged().some((w) => w.label === a.window));
  if (clash) return { ok: false, error: `swarm "${p.swarm}" already has a live window (${clash.window}). Stop it first or pick another name.`, plan: p };

  writeSwarmFiles(p);

  const results = [];
  const byWindow = Object.fromEntries(p.agents.map((a) => [a.window, a]));
  for (const window of p.launchOrder) {
    const a = byWindow[window];
    const r = manage.run(a.window, a.claudeArgs, p.cwd, {
      capture: false,
      cmd: opts.cmd, // test seam — defaults to 'claude' inside manage.run
      meta: { swarm: p.swarm, role: a.role, slot: a.slot, topology: p.topology },
    });
    results.push({ window: a.window, role: a.role, ...r });
    if (r.ok && opts.kickoff !== false) manage.deliverAdopted(a.window, a.kickoff);
  }

  const ok = results.every((r) => r.ok);
  return { ok, swarm: p.swarm, topology: p.topology, model: p.model, dir: p.dir, cwd: p.cwd, agents: results, warnings: p.warnings, attach: ok ? results[0].attach : undefined, error: ok ? undefined : results.filter((r) => !r.ok).map((r) => `${r.window}: ${r.error}`).join('; ') };
}

// Live swarms, grouped from the managed-window registry.
function listSwarms() {
  const groups = {};
  for (const w of manage.listManaged()) {
    if (!w.swarm) continue;
    (groups[w.swarm] = groups[w.swarm] || { swarm: w.swarm, topology: w.topology, dir: path.join(SWARMS_DIR, w.swarm), windows: [] })
      .windows.push({ window: w.label, role: w.role, slot: w.slot, sessionId: w.sessionId });
  }
  return Object.values(groups);
}

// Kill every window of one swarm. Irreversible — callers gate it.
function stopSwarm(name) {
  const swarm = sanitizeSwarm(name);
  const members = manage.listManaged().filter((w) => w.swarm === swarm);
  if (!members.length) return { ok: false, error: `no live swarm "${swarm}"` };
  const stopped = members.map((w) => manage.stop(w.label));
  return { ok: stopped.every((r) => r.ok), swarm, stopped: stopped.map((r) => r.label) };
}

module.exports = { plan, fire, writeSwarmFiles, listSwarms, stopSwarm, sanitizeSwarm, MODEL, PERMISSION_MODES, SWARMS_DIR, V2_DIR };
