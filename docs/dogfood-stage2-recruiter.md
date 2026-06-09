# Stage 2 — Recruiter-Lens Critique (Head of Agentic AI evaluating the author)

Reviewer: dogfood-s2 (swarm "dogfood", pipeline stage 2 of 3).
Inputs: README.md (at commit `bfbd86c`), stage-1-s1.md, package.json, git history, npm registry check.
Note: the README was patched **mid-review** (15:52, commit `bfbd86c` — screenshots + "Why this is the hard part" section added while this swarm was running). I critique the current state and flag the patch itself in §5.

## 1. The 30-second screen

What a hiring manager sees in the first half-minute: a one-line V1→V2 positioning sentence, "Zero dependencies. Claude-only. One model.", a launch-pad screenshot, an install command, and a section titled "Why this is the hard part" explaining that macOS removed TIOCSTI so cross-terminal input injection is a control problem solved with tmux + a pane-state machine. That section is the single best recruiting artifact in the repo — it demonstrates the author found the actual hard problem, named the syscall, and engineered a state machine around it rather than wrapping an SDK.

Then they run the install command. **`npm install -g @yksanjo/conductor2` returns 404 — the package is not published.** The very first executable claim in the README is false. The `git clone && npm link` fallback works, but a broken install command on line 13 is the kind of detail that makes an evaluator discount everything below it. This is the cheapest, highest-impact fix in the entire repo.

## 2. Senior signals (specific, verified)

1. **Problem framing.** "Send a message to an agent is really 'drive it from boot to ready, then deliver exactly once'" — that's distributed-systems thinking applied to TUIs. Most agent-framework repos never articulate their delivery semantics at all.
2. **`plan()`/`fire()` purity** (s1 strength #1). Preview, CLI, and tests all exercise the same artifact the launcher executes. This is the architectural decision a senior interviewer would fish for, and it's there.
3. **Documented removed false-positive check** (manage.js:186-190, s1 strength #2). Comments explaining *why a check was deleted* are evidence of iteration on real failures — demo-ware never has these.
4. **"Design stance" section owns probabilistic coordination** instead of hiding it: "they're LLMs, not a DAG executor. Pretending otherwise would be the junior move." Correct, self-aware, and rare. Same for loudly-labeled `bypassPermissions`.
5. **Zero dependencies, no-shell tmux invocations, localhost-only CSRF-guarded server, 64KB body caps** — a coherent minimal-trust posture, executed consistently (s1 strengths #5-6).
6. **49 passing tests with sandboxed HOME, real tmux and real HTTP integration, negative cases.** Above the bar for a solo side project — but invisible: the README never mentions the test suite. Advertise it.
7. **The dogfood concept** ("the tool reviewing its own code is the demo") is a genuinely differentiating idea for an agentic-AI portfolio. Execution caveat in §3.2.

## 3. Junior or missing signals (brutal, ranked)

### 3.1 Zero evals or benchmarks — the disqualifying gap for this specific role
The product's core claim is that topology + briefings make multi-agent coordination "reliable, not deterministic." There is **no measurement of that reliability anywhere**: no N-run completion rates per preset, no handoff success rate, no comparison against a single agent doing the same mission, no token cost, no wall-clock numbers. A Head of Agentic AI lives in evals; a multi-agent orchestrator with zero quantified coordination data reads as "vibes-based reliability." Even a crude table — "deep-research preset, 10 runs: 9/10 produced REPORT.md, median 14 min, ~$X" — would move this from hobby to engineering. This is the #1 content gap.

### 3.2 The flagship demo is broken in the default configuration — and the README sells it anyway
s1's BUG-1, **verified live on this very swarm**: all agents launched into one folder bind to the same transcript sessionId, so the board's swarm grouping — the headline feature, screenshotted in the README — mis-renders, and reply buttons can route to the wrong agent. Meanwhile the new "Dogfooded on itself" section presents the dogfood run as a triumph and doesn't link the resulting report or admit it found bugs. Claiming "the tool reviewing its own code is the demo" while that review's primary finding is "the cockpit mis-binds every agent in the default config" is spin, and a technical evaluator who fires a swarm will see the broken board within minutes. The senior move: fix BUG-1, then link `out/REPORT.md` from the README, bugs included — *that* artifact is worth more than the screenshots.

### 3.3 Safety story is prompt-deep, and the README oversells it
The README frames permission modes as the safety dial. But per s1: `swarm-say` will deliver into **any** window of any swarm (no allowlist baked at fire time), has no readiness gate (blind send + 0.3s + Enter — keystrokes can land in permission dialogs), the "READ-ONLY repo" and "never message other windows" rules are briefing prose with zero enforcement, and unauthenticated GETs leak session titles/prompts/cwds to DNS-rebinding pages (BUG-5). Nothing addresses prompt injection between agents — every stage trusts files written by the previous stage. For an agentic-AI leadership role, "what enforces agent boundaries?" is a guaranteed interview question, and today's honest answer is "the prompt." The README's "Irreversible actions are gated" paragraph is true for the *server* but silent on the *agents*, which is where the risk is.

### 3.4 "Two dumb, reliable channels" — one of them isn't
Files are reliable. The message channel demonstrably is not: no delivery confirmation in `swarm-say`, no timeout/retry/dead-letter, and a single eaten handoff silently stalls a whole pipeline (s1 weakness #3). The board can't distinguish "stage 2 is thinking" from "stage 2 never got the message." Precise engineers don't call a fire-and-forget keystroke blast reliable; say "files are the source of truth, messages are best-effort nudges with the board as backstop" — which is the actual design — and add a stalled-handoff indicator.

### 3.5 Repo hygiene reads junior on inspection
- **Two commits total**: one giant squash + one README patch. No visible iteration history, no PR discipline. For a portfolio repo, history *is* evidence of process.
- **No CI.** 49 tests exist but nothing runs them on push — no badge, no `.github/workflows/`. A 15-line Actions file fixes this.
- **No CHANGELOG, no versioning story** beyond `2.0.0`, no CONTRIBUTING.
- **`main: "swarm.js"` vs documented facade `lib.js`** (s1 weakness #6) — small, but exactly what a code-reading interviewer trips on.
- **Hardcoded `claude-fable-5`** with no `--model` escape hatch: model names rot; in six months the README's confident "no bikeshedding" line becomes "doesn't start."

### 3.6 Demo artifacts: better since 15:52, still short of the magic moment
Two static screenshots now exist (good). But the product's wow is temporal — FIRE → windows boot → handoffs fly → REPORT.md lands. A 60-90s asciinema/GIF of one full pipeline run would do more than both PNGs. No hosted sample output (`out/REPORT.md` from a real run) is linked anywhere.

## 4. Claims vs. evidence (the table an evaluator builds in their head)

| README claim | Reality (per s1 + checks) |
|---|---|
| `npm install -g @yksanjo/conductor2` | 404 — unpublished |
| "two dumb, **reliable** channels" | message channel has no readiness gate, confirmation, or retry |
| cockpit "swarm grouping" (screenshot) | broken by BUG-1 in the default same-folder config, verified live |
| "walked through Claude's startup prompts automatically" | pane-stage regexes match conversation content; can misfire Enter into live sessions (BUG-2) |
| "Dogfooded on itself" | true — but the run's findings (6 bugs) are unlinked and unacknowledged |
| "POST-only, localhost-only, CSRF-guarded" | true for writes; GETs leak session metadata to rebound origins (BUG-5) |
| Zero deps, plan/fire purity, honest seams | fully verified — these hold up |

## 5. Meta-observation: the live patch
Commit `bfbd86c` landed at 15:52 — *while this swarm was reviewing* — adding exactly the artifacts a reviewer would flag (screenshots, hard-problem framing, dogfood note), co-authored with Claude. Read generously: the author runs a tight agentic feedback loop and ships fixes in minutes — genuinely on-brand for the role. Read skeptically: the evaluation target moved mid-evaluation, and the patch added *narrative* (dogfood triumph) ahead of *fixes* (BUG-1 is still live). An interviewer who notices the timestamps will ask about it; the answer should be "the swarm's report drove the next commits," which requires the report's bugs to actually get fixed next.

## 6. Verdict

**Interview: yes.** The TIOCSTI framing, plan/fire purity, delivery-semantics honesty, and the dogfooding concept clear the senior bar on judgment and taste. **But the offer-risk profile is "ships narrative faster than evidence":** a broken install command, a flagship feature its own dogfood run disproved, a safety model that is prose-deep, and zero evals for a product whose entire value proposition is coordination reliability. Every one of these is fixable in days, and the ranked fixes are stage 3's job — but as it stands, the repo is one `npm publish`, one BUG-1 fix, one eval table, and one linked dogfood report away from being a genuinely strong Head-of-Agentic-AI portfolio piece instead of a promising one.

— dogfood-s2
