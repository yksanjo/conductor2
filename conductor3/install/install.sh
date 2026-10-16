#!/bin/bash
# conductor3 night-shift installer for macOS (also runs on Linux, minus the launchd step).
# Nothing here sends, posts or pays. Default is install + dry run. Scheduling needs --enable.
#   bash install.sh [--cap USD] [--hour 22] [--enable] [--ledger-dir DIR] [--branch NAME]
set -euo pipefail
CAP=""; HOUR=22; ENABLE=0; LEDGER_SRC=""; BRANCH="conductor3/leadx"
while [ $# -gt 0 ]; do case "$1" in
  --cap) CAP="$2"; shift 2;; --hour) HOUR="$2"; shift 2;; --enable) ENABLE=1; shift;;
  --ledger-dir) LEDGER_SRC="$2"; shift 2;; --branch) BRANCH="$2"; shift 2;;
  *) echo "unknown option $1"; exit 2;; esac; done
[ -n "$CAP" ] || { echo "Set a daily spend cap: --cap 5 (USD). Refusing without one."; exit 2; }
case "$CAP" in ''|*[!0-9.]*) echo "--cap must be a number"; exit 2;; esac
command -v git >/dev/null || { echo "git missing (macOS: xcode-select --install)"; exit 1; }
command -v node >/dev/null || { echo "node 18+ missing (macOS: brew install node)"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "node 18+ required"; exit 1; }
H="${C3_HOME:-$HOME/conductor3}"
mkdir -p "$H/ledger" "$H/runs" "$H/logs"; chmod 700 "$H/ledger"
if [ -d "$H/repo/.git" ]; then git -C "$H/repo" fetch -q origin "$BRANCH" && git -C "$H/repo" checkout -q "$BRANCH" && git -C "$H/repo" pull -q --ff-only origin "$BRANCH"
else git clone -q --branch "$BRANCH" https://github.com/yksanjo/conductor2.git "$H/repo"; fi
if [ -n "$LEDGER_SRC" ]; then cp "$LEDGER_SRC"/*.csv "$H/ledger"/ 2>/dev/null || true; chmod 600 "$H/ledger"/*.csv 2>/dev/null || true; fi
cat > "$H/config.env" <<CFG
DAILY_CAP_USD=$CAP
MAX_RUN_MINUTES=45
NIGHT_HOUR=$HOUR
CFG
cp "$H/repo/conductor3/install/nightly.sh" "$H/nightly.sh"; chmod +x "$H/nightly.sh"   # one source of truth: the tested script in the repo
mkdir -p "$H/queue" "$H/drop"
printf '%s\n' '#!/bin/bash' '# one queue tick, one log line. Never sends.' 'H="${C3_HOME:-$HOME/conductor3}"' 'node "$H/repo/conductor3/queue/cli.js" tick "$H/queue" >> "$H/logs/tick.log" 2>&1' 'node "$H/repo/conductor3/queue/cli.js" drop "$H/queue" "$H/drop" >> "$H/logs/tick.log" 2>&1' > "$H/tick.sh"; chmod +x "$H/tick.sh"
echo "== dry check =="; node "$H/repo/conductor3/leadx/cli.js" run 2>&1 | head -1 || true
(cd "$H/repo" && for t in conductor3/leadx/test.js conductor3/test.js conductor3/inbox-spend.test.js conductor3/queue/queue.test.js conductor3/queue/cli.test.js; do node "$t" >/dev/null 2>&1 && echo "tests ok: $t" || echo "TESTS FAILED: $t"; done)
if [ "$ENABLE" = 1 ] && [ "$(uname)" = Darwin ]; then
  P="$HOME/Library/LaunchAgents/com.conductor3.night.plist"
  cat > "$P" <<PL
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><Label>com.conductor3.night</Label>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$H/nightly.sh</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>0</integer></dict>
<key>StandardErrorPath</key><string>$H/logs/launchd.err</string></dict></plist>
PL
  launchctl unload "$P" 2>/dev/null || true; launchctl load "$P"
  P2="$HOME/Library/LaunchAgents/com.conductor3.tick.plist"
  cat > "$P2" <<PL
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.conductor3.tick</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$H/tick.sh</string></array>
<key>StartInterval</key><integer>600</integer>
<key>StandardErrorPath</key><string>$H/logs/launchd-tick.err</string></dict></plist>
PL
  launchctl unload "$P2" 2>/dev/null || true; launchctl load "$P2"; echo "queue tick every 10 min (never sends; approvals only via the dashboard)"; echo "scheduled nightly at $HOUR:00 (macOS sleeps: use Energy settings or 'caffeinate' to keep it awake)"
else echo "installed, NOT scheduled. Re-run with --enable to schedule."; fi
echo "dashboard (local only): node $H/repo/conductor3/queue/dashboard.js $H/queue  -> open the URL it prints"
echo "home: $H  | uninstall: launchctl unload ~/Library/LaunchAgents/com.conductor3.night.plist; rm -rf $H"
