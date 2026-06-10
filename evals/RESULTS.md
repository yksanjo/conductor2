# Conductor V2 — coordination eval results

_Generated 2026-06-10T02:37:06.156Z · `node evals/coordination.mjs --runs 5 --agents 3 --topology pipeline --model claude-haiku-4-5`_

Deterministic relay probe: each agent appends one baton line and hands off; the final agent writes
`REPORT.md`. This measures the handoff chain (swarm-say + shared directory), not model output quality —
so it runs on a cheap model (`claude-haiku-4-5`); the coordination code path is identical on any model.

| metric | value |
|---|---|
| topology · agents | pipeline · 3 |
| runs | 5 |
| **completion rate** (REPORT.md within 240s) | **100%** (5/5) |
| handoff success (baton lines / expected) | 93% (14/15) |
| median wall-clock (completed runs) | 34s |
| single-agent baseline (same deliverable) | 8s |

### Per run

| run | result | wall-clock | relayed | kickoff retries |
|---|---|---|---|---|
| 1 | ✓ completed | 34s | 3/3 | 0 |
| 2 | ✓ completed | 37s | 2/3 | 0 |
| 3 | ✓ completed | 32s | 3/3 | 0 |
| 4 | ✓ completed | 34s | 3/3 | 0 |
| 5 | ✓ completed | 29s | 3/3 | 0 |

> Auto-approved unattended (the board's supervised path, automated): trust prompts, resume pickers,
> and permission menus are accepted by the harness. `acceptEdits` auto-accepts file writes; the one
> Bash prompt per agent (swarm-say) is approved with "don't ask again".
>
> Per-run pane-stage transition logs are written to `evals/logs/<run>.log` so failures are
> attributable. "Kickoff retries" counts harness re-deliveries of a LOST launch kickoff (zero baton
> lines + idle initiator) — launch machinery, not the handoff chain under test, which is never re-driven.

### Root cause of the previous 67% (2/3) result

The prior batch had one run time out at 202s with **0/3** baton lines — the chain never started.
Cause: `manage.deliverAdopted()` delivered the launch kickoff **fire-and-forget** — on the first
`ready` classification it called `say()` (raw tmux send-keys, no confirmation) exactly once and
stopped polling. Claude Code's TUI has a startup race where the first "ready" render can still drop
keystrokes (input handler not yet bound, esp. right after the trust-prompt accept); when stage 1's
kickoff landed in that window it was silently eaten, s1 idled forever, and nothing retried — the
harness only drove approval menus. Mid-chain handoffs were never at risk: `swarm-say` routes through
`deliver()`, which gates on readiness and confirms; only the kickoff used the unverified path.

Fix (KICKOFF-RETRY in `manage.js`): delivery is now verified — after sending, keep polling; seeing
the turn run confirms it took, while a return to `ready` means the line was eaten, so flush any text
stranded in the input box (bare Enter) and resend, capped at 3 sends. Defense in depth: `fire()` now
exposes each agent's kickoff so the eval's watchdog can re-deliver to an idle initiator after 45s of
zero progress (it never had to: 0 retries across all 5 runs). Result: 67% → **100%** completion.
Run 2's 2/3 baton count is model behavior (one haiku agent skipped its append but still handed off —
the run completed), not a lost handoff.
