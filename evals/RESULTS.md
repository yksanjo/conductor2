# Conductor V2 — coordination eval results

_Generated 2026-06-10T10:08:16.632Z · `node evals/coordination.mjs --runs 5 --agents 3 --topology pipeline --model claude-haiku-4-5`_

Deterministic relay probe: each agent appends one baton line and hands off; the final agent writes
`REPORT.md`. This measures the handoff chain (swarm-say + shared directory), not model output quality —
so it runs on a cheap model (`claude-haiku-4-5`); the coordination code path is identical on any model.

| metric | value |
|---|---|
| topology · agents | pipeline · 3 |
| runs | 5 |
| **completion rate** (REPORT.md within 240s) | **80%** (4/5) |
| handoff success (baton lines / expected) | 100% (15/15) |
| median wall-clock (completed runs) | 91s |
| single-agent baseline (same deliverable) | 26s |

### Per run

| run | result | wall-clock | relayed | kickoff retries |
|---|---|---|---|---|
| 1 | ✗ timeout | 242s | 3/3 | 0 |
| 2 | ✓ completed | 73s | 3/3 | 0 |
| 3 | ✓ completed | 65s | 3/3 | 0 |
| 4 | ✓ completed | 110s | 3/3 | 0 |
| 5 | ✓ completed | 148s | 3/3 | 0 |

> Auto-approved unattended (the board's supervised path, automated): trust prompts, resume pickers,
> and permission menus are accepted by the harness. `acceptEdits` auto-accepts file writes; the one
> Bash prompt per agent (swarm-say) is approved with "don't ask again".
>
> Per-run pane-stage transition logs are written to `evals/logs/<run>.log` so failures are
> attributable. "Kickoff retries" counts harness re-deliveries of a LOST launch kickoff (zero baton
> lines + idle initiator) — launch machinery, not the handoff chain under test, which is never re-driven.
