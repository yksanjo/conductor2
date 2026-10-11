# Mission spec: relationship-ops-nightly (draft)

## Proposal for Instinct
Direction from the repo owner: build this for Instinct. Instinct's value is an assistant that handles things for a person. The harder question is what an agent layer needs once it serves tens of thousands of people, each with their own contacts, threads and commitments, and still never embarrasses any of them. This spec is a proposal for that layer, written as a conductor3 mission so it can be built and tested in the open before anything touches a real user.

What the proposal argues, from outside the product (it describes needs, not Instinct's internals, which this repo has no view of):
- Scale is a memory and state problem before it is a model problem. Per-person records, one action ledger and explicit sequence state are what keep thousands of parallel conversations coherent.
- Trust is the product. Opt-outs, approval gates and an audit trail are not features to add later; they decide whether anyone lets an agent speak for them. Default is draft and ask.
- Volume comes from orchestration. Shard the base, run slices as separate verified runs, escalate only decisions that are genuinely a human's.
- Honest measurement. Reply rates per segment and variant feed the next batch, and "no edge" is a valid result.
Reading for the Instinct team: the ten rows below are the checklist; the "What exists vs what's spec" section says how far this repo is from any of it (not far, yet).

The relationship-at-scale brain for conductor3. One standing mission that keeps tens of thousands of conversations organized overnight and hands you a short approval batch in the morning. Example file: `conductor3/missions/relationship-ops-nightly.json` (validates today with the iteration-1 validator).

Status: **spec only.** Nothing here sends, schedules, or stores anything yet. See "What exists vs what's spec" at the bottom.

## The rule that shapes everything
The night mission **reads, classifies, researches and drafts. It never sends, publishes, edits suppression, or contacts anyone.** Every outbound message is a draft in an approval batch. A separate gated executor (not built) is the only thing allowed to send, and only items approved in the decision inbox. The validator already refuses `send`/`publish`/`pay`/`delete`/`deploy` in `allowedOps`.

## Ten capabilities, where each lives
| # | Capability | Where it lives | Night mission does |
|---|---|---|---|
| 1 | Memory per person | Contact ledger (`contacts.jsonl`), append-only events per person: who, source, every touch, stated preferences, consent status | Reads the record, proposes updates as events in "Record updates". Does not overwrite history. |
| 2 | Identity resolution | Contact ledger keys: normalized email, phone, handles | Flags probable duplicates as merge proposals with evidence. Merges are approved, not automatic. |
| 3 | Inbound triage | Triage worker | Classifies each new reply: interested, not-now (with return date), question, objection, referral, angry, opt-out, auto-reply, unclear. Low-confidence goes to a human bucket. |
| 4 | Personalization at write time | Draft worker | Writes each draft from that person's record and the campaign brief. No merge-field templates. Cites which record facts it used. |
| 5 | Follow-up state machines | Sequence rules in `campaign-config` | Computes who is due (e.g. no reply after N days, stop on reply, dead after M touches) and proposes the next step. Rules are data, not prompts. |
| 6 | Rate limits + deliverability | Executor policy (not the mission) | Respects daily caps and per-domain limits when sizing the batch; reports bounces and suppression hits. Never edits the list. |
| 7 | Approval gates | Decision inbox | Every draft is an inbox item with evidence. Confidence thresholds decide whether an item can be batch-approved or needs individual review. |
| 8 | Queue infra | conductor3 scheduler + durable queue (not built) | The mission shards the contact base into slices, one swarm run per slice, so volume is parallel runs, not one giant agent loop. |
| 9 | Human handoff | Inbox item type `handoff` | Warm cases (interested, angry, high-value) get a one-page file: history, last message, suggested reply, why it escalated. |
| 10 | Feedback loop | Metrics section + action ledger | Reports reply rate by segment and message variant from the previous batches so the next night's drafts can change. |

## Hard constraints (checked, not hoped for)
- **Opt-out is absolute.** Any person marked opted-out, bounced, or on the suppression list is excluded from every batch. The report lists exclusion counts. An opt-out detected in a new reply is recorded as an event and removes the person from drafts the same run.
- **One ledger.** Before drafting, the worker checks the action ledger so no person gets two messages from two missions in the same window.
- **No invented facts.** Personalization may only use facts present in the person's record or a cited source. Drafts list those facts.
- **Approval state is explicit.** Drafts carry `status: pending`. Nothing moves to `approved` except through the inbox.

## Crew shape (hierarchical, size 5)
- `orc`: slices the work, merges worker outputs, writes `REPORT.md`.
- `triage`: classifies inbound.
- `records`: proposes record updates and merge candidates.
- `planner`: runs the sequence rules and picks who is due.
- `writer`: drafts messages for the due set.

## Deliverable: `REPORT.md`
Required sections (already enforced by the sections verifier): Summary, Triage results, Record updates, Proposed follow-ups, Drafts for approval, Holds and exclusions, Metrics. Drafts live in a sibling `batch.jsonl` for the executor.

## Verifier (next iteration; today only section presence is checked)
Planned checks, all mechanical: every draft references an existing contact id; no draft targets a suppressed/opted-out/bounced contact; no contact appears twice in a batch; every draft has `status: pending`; batch size is within the configured cap; every personalization fact cited exists in the contact record. A failure retries once, then goes to the inbox as failed.

## What exists vs what's spec
- Exists: mission file validates; gated ops are refused; run states and unique run IDs; runner loop with injected launcher; section check.
- Spec only: contact/action ledgers, suppression handling, triage taxonomy, sequence rules format, batch format, relationship verifier, sharding, executor, rate limiting, handoff items, metrics.

## Open questions
1. Ledger storage: JSONL files first, SQLite once volume needs queries?
2. Where do inbound replies come from (mail export, API connector)? Needs the connector layer, which doesn't exist.
3. Consent and jurisdiction rules differ by channel and country. The spec keeps opt-out absolute and leaves any further policy to the operator's config; it does not encode legal advice.
4. Confidence thresholds for batch approval: start conservative, human-review everything, loosen with measured accuracy.
