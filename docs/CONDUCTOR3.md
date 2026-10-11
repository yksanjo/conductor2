# conductor3 - design + skeleton (iteration 1)

conductor3 is the night-shift layer on top of conductor2: standing missions that run while you are away, prove their own output, and leave one decision inbox in the morning. It builds on `docs/V3.md`. This doc is the concrete shape of the first slice.

## Principles
1. Night workers research and draft. They never send, publish, pay, delete or deploy.
2. Anything irreversible goes through a separate, gated executor that acts only on an approved inbox item. (Not built yet.)
3. One shared contact/action ledger so two missions don't contact the same person twice. (Not built yet.)
4. Every run gets a unique run ID and a fresh folder. No reused swarm folders, no inherited stale reports.
5. A morning decision inbox is the only interruption.

## Mission file (JSON, zero deps)
| field | meaning |
|---|---|
| name | lowercase id |
| purpose | what the swarm is asked to do |
| trigger | `{cron}` or `{manual:true}` |
| swarm | `{topology, size}` (hierarchical / pipeline / mesh) |
| inputs | named files or URLs the crew may read |
| allowedOps | subset of read, research, draft, write-workspace. send/publish/pay/delete/deploy are rejected at validation |
| budget | `minutes` (wall clock) and optional `tokens` |
| deliverable | `{file, requiredSections}` |
| verifier | `{sections:true}` and/or `{command}` |
| retry | `{max}` 0-3 |
| escalate | `{to:"inbox"}` |

Example: `conductor3/missions/nightly-repo-health.json`.

## Run states
```
queued -> running -> needs-input -> running
                  -> ready-for-review -> verified
                                      -> queued (retry, attempt+1)
                  -> failed (from running / needs-input / ready-for-review / queued)
```
`verified` and `failed` are terminal. Illegal transitions throw. Each transition is appended to `run.json` history.

## Verifier
"Agent says done" is evidence. A green verifier is proof. The runner checks the deliverable has every required section, then runs the mission's verifier command. Red verifier -> retry up to `retry.max`, then fail and put the failure in the inbox.

## What works today
- Mission validation, including refusing gated ops.
- State machine with unique run IDs.
- Runner loop (retry, needs-input, timeout, inbox items), tested with injected launch/verify. `node conductor3/test.js`.

## What does not work yet (honest list)
- The runner does not call conductor2 `fire()`. `launch` is an injected function; wiring it to a real swarm is the next iteration.
- No scheduler. `trigger.cron` is validated but nothing fires it.
- No durable queue. Run state is a JSON file per run; there is no cross-run queue or crash recovery.
- `budget.minutes` is only checked by the injected launcher; `budget.tokens` is advisory.
- Verifier command execution is injected, not implemented. Sections check is real.
- Permission prompts still pause a swarm. Mapping them to `needs-input` is not done.
- No executor, no ledger, no connectors, no notifier. Inbox items are returned as objects, not stored or delivered.
- Not run against a live tmux swarm. Tested only with fakes.

## Next iterations
1. Wire `launch` to `fire()` + tmux babysitting, with per-run folders and `--add-dir`.
2. Verifier command runner with timeout and captured output as inbox evidence.
3. Scheduler + durable queue.
4. Inbox store + approve/deny CLI.
5. Gated executor + contact/action ledger.
