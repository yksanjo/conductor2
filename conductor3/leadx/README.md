# leadx: published-email lead extraction (draft)

Pulls email addresses that are **literally published** on a target firm's own site, for outreach lanes. It produces candidates for batch review. It never sends, never guesses an address, and never touches LinkedIn.

Status: fixture-tested only (`node conductor3/leadx/test.js`, no network). Not run live. `run` refuses to touch the network without `--live`, and refuses to run without a contacts ledger.

## Rules, and where each is enforced
| Rule | Enforcement |
|---|---|
| Only published addresses | `extract.js` reads mailto links and on-page text. No code builds an address from a name and a domain pattern. `[at]`/`(dot)` forms count only because the page shows them that way. |
| Proof per lead | Every lead keeps `source_url`, the exact `raw` text, and a `quote` around it. `verify` re-extracts the address from the quote; a lead it can't recover fails. |
| No LinkedIn / people-data sites | `guard.js` blocks the hosts (social networks, zoominfo, apollo, hunter, etc.) in the fetch layer, including redirects and followed links. |
| Firm's own site only | Pages are fetched only on the target domain; same-site links only. |
| Region exclusion | Lane config: `excludeTlds` (e.g. `[".jp"]`) and `excludeTerms` (e.g. `["Tokyo","Japan"]`). A page naming an excluded term drops the whole domain. |
| Opt-out | `suppression.csv`: exact address or whole domain. Suppressed domains are not even fetched. |
| Never contact twice, across lanes | One contacts ledger for every lane. A contacted address excludes that address; a contacted firm (the domain of any contacted address, except freemail providers) excludes the whole firm, in every lane. `verify` fails the run on any overlap, and fails if no ledger is given. |
| No parallel overlap | After a run, candidates are appended to `claims.csv` (with a run id), so another lane's run can't pick the same address or firm before outreach happens. |
| Politeness | robots.txt honored, 1.5s between requests, identifying user agent, 200 domains/night, 5 pages/domain. |
| Never sends | Leads are `status: candidate`. The mission grants no send op. |

## File formats (CSV, header row required, lowercase)
- `contacts.csv` (the shared ledger): `email,domain,lane,source`. Either column may be blank per row. Every outreach loop exports what it has contacted into this one file.
- `suppression.csv`: `email,domain,reason`.
- `exclusions.csv` (e.g. circles to avoid, music-tech): `email,domain,reason`.
- `claims.csv`: written by leadx: `email,domain,lane,source,run`.
- `lane.json`: `{ "name": "deadstock", "excludeTlds": [".jp"], "excludeTerms": ["Tokyo", "Japan"] }`
- `targets.txt`: one domain or URL per line, `#` comments allowed.

## Commands
```
node conductor3/leadx/cli.js run --live --lane lane.json --targets targets.txt \
  --contacts ledger/contacts.csv --claims ledger/claims.csv \
  --suppression ledger/suppression.csv --exclusions ledger/exclusions.csv --out out/
node conductor3/leadx/cli.js verify --out out/ --contacts ledger/contacts.csv --claims ledger/claims.csv \
  --suppression ledger/suppression.csv --exclusions ledger/exclusions.csv
```
Outputs: `leads.jsonl` and `REPORT.md` (counts of fetched, extracted, kept, dropped by reason, skipped sites).

## Known limits
- Static HTML only. JavaScript-rendered pages and contact forms yield nothing; they're skipped silently except for the counts.
- Generic role inboxes (info@, sales@) are kept but flagged `generic-role`; addresses on other domains are flagged `offdomain`; freemail addresses are flagged `freemail`. Review the flags.
- Overlap protection is only as complete as the ledger: it is exactly as good as what outreach loops export into `contacts.csv`.
- Region detection is a term/TLD match, not geolocation.
- Legal rules on cold email differ by country; this tool enforces opt-out and region exclusion, not legal compliance.
