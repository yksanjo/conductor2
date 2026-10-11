'use strict';
// Fetch-layer guards. These are code, not prompts: a blocked host cannot be fetched.

const BLOCKED_HOSTS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com',
  'zoominfo.com', 'apollo.io', 'rocketreach.co', 'hunter.io', 'lusha.com', 'signalhire.com', 'contactout.com',
];

function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function hostMatches(host, domain) { return host === domain || host.endsWith('.' + domain); }
function isBlockedHost(url) { const h = hostOf(url); return !!h && BLOCKED_HOSTS.some((d) => hostMatches(h, d)); }
function sameSite(url, firmDomain) { const h = hostOf(url); return !!h && hostMatches(h, firmDomain); }

// Minimal robots.txt: User-agent "*" group, longest matching Allow/Disallow wins. Empty Disallow = allow.
function parseRobots(text) {
  const rules = []; let applies = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') applies = v === '*';
    else if (applies && (k === 'allow' || k === 'disallow') && v) rules.push({ allow: k === 'allow', path: v });
  }
  return rules;
}
function robotsAllows(rules, pathname) {
  let best = null;
  for (const r of rules) if (pathname.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
  return !best || best.allow;
}

module.exports = { BLOCKED_HOSTS, hostOf, isBlockedHost, sameSite, parseRobots, robotsAllows };
