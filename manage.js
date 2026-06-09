'use strict';

// Conductor control plane — launch and steer Claude Code windows that run inside tmux.
// A plain-terminal Claude TUI can't have input injected (macOS removed TIOCSTI), so the
// only reliable channel is tmux send-keys. Conductor therefore "manages" windows it
// launches into a dedicated tmux session ("conductor"), one window per label. It records
// each window's transcript sessionId so the cockpit can attach reply buttons to the right
// card. All tmux calls use arg arrays (no shell), so reply text is never interpolated.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const REG_FILE = path.join(HOME, '.conductor2', 'managed.json');
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const SESSION = 'conductor2'; // tmux session that holds all managed windows

function tmux(args, opts = {}) {
  const r = spawnSync('tmux', args, { encoding: 'utf8', ...opts });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function hasTmux() { return spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0; }

function sanitize(label) {
  return String(label).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'window';
}
function target(label) { return `${SESSION}:${sanitize(label)}`; }

function loadReg() {
  try { return JSON.parse(fs.readFileSync(REG_FILE, 'utf8')); } catch { return { windows: {} }; }
}
function saveReg(reg) {
  fs.mkdirSync(path.dirname(REG_FILE), { recursive: true });
  fs.writeFileSync(REG_FILE, JSON.stringify(reg, null, 2));
}

function folderFor(cwd) { return path.join(PROJECTS_DIR, cwd.replace(/\//g, '-')); }
function jsonlSet(cwd) {
  try { return new Set(fs.readdirSync(folderFor(cwd)).filter((f) => f.endsWith('.jsonl'))); }
  catch { return new Set(); }
}

function sessionExists() { return tmux(['has-session', '-t', SESSION]).code === 0; }
function windowAlive(label) {
  const r = tmux(['list-windows', '-t', SESSION, '-F', '#{window_name}']);
  if (r.code !== 0) return false;
  return r.out.split('\n').includes(sanitize(label));
}

// Launch a new managed window running `claude` in tmux, capture its sessionId.
function run(label, claudeArgs, cwd, opts = {}) {
  if (!hasTmux()) return { ok: false, error: 'tmux is not installed (brew install tmux).' };
  const name = sanitize(label);
  cwd = cwd || process.cwd();
  if (windowAlive(name)) return { ok: false, error: `a managed window "${name}" already exists. Use a different label or: conductor stop ${name}` };

  const created = Date.now();      // anchor BEFORE launch so late-written transcripts still match
  const before = jsonlSet(cwd);

  if (!sessionExists()) {
    const r = tmux(['new-session', '-d', '-s', SESSION, '-n', name, '-c', cwd]);
    if (r.code !== 0) return { ok: false, error: 'tmux new-session failed: ' + r.err };
    tmux(['set', '-t', SESSION, 'status', 'off']); // keep any direct attach clean too
  } else {
    const r = tmux(['new-window', '-t', SESSION, '-n', name, '-c', cwd]);
    if (r.code !== 0) return { ok: false, error: 'tmux new-window failed: ' + r.err };
  }

  // Start the program inside the pane (typed into the shell so it stays visible). opts.cmd
  // defaults to "claude" — overridable for tests / launching other CLIs.
  const cmd = [opts.cmd || 'claude', ...(claudeArgs || [])].join(' ');
  tmux(['send-keys', '-t', target(name), '-l', '--', cmd]);
  tmux(['send-keys', '-t', target(name), 'Enter']);

  // Capture the new transcript sessionId (claude writes a fresh .jsonl on start) and
  // auto-answer the "trust this folder?" prompt along the way. Skipped when
  // opts.capture === false (e.g. the web server, which must not block) — the server
  // schedules trust separately, and listManaged() lazily resolves the sessionId.
  let sessionId = null;
  if (opts.capture !== false) {
    for (let i = 0; i < 20; i++) {               // poll up to ~10s
      if (trustPromptShowing(name)) answerTrust(name);
      const fresh = [...jsonlSet(cwd)].filter((f) => !before.has(f));
      if (fresh.length) { sessionId = fresh[0].replace(/\.jsonl$/, ''); break; }
      spawnSync('sleep', ['0.5']);
    }
  }

  const reg = loadReg();
  // opts.meta carries swarm bookkeeping (swarm name, role, topology) so the cockpit can
  // group a fleet's windows and stop-swarm can find its members.
  reg.windows[name] = { label: name, target: target(name), cwd, created, sessionId, adoptedFrom: opts.adoptedFrom || null, ...(opts.meta || {}) };
  saveReg(reg);
  return { ok: true, label: name, target: target(name), sessionId, attach: attachCommand(name) };
}

// Adopt an existing session: re-open it in a managed tmux window by forking its history
// (claude --resume <id> --fork-session). Forking avoids two live clients on one session id,
// so the user's old tab can stay open until they close it. Returns run()'s result (the new,
// forked sessionId is captured by polling, like a fresh launch).
function adopt(label, sessionId, cwd, opts) {
  if (!sessionId) return { ok: false, error: 'no sessionId to adopt' };
  // Record which session this window was forked from so managedBySession() can flag the
  // ORIGINAL card as managed (the fork gets a brand-new sessionId, so without this the card
  // you clicked never flips and every later click re-adopts).
  return run(label, ['--resume', sessionId, '--fork-session'], cwd, { ...opts, adoptedFrom: sessionId });
}

// Pick a window label that won't collide with a DIFFERENT managed session. Labels come from
// the project/cwd, so several sessions in the same folder (e.g. ~/ scratch windows) would
// otherwise map to one window and misroute each other's replies. Reuses the base label when
// it's free or already this session's; otherwise suffixes the short session id.
function uniqueLabel(base, sessionId) {
  const want = sanitize(base);
  const clash = listManaged().find(
    (w) => w.label === want && w.sessionId !== sessionId && w.adoptedFrom !== sessionId,
  );
  return clash ? sanitize(want + '-' + String(sessionId || '').slice(0, 8)) : want;
}

// The "trust this folder?" prompt: detect it and accept the default (highlighted "Yes")
// with Enter. Only sends Enter when the prompt is actually showing, so it can't fire a
// stray keystroke into an already-trusted session.
//
// Claude's prompts/menus/footer always render in the bottom rows of the pane. Match against
// only the last N lines, never the whole scrollback — otherwise a session whose visible
// TRANSCRIPT merely *discusses* "trust this folder" (e.g. a swarm reviewing this code) would
// be misread as sitting at the trust prompt, and we'd fire a stray Enter into a live turn.
function tailLines(s, n = 16) { const a = String(s).split('\n'); return a.slice(Math.max(0, a.length - n)).join('\n'); }
function trustPromptShowing(label) {
  const r = tmux(['capture-pane', '-p', '-t', target(label)]);
  return r.code === 0 && /trust this folder|Yes, I trust|safety check/i.test(tailLines(r.out));
}
function answerTrust(label) { return key(label, 'Enter'); }

// Classify what a managed window is showing, so the caller can drive it from boot to ready.
//   trust  = the folder-trust safety prompt (accept with Enter → default "Yes")
//   resume = the `--resume --fork-session` picker that large/old sessions show
//            ("Resume from summary / full session as-is / don't ask"). Recently-active cards
//            are exactly these large sessions — the old trust-only handler never answered this
//            menu, so adopting hung here and the reply was typed into it.
//   busy   = booting, loading history, or compacting — not safe to type into yet
//   ready  = Claude's prompt box is up and will accept a reply
//   gone   = the window/pane no longer exists
function paneStage(label) {
  const r = tmux(['capture-pane', '-p', '-t', target(label)]);
  if (r.code !== 0) return 'gone';
  const s = tailLines(r.out);   // BUG-2: match chrome in the bottom rows, not transcript content
  if (/trust this folder|Yes, I trust|safety check/i.test(s)) return 'trust';
  if (/Resume from summary|Resume full session as-is/i.test(s)) return 'resume';
  if (/Compacting conversation/i.test(s)) return 'busy';
  if (/\? for shortcuts|shift\+tab to cycle|auto mode on|esc to interrupt/i.test(s)
      || /^\s*[│|]?\s*[❯>]\s*$/m.test(s)) return 'ready';   // footer hints, or an empty prompt caret
  return 'busy';                                            // unknown / still loading
}

// Answer the resume picker by selecting "Resume full session as-is" (one Down from the
// highlighted "from summary" default). As-is is instant and keeps full context, which is what
// adopting a window to continue it wants — the summary default kicks off a slow /compact.
function resumeFull(label) { key(label, 'Down'); return key(label, 'Enter'); }

// Settle delay between firing a prompt and reading the pane back to see if the turn started.
const CONFIRM_MS = 350;

// Phase 1 of a verified send: gate on readiness and fire the keystrokes, but DON'T wait. Returns a
// record whose status is 'pending' when the text was delivered to a ready prompt (the caller
// confirms it later), or 'skipped'/'gone'/'error' when it wasn't. Splitting send from confirm lets
// sayAll fire every window first and settle ONCE — instead of paying the confirm delay per window,
// which froze the single-threaded server for ~CONFIRM_MS × (window count) on every broadcast.
function sendIfReady(label, text) {
  if (!hasTmux()) return { ok: false, label: sanitize(label), status: 'error', error: 'tmux not installed' };
  const name = sanitize(label);
  if (!windowAlive(name)) return { ok: false, label: name, status: 'gone' };
  const stage = paneStage(name);
  // Typing into the folder-trust prompt, the resume picker, or a busy/compacting pane is exactly
  // how a broadcast silently lands in the wrong place — refuse, and report the stage so the cockpit
  // can flag "⏸ trust prompt" / "busy" on that card instead of claiming success.
  if (stage !== 'ready') return { ok: false, label: name, status: stage === 'gone' ? 'gone' : 'skipped', stage };
  tmux(['send-keys', '-t', target(name), '-l', '--', String(text)]);
  const r = tmux(['send-keys', '-t', target(name), 'Enter']);
  if (r.code !== 0) return { ok: false, label: name, status: 'error', stage: 'ready', error: r.err };
  return { ok: true, label: name, status: 'pending', stage: 'ready' };
}

// Phase 2: read the pane back and upgrade a 'pending' record to 'started' (the turn is visibly
// running) or 'sent' (delivered to a ready prompt; a fast turn may already be done). We deliberately
// do NOT try to detect "text still sitting in the input box" — Claude echoes the submitted message
// into the transcript with a '>' prefix, indistinguishable from an unsent input line, so that check
// only produced false "unverified" alarms on prompts that were actually accepted.
function confirmDelivery(rec) {
  if (!rec || rec.status !== 'pending') return rec;
  const after = tmux(['capture-pane', '-p', '-t', target(rec.label)]);
  const running = after.code === 0 && /esc to interrupt|Compacting conversation/i.test(after.out);
  return { ...rec, status: running ? 'started' : 'sent' };
}

// Send a reply to ONE managed window, honestly: gate on readiness (sendIfReady), then confirm the
// turn took (confirmDelivery). Unlike say() (a raw keystroke pump), ok is true only when the prompt
// was delivered to a ready prompt; otherwise status is 'skipped'/'gone'/'error' with the stage.
function deliver(label, text) {
  const rec = sendIfReady(label, text);
  if (rec.status !== 'pending') return rec;
  spawnSync('sleep', [String(CONFIRM_MS / 1000)]);
  return confirmDelivery(rec);
}

// Broadcast one reply (or key) to every managed window at once. Text broadcasts fire into every
// ready window first, then settle ONCE before confirming — so the result carries a per-window
// breakdown the cockpit renders as status chips, without the count that used to lie (tmux exit 0 ≠
// Claude accepted the prompt) and without an O(n) stack of confirm delays. Key broadcasts
// (interrupt/panic) are intentional control signals and fire into every pane regardless of stage.
function sayAll(payload) {
  payload = payload || {};
  const ws = listManaged();
  let results;
  if (payload.key) {
    results = ws.map((w) => { const r = key(w.label, payload.key); return { ok: r.ok, label: w.label, status: r.ok ? 'sent' : 'error', error: r.error }; });
  } else {
    results = ws.map((w) => sendIfReady(w.label, payload.text || ''));   // fire all — no per-window wait
    if (results.some((r) => r.status === 'pending')) {
      spawnSync('sleep', [String(CONFIRM_MS / 1000)]);                   // settle ONCE for the whole batch
      results = results.map(confirmDelivery);
    }
  }
  const started = results.filter((r) => r.status === 'started' || r.status === 'sent').length;
  const skipped = results.filter((r) => r.status === 'skipped' || r.status === 'gone').length;
  // `sent` kept for backward-compat (old toast / adapter): it now means "actually delivered".
  return { ok: true, sent: started, started, skipped, total: ws.length, results };
}

// Send a short reply (literal text + Enter). Reply text is passed as an arg, never shelled.
function say(label, text) {
  if (!hasTmux()) return { ok: false, error: 'tmux not installed' };
  const name = sanitize(label);
  if (!windowAlive(name)) return { ok: false, error: `no live managed window "${name}"` };
  tmux(['send-keys', '-t', target(name), '-l', '--', String(text)]);
  const r = tmux(['send-keys', '-t', target(name), 'Enter']);
  return r.code === 0 ? { ok: true, sent: text, label: name } : { ok: false, error: r.err };
}

// Send a named key (Escape, C-c, etc.) — for "stop"/interrupt.
function key(label, k) {
  if (!hasTmux()) return { ok: false, error: 'tmux not installed' };
  const name = sanitize(label);
  if (!windowAlive(name)) return { ok: false, error: `no live managed window "${name}"` };
  const r = tmux(['send-keys', '-t', target(name), k]);
  return r.code === 0 ? { ok: true, sent: k, label: name } : { ok: false, error: r.err };
}

// Bring a managed window's terminal to the front (macOS) — into ONE reusable viewer window.
// Every click reuses the same "conductor-view" terminal and just switches it to the session you
// clicked, instead of spawning a fresh Terminal window each time (which piled up "every CLI
// window" and was confusing). It's a grouped tmux session that shares conductor's windows but
// has its own pinned current window, with the status bar OFF so you see just that one session —
// no multiplexer chrome. We track the viewer terminal by its tty so we can raise that exact
// window (not just bring the app forward), and open a new one only when no viewer exists yet.
function openTerminal(label) {
  if (process.platform !== 'darwin') return { ok: false, error: 'open-in-terminal is macOS only (use: conductor attach ' + sanitize(label) + ')' };
  const name = sanitize(label);
  if (!windowAlive(name)) return { ok: false, error: 'no live managed window "' + name + '"' };
  const view = SESSION + '-view';                            // ONE shared viewer, reused for every card
  if (tmux(['has-session', '-t', view]).code !== 0) {
    tmux(['new-session', '-d', '-s', view, '-t', SESSION]);  // grouped: shares conductor's windows
  }
  tmux(['set', '-t', view, 'status', 'off']);                // no tmux status bar / window list
  tmux(['select-window', '-t', view + ':' + name]);          // point the viewer at this session
  const tty = (tmux(['list-clients', '-t', view, '-F', '#{client_tty}']).out || '').split('\n')[0].trim();
  // Already open → raise that exact Terminal window (matched by tty) and let it re-render.
  // Not open yet → open the single viewer attached to it.
  const script = tty
    ? 'tell application "Terminal"\nactivate\nrepeat with w in windows\ntry\nif tty of selected tab of w is "' + tty + '" then set index of w to 1\nend try\nend repeat\nend tell'
    : 'tell application "Terminal" to activate\ntell application "Terminal" to do script "tmux attach -t ' + view + '"';
  const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  return r.status === 0 ? { ok: true, label: name, attached: !!tty, view } : { ok: false, error: (r.stderr || '').trim() || 'osascript failed' };
}

function attachCommand(label) {
  const name = sanitize(label);
  return `tmux attach -t ${SESSION} \\; select-window -t ${name}`;
}

// Non-blocking: drive a freshly launched/adopted window from boot to "ready", accepting each
// startup menu along the way (folder-trust AND the resume picker that large, recently-active
// forks show), then deliver the reply once the prompt box is actually up. Polls up to ~60s
// (forks load a lot of history) and delivers the text exactly once. Shared by the web cockpit
// and the MCP control tools so both drive adopted windows identically.
function deliverAdopted(label, text) {
  const deadline = Date.now() + 60000;
  let delivered = false, resumeAnswered = false;
  (function tick() {
    if (Date.now() > deadline) return;
    try {
      const stage = paneStage(label);
      if (stage === 'gone') return;
      if (stage === 'trust') { answerTrust(label); return setTimeout(tick, 700); }
      if (stage === 'resume') {                       // pick "full session as-is" once, then let it clear
        if (!resumeAnswered) { resumeAnswered = true; resumeFull(label); }
        return setTimeout(tick, 1000);
      }
      if (stage === 'ready') {
        if (text && text.trim() && !delivered) { delivered = true; say(label, text); }
        return;                                       // done
      }
      return setTimeout(tick, 700);                   // busy / still loading
    } catch { /* ignore */ }
  })();
}

function stop(label) {
  const name = sanitize(label);
  const r = tmux(['kill-window', '-t', target(name)]);
  const reg = loadReg();
  delete reg.windows[name];
  saveReg(reg);
  return { ok: r.code === 0, label: name };
}

// Late-bind a window's sessionId: claude only writes a transcript once you send the first
// prompt (not at launch / trust prompt), so run()'s capture often misses it.
//
// BUG-1 fix: a swarm launches N windows into ONE cwd at ~one instant. The old code bound every
// missing sessionId to the *newest* .jsonl in that cwd, so all N windows collapsed onto a single
// transcript — the board could then only group/control one of them. Now we (a) skip transcripts
// already claimed by another registry entry, and (b) pick the OLDEST qualifying transcript (the
// one created nearest this window's launch) rather than the newest. Resolving windows in launch
// order (see listManaged) lets earlier windows claim their earlier transcripts first, so N
// windows map to N distinct sessions.
function resolveSession(w, claimed) {
  if (w.sessionId) return w.sessionId;
  try {
    const dir = folderFor(w.cwd);
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ id: f.replace(/\.jsonl$/, ''), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.m >= (w.created || 0) - 1500)
      .filter((x) => !claimed || !claimed.has(x.id))
      .sort((a, b) => a.m - b.m);
    if (files.length) return files[0].id;
  } catch { /* ignore */ }
  return null;
}

// All managed windows, with liveness. Prunes dead ones; late-binds missing sessionIds.
function listManaged() {
  const reg = loadReg();
  const out = [];
  let changed = false;
  // Resolve in launch order, tracking already-bound sessionIds, so a same-cwd swarm never
  // collapses N windows onto one transcript (BUG-1).
  const names = Object.keys(reg.windows).sort((a, b) => (reg.windows[a].created || 0) - (reg.windows[b].created || 0));
  const claimed = new Set();
  for (const name of names) { const sid = reg.windows[name].sessionId; if (sid) claimed.add(sid); }
  for (const name of names) {
    const w = reg.windows[name];
    if (!windowAlive(name)) { delete reg.windows[name]; changed = true; continue; }
    if (!w.sessionId) { const sid = resolveSession(w, claimed); if (sid) { w.sessionId = sid; claimed.add(sid); changed = true; } }
    out.push({ ...w, alive: true });
  }
  if (changed) saveReg(reg);
  return out;
}

// sessionId -> managed window, for the cockpit to flag/control the right card.
function managedBySession() {
  const map = {};
  for (const w of listManaged()) {
    if (w.sessionId) map[w.sessionId] = w;
    if (w.adoptedFrom) map[w.adoptedFrom] = w; // flag the ORIGINAL (clicked) card as managed too
  }
  return map;
}

module.exports = { run, adopt, uniqueLabel, say, deliver, sayAll, key, stop, openTerminal, listManaged, managedBySession, attachCommand, trustPromptShowing, paneStage, resumeFull, answerTrust, deliverAdopted, sanitize, windowAlive, tailLines, resolveSession, hasTmux, SESSION, REG_FILE };
