'use strict';
// Extract ONLY addresses literally published on a page. There is no code path that builds an address
// from a name plus a domain pattern. Every result carries the raw on-page text it came from.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const OBFUSCATED = /([A-Za-z0-9._%+-]+)\s*(?:\[at\]|\(at\))\s*([A-Za-z0-9-]+(?:\s*(?:\[dot\]|\(dot\))\s*[A-Za-z0-9-]+)+)/gi;
const JUNK_DOMAINS = ['example.com', 'example.org', 'domain.com', 'email.com', 'sentry.io', 'wixpress.com', 'sentry.wixpress.com'];
const JUNK_SUFFIX = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&commat;/g, '@').replace(/&period;/g, '.').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}
function toText(html) {
  return decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
function ok(email) {
  const e = email.toLowerCase(); const dom = e.split('@')[1];
  return !JUNK_SUFFIX.test(e) && !JUNK_DOMAINS.some((d) => dom === d || dom.endsWith('.' + d));
}
function quoteAround(text, raw) {
  const i = text.indexOf(raw); if (i < 0) return raw;
  return text.slice(Math.max(0, i - 60), Math.min(text.length, i + raw.length + 60)).trim();
}

// -> [{ email, raw, quote, kind: 'mailto'|'text'|'obfuscated', name? }]
function extractEmails(html) {
  const found = new Map(); const text = toText(html);
  const add = (email, raw, kind, name) => {
    email = email.toLowerCase(); if (!ok(email) || found.has(email)) return;
    found.set(email, { email, raw, quote: quoteAround(text, raw), kind, ...(name ? { name } : {}) });
  };
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const addr = decodeEntities(decodeURIComponent(m[1])).trim(); const label = toText(m[2]).trim();
    if (EMAIL.test(addr)) { EMAIL.lastIndex = 0; add(addr, addr, 'mailto', label && !label.includes('@') && label.length < 60 ? label : undefined); }
    EMAIL.lastIndex = 0;
  }
  for (const m of text.matchAll(EMAIL)) add(m[0], m[0], 'text');
  for (const m of text.matchAll(OBFUSCATED)) {
    const dom = m[2].replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, '.'); add(`${m[1]}@${dom}`, m[0], 'obfuscated');
  }
  return [...found.values()];
}

module.exports = { extractEmails, toText };
