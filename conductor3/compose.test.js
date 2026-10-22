'use strict';
// node conductor3/compose.test.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const C = require('./compose'), Q = require('./queue/queue');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'c3-compose-')); }
function item(dir, over = {}) {
  const base = { lane: 'advisory', title: 'Findings on the Berlin studio', kind: 'draft', detail: 'Solid detail with evidence and a next step. next: send the teaser sheet.' };
  const it = Q.add(dir, { ...base, ...over });
  Q.update(dir, it.id, { status: 'drafted' });
  return Q.load(dir).items.find((i) => i.id === it.id);
}

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok -', name); }

t('briefing when no email in evidence, recipient null', () => {
  const dir = tmp(); item(dir);
  const done = C.tick(dir);
  assert.strictEqual(done.length, 1); assert.strictEqual(done[0].type, 'briefing');
  const it = Q.load(dir).items[0];
  assert.strictEqual(it.draft.type, 'briefing'); assert.strictEqual(it.draft.recipient, null);
  assert.match(it.draft.body, /no recipient identified/);
});

t('message when an email is in the detail, recipient marked UNVERIFIED', () => {
  const dir = tmp(); item(dir, { detail: 'Karl replied; his address is karl@example.com and the teaser is ready. next: send it.' });
  const it = Q.load(dir).items[0]; C.tick(dir);
  const d = Q.load(dir).items[0].draft;
  assert.strictEqual(d.type, 'message'); assert.strictEqual(d.recipient, 'karl@example.com');
  assert.strictEqual(d.recipientVerified, false); // extraction never verifies provenance
  assert.match(d.body, /^Hi,/);
  assert.match(d.body, /UNVERIFIED/);
});

t('no extracted recipient is ever marked verified', () => {
  const dir = tmp(); item(dir, { detail: 'Reach karl@example.com or sam@example.org, both from an old thread.' });
  C.tick(dir);
  const d = Q.load(dir).items[0].draft;
  assert.strictEqual(d.recipientVerified, false);
  assert.match(d.body, /confirm it is the published, current address/);
});

t('never pattern-guesses a recipient from a name alone', () => {
  const dir = tmp(); item(dir, { detail: 'Karl Hughes is interested in the studio; no address on file yet.' });
  C.tick(dir);
  assert.strictEqual(Q.load(dir).items[0].draft.type, 'briefing');
});

t('subject comes from the title, capped at 72 chars', () => {
  const dir = tmp(); item(dir, { title: 'x'.repeat(100) });
  C.tick(dir);
  assert.strictEqual(Q.load(dir).items[0].draft.subject.length, 72);
});

t('body carries the next step and the first source URL', () => {
  const dir = tmp(); item(dir, { detail: 'Numbers checked. See https://example.com/listing - next: call the broker Friday.' });
  C.tick(dir);
  const b = Q.load(dir).items[0].draft.body;
  assert.match(b, /Next step: call the broker Friday\./); assert.match(b, /Source: https:\/\/example\.com\/listing/);
});

t('honesty footer is always present', () => {
  const dir = tmp(); item(dir);
  C.tick(dir);
  assert.match(Q.load(dir).items[0].draft.body, /nothing has been sent/i);
});

t('gated kinds are never composed', () => {
  const dir = tmp();
  for (const kind of ['send', 'money', 'commitment']) { const it = Q.add(dir, { lane: 'a', title: kind + ' item', kind, detail: 'detail with karl@example.com' }); Q.update(dir, it.id, { status: 'drafted' }); }
  assert.strictEqual(C.tick(dir).length, 0);
  assert.ok(Q.load(dir).items.every((i) => !i.draft));
});

t('queued (not yet drafted) items are left alone', () => {
  const dir = tmp(); Q.add(dir, { lane: 'a', title: 'still queued', kind: 'draft', detail: 'some detail here' });
  assert.strictEqual(C.tick(dir).length, 0);
});

t('idempotent: unchanged item is not recomposed', () => {
  const dir = tmp(); item(dir);
  assert.strictEqual(C.tick(dir).length, 1);
  assert.strictEqual(C.tick(dir).length, 0);
});

t('recomposes when the detail changes', () => {
  const dir = tmp(); const it = item(dir);
  C.tick(dir);
  Q.update(dir, it.id, { detail: 'Updated findings, new evidence. next: re-review.' });
  assert.strictEqual(C.tick(dir).length, 1);
  assert.match(Q.load(dir).items[0].draft.body, /Updated findings/);
});

t('folds drop-folder workpad text into evidence (recipient from artifact)', () => {
  const dir = tmp(); const it = item(dir, { detail: 'Teaser sheet drafted for the buyer.' });
  fs.mkdirSync(path.join(dir, 'drop'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'drop', it.id + '.md'), 'Buyer confirmed at buyer@example.org');
  C.tick(dir);
  assert.strictEqual(Q.load(dir).items[0].draft.recipient, 'buyer@example.org');
});

t('CLI composes and prints one line per item', () => {
  const dir = tmp(); item(dir);
  const { execFileSync } = require('child_process');
  const out = execFileSync('node', [path.join(__dirname, 'compose.js'), dir], { encoding: 'utf8' });
  assert.match(out, /composed briefing/);
});

console.log(`\n${n} passed, 0 failed`);
