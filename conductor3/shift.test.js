'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('./queue/queue'), { shift } = require('./shift');
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3s-'));
const T = new Date('2026-10-18T12:00:00Z');

const d = tmp();
fs.mkdirSync(path.join(d, 'drop'));
const good = Q.add(d, { lane: 'research', title: 'solid brief', kind: 'draft', detail: 'Findings with a link: https://example.com/a and a clear next step for the morning.' }, T);
const thin = Q.add(d, { lane: 'research', title: 'thin brief', kind: 'draft', detail: 'too short' }, T);
fs.writeFileSync(path.join(d, 'drop', thin.id + '.md'), 'The actual findings, long enough to matter, with a source: https://example.com/b');
const gated = Q.add(d, { lane: 'job', title: 'send follow-up', kind: 'send', detail: 'To: jane@example.com - the follow-up paragraph we discussed, one page.' }, T);

const r = shift(d, { now: T, restHours: 9 });
const items = Q.load(d).items;
const byId = (id) => items.find((i) => i.id === id);
ok(byId(good.id).status === 'drafted' && byId(good.id).overseer.verdict === 'endorsed', 'good draft: ticked, reviewed, endorsed');
ok(/More from the workpad/.test(byId(thin.id).detail) && byId(thin.id).overseer.verdict === 'endorsed', 'thin draft: returned, reworked from workpad, endorsed after rest');
ok(byId(gated.id).status === 'needs-approval' && byId(gated.id).overseer.verdict === 'annotated' && !byId(gated.id).approval, 'gated send: annotated, still gated, no approval written');
ok(r.reviewed.length >= 2 && r.reworked.length === 1, 'shift returns the action counts');
ok(/# Overseer shift report/.test(r.report) && /Endorsed - ready to use/.test(r.report), 'report rendered');
const out = path.join(d, 'report.md'); fs.writeFileSync(out, r.report);
ok(fs.readFileSync(out, 'utf8') === r.report, 'report file writable');
ok(shift(d, { now: new Date(T.getTime() + 9 * 36e5) }).reviewed.length === 0, 'second shift is a no-op on a settled queue');

ok(byId(good.id).draft && byId(good.id).draft.type === 'briefing' && /nothing has been sent/i.test(byId(good.id).draft.body), 'shift composes real drafts before review');
ok(byId(gated.id).draft === undefined, 'gated send item is never composed');
ok(/## Drafts composed - review before any use, nothing sent/.test(r.report) && r.report.includes('**solid brief** [briefing]'), 'report lists composed drafts');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
