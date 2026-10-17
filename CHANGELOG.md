# Changelog

## 2.0.0

Conductor V2 — configure the swarm **before** you fire it. A web launch pad (`:7592`) that turns
a topology + preset + mission into a fleet of Claude Code windows on Fable 5, coordinating over
tmux + a shared swarm directory, watched and steered from V1's cockpit board re-skinned with swarm
grouping. Zero dependencies, Claude-only. Isolated from V1 by design (session `conductor2`,
registry `~/.conductor2/`).

The history of this release is the tool reviewing itself, twice, and surviving:

- **Launch pad + fire control.** Three topologies (hierarchical / pipeline / mesh), three presets
  (deep research / market bots / web3+security), `plan()` previews the exact crew before `fire()`
  launches it. Per-agent role briefings on disk; the kickoff is one line pointing at the briefing
  file — long prompts never travel through tmux. CLI mirror: `conductor2 fire|plan|presets|swarms|stop`.
- **Dogfood pass — a V2 swarm reviewed this repo and found six real bugs** (incl. BUG-1: same-cwd
  windows all binding to one transcript, breaking swarm grouping). All six fixed with regression
  tests; swarm boundaries upgraded from prose to a mechanical per-swarm `swarm-say` allowlist;
  honest readiness-gated delivery (`deliver()` refuses a pane that isn't at a ready prompt);
  stalled-handoff detector + nudge on the board; per-window `--model` escape hatch; CI.
- **Eval harness + verified kickoff delivery.** `npm run eval` measures coordination reliability
  with a deterministic relay probe instead of asserting it. An early batch scored 67% completion —
  a TUI startup race silently ate launch kickoffs. Fixed with verified delivery (send, confirm the
  turn started, resend if eaten) + an idle-initiator watchdog → 100% after.
- **Finishline pass.** Second self-review swarm: cwd→transcript-dir transform handles every
  non-alphanumeric char (swarms in `repo.v2`-style folders were invisible), `--add-dir` on the
  swarm dir so pipeline stages don't stall on write prompts, `files[]` completeness, README claims
  trued up.
- **Hardening pass (this one).** Permission menus are now a first-class pane stage: text delivery
  to a menu is refused (it would be eaten as a selection) and the board grows one-click
  **approve/deny** buttons — same detection the eval auto-approver uses. Lost kickoffs are no
  longer invisible: a swarm window with no transcript surfaces as a "kickoff lost?" card after 90s
  with one-click re-kickoff (`/api/rekick`, kickoff persisted at fire time). Fire-path injection
  closed (`model` validated like `permissionMode`), nonexistent cwd refused before any window is
  created, `claude`-on-PATH preflight, delivery confirmation now requires a marker *transition*
  (not a leftover from a prior turn), `main` points at the documented facade (`lib.js`), CI tests
  Node 18 + 22.

Inherited from V1: the transcript scanner, `lsof` liveness, the tmux control plane, and the
CSRF/DNS-rebinding guard scheme.

## conductor3 - iteration 1 (unreleased, design + skeleton)
Mission file format, run-state model, and a draft mission runner under `conductor3/`. Tested with fakes only; not wired to live swarms. See `docs/CONDUCTOR3.md`.

## conductor3 - iteration 2 (unreleased, queue + gate + dashboard)
- `conductor3/queue/`: file-backed queue with exclusive claims, policy gate as code (no as-him sends 9pm-8am; send/money/commitment need approval; an approval counts only from a dashboard click; fail closed), idempotent `tick`, local dashboard (127.0.0.1 only, token-gated approve/reject), and a CLI (`add`, `drop`, `tick`, `approvals`; no approve command by design).
- `conductor3/spend.js` daily cap that fails closed, `conductor3/inbox.js` morning decision inbox, `conductor3/install/` macOS installer + nightly script.
- Honest status: nothing in here executes a send, post or payment. A separate gated executor does not exist yet, and nothing launches AI workers yet.

## conductor3 - iteration 3 (unreleased, simulated human overseers)
- `conductor3/overseer/`: one simulated human overseer per agent. Conductor 1 was one human at a CLI watching N agents; this flips the ratio - every worker gets a named persona (strictness, attention budget, fatigue/recovery) that reviews its output overnight: endorses clean drafts, returns sloppy ones with the exact question (named rules `r-*`), defers when out of attention instead of rubber-stamping, and escalates after two failed returns.
- Gated kinds (send/money/commitment) are only ever annotated for decision-readiness. Overseers never approve: approval still comes only from a dashboard click, enforced by `conductor3/queue/policy.js`, which this module never touches.
- Honest status: the judgment is deterministic rules, not a model - it checks shape and evidence, not taste or truth. No worker loop consumes returned questions yet; the dashboard does not render overseer notes yet. 27 tests, plus `demo.js` (seeded night shift -> shift report) and a CLI (`roster`, `tick`, `status`, `report`).
