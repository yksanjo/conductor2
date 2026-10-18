#!/bin/bash
# conductor3 night shift. Research and extraction only. Never sends, posts or pays.
set -uo pipefail
H="${C3_HOME:-$HOME/conductor3}"; . "$H/config.env"
R="$H/repo/conductor3"; D=$(date +%Y-%m-%d); RUN="$H/runs/$D-$(date +%H%M%S)-$$"; LOG="$H/logs/$D.log"
mkdir -p "$RUN" "$H/logs"; echo "run $RUN cap=\$$DAILY_CAP_USD" >> "$LOG"
# 1. hard spend cap (spend.js exits 3 at or over the cap, and when the cap is missing/invalid)
if ! node "$R/spend.js" check "$H/logs" "$DAILY_CAP_USD" >> "$LOG" 2>&1; then echo "cap reached or invalid, stopping" >> "$LOG"; node "$R/inbox.js" "$H/runs" > "$H/inbox.md"; exit 0; fi
# 2. shared ledger is mandatory
L="$H/ledger"; [ -f "$L/contacts.csv" ] || { echo "no ledger contacts.csv: refusing" >> "$LOG"; exit 1; }
[ -f "$H/targets.txt" ] && [ -f "$H/lane.json" ] || { echo "no targets.txt/lane.json: nothing to do" >> "$LOG"; node "$R/inbox.js" "$H/runs" > "$H/inbox.md"; exit 0; }
a=(); v=(); for k in suppression exclusions watchlist; do if [ -f "$L/$k.csv" ]; then a+=(--$k "$L/$k.csv"); [ $k != watchlist ] && v+=(--$k "$L/$k.csv"); fi; done
timeout "${MAX_RUN_MINUTES:-45}m" node "$R/leadx/cli.js" run --live --lane "$H/lane.json" --targets "$H/targets.txt" --contacts "$L/contacts.csv" --claims "$RUN/claims.csv" "${a[@]}" --out "$RUN" >> "$LOG" 2>&1; rc=$?
# 3. mechanical verify, then write run.json so the morning inbox can see it
if [ $rc -eq 0 ] && node "$R/leadx/cli.js" verify --out "$RUN" --contacts "$L/contacts.csv" --claims "$RUN/claims.csv" "${v[@]}" >> "$LOG" 2>&1; then st=verified; note="leadx output verified; leads await your review, nothing sent"; else st=failed; note="leadx or verify failed (exit $rc), see $LOG"; fi
node -e 'const [d,s,n]=process.argv.slice(1);const id=require("path").basename(d);require("fs").writeFileSync(d+"/run.json",JSON.stringify({runId:id,mission:"lead-extraction-nightly",state:s,history:[{state:s,note:n}]}))' "$RUN" "$st" "$note"
node "$R/inbox.js" "$H/runs" > "$H/inbox.md"; echo "$st: $RUN" >> "$LOG"
# 4. file the run into the overseer queue so the morning shift report includes it
node "$R/autofile.js" "$H/queue" "$H/runs" >> "$LOG" 2>&1 || echo "autofile failed (non-fatal)" >> "$LOG"
