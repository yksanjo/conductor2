# conductor3/overseer - a simulated human per agent

Conductor 1's idea: one human at a CLI, overseeing N agents. That ratio is the bottleneck.
This module flips it: **every agent gets its own overseer, and the overseer is a simulated
human** - a named persona with a standard, an attention budget, and a fatigue model.

Overnight, workers draft. Their overseers read what each worker produced, ask questions,
send sloppy work back with the question the worker must answer, and endorse what is clean.
What lands in the morning is a curated shift report with first-person notes - not raw output.

## The roster

| persona | role | strictness | attention |
|---|---|---|---|
| Mara | managing editor | 0.9 - no sign-off without a URL | 8 reviews/shift |
| Priya | research lead | 0.8 | 6 reviews/shift |
| Dez | ops lead | 0.7 | 10 reviews/shift |
| Cole | generalist | 0.5 - accepts a named source | 12 reviews/shift |

Assignment is stable: `sha256(agent id)` picks the overseer, so a worker faces the same
standard every night and cannot shop for a lenient reviewer. Strictness sets the bar
(how much detail, whether a URL is required). Attention is the budget: each review costs
energy, and when a persona runs low it **defers** items instead of rubber-stamping them -
"I am at my limit for this shift." A tank refills over 8 rest-hours.

## Verdicts

- **endorsed** - clean work, ready for the morning batch.
- **returned** - sent back to the worker with the exact questions (`r-thin-detail`,
  `r-no-source`, `r-malformed`). After two returns the item **escalates** to the human
  instead of looping forever.
- **annotated** - gated kinds (`send` / `money` / `commitment`). The overseer only checks
  decision-readiness (detail, amount, recipient). **It never approves.** Approval still
  comes from one place: the real dashboard click, enforced by `../queue/policy.js`,
  which this module never touches.
- **deferred** - the overseer was out of attention; picked up on a later tick when rested.

## Use it

```
node conductor3/overseer/demo.js              # seeded night shift -> shift report
node conductor3/overseer/cli.js <queue-dir> roster
node conductor3/overseer/cli.js <queue-dir> tick
node conductor3/overseer/cli.js <queue-dir> status
node conductor3/overseer/cli.js <queue-dir> report
```

It runs on the same queue directory as the rest of conductor3 (`../queue`). Reviews land
on the items as `item.overseer`; persona state lives in `<queue-dir>/overseers.json`.
Zero dependencies, local only, no API calls, no spend.

## What works / what doesn't

Works: stable assignment, rule-based review with named rules, fatigue and recovery,
return loops capped by escalation, gated-kind annotation without approval, morning
shift report, 27 tests.

Doesn't: the judgment is deterministic rules, not a model - it checks shape and evidence,
not taste or truth. Workers that resubmit returned items are not wired yet (the queue
records the questions; a worker loop that reads them is a next iteration). The dashboard
does not render overseer notes yet.
