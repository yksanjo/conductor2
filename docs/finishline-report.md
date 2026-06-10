# Conductor V2 — Release-Readiness Report

**Swarm:** finishline (pipeline: recon → audit → verify → report) · **Date:** 2026-06-10
**Scope:** everything shipped in `~/conductor-v2` (github.com/yksanjo/conductor2, npm `@yksanjo/conductor2@2.0.0`, unpublished): code correctness, security of server.js + swarm-say allowlist + CSRF guard, eval-harness honesty, README accuracy vs behavior, `files[]` completeness, npm publish readiness.
**Method:** recon mapped every entry point; the auditor read every shipped module line-by-line with live probes; the verifier independently reproduced or killed every finding (3 fresh headless-Claude repros, tarball re-inspection, suite re-run). Nothing below is a "maybe" — every finding was independently confirmed.

## Verdict

**Not ready to publish yet — but close.** One behavioral release-blocker (F1), two honesty gates that must land before `npm publish` (F2, F3), two cheap polish items (F4, F5). The security posture is genuinely solid: every scary-looking construct (generated shell script, tmux send-keys, CSRF gate, dynamic require, osascript, lsof) was adversarially checked and **verified clean**. No secrets, no personal paths, tarball matches `files[]` exactly. Fix F1–F3 and this ships.

---

## Findings (severity-ranked, all CONFIRMED by independent reproduction)

### F1 — HIGH (release-blocking behavior): `folderFor()` mis-maps any cwd containing `.`, `_`, space, or non-ASCII — the cockpit silently loses the whole swarm

**Where:** `manage.js:39`, duplicated at `adapters/claude-code.js:210`; test fixture shares the bug at `test.js:144`.

**What happens:** Claude Code names a session's transcript directory by replacing **every non-alphanumeric character** of the cwd with `-` (verified live 3×, including a Japanese-named dir: per-code-unit `[^A-Za-z0-9]` → `-`, runs not collapsed). Conductor only replaces `/`. For any cwd like `~/my_project`, `~/repo.v2`, or a folder with a space, conductor computes a directory that doesn't exist, so:

- `run()`'s capture loop never finds the transcript → `sessionId` stays `null`; `resolveSession()` never recovers.
- `managedBySession()` only maps windows **with** a sessionId → board cards render **ungrouped and unmanaged**: no swarm grouping (server.js:653-661), no reply/nudge routing (server.js:869), no stalled-handoff detection (server.js:497) — the three headline cockpit features.
- The swarm still coordinates (swarm-say keys off the registry, not sessionId), so the failure is **silent**: agents talk, you can't watch or steer them.

Dogfooding never caught it because `~` and `conductor-v2` contain no offending chars, and the test fixture uses the same wrong transform — self-consistent, not correct.

**Fix (verified to match all three observed Claude outputs):**
```js
// manage.js:39 AND adapters/claude-code.js:210 — was: cwd.replace(/\//g, '-')
cwd.replace(/[^A-Za-z0-9]/g, '-')
```
Also update the fixture at `test.js:144` to the same transform and add a regression test with a dotted/underscored cwd (e.g. `a.b_c d`) so the suite pins real Claude naming, not the old bug.

### F2 — MEDIUM (publish gate, honesty): README ships stale reliability numbers that contradict the `evals/RESULTS.md` it links to

**Where:** `README.md` "Measured coordination reliability" table (~lines 112–117), the "~5× faster" line (~118), and "59 assertions" (line 157).

| claim | README says | shipped truth |
|---|---|---|
| completion rate | 67% (2/3), "within 200s" | **100% (5/5), within 240s** (evals/RESULTS.md, regenerated 2026-06-10) |
| handoff success | 67% (6/9) | **93% (14/15)** |
| median wall-clock | 61s | **34s** |
| single-agent baseline | 13s | **8s** |
| speedup framing | "~5× faster" | 34s/8s ≈ **4.25×** → "~4×" |
| test suite | "59 assertions" | **66 passed, 0 failed** (re-run twice) |

The last commit regenerated RESULTS.md (67% → 100%) but didn't touch the README. For a launch pitched on *"we measure reliability instead of asserting it,"* the README contradicting its own shipped results file is a credibility problem. The surrounding "read it honestly" prose (one stalled run, tail-failure framing) also needs a pass — at 5/5 the narrative changes.

**Fix:** sync the README table to RESULTS.md (100%, 93%, 34s, 8s, 240s), change "~5×" to "~4×", change "59 assertions" to "66 assertions", and re-read the honesty paragraph against the new numbers.

### F3 — MEDIUM (publish gate, latent): `npm run eval` and `npm test` are advertised, but `evals/` and `test.js` aren't in the tarball

**Where:** `package.json` scripts (`"eval": "node evals/coordination.mjs"`, `"test": "node test.js"`) vs `files[]`. Tarball verified twice via `npm pack --dry-run`: 14 files, no `evals/`, no `test.js`.

Today nothing is broken — the documented install path is `npm link` from a clone, and the package is unpublished. But the moment it's published, `npm install @yksanjo/conductor2 && npm run eval` → `MODULE_NOT_FOUND`, and the README markets `npm run eval` as a user-facing feature. Since this swarm's mission is publish readiness, this gates the publish.

**Fix (pick one):**
1. *(recommended)* Add to `files[]`: `"test.js"`, `"evals/coordination.mjs"`, `"evals/RESULTS.md"` (list the two files explicitly so generated `evals/logs/` stays out of the tarball).
2. Or rewrite the README so `npm run eval` / `npm test` are explicitly clone-only surfaces.

### F4 — LOW (doc bug): `npm run eval --runs 10` silently runs 3

**Where:** `README.md:129`. npm consumes `--runs` as its own config flag (current npm forwards only the bare `10`, which `parseArgs` in coordination.mjs ignores), so the documented command silently uses the default `runs=3`.

**Fix:** document the separator — `npm run eval -- --runs 10` (probe-verified to forward correctly).

### F5 — LOW (self-XSS only): `__MODEL__` substituted into Launch Pad HTML unescaped

**Where:** `server.js:912` `.replace('__MODEL__', () => swarm.MODEL)`; `swarm.MODEL = process.env.CONDUCTOR2_MODEL || 'claude-fable-5'` (swarm.js:26), no sanitization. It lands in element **text content** at server.js:252 (`>__MODEL__ · locked</span>`), so `CONDUCTOR2_MODEL='<script>…'` injects markup (verified end-to-end).

Severity stays LOW: it's the operator's own env var rendered on their own 127.0.0.1-bound server — self-XSS, no external attacker path; and the function-form replace means `$`-pattern expansion is impossible (BUG-6 holds).

**Fix (one line):**
```js
res.end(PAD.replace('__CONFIG__', () => jsonForScript(launchConfig()))
  .replace('__MODEL__', () => String(swarm.MODEL).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))));
```

---

## Checked and found CLEAN (adversarially verified, not just eyeballed)

1. **CSRF / DNS-rebinding gate (server.js:742-776) — CLEAN.** Writes require `localHost && localOrigin && x-conductor:1`. The custom header is decisive: cross-origin `fetch` triggers a CORS preflight, and the server emits zero `Access-Control-*` headers and has no OPTIONS handler — preflight can never succeed; HTML forms can't set custom headers, so allowing missing/`null` Origin is safe. DNS-rebinding read-harvest fails the `localHost` Host check (after a rebind the browser still sends the attacker's hostname); `localhost.evil.com` and `[::1]:port` edge cases handled. Server binds 127.0.0.1 only (server.js:953).
2. **Generated `swarm-say` shell script (swarm.js:96-109) — CLEAN.** The only string-built shell script in the codebase. Every interpolated value is charset-sanitized (swarm `[a-z0-9_-]` ≤24; member windows `[A-Za-z0-9_-]` ≤40 — verified the sanitizer is the *only* source of member names); helper path is `JSON.stringify`'d; message text rides `"$*"` as a single argv into node and never re-enters a shell. No metacharacter can reach the script.
3. **tmux control plane (manage.js) — CLEAN.** All five text-sending sites use `spawnSync('tmux', argsArray)` with literal-mode `send-keys -l -- <text>`. No shell anywhere in the tmux path; message/reply injection is structurally impossible.
4. **`openTerminal` osascript (manage.js:281-283) — CLEAN.** The only string-built AppleScript; interpolates only a `/dev/ttys…` device path from tmux and a constant session name. No quote-bearing input can reach it.
5. **`loadAdapter` dynamic require (engine.js:34-36) — CLEAN.** Name guarded by `/^[a-z0-9-]+$/` before `require`; zero call sites in shipped code (lib.js hard-requires the claude-code adapter). No traversal path.
6. **`lsof` exec (adapters/claude-code.js:199) — CLEAN.** Static command string, no interpolation, try/catch + 4s timeout; degrades gracefully where lsof is absent (portability note, not a vuln).
7. **HTTP body handling (server.js:734-741) — CLEAN.** 64KB cap with 413 + `req.destroy()`; JSON parse try/caught.
8. **`jsonForScript` HTML-script injection guard (server.js:733) — CLEAN.** Escapes `<` (blocks `</script>` breakout); both `__CONFIG__`/`__META__` call sites use the function-form replace, so `$&`-expansion is impossible.
9. **Secrets & personal data — CLEAN.** No hardcoded secrets in any shipped file or in git history; no personal/absolute paths in shipped source (only illustrative `~/soag-*` example strings in presets.js — cosmetic). `/api/sessions`'s machine-wide transcript exposure is localhost-gated and documented as a design tradeoff in the README.
10. **npm tarball — CLEAN (modulo F3).** `npm pack --dry-run` → exactly 14 files matching `files[]`; no tests, docs, CI files, or secrets leak into the package. Shebangs present on cli.js/server.js/swarm-say.js; `publishConfig.access: public` correct for the scoped name; MIT LICENSE shipped; `engines.node >=18` consistent with the code.
11. **Test suite — passing.** `npm test`: 66 assertions, 0 failures, re-run independently by two stages (real modules, sandboxed HOME, real http, live tmux integration).

## Minor notes (cosmetic, non-blocking)

- `evals/coordination.mjs` usage comment lists `[--baseline]` but the parser only knows `--no-baseline`.
- CI tests Node 20 only while `engines` declares `>=18` — consider a small version matrix.
- `presets.js` example purposes mention `~/soag-gate` / `agentsoag.com` — illustrative but slightly personal; swap for neutral examples if you care.
- Verifier probe leftovers exist on the dev machine and can be deleted: a handful of throwaway probe dirs under `/tmp/` (used for the F1 cwd-transform repros) and their matching transcript dirs under `~/.claude/projects/`.

## Recommended order to the finish line

1. **F1** — fix the cwd→projects-dir transform in both places + the fixture, add the regression test. *(the only behavior blocker)*
2. **F2 + F4** — one README pass: sync the eval table/assertion count, fix `-- --runs`.
3. **F3** — add `test.js` + `evals/coordination.mjs` + `evals/RESULTS.md` to `files[]`; re-run `npm pack --dry-run`.
4. **F5** — one-line escape of `__MODEL__`.
5. `npm test` + `npm run eval` once more, then `npm publish`.
