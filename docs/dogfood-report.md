# Conductor V2 — Dogfood Review Report

**Produced by the "dogfood" swarm** — a 3-stage pipeline of Claude Code agents launched *by Conductor V2 itself* to review Conductor V2 (`~/conductor-v2`, ~2,626 lines, 11 files, 49 tests passing).
**Pipeline:** s1 read every source file and ran the tests (architecture + bug review) → s2 audited the README and s1's findings as a skeptical external reviewer → s3 (this report) merged both into the top 10 findings, ranked by impact, each with a concrete fix.

**Meta-evidence first:** the swarm that wrote this report launched, coordinated, and handed off through the pipeline exactly as designed — *and* reproduced the product's worst bug in its own registry within seconds of launch (Finding #1). Both facts belong in the evaluation.

---

## Verdict (one paragraph)

**Sound core, but the repo ships narrative faster than evidence.** The hard-problem framing (macOS removed TIOCSTI, so cross-terminal input injection becomes a tmux pane-state-machine control problem), the pure `plan()`/`fire()` separation, the honest delivery semantics, and the dogfooding concept are all genuinely solid engineering. But the repo currently has a broken install command on line 13 of the README, a flagship cockpit feature that its own dogfood run disproved, a safety model that lives entirely in prompt text, and zero quantified reliability data for a product whose entire pitch is coordination reliability. Every one of these is fixable in days. The ranked list below is the fix order.

---

## Top 10 findings, ranked by impact

### 1. The flagship swarm board mis-binds every agent in the default configuration — verified live on this swarm (HIGH bug)
**Evidence:** `manage.js:317-329`. Swarm launches use `capture: false` (`swarm.js:123`), so no window gets a sessionId at launch; `listManaged()` later late-binds each missing sessionId to the *newest* transcript in the window's cwd. All agents of a swarm share one cwd and one launch instant, so every window resolves to the same transcript. Proven empirically: in this swarm's own `~/.conductor2/managed.json`, dogfood-s1, -s2, and -s3 all bound to sessionId `cdc998b5-…`. Consequence: `managedBySession()` (`manage.js:347-354`) keys by sessionId, so swarm cards lose their flags (last-write-wins), reply buttons can route to the **wrong agent**, and the swarm grouping screenshotted in the README is broken in the default (all-agents-one-folder) config. Any evaluator who fires a swarm sees this within minutes.
**Fix:** generate a UUID per window at fire time and launch with `claude --session-id <uuid>` so the binding is exact, never inferred. Fallback hardening: in `resolveSession`, exclude sessionIds already claimed by other registry entries, and disambiguate by matching the transcript's first user prompt against the kickoff line (it embeds the unique window name).

### 2. Zero evals or benchmarks — the biggest evidence gap for an orchestration tool
**Evidence:** the core claim is that topology + briefings make multi-agent coordination "reliable, not deterministic," and there is no measurement of that reliability anywhere: no N-run completion rates, no handoff success rate, no single-agent baseline, no cost or wall-clock numbers. Anyone serious about agentic systems lives in evals; "vibes-based reliability" is the phrase that sticks.
**Fix:** add an `evals/` harness that fires each preset N times headlessly and emits one table: runs, % producing the final artifact, handoff success rate, median wall-clock, token cost, vs. a single agent given the same mission. Even `deep-research, 10 runs: 9/10 REPORT.md, median 14 min` moves this from hobby to engineering. Publish the table in the README.

### 3. The README's first executable claim is false: `npm install -g @yksanjo/conductor2` returns 404
**Evidence:** package unpublished (verified against the npm registry by s2). The clone + `npm link` fallback works, but a broken install on line 13 makes an evaluator discount everything below it.
**Fix:** `npm publish` (it's a zero-dep package — there is nothing to vendor), or make clone+link the primary documented path until published. Five minutes; the single cheapest high-impact fix in the repo.

### 4. The safety story is prompt-deep; the mechanisms don't enforce the rules the briefings state
**Evidence:** `swarm-say` delivers to *any* window in the `conductor2` tmux session — no membership allowlist (`swarm.js:87-92`); it has no readiness gate, firing `send-keys` + 0.3 s + Enter blindly (`swarm.js:91`), so keystrokes can land inside permission dialogs — bypassing the careful `paneStage`/`sendIfReady` machinery in manage.js. "READ-ONLY repo" and "never message other windows" are briefing prose with zero enforcement, and inter-agent prompt injection (every stage trusts the previous stage's files) is unaddressed. The README's "Irreversible actions are gated" paragraph is true for the *server* and silent on the *agents*, where the risk actually lives. "What enforces agent boundaries?" is the obvious question for any reviewer; today's honest answer is "the prompt."
**Fix:** bake a per-swarm window allowlist into `swarm-say` at fire time (it's generated text — emit the list into the script); route it through the existing `deliver()` readiness gate instead of raw `send-keys`; add a short "Trust boundaries" README section stating plainly which rules are mechanical and which are prompt-level.

### 5. No pipeline health model: one eaten handoff silently stalls the whole swarm
**Evidence:** s1 weakness #3. There is no timeout, retry, or dead-letter story; the board shows liveness but cannot distinguish "stage 2 is thinking" from "stage 2 never got the message" — and `swarm-say` (Finding #4) gives no delivery confirmation. The README calls this "two dumb, reliable channels"; files are reliable, the message channel demonstrably is not.
**Fix:** add a stalled-handoff detector — stage N's output file exists but stage N+1's transcript has been idle past a threshold → flag the card on the board with a one-click re-nudge. Reword the README to the actual design: "files are the source of truth; messages are best-effort nudges with the board as backstop."

### 6. Pane-stage regexes match conversation *content*, not just UI chrome — can fire a stray Enter into a live session (MEDIUM bug)
**Evidence:** `manage.js:128, 145-149`. `trustPromptShowing`/`paneStage` grep the entire captured pane for `/trust this folder|Yes, I trust|safety check/i` and `/Resume from summary/`. An agent whose visible transcript merely *discusses* folder trust — e.g., a security-review swarm quoting this very code — is classified as `'trust'`, and `deliverAdopted` sends Enter into it (`manage.js:291`), or delivery is refused forever.
**Fix:** anchor matches to the last N lines / the bordered dialog region of the capture, or require the prompt-box footer to be absent before classifying as a dialog.

### 7. `paneStage` and `confirmDelivery` disagree about what a running turn looks like — delivery can report success for a message that only queued (MEDIUM bug)
**Evidence:** `manage.js:148` treats `esc to interrupt` as `ready`; `manage.js:189` treats the same marker as "turn is running." So `sendIfReady` types into mid-turn windows, and the `started` confirmation is satisfied by the *previous* turn still running.
**Fix:** unify the classification: add a distinct `running` stage in `paneStage`, have `sendIfReady` queue-or-skip on it explicitly, and confirm delivery by observing a state *transition* (or an echo of the sent text in the input box) rather than the presence of a running marker.

### 8. Unguarded GET endpoints leak session metadata to DNS-rebinding pages (LOW bug, cheap fix)
**Evidence:** `server.js:746` applies the Host/Origin/header guard to POSTs only; a rebound origin can GET `/api/sessions` and read transcript titles, last prompts, cwds, and git branches for every recent Claude session (`server.js:785-800`).
**Fix:** apply the existing `localHost(req)` check to all `/api/*` routes regardless of method. One line. (While in there: fix the `__CONFIG__` splice at `server.js:873-878` to use a replacer function and escape `<`, closing a latent self-XSS footgun — s1 BUG-6.)

### 9. The README sells the dogfood run as a triumph and hides its findings — invert that
**Evidence:** the "Dogfooded on itself" section landed mid-review (commit `bfbd86c`, 15:52, while this swarm was running) and presents the concept without linking the resulting report or acknowledging it found 6 bugs — including #1, which breaks the screenshotted feature. A technical evaluator who checks timestamps sees narrative shipped ahead of fixes. Meanwhile the repo's genuinely strong evidence — 49 tests with sandboxed HOME, real tmux and real HTTP integration, negative cases — is never mentioned in the README at all.
**Fix:** link this `REPORT.md` from the README, bugs included, with a one-line changelog of which findings were fixed in response. "My orchestrator found 6 real bugs in itself and here they are, fixed" is *stronger* evidence than any screenshot. Add a Testing section advertising the suite — and extend it to cover the riskiest untested code: `paneStage`, `sendIfReady`/`confirmDelivery`, and `resolveSession` (the site of Finding #1, which a fixture test would have caught).

### 10. Repo hygiene bundle: the small things a code-reading reviewer trips on
**Evidence:** two commits total (one giant squash + one README patch — no visible iteration); no CI running the 49 tests (no badge, no `.github/workflows/`); `package.json` `main: "swarm.js"` while the documented facade is `lib.js`; hardcoded `claude-fable-5` with no `--model` escape hatch (model names rot — in six months "no bikeshedding" becomes "doesn't start"); `fire()` checks only the registry for name clashes (`swarm.js:114`) so a manually created tmux window makes it fail **halfway** with no rollback, leaving a zombie partial swarm (s1 BUG-4).
**Fix:** a 15-line GitHub Actions workflow + badge; set `main` to `lib.js`; add a `--model` flag defaulting to the current hardcode; pre-flight all window names against live tmux before launching any, and roll back (or report partial state honestly) on mid-fire failure.

---

## What holds up under inspection (keep these, advertise them)

- **`plan()`/`fire()` purity** — preview, CLI, and tests all exercise the exact artifact the launcher executes (`swarm.js:35-83`). The architecture decision that makes the system testable.
- **Honest delivery semantics in the cockpit path** — `sendIfReady`/`confirmDelivery` refuse trust prompts and busy panes and report per-window `started/sent/skipped/gone`; a comment documents a *removed* false-positive check (`manage.js:186-190`) — evidence of iteration on real failures.
- **Long prompts never travel through tmux** — briefings go to disk; kickoffs are <250-char pointers (tested). Sidesteps the whole send-keys escaping class.
- **No-shell tmux invocations throughout**; localhost-only CSRF-guarded writes with typed confirm tokens; 64 KB body caps; bounded concurrent transcript streaming.
- **The "Honest seams" README section and the TIOCSTI hard-problem framing** — the two best credibility artifacts in the repo.
- **Dependency-aware launch order** (receivers before initiators) — tested.

## Meta: how the swarm itself behaved (the dogfood evidence)

Launch, briefing delivery, pipeline ordering, and both handoffs (s1→s2, s2→s3) worked without human intervention; the briefing's rules were followed by all three agents without clarification. Finding #1 manifested in our own registry within seconds of launch. Prompt-level coordination was sufficient for a 3-stage pipeline; the gaps that matter (Findings #4, #5) are about what happens when it *isn't*.

## Appendix

- Stage 1 (architecture + code review, all bugs with file:line): `out/stage-1-s1.md`
- Stage 2 (skeptical external-reviewer critique, claims-vs-evidence table): `out/stage-2-s2.md`
- Stage 3 (this merge): `out/stage-3-s3.md`

— dogfood-s3, final stage
