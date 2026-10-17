'use strict';
// Mechanical proof that the no-guessing and exclusion rules held. Exit 1 on any violation.
const fs = require('fs'), path = require('path');
const { extractEmails } = require('./extract'), filters = require('./filters'), guard = require('./guard');

function loadList(file) { return file && fs.existsSync(file) ? filters.buildList(filters.parseCsv(fs.readFileSync(file, 'utf8'))) : { emails: new Map(), domains: new Map() }; }

function loadContacts(files, ownRuns = new Set()) {
  const rows = []; for (const f of files) if (f && fs.existsSync(f)) rows.push(...filters.parseCsv(fs.readFileSync(f, 'utf8')).filter((r) => !(r.run && ownRuns.has(r.run))));
  return filters.buildContacts(rows);
}

// The contacts ledger is mandatory: verifying without it would pass vacuously, so it is an error.
function verifyDir(dir, { contactsCsv, claimsCsv, suppressionCsv, exclusionsCsv } = {}) {
  const errs = [];
  if (!contactsCsv || !fs.existsSync(contactsCsv)) return ['contacts ledger missing: cross-lane overlap cannot be checked'];
  const file = path.join(dir, 'leads.jsonl');
  if (!fs.existsSync(file)) return ['leads.jsonl missing'];
  const leads = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const contacts = loadContacts([contactsCsv, claimsCsv], new Set(leads.map((l) => l.run_id).filter(Boolean))), supp = loadList(suppressionCsv), excl = loadList(exclusionsCsv);
  const seen = new Set();
  leads.forEach((l, i) => {
    const at = `lead ${i + 1} (${l.email})`;
    if (!/^https?:\/\//.test(l.source_url || '')) errs.push(`${at}: no source_url`);
    else if (guard.isBlockedHost(l.source_url)) errs.push(`${at}: source on blocked host`);
    if (!l.quote || !l.raw || !l.quote.includes(l.raw)) errs.push(`${at}: quote does not contain the raw on-page text`);
    else if (!extractEmails(`<p>${l.quote}</p>`).some((e) => e.email === l.email)) errs.push(`${at}: email is not recoverable from the quoted page text (possible guessed address)`);
    if (seen.has(l.email)) errs.push(`${at}: duplicate`); seen.add(l.email);
    const dom = l.email.split('@')[1];
    if (supp.emails.has(l.email) || filters.inDomains(supp, dom) || filters.inDomains(supp, l.firm_domain)) errs.push(`${at}: suppressed`);
    if (excl.emails.has(l.email) || filters.inDomains(excl, dom) || filters.inDomains(excl, l.firm_domain)) errs.push(`${at}: on exclusion list`);
    if (contacts.emails.has(l.email)) errs.push(`${at}: address already contacted or claimed in another lane`);
    if ((!filters.FREEMAIL.includes(dom) && filters.inDomains(contacts, dom)) || filters.inDomains(contacts, l.firm_domain)) errs.push(`${at}: firm already contacted or claimed in another lane`);
    if (l.status !== 'candidate') errs.push(`${at}: status must be candidate`);
  });
  return errs;
}
module.exports = { verifyDir };
