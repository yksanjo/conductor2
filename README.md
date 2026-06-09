# 🎼 Conductor V2 — configure the swarm, then fire

V1 ([conductor](https://github.com/yksanjo/conductor)) watches Claude Code windows you already opened.
**V2 flips the order: you design the fleet first.** Pick a swarm topology, load a preset, write the
mission, press **FIRE** — and a crew of Claude Code agents launches on **Fable 5**, coordinates over
tmux + a shared swarm directory, and shows up live on the cockpit board.

Zero dependencies. Claude-only. One model: `claude --model claude-fable-5`, every window, no bikeshedding.

![Conductor V2 launch pad](docs/launch-pad.png)

```
npm install -g @yksanjo/conductor2     # or: git clone && npm link
conductor2 up                          # launch pad → http://localhost:7592
```

## Why this is the hard part

A Claude Code session is a terminal TUI, and you **cannot inject input into another process's
terminal** — macOS removed `TIOCSTI`, the syscall that used to allow it. So "tell agent B to start"
isn't a function call; it's a control problem. Conductor solves it the way it actually has to be
solved: every managed agent runs inside a **tmux** session, and the only reliable channel in or out
is `tmux send-keys`. On top of that raw channel sits a small state machine — `paneStage()` in
[`manage.js`](manage.js) classifies each window as `trust` / `resume` / `busy` / `ready` / `gone`, so
a prompt is never typed into a folder-trust dialog or a loading screen and silently lost. "Send a
message to an agent" is really "drive it from boot to ready, then deliver exactly once." That, not
the UI, is the engineering.

## The launch pad

1. **Preset** — lazy fire-off setups (or go Custom):

   | preset | topology | crew | what it does |
   |---|---|---|---|
   | 🔬 Deep Research | hierarchical | 5 | orchestrator splits a question across 4 researchers (landscape / evidence / red-team / numbers), synthesizes one cited report |
   | 📈 Market Bot Management | mesh | 3 | one peer per trading desk: liveness, ledger performance, tuning proposals — read-only, merged fleet report |
   | 🛡 Web3 & Security | pipeline | 4 | recon → audit → adversarial verify → severity-ranked report, for code you own |

2. **Topology** — who talks to whom, who starts:
   - 🏛 **Hierarchical** (orchestrator → workers): one agent decomposes, delegates, synthesizes.
   - ⛓ **Pipeline** (sequential): each stage consumes the previous stage's output and hands off.
   - 🕸 **Mesh** (peer-to-peer): equal peers claim angles, cross-talk, peer 1 merges as scribe.

3. **Mission** — the purpose every agent reads, crew size (2–8), folder, permission mode.

4. **🔥 FIRE** — then watch and steer everything from `/board` (V1's cockpit, with swarm grouping).

![Cockpit board with a live swarm](docs/board.png)

Terminal version of the same thing:

```
conductor2 presets
conductor2 fire deep-research --purpose "state of x402 agentic payments for a solo builder"
conductor2 swarms
conductor2 stop deep-research --yes
```

## How a swarm actually coordinates

No message bus, no framework — two dumb, reliable channels:

- **Files.** Each swarm gets `~/.conductor2/swarms/<name>/` with `mission.md`, per-agent role
  briefings in `prompts/`, artifacts in `out/`, scratch in `notes/`. Files are the source of truth;
  the final deliverable is always `out/REPORT.md`.
- **Messages.** `~/.conductor2/bin/swarm-say <window> "<one line>"` — tmux `send-keys` into a
  sibling window's prompt. Briefings teach every agent the protocol: task dispatches, DONE
  reports, pipeline handoffs are all one-line pointers to files.

Launch order is dependency-aware (receivers before initiators), each window is walked through
Claude's startup prompts automatically, and the kickoff is a single line pointing at the agent's
briefing file — long prompts never travel through tmux.

## Design stance (the honest seams, stated plainly)

- **Coordination is probabilistic, and that's the right model.** A topology + briefings make agents
  hand off, claim distinct angles, and converge on `out/REPORT.md` *reliably*, not *deterministically* —
  they're LLMs, not a DAG executor. Pretending otherwise would be the junior move. The board **is**
  the control surface: when an agent drifts, you see it and nudge it with one reply. Supervision is a
  feature, not a missing guarantee.
- **Permission mode is an explicit safety dial.** Default `acceptEdits` still surfaces Bash prompts
  (including `swarm-say`) so you stay in the loop; answer them from the board, or pre-allowlist
  `~/.conductor2/bin/swarm-say` for frictionless coordination. `bypassPermissions` exists for trusted,
  unattended runs and is loudly labeled — full autonomy, full trust.
- **Irreversible actions are gated.** Firing into a live swarm is refused; stopping a swarm (which
  kills live sessions) needs an explicit confirm token in both the UI and CLI. Every state-changing
  endpoint is POST-only, localhost-only, and CSRF-guarded.

## Dogfooded on itself

This repo was reviewed by a Conductor V2 swarm: `conductor2 fire --topology pipeline --agents 3`
launched three Fable 5 agents that read every source file, critiqued it through a hiring manager's
lens, and merged a ranked report — coordinating entirely over `swarm-say` and the shared `out/`
directory. The tool reviewing its own code is the demo.

## Surfaces

- `conductor2 up` — launch pad (`/`) + cockpit board (`/board`) on `:7592`
- `conductor2 fire|plan|presets|swarms|stop` — the same fire control from the terminal
- All state-changing endpoints are POST-only, localhost-only, CSRF-guarded (V1's scheme)

Same design system and data pipeline as V1 (transcript scanner, liveness via `lsof`, tmux control
plane) — V2 adds the pre-flight layer on top.

MIT © yksanjo
