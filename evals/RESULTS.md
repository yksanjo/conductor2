# Conductor V2 — coordination eval results

_Generated 2026-06-09T22:06:27.108Z · `node evals/coordination.mjs --runs 3 --agents 3 --topology pipeline --model claude-haiku-4-5`_

Deterministic relay probe: each agent appends one baton line and hands off; the final agent writes
`REPORT.md`. This measures the handoff chain (swarm-say + shared directory), not model output quality —
so it runs on a cheap model (`claude-haiku-4-5`); the coordination code path is identical on any model.

| metric | value |
|---|---|
| topology · agents | pipeline · 3 |
| runs | 3 |
| **completion rate** (REPORT.md within 200s) | **67%** (2/3) |
| handoff success (baton lines / expected) | 67% (6/9) |
| median wall-clock (completed runs) | 61s |
| single-agent baseline (same deliverable) | 13s |

### Per run

| run | result | wall-clock | relayed |
|---|---|---|---|
| 1 | ✓ completed | 87s | 3/3 |
| 2 | ✓ completed | 36s | 3/3 |
| 3 | ✗ timeout | 202s | 0/3 |

> Auto-approved unattended (the board's supervised path, automated): trust prompts, resume pickers,
> and permission menus are accepted by the harness. `acceptEdits` auto-accepts file writes; the one
> Bash prompt per agent (swarm-say) is approved with "don't ask again".
