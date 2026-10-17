'use strict';
// Morning decision inbox: reads every run.json under a runs dir and renders one markdown page.
// Read-only. It never sends, publishes or pays; it only tells the human what needs a decision.
const fs = require('fs'), path = require('path');
const ORDER = { 'needs-input': 0, failed: 1, verified: 2 };
const LABEL = { 'needs-input': 'Needs your input', failed: 'Failed', verified: 'Ready for review' };
function load(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const out = [];
  for (const d of fs.readdirSync(runsDir)) {
    const f = path.join(runsDir, d, 'run.json'); if (!fs.existsSync(f)) continue;
    try { out.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { out.push({ runId: d, state: 'failed', history: [{ note: 'unreadable run.json' }] }); }
  }
  return out;
}
function render(runs) {
  const open = runs.filter((r) => r.state in ORDER).sort((a, b) => ORDER[a.state] - ORDER[b.state] || String(a.runId).localeCompare(String(b.runId)));
  const quiet = runs.length - open.length;
  const L = [`# Morning decision inbox`, '', `${open.length} item(s) need you. ${quiet} run(s) still in progress or done with nothing to decide. Nothing was sent, published or paid.`, ''];
  for (const r of open) {
    const h = r.history && r.history[r.history.length - 1]; const note = h && (h.note || h.detail) || '';
    L.push(`- **${LABEL[r.state]}**: ${r.mission || r.runId} (${r.runId})${note ? ' - ' + note : ''}`);
  }
  return L.join('\n') + '\n';
}
module.exports = { load, render };
if (require.main === module) { const dir = process.argv[2]; if (!dir) { console.error('usage: inbox.js <runsDir>'); process.exit(2); } process.stdout.write(render(load(dir))); }
