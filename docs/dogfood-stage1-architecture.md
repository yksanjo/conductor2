# Stage 1 — Architecture & Code Review of ~/conductor-v2

Reviewer: dogfood-s1 (swarm "dogfood", pipeline stage 1 of 3).
Scope: every source file read in full (~2,626 lines across 11 files). Test suite executed: **49 passed, 0 failed**. One finding verified empirically against the live registry of the very swarm running this review.

## What the system is

Conductor V2 is a pre-flight configurator + launcher for fleets of Claude Code agents:

- **swarm.js** — `plan()` (pure config→launch-plan resolution) and `fire()` (write swarm dir, launch tmux windows, deliver kickoffs).
- **topologies.js** — three coordination shapes (hierarchical / pipeline / mesh) that generate per-agent markdown briefings.
- **presets.js** — three canned missions with role hints and placeholder-bearing purpose templates.
- **manage.js** — the tmux control plane: launch, pane-stage classification (trust/resume/busy/ready), verified delivery, registry (`~/.conductor2/managed.json`).
- **engine.js + adapters/claude-code.js + lib.js + util.js** — source-agnostic observation engine; the adapter scans `~/.claude/projects/*.jsonl` transcripts and detects liveness via `lsof`.
- **server.js** — zero-dep `node:http` server: Launch Pad (`/`), cockpit board (`/board`), JSON API, CSRF/DNS-rebinding guard on writes.
- **cli.js** — `up / presets / plan / fire / swarms / stop` mirroring the web surface.
- **test.js** — sandboxed-HOME unit + tmux-integration + real-HTTP tests.

Coordination between agents is deliberately primitive: a shared swarm directory (files as source of truth) and `swarm-say` (a 5-line `tmux send-keys` shell script). No message bus, no framework.

## Strengths

1. **plan/fire separation is genuinely good.** `swarm.plan()` is pure (no tmux, no fs), so the UI preview, the CLI `plan` command, and the tests all exercise the exact artifact that `fire()` executes (swarm.js:35-83). This is the architecture decision that makes the whole thing testable.
2. **Honest delivery semantics.** `sendIfReady`/`confirmDelivery`/`deliver` (manage.js:166-201) refuse to type into trust prompts, resume pickers, or busy panes, and report per-window status (`started`/`sent`/`skipped`/`gone`) instead of claiming success on tmux exit 0. The comments explicitly document a prior false-positive check that was removed (manage.js:186-190) — evidence of iterated, honest engineering rather than demo-ware.
3. **Dependency-aware launch order.** Receivers launch before initiators (swarm.js:75), so the orchestrator/stage-1 can never message a window that doesn't exist yet. Tested (test.js:87).
4. **Long prompts never travel through tmux.** Briefings are written to disk; the kickoff is a <250-char single line pointing at the file (swarm.js:69, tested at test.js:97). This sidesteps the entire class of send-keys escaping/length bugs.
5. **No-shell tmux invocations.** Every tmux call uses arg arrays via `spawnSync` with `-l --` for literals (manage.js:20-22, 74-75, 175) — message text is never shell-interpolated. Same discipline in `swarm-say` (`"$*"` after `--`).
6. **Reasonable security posture for a localhost tool.** Server binds 127.0.0.1 only (server.js:919); writes require POST + Host allowlist + Origin check + `X-Conductor: 1` header (server.js:721-733); destructive endpoints require a typed confirm token equal to the target name (server.js:778, 824); body size capped at 64 KB (server.js:717).
7. **Bounded resource usage in the scanner.** `mapLimit` caps concurrent transcript streams (util.js:30-38, engine.js:63); transcripts are streamed line-by-line, never loaded whole (claude-code.js:108-153); `lsof` results cached 3 s (claude-code.js:194-195).
8. **The README's "Honest seams" section.** It names the real failure modes (permission prompts block `swarm-say`, LLM coordination is probabilistic, stop kills sessions) instead of hiding them. Rare and senior.
9. **Test suite quality is above average for a side project**: sandboxed HOME set before module load, real tmux integration with a `sleep 30 #` command seam, real HTTP against the exported `handle`, negative tests (CSRF 403, double-fire, bad permission mode, missing confirm token).

## Weaknesses (design-level)

1. **Coordination safety is prompt-enforced, not mechanism-enforced.** "Never message a window not listed above", "READ-ONLY repo", "one line only" are all briefing text. `swarm-say` itself will happily deliver to *any* window in the `conductor2` tmux session, of any swarm (swarm.js:87-92 — no membership check, no swarm namespace in the script). A confused agent can cross-talk into an unrelated swarm or a user's adopted personal session. The script could trivially take an allowlist baked in at fire time.
2. **`swarm-say` has no readiness gate.** Unlike the cockpit's `deliver()`, the shell script fires `send-keys` + 0.3 s + Enter blindly (swarm.js:91). If the receiving pane is at a permission prompt or a menu, the message keystrokes land in the dialog. The careful pane-stage machinery in manage.js is bypassed by the very channel agents use most.
3. **No swarm lifecycle/health model.** Nothing detects "stage 2 never got the handoff" or "worker died mid-task". The board shows liveness, but the pipeline has no timeout/retry/dead-letter story; a single missed `swarm-say` (e.g., eaten by a permission prompt) silently stalls the whole pipeline. For a product whose pitch is reliable multi-agent coordination, this is the biggest conceptual gap.
4. **Single hardcoded tmux session name** (`conductor2`, manage.js:18) means tests, real swarms, and viewer sessions all share one namespace. The integration test creates and kills windows inside the user's *live* `conductor2` session (test.js:127-139) — pid-suffixed so collision is unlikely, but a test suite mutating production tmux state is a footgun.
5. **engine.js's adapter abstraction is speculative.** `loadAdapter()` (engine.js:34-45) is exported but never called by any surface; only one adapter exists; `lib.js` is a facade over a facade. ~130 lines of generality serving one concrete case. Defensible as a seam, but it's scaffolding for a future that isn't in the repo.
6. **package.json `main: "swarm.js"`** while the documented programmatic facade is lib.js — cosmetic but confusing (package.json:11).

## Real bugs (with file:line)

### BUG-1 (HIGH): `resolveSession` binds every same-cwd swarm window to the same transcript — **verified live**
manage.js:317-329. Swarm launches use `capture: false` (swarm.js:123), so no window gets a sessionId at launch. `listManaged()` later late-binds each missing sessionId to *the newest* `.jsonl` in the window's cwd whose mtime ≥ `created − 1500 ms`. All agents of a swarm share one cwd and one launch instant, so **every window resolves to the same newest transcript**, and the binding is then persisted (manage.js:339).

Empirical proof from the swarm running this review — `~/.conductor2/managed.json` right now:
```
dogfood-s1.sessionId == dogfood-s2.sessionId == dogfood-s3.sessionId
                     == "cdc998b5-97b2-435c-b770-a54bd63a4437"
```
Consequences: `managedBySession()` (manage.js:347-354) keys by sessionId, so two of three swarm cards on the board lose their `managed`/swarm flags (last-write-wins), reply buttons route to the wrong window, and the swarm grouping the product demos is broken for its *default* configuration (all agents in one folder). Fix direction: exclude sessionIds already claimed by other registry entries, and/or match transcripts to windows by first-prompt content (the kickoff embeds the unique window name) or by per-window `--session-id`.

### BUG-2 (MEDIUM): pane-stage regexes match conversation *content*, not just chrome
manage.js:128, 145-149. `trustPromptShowing`/`paneStage` grep the whole captured pane for `/trust this folder|Yes, I trust|safety check/i`. If an agent's visible transcript *discusses* folder trust (e.g., a security-review swarm quoting this very code), `paneStage` returns `'trust'` and `deliverAdopted`/`sendIfReady` will fire a stray Enter into a live session (manage.js:291) or refuse delivery forever. Same for `/Resume from summary/`. A swarm whose mission is "review conductor-v2" — this one — can trip it. Fix: anchor matches to the last N lines / the bordered dialog region, or require absence of the prompt-box footer.

### BUG-3 (MEDIUM): `paneStage` classifies a *running* turn as `ready`
manage.js:148 treats `esc to interrupt` as `ready`, while `confirmDelivery` (manage.js:189) treats the same marker as "turn is running". So `sendIfReady` types into mid-turn windows (the text queues in Claude's input box — usually benign, but it contradicts the documented contract "prompt box is up and will accept a reply", manage.js:144) and the `started` confirmation is satisfied by the *previous* turn still running, reporting success for a message that merely queued. The two functions disagree about what the same pixels mean.

### BUG-4 (LOW): `fire()` clash check misses unmanaged tmux windows
swarm.js:114 checks only the registry (`manage.listManaged()`), but `manage.run()` fails on any *tmux* window with the same name (manage.js:57). A manually created window named like an agent makes `fire()` fail **halfway** — earlier windows are already launched and kicked off, files written, no rollback; the returned `ok:false` leaves a zombie partial swarm the registry knows about but the caller was told failed.

### BUG-5 (LOW): GET endpoints are unguarded against DNS rebinding
server.js:746 applies `writeAllowed` (Host + Origin + header) to POSTs only. A DNS-rebinding page can issue GETs to `/api/sessions` and read transcript titles, last prompts, cwds, and git branches for every recent Claude session (server.js:785-800). README claims V1's guard scheme "verbatim" for state-changing routes — true — but the read side leaks meaningful private data to a rebound origin. Cheap fix: apply `localHost(req)` to all `/api/*` routes.

### BUG-6 (LOW): `__CONFIG__`/`__META__` template injection footguns
server.js:873, 878. Config JSON is spliced into HTML via `String.replace`, where `$&`/`$'` sequences in the JSON would be expanded as replacement patterns, and a `</script>` inside any preset/topology string would break out of the script tag. All current content is static and clean, so not exploitable today — but the first user-supplied string that reaches `launchConfig()` turns this into self-XSS. Use a replacer function (`.replace('__CONFIG__', () => json)`) and escape `<` as `<`.

### Observation (not a bug): blocking sleeps in the request path
`deliver()` runs `spawnSync('sleep', 0.35s)` on the single-threaded server per `/api/say` (manage.js:199); `run()` with capture polls up to ~10 s (manage.js:83-89). The batch-settle design in `sayAll` (manage.js:208-225) shows the author understands the cost — but per-card replies still freeze every concurrent poll for 350 ms.

## Test-suite assessment

Good: real modules, sandboxed HOME, tmux integration, HTTP-level server tests, negative cases. Gaps that matter: **zero coverage of the trickiest code** — `paneStage`, `sendIfReady`/`confirmDelivery`, `deliverAdopted`, and `resolveSession` (the site of BUG-1) are untested; the adapter's transcript parser and the engine's `collect()` have no fixtures. The suite proves the launch path and proves nothing about the steering/observation path, which is where the real risk lives.

## Meta: how this swarm itself behaved (dogfood evidence)

- Launch, briefing delivery, and kickoff worked exactly as designed; the pipeline briefing was unambiguous about start conditions and handoff.
- BUG-1 manifested in our own registry within seconds of launch (all three windows share one sessionId).
- The briefing's rules (read-only repo, out/-only writes, one-line messages) were clear enough to follow without clarification — prompt-level coordination did its job for a 3-agent pipeline.

— dogfood-s1
