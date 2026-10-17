'use strict';
// Standing rules as code. Fail closed: anything unknown, missing or malformed means "needs a human".
//  - No sends as Yoshi during quiet hours (21:00-08:00 in his timezone).
//  - Money and new commitments always need his approval.
//  - Sends need his approval too. Nothing here executes anything; "ready" only means an executor may pick it up.
//  - An approval counts only if it was recorded by the dashboard from his authenticated click.
//    Messages, pings, agent output and anything else cannot create one.
const TZ = process.env.C3_TZ || 'America/New_York';
function hourIn(now, tz = TZ) { const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now); return Number(h) % 24; }
function quietHours(now, tz) { const h = hourIn(now, tz); return h >= 21 || h < 8; }
function validApproval(item) {
  const a = item && item.approval;
  return !!(a && a.source === 'dashboard-click' && typeof a.at === 'string' && !isNaN(Date.parse(a.at)) && Date.parse(a.at) >= Date.parse(item.createdAt) && a.decision === 'approved');
}
// Returns { action, reason }. action in: draft | park-approval | hold-quiet-hours | ready | reject
function decide(item, now = new Date(), tz) {
  if (!item || typeof item.kind !== 'string') return { action: 'park-approval', reason: 'malformed item, fail closed' };
  if (item.approval && item.approval.decision === 'rejected' && item.approval.source === 'dashboard-click') return { action: 'reject', reason: 'rejected by user' };
  if (item.kind === 'draft') return { action: 'draft', reason: 'drafting needs no approval' };
  if (!['send', 'money', 'commitment'].includes(item.kind)) return { action: 'park-approval', reason: 'unknown kind, fail closed' };
  if (!validApproval(item)) return { action: 'park-approval', reason: item.kind + ' needs your approval from the dashboard' };
  if (item.kind === 'send' && quietHours(now, tz)) return { action: 'hold-quiet-hours', reason: 'approved, but sends as you wait until 8am' };
  return { action: 'ready', reason: 'approved by you in the dashboard' };
}
module.exports = { decide, quietHours, validApproval, hourIn };
