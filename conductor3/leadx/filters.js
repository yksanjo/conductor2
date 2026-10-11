'use strict';
// Filters in a fixed order. Each returns a reason string when a lead must be dropped, else null.

const GENERIC_ROLES = ['info', 'hello', 'contact', 'office', 'team', 'press', 'sales', 'support', 'admin', 'mail', 'enquiries', 'inquiries'];
// Shared mailbox providers are NOT firms: never lock or suppress the whole domain, dedupe by exact address only.
const FREEMAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 't-online.de', 'web.de', 'gmx.de', 'gmx.net', 'gmx.com', 'mail.com', 'yandex.com', 'qq.com', '163.com'];

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

// Lists accept an `email` and/or `domain` column (suppression, exclusions, contacts).
function buildList(rows) {
  const emails = new Map(), domains = new Map();
  for (const r of rows) {
    if (r.email) emails.set(r.email.toLowerCase(), r.reason || r.source || '');
    if (r.domain && !FREEMAIL.includes(r.domain.toLowerCase().replace(/^www\./, ''))) domains.set(r.domain.toLowerCase().replace(/^www\./, ''), r.reason || r.source || '');
  }
  return { emails, domains };
}
// Contacts ledger: one list for ALL lanes. A contacted address excludes that address everywhere; a contacted
// firm (the address's domain, unless it is a freemail provider) excludes the whole firm everywhere.
function buildContacts(rows) {
  const list = buildList(rows);
  for (const r of rows) {
    if (!r.email) continue; const d = r.email.toLowerCase().split('@')[1];
    if (d && !FREEMAIL.includes(d)) list.domains.set(d.replace(/^www\./, ''), r.lane || r.source || 'contact');
  }
  return list;
}
function inDomains(list, domain) { for (const d of list.domains.keys()) if (domain === d || domain.endsWith('.' + d)) return d; return null; }

function classify(email, firmDomain) {
  const [local, dom] = email.split('@'); const flags = [];
  if (GENERIC_ROLES.includes(local)) flags.push('generic-role');
  if (FREEMAIL.includes(dom)) flags.push('freemail');
  else if (!(dom === firmDomain || dom.endsWith('.' + firmDomain) || firmDomain.endsWith('.' + dom))) flags.push('offdomain');
  return flags;
}

function dropReason(lead, { contacts, suppression, exclusions, seen }) {
  const dom = lead.email.split('@')[1];
  if (suppression.emails.has(lead.email)) return 'suppressed-email';
  if (inDomains(suppression, dom) || inDomains(suppression, lead.firm_domain)) return 'suppressed-domain';
  if (exclusions.emails.has(lead.email) || inDomains(exclusions, dom) || inDomains(exclusions, lead.firm_domain)) return 'excluded-list';
  if (contacts.emails.has(lead.email)) return 'already-contacted-address';
  if ((!FREEMAIL.includes(dom) && inDomains(contacts, dom)) || inDomains(contacts, lead.firm_domain)) return 'already-contacted-firm';
  if (seen.has(lead.email)) return 'duplicate-in-batch';
  return null;
}

module.exports = { parseCsv, buildList, buildContacts, inDomains, classify, dropReason, GENERIC_ROLES, FREEMAIL };
