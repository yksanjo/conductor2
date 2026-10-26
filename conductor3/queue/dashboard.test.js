'use strict';
// Iteration 7: complete draft viewing on the dashboard (read-only, nothing sent).
const fs = require('fs'), os = require('os'), path = require('path');
const { page, summary } = require('./dashboard'), Q = require('./queue');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'c3db-'));
const mk = (items) => { const d = tmp(); Q.save(d, { items, lastTick: new Date().toISOString() }); return page(summary(d), 'tok'); };

// complete message draft: subject, full multi-line body, recipient with UNVERIFIED status
const h1 = mk([{ id: 'q-1', lane: 'jobs', title: 'T1', kind: 'draft', status: 'drafted',
  draft: { type: 'message', recipient: 'dana@acme.com', recipientVerified: false, subject: 'Follow up with Acme recruiter', body: 'Hi,\n\nFirst line.\nSecond line.\n\n--\nDrafted overnight' } }]);
ok(h1.includes('Follow up with Acme recruiter') && h1.includes('First line.\nSecond line.'), 'full multi-line draft body rendered');
ok(h1.includes('dana@acme.com') && h1.includes('UNVERIFIED'), 'recipient shown with UNVERIFIED status');
ok(h1.includes('Drafts to review (1)'), 'drafts section header with count');

// briefing draft: explicit no-recipient wording
const h2 = mk([{ id: 'q-2', lane: 'finance', title: 'T2', kind: 'draft', status: 'drafted',
  draft: { type: 'briefing', recipient: null, recipientVerified: false, subject: 'Weekly numbers', body: 'Body text' } }]);
ok(h2.includes('no recipient identified, nothing to send'), 'briefing says no recipient, nothing to send');

// HTML injection in a draft body is escaped
const h3 = mk([{ id: 'q-3', lane: 'x', title: 'T3', kind: 'draft', status: 'drafted',
  draft: { type: 'message', recipient: 'a@b.co', recipientVerified: false, subject: 'S3', body: 'x <script>alert(1)</script> <b>bold</b>' } }]);
ok(!h3.includes('<script>alert(1)</script> <b>bold</b>') && h3.includes('&lt;script&gt;'), 'draft body HTML-escaped');

// no drafts -> no section
const h4 = mk([{ id: 'q-4', lane: 'x', title: 'T4', kind: 'draft', status: 'queued' }]);
ok(!h4.includes('Drafts to review'), 'no drafts, no section');

// no approve/reject affordance inside the drafts section
const draftPart = h1.split('Drafts to review')[1] || '';
ok(!/Approve|Reject/.test(draftPart.split('Everything else')[0] || ''), 'drafts section has no approve/reject buttons (read-only)');

// gated items keep their approve buttons (not broken by the change)
const h5 = mk([{ id: 'q-5', lane: 'x', title: 'T5', kind: 'send', status: 'needs-approval' }]);
ok(h5.includes('Approve') && h5.includes('Reject'), 'gated approve/reject buttons still present');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
