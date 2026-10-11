'use strict';
// Fixture tests. No network. Run: node conductor3/leadx/test.js
const fs = require('fs'), os = require('os'), path = require('path');
const { extractEmails } = require('./extract'), guard = require('./guard'), filters = require('./filters');
const { runLeadx } = require('./run'), { verifyDir } = require('./verify'), cli = require('./cli');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.error('  ✗ ' + m)); };
const L = (rows) => filters.buildList(rows), C = (rows) => filters.buildContacts(rows);

console.log('\nextract');
{
  const html = '<p>Press: <a href="mailto:Ann.Lee@firm.com">Ann Lee</a>. Sales: bob@firm.com. Jo: jo [at] firm [dot] com. <img src="logo@2x.png"> x@example.com</p>';
  const e = extractEmails(html); const m = Object.fromEntries(e.map((x) => [x.email, x]));
  ok(m['ann.lee@firm.com'] && m['ann.lee@firm.com'].kind === 'mailto' && m['ann.lee@firm.com'].name === 'Ann Lee', 'mailto link extracted, name from link text');
  ok(m['bob@firm.com'] && m['bob@firm.com'].quote.includes('bob@firm.com'), 'plain address extracted with on-page quote');
  ok(m['jo@firm.com'] && m['jo@firm.com'].kind === 'obfuscated', 'obfuscation counted only because the page shows it that way');
  ok(!m['logo@2x.png'] && !m['x@example.com'], 'image names and placeholder domains are not leads');
  ok(extractEmails('<p>Our CEO is Ann Lee. Reach the team at our contact form.</p>').length === 0, 'names alone never produce an address (no pattern guessing)');
}
console.log('\nguard');
{
  ok(guard.isBlockedHost('https://www.linkedin.com/in/x') && guard.isBlockedHost('https://uk.linkedin.com/company/y'), 'linkedin blocked, subdomains too');
  ok(guard.isBlockedHost('https://hunter.io/') && !guard.isBlockedHost('https://firm.com'), 'people-data blocked, firm site allowed');
  const rules = guard.parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok');
  ok(!guard.robotsAllows(rules, '/private/x') && guard.robotsAllows(rules, '/private/ok/a') && guard.robotsAllows(rules, '/contact'), 'robots: longest match wins');
}

const PAGES = {
  'https://good.com/robots.txt': { status: 404, text: '' },
  'https://good.com/': { status: 200, text: '<a href="/contact">Contact</a> <a href="https://www.linkedin.com/company/good">LI</a>' },
  'https://good.com/contact': { status: 200, text: 'Write to <a href="mailto:pat@good.com">Pat</a> or info@good.com or old@contacted-firm.org' },
  'https://known.com/robots.txt': { status: 404, text: '' },
  'https://known.com/': { status: 200, text: 'hi sam@known.com' },
  'https://other.com/robots.txt': { status: 404, text: '' },
  'https://other.com/': { status: 200, text: 'write lane2@other.com' },
  'https://tokyo.example.net/robots.txt': { status: 404, text: '' },
  'https://tokyo.example.net/': { status: 200, text: 'Our Tokyo office: t@tokyo.example.net' },
  'https://closed.com/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /' },
  'https://suppressed.com/': { status: 200, text: 'a@suppressed.com' },
  'https://jp.co.jp/': { status: 200, text: 'a@jp.co.jp' },
};
let fetched = [];
const fetchFn = async (u) => { fetched.push(u); return PAGES[u] || { status: 404, text: '' }; };
const lane = { name: 'deadstock', excludeTlds: ['.jp'], excludeTerms: ['Tokyo', 'Japan'] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leadx-'));

(async () => {
  console.log('\npipeline');
  const contacts = C([{ email: 'old@somewhere.com', lane: 'job' }, { email: 'x@known.com', lane: 'advisory' }, { email: 'me@gmail.com', lane: 'job' }]);
  const suppression = L([{ domain: 'suppressed.com', reason: 'opt-out' }]);
  const out = tmp();
  const r = await runLeadx({ targets: ['good.com', 'https://www.known.com', 'tokyo.example.net', 'closed.com', 'suppressed.com', 'jp.co.jp', 'good.com', 'www.linkedin.com'], lane, contacts, suppression, exclusions: L([]), fetchFn, outDir: out, now: () => new Date('2026-10-11T12:00:00Z') });
  const emails = r.leads.map((l) => l.email).sort();
  ok(JSON.stringify(emails) === JSON.stringify(['info@good.com', 'old@contacted-firm.org', 'pat@good.com']), 'only published, new, allowed addresses kept: ' + emails.join(','));
  ok(r.stats.dropped['already-contacted-firm'] === 1 && r.stats.skipped['region-term'] === 1 && r.stats.skipped['region-tld'] === 1 && r.stats.skipped['blocked-host'] === 1 && r.stats.skipped['suppressed-domain'] === 1, 'region, linkedin and suppressed domains skipped and counted');
  ok(!fetched.some((u) => /linkedin|jp\.co\.jp|suppressed\.com/.test(u)), 'blocked/suppressed/region-TLD hosts never fetched');
  ok(!fetched.some((u) => u.startsWith('https://closed.com/') && !u.endsWith('robots.txt')), 'robots.txt Disallow: / honored');
  ok(r.leads.every((l) => l.source_url.startsWith('https://') && l.quote.includes(l.raw)), 'every lead has source_url + on-page quote');
  const info = r.leads.find((l) => l.email === 'info@good.com'), off = r.leads.find((l) => l.email === 'old@contacted-firm.org');
  ok(info.flags.includes('generic-role') && off.flags.includes('offdomain'), 'generic-role and offdomain flagged for review');
  ok(fs.existsSync(path.join(out, 'REPORT.md')) && /## Lead batch/.test(fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8')), 'REPORT.md written with required sections');

  console.log('\ncross-lane overlap');
  const known = await runLeadx({ targets: ['known.com'], lane, contacts, suppression: L([]), exclusions: L([]), fetchFn });
  ok(known.leads.length === 0 && known.stats.dropped['already-contacted-firm'] === 1, 'firm contacted in another lane is excluded everywhere (even a different address)');
  const gm = C([{ email: 'me@gmail.com', lane: 'job' }]);
  ok(!gm.domains.has('gmail.com'), 'a freemail contact does not exclude the whole provider');
  const sp = C([{ email: 'a@t-online.de', domain: 't-online.de', lane: 'deadstock' }, { email: 'b@gmail.com', domain: 'gmail.com', lane: 'deadstock' }]);
  ok(!sp.domains.has('t-online.de') && !sp.domains.has('gmail.com') && sp.emails.has('a@t-online.de'), 'shared providers listed in the domain column lock the exact address only, never the provider');
  const sup = L([{ email: 'x@outlook.com', domain: 'outlook.com', reason: 'bounced' }]);
  ok(!sup.domains.has('outlook.com') && sup.emails.has('x@outlook.com'), 'a suppression row for a shared provider suppresses the address, not the provider');
  // claims: a first lane run claims its leads; a second lane cannot pick the same firm
  const dir = tmp(), claims = path.join(dir, 'claims.csv'), ledger = path.join(dir, 'contacts.csv');
  fs.writeFileSync(ledger, 'email,domain,lane,source\nold@somewhere.com,somewhere.com,job,sent\n');
  const o1 = path.join(dir, 'a');
  const run1 = await runLeadx({ targets: ['other.com'], lane: { name: 'advisory' }, contacts: C(filters.parseCsv(fs.readFileSync(ledger, 'utf8'))), suppression: L([]), exclusions: L([]), fetchFn, outDir: o1 });
  fs.writeFileSync(claims, 'email,domain,lane,source,run\n' + run1.leads.map((l) => `${l.email},${l.firm_domain},${l.lane},leadx-candidate,${run1.runId}`).join('\n') + '\n');
  ok(verifyDir(o1, { contactsCsv: ledger, claimsCsv: claims }).length === 0, 'verify passes: a run\'s own claims are not counted as overlap');
  const rows = filters.parseCsv(fs.readFileSync(ledger, 'utf8')).concat(filters.parseCsv(fs.readFileSync(claims, 'utf8')));
  const run2 = await runLeadx({ targets: ['other.com'], lane: { name: 'deadstock' }, contacts: C(rows), suppression: L([]), exclusions: L([]), fetchFn });
  ok(run2.leads.length === 0 && Object.keys(run2.stats.dropped).some((k) => /already-contacted/.test(k)), 'second lane cannot take an address or firm the first lane claimed');

  console.log('\nverify (mechanical checks)');
  const bad = tmp(); fs.writeFileSync(path.join(bad, 'leads.jsonl'), JSON.stringify({ email: 'guess@firm.com', firm_domain: 'firm.com', lane: 'x', source_url: 'https://firm.com/', quote: 'Our team: Ann Lee', raw: 'guess@firm.com', status: 'candidate' }) + '\n');
  const le = path.join(dir, 'l.csv'); fs.writeFileSync(le, 'email,domain,lane\n');
  ok(verifyDir(bad, { contactsCsv: le }).some((e) => /quote does not contain/.test(e)), 'a guessed address with no on-page quote fails verify');
  const lk = tmp(); fs.writeFileSync(path.join(lk, 'leads.jsonl'), JSON.stringify({ email: 'sam@known.com', firm_domain: 'known.com', lane: 'x', source_url: 'https://known.com/', quote: 'hi sam@known.com', raw: 'sam@known.com', status: 'candidate' }) + '\n');
  const kl = path.join(dir, 'k.csv'); fs.writeFileSync(kl, 'email,domain,lane\nx@known.com,known.com,advisory\n');
  ok(verifyDir(lk, { contactsCsv: kl }).some((e) => /firm already contacted/.test(e)), 'cross-lane overlap fails verify');
  ok(verifyDir(lk, {}).some((e) => /contacts ledger missing/.test(e)), 'verify without a contacts ledger fails (no vacuous pass)');
  ok(verifyDir(out, { contactsCsv: le, suppressionCsv: (() => { const f = path.join(dir, 's.csv'); fs.writeFileSync(f, 'domain,reason\ngood.com,opt-out\n'); return f; })() }).some((e) => /suppressed/.test(e)), 'a suppressed lead fails verify');

  console.log('\ncli safety');
  const sink = console.error; console.error = () => {};
  ok(await cli.main(['run', '--lane', 'x', '--targets', 'y', '--contacts', ledger, '--out', tmp()]) === 2, 'run refuses without --live');
  ok(await cli.main(['run', '--live', '--lane', 'x', '--targets', 'y', '--out', tmp()]) === 2, 'run refuses without a contacts ledger');
  console.error = sink;
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
