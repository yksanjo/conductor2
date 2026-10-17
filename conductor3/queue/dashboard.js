'use strict';
// Local dashboard. Plain Node http, no deps, binds 127.0.0.1 only. Never sends anything.
// Approve/Reject need the session token printed at startup (open the URL it prints). Only this path can create an approval.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const Q = require('./queue'), P = require('./policy'), { fp } = require('./executor');
let ROSTER = []; try { ROSTER = require('../overseer/personas').ROSTER; } catch {}
const pName = (id) => { const p = ROSTER.find((r) => r.id === id); return p ? p.name : id; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDER = ['needs-approval', 'ready', 'held-quiet-hours', 'queued', 'claimed', 'drafted', 'approved', 'rejected'];
function summary(dir, now = new Date()) {
  const q = Q.load(dir), by = {}; for (const i of q.items) (by[i.status] = by[i.status] || []).push(i);
  return { dir, lastTick: q.lastTick, quiet: P.quietHours(now), counts: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])), waiting: by['needs-approval'] || [], items: q.items, now: now.toISOString() };
}
function ago(iso, now) { if (!iso) return 'never'; const m = Math.round((now - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 90 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; }
function page(s, token, now = new Date()) {
  const ov = (i) => {
    if (!i.overseer) return '';
    const o = i.overseer;
    let h = `<div class=n>${esc(pName(o.by))} (${esc(o.verdict)}): ${esc(o.note || '')}</div>`;
    if (o.questions) h += `<div class=n>asked: ${o.questions.map((x) => esc(x.question)).join(' ')}</div>`;
    if (i.worker && i.worker.stuck && i.worker.stuck.length) h += `<div class="n warn-inline">worker stuck: ${i.worker.stuck.map(esc).join('; ')}</div>`;
    return h;
  };
  const row = (i, btn) => `<tr><td>${esc(i.lane)}</td><td>${esc(i.title)}${i.note ? `<div class=n>${esc(i.note)}</div>` : ''}${ov(i)}</td><td>${esc(i.kind)}</td><td>${btn ? `<button onclick="act('${esc(i.id)}','approve')">Approve</button> <button class=no onclick="act('${esc(i.id)}','reject')">Reject</button>` : esc(i.status)}</td></tr>`;
  const stale = !s.lastTick || now - new Date(s.lastTick) > 30 * 60000;
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Conductor3</title><style>
body{font:15px -apple-system,system-ui,sans-serif;margin:24px;max-width:860px;color:#111}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px}
.bar{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.c{border:1px solid #ddd;border-radius:8px;padding:8px 12px;min-width:90px}.c b{display:block;font-size:22px}
.warn{background:#fff3cd;padding:8px 12px;border-radius:8px}.ok{background:#e7f6ea;padding:8px 12px;border-radius:8px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eee;padding:6px 8px;text-align:left;vertical-align:top}
.n{color:#666;font-size:12px}.warn-inline{color:#8a6d00}button{padding:5px 12px;border-radius:6px;border:1px solid #2a7;background:#2a7;color:#fff;cursor:pointer}button.no{background:#fff;color:#a22;border-color:#a22}</style>
<h1>Conductor3</h1><div class="${stale ? 'warn' : 'ok'}">Last tick: <b>${esc(ago(s.lastTick, now))}</b>${stale ? ' (stale: nothing is running the queue)' : ''} &middot; ${s.quiet ? 'Quiet hours: nothing is sent as you until 8am' : 'Daytime'} &middot; Nothing here sends anything</div>
<div class=bar>${ORDER.filter((k) => s.counts[k]).map((k) => `<div class=c><b>${s.counts[k]}</b>${esc(k)}</div>`).join('') || '<div class=c>queue empty</div>'}</div>
<h2>Waiting on you (${s.waiting.length})</h2>${s.waiting.length ? `<table><tr><th>Lane</th><th>Item</th><th>Kind</th><th></th></tr>${s.waiting.map((i) => row(i, true)).join('')}</table>` : '<p>Nothing waiting.</p>'}
<h2>Everything else</h2><table><tr><th>Lane</th><th>Item</th><th>Kind</th><th>Status</th></tr>${s.items.filter((i) => i.status !== 'needs-approval').sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((i) => row(i, false)).join('')}</table>
${overseerSection(s.dir)}
<script>const T=new URLSearchParams(location.search).get('t')||'';async function act(id,a){const r=await fetch('/api/'+a+'/'+id,{method:'POST',headers:{'x-token':T}});if(!r.ok){alert('Not allowed: open the dashboard with the URL printed at startup');return}location.reload()}</script>`;
}
function overseerSection(dir) {
  let st; try { st = JSON.parse(fs.readFileSync(path.join(dir, 'overseers.json'), 'utf8')); } catch { return ''; }
  const rows = Object.entries(st.overseers || {});
  if (!rows.length) return '';
  const li = rows.map(([pid, ps]) => `<tr><td>${esc(pName(pid))}</td><td>${ps.reviewed}</td><td>${ps.endorsed}</td><td>${ps.returned}</td><td>${ps.annotated}</td><td>${ps.deferred}</td><td>${Math.round(ps.energy * 100)}%</td></tr>`).join('');
  return `<h2>Overseers (simulated - they never approve)</h2><table><tr><th>Who</th><th>Reviewed</th><th>Endorsed</th><th>Returned</th><th>Annotated</th><th>Deferred</th><th>Energy</th></tr>${li}</table>`;
}
function serve(dir, { port = 8787, now = () => new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true }); const token = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(path.join(dir, '.token'), token, { mode: 0o600 });
  const srv = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0]; if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(403); return res.end('forbidden'); }
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page(summary(dir, now()), token, now())); }
    if (req.method === 'GET' && u.pathname === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(summary(dir, now()))); }
    const m = u.pathname.match(/^\/api\/(approve|reject)\/(q-[0-9a-f]+)$/);
    if (req.method === 'POST' && m) {
      const ok = req.headers['x-token'] === token && (!req.headers.origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin));
      if (!ok) { res.writeHead(403); return res.end('forbidden'); }
      const it = Q.load(dir).items.find((i) => i.id === m[2]); if (!it || it.status !== 'needs-approval') { res.writeHead(409); return res.end('not waiting for approval'); }
      const approved = m[1] === 'approve';
      Q.update(dir, it.id, { approval: { source: 'dashboard-click', decision: approved ? 'approved' : 'rejected', at: now().toISOString(), contentHash: fp(it) }, status: approved ? 'approved' : 'rejected' });
      res.writeHead(200); return res.end('ok');
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, token, port: srv.address().port })));
}
module.exports = { serve, summary, page };
if (require.main === module) { const dir = process.argv[2]; if (!dir) { console.error('usage: dashboard.js <dir> [port]'); process.exit(2); } serve(dir, { port: Number(process.argv[3]) || 8787 }).then(({ token, port }) => console.log(`Open: http://127.0.0.1:${port}/?t=${token}`)); }
