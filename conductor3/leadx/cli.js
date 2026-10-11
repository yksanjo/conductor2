#!/usr/bin/env node
'use strict';
// leadx: extract published email addresses for outreach lanes. Never sends. Never guesses addresses.
//   node conductor3/leadx/cli.js run --lane lane.json --targets domains.txt --contacts ledger.csv [--claims claims.csv] [--suppression s.csv] [--exclusions e.csv] [--watchlist w.csv] --out dir --live
//   node conductor3/leadx/cli.js verify --out dir --contacts ledger.csv [--claims claims.csv] [--suppression s.csv] [--exclusions e.csv]
// Network access requires --live. Without it, run refuses: nothing touches the web by accident.
const fs = require('fs'), path = require('path');
const { runLeadx } = require('./run'), { verifyDir } = require('./verify'), filters = require('./filters');

const UA = 'conductor3-leadx/0.1 (+https://github.com/yksanjo/conductor2)';
function arg(a, k) { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; }
function contactsFrom(files) { const rows = []; for (const f of files) if (f && fs.existsSync(f)) rows.push(...filters.parseCsv(fs.readFileSync(f, 'utf8'))); return filters.buildContacts(rows); }
function list(f) { return f ? filters.buildList(filters.parseCsv(fs.readFileSync(f, 'utf8'))) : filters.buildList([]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function liveFetch() {
  let last = 0;
  return async (url) => {
    const wait = 1500 - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try { const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: ctl.signal }); const ct = r.headers.get('content-type') || '';
      return { status: r.status, text: /text|html|xml/.test(ct) || url.endsWith('robots.txt') ? await r.text() : '', finalUrl: r.url };
    } finally { clearTimeout(t); }
  };
}

async function main(argv) {
  const [cmd, ...a] = argv;
  if (cmd === 'verify') {
    const errs = verifyDir(arg(a, 'out'), { contactsCsv: arg(a, 'contacts'), claimsCsv: arg(a, 'claims'), suppressionCsv: arg(a, 'suppression'), exclusionsCsv: arg(a, 'exclusions') });
    if (errs.length) { console.error('verify FAILED:\n - ' + errs.join('\n - ')); return 1; }
    console.log('verify ok'); return 0;
  }
  if (cmd === 'run') {
    if (!a.includes('--live')) { console.error('refusing to run: pass --live to allow network fetches (approved lane lists only)'); return 2; }
    if (!arg(a, 'contacts') || !fs.existsSync(arg(a, 'contacts'))) { console.error('refusing to run: --contacts <ledger.csv> is required (one shared ledger across all lanes, so nothing is contacted twice)'); return 2; }
    const lane = JSON.parse(fs.readFileSync(arg(a, 'lane'), 'utf8'));
    const targets = fs.readFileSync(arg(a, 'targets'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    const { stats, leads, runId } = await runLeadx({ targets, lane, contacts: contactsFrom([arg(a, 'contacts'), arg(a, 'claims')]), suppression: list(arg(a, 'suppression')), exclusions: list(arg(a, 'exclusions')), watchlist: arg(a, 'watchlist') ? filters.buildWatchlist(filters.parseCsv(fs.readFileSync(arg(a, 'watchlist'), 'utf8'))) : [], fetchFn: liveFetch(), outDir: arg(a, 'out') });
    // Claim every candidate so a parallel or later lane run cannot pick the same address or firm.
    if (arg(a, 'claims')) { const f = arg(a, 'claims'); const rows = leads.map((l) => `${l.email},${l.firm_domain},${l.lane},leadx-candidate,${runId}`); if (!fs.existsSync(f)) fs.writeFileSync(f, 'email,domain,lane,source,run\n'); if (rows.length) fs.appendFileSync(f, rows.join('\n') + '\n'); }
    console.log(JSON.stringify(stats, null, 2)); return 0;
  }
  console.error('usage: leadx run|verify (see header of cli.js)'); return 2;
}
if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c));
module.exports = { main };
