# 🎼 Conductor V2 — configure the swarm, then fire

V1 ([conductor](https://github.com/yksanjo/conductor)) watches Claude Code windows you already opened.
**V2 flips the order: you design the fleet first.** Pick a swarm topology, load a preset, write the
mission, press **FIRE** — and a crew of Claude Code agents launches on **Fable 5**, coordinates over
tmux + a shared swarm directory, and shows up live on the cockpit board.

Zero dependencies. Claude-only. One model: `claude --model claude-fable-5`, every window, no bikeshedding.

```
npm install -g @yksanjo/conductor2     # or: git clone && npm link
conductor2 up                          # launch pad → http://localhost:7592
```

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

## Honest seams

- **Permission mode matters.** Default is `acceptEdits`; agents still hit permission prompts on
  Bash (including `swarm-say`), which you can answer from the board — or pre-allowlist
  `~/.conductor2/bin/swarm-say` in your Claude settings for frictionless coordination.
  `bypassPermissions` is offered, loudly labeled: full autonomy, full trust.
- **Agents are LLMs.** The topology and briefings make coordination *likely*, not guaranteed —
  that's exactly why the board exists. Watch the swarm; nudge any window with a reply.
- **Stopping a swarm kills live sessions.** Both the UI and CLI gate it behind explicit confirms.

## Surfaces

- `conductor2 up` — launch pad (`/`) + cockpit board (`/board`) on `:7592`
- `conductor2 fire|plan|presets|swarms|stop` — the same fire control from the terminal
- All state-changing endpoints are POST-only, localhost-only, CSRF-guarded (V1's scheme)

Same design system and data pipeline as V1 (transcript scanner, liveness via `lsof`, tmux control
plane) — V2 adds the pre-flight layer on top.

MIT © yksanjo
