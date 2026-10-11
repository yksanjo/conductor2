'use strict';
const fs = require('fs'), path = require('path');
const guard = require('./guard'), { extractEmails, toText } = require('./extract'), filters = require('./filters');

const LIMITS = { maxDomains: 200, maxPagesPerDomain: 5 };
const CANDIDATE_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/team', '/imprint', '/impressum', '/legal'];
const LINK_HINT = /(contact|about|team|people|imprint|impressum|legal|press)/i;

function normDomain(d) { return String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''); }

function candidateLinks(html, base, firmDomain) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(m[1], base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || guard.isBlockedHost(u.href) || !guard.sameSite(u.href, firmDomain)) continue;
    if (LINK_HINT.test(u.pathname)) out.push(u.origin + u.pathname);
  }
  return out;
}

async function crawlDomain(domain, lane, fetchFn, maxPages) {
  const base = `https://${domain}`; const res = { pages: [], skipped: null, leads: [] };
  if (guard.isBlockedHost(base)) { res.skipped = 'blocked-host'; return res; }
  if (lane.excludeTlds && lane.excludeTlds.some((t) => domain.endsWith(t))) { res.skipped = 'region-tld'; return res; }
  let rules = [];
  try { const r = await fetchFn(base + '/robots.txt'); if (r.status === 200) rules = guard.parseRobots(r.text); } catch { /* no robots: allowed */ }
  const queue = [base + '/']; const seen = new Set(); let home = null;
  while (queue.length && res.pages.length < maxPages) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
    if (guard.isBlockedHost(url) || !guard.sameSite(url, domain)) continue;
    if (!guard.robotsAllows(rules, new URL(url).pathname)) { res.robotsBlocked = (res.robotsBlocked || 0) + 1; continue; }
    let r; try { r = await fetchFn(url); } catch { continue; }
    if (r.finalUrl && (guard.isBlockedHost(r.finalUrl) || !guard.sameSite(r.finalUrl, domain))) continue;
    if (r.status !== 200 || !r.text) { if (url === base + '/' && !res.pages.length) res.skipped = `http-${r.status || 'error'}`; continue; }
    res.skipped = null; res.pages.push(url);
    const text = toText(r.text);
    const hit = (lane.excludeTerms || []).find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (hit) { res.pages = []; res.leads = []; res.skipped = `region-term:${hit}`; return res; }
    for (const e of extractEmails(r.text)) res.leads.push({ ...e, source_url: url });
    if (!home) { home = r.text; for (const p of [...candidateLinks(home, url, domain), ...CANDIDATE_PATHS.map((p) => base + p)]) queue.push(p); }
  }
  return res;
}

async function runLeadx({ targets, lane, contacts, suppression, exclusions, fetchFn, now = () => new Date(), outDir }) {
  const domains = [...new Set(targets.map(normDomain).filter(Boolean))];
  const capped = domains.slice(0, LIMITS.maxDomains);
  const stats = { targets: domains.length, over_cap: Math.max(0, domains.length - capped.length), fetched_domains: 0, pages: 0, extracted: 0, kept: 0, dropped: {}, skipped: {}, robots_blocked_pages: 0 };
  const runId = `${lane.name}-${now().toISOString().replace(/[-:.]/g, '')}-${require('crypto').randomBytes(3).toString('hex')}`;
  const leads = [], seen = new Set();
  for (const domain of capped) {
    if (filters.inDomains(suppression, domain)) { stats.skipped['suppressed-domain'] = (stats.skipped['suppressed-domain'] || 0) + 1; continue; }
    const r = await crawlDomain(domain, lane, fetchFn, LIMITS.maxPagesPerDomain);
    stats.robots_blocked_pages += r.robotsBlocked || 0;
    if (r.skipped) { const k = r.skipped.replace(/^region-term:.*/, 'region-term'); stats.skipped[k] = (stats.skipped[k] || 0) + 1; continue; }
    stats.fetched_domains++; stats.pages += r.pages.length;
    for (const e of r.leads) {
      stats.extracted++;
      const lead = { email: e.email, name: e.name || null, firm_domain: domain, lane: lane.name, source_url: e.source_url, quote: e.quote, raw: e.raw, kind: e.kind, flags: filters.classify(e.email, domain), fetched_at: now().toISOString(), status: 'candidate', run_id: runId };
      const why = filters.dropReason(lead, { contacts, suppression, exclusions, seen });
      if (why) { stats.dropped[why] = (stats.dropped[why] || 0) + 1; continue; }
      seen.add(lead.email); leads.push(lead); stats.kept++;
    }
  }
  if (outDir) writeOutputs(outDir, leads, stats, lane, now());
  return { leads, stats, runId };
}

function writeOutputs(outDir, leads, stats, lane, when) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'leads.jsonl'), leads.map((l) => JSON.stringify(l)).join('\n') + (leads.length ? '\n' : ''));
  const kv = (o) => Object.keys(o).length ? Object.entries(o).map(([k, v]) => `- ${k}: ${v}`).join('\n') : '- none';
  const flagged = leads.filter((l) => l.flags.length).length;
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), [
    `# leadx report: ${lane.name}`, '', `Run at ${when.toISOString()}. Candidates only. Nothing was sent.`, '',
    '## Summary', `- target domains: ${stats.targets} (over the ${LIMITS.maxDomains}/night cap, not processed: ${stats.over_cap})`,
    `- domains fetched: ${stats.fetched_domains}, pages read: ${stats.pages}`, `- addresses found on pages: ${stats.extracted}`, `- kept as candidates: ${stats.kept} (${flagged} carry a review flag)`, '',
    '## Lead batch', `${stats.kept} candidates in leads.jsonl. Each has source_url and the exact on-page quote. Review before any outreach.`, '',
    '## Dropped', kv(stats.dropped), '', '## Skipped sites', kv(stats.skipped), `- pages blocked by robots.txt: ${stats.robots_blocked_pages}`, '',
  ].join('\n'));
}

module.exports = { runLeadx, LIMITS, normDomain };
