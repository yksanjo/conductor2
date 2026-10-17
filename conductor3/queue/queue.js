'use strict';
// File-backed task queue. One JSON file, atomic writes, lease-based claiming (two loops cannot take one item).
// Statuses: queued -> claimed -> drafted | needs-approval ; needs-approval -> approved | rejected ; approved -> ready | held-quiet-hours
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const KINDS = ['draft', 'send', 'money', 'commitment'];
function file(dir) { return path.join(dir, 'queue.json'); }
function load(dir) { try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return { items: [], lastTick: null }; } }
function save(dir, q) { fs.mkdirSync(dir, { recursive: true }); const t = file(dir) + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(q, null, 2)); fs.renameSync(t, file(dir)); }
function add(dir, { lane, title, kind = 'draft', detail = '' }, now = new Date()) {
  if (!KINDS.includes(kind)) throw new Error('unknown kind: ' + kind);
  if (!title) throw new Error('title required');
  const q = load(dir); const item = { id: 'q-' + crypto.randomBytes(4).toString('hex'), lane: lane || 'general', title, kind, detail, status: 'queued', createdAt: now.toISOString() };
  q.items.push(item); save(dir, q); return item;
}
function claim(dir, owner, now = new Date(), leaseMs = 10 * 60 * 1000) {
  const q = load(dir);
  const it = q.items.find((i) => i.status === 'queued' || (i.status === 'claimed' && new Date(i.leaseUntil) < now));
  if (!it) return null;
  it.status = 'claimed'; it.owner = owner; it.leaseUntil = new Date(now.getTime() + leaseMs).toISOString(); save(dir, q); return it;
}
function update(dir, id, patch) { const q = load(dir); const it = q.items.find((i) => i.id === id); if (!it) throw new Error('no such item ' + id); Object.assign(it, patch); save(dir, q); return it; }
function setLastTick(dir, at) { const q = load(dir); q.lastTick = at.toISOString(); save(dir, q); }
module.exports = { add, claim, update, load, save, setLastTick, KINDS };
