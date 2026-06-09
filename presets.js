'use strict';

// Conductor V2 presets — premade swarm setups for lazy fire-off.
//
// A preset is a complete launch config: topology, crew size, per-slot role hints, and a
// purpose template. Fire one as-is, or load it into the launch pad and edit the purpose
// before firing. Placeholders like <TOPIC> are deliberately loud — the UI highlights them
// so a swarm never launches against a literal placeholder by accident (the server warns,
// it doesn't block: sometimes the template alone is exactly what you want).

const PRESETS = {
  'deep-research': {
    key: 'deep-research',
    emoji: '🔬',
    title: 'Deep Research',
    topology: 'hierarchical',
    agents: 5, // orc + 4 researchers
    desc: 'Orchestrator splits a research question across 4 researchers (landscape, evidence, counter-evidence, numbers), then synthesizes one cited report.',
    purpose: `Deep research: <TOPIC — replace me, e.g. "the current state of x402 agentic payments and where a solo builder fits">.

Produce a decision-grade report: what is true, what is hype, what the numbers say, and what
the counter-arguments are. Every claim needs a source URL or a file/line reference. Prefer
primary sources. End with a clear recommendation.`,
    roleHints: [
      'landscape researcher — map the space, the players, and what shipped recently',
      'evidence researcher — primary sources, docs, repos, announcements that SUPPORT the emerging thesis',
      'red-team researcher — actively hunt counter-evidence and reasons the thesis is wrong',
      'numbers researcher — market size, volumes, pricing, growth: real figures with sources',
    ],
  },

  'market-bots': {
    key: 'market-bots',
    emoji: '📈',
    title: 'Market Bot Management',
    topology: 'mesh',
    agents: 3,
    desc: 'Three peers each take one trading desk: check the bots are alive, audit recent performance from the ledgers, and propose tuning. Scribe merges one fleet report.',
    purpose: `Market bot management sweep over <FLEET — replace me, e.g. "the soag-grid paper fleet on the Pi (https://agentsoag.com/grid/)">.

For each desk: (1) is every bot actually running and writing its ledger, (2) what do the last
24h of trades say — win rate, expectancy, profit factor, worst slippage, (3) propose at most
3 concrete tuning changes with the evidence for each. READ-ONLY: observe and report, do not
restart services or change live configs — put proposed changes in the report for a human.`,
    roleHints: [
      'desk A analyst — first market/venue in the fleet',
      'desk B analyst — second market/venue in the fleet',
      'desk C analyst — remaining venues + cross-desk risk (correlated positions, shared kill-switches)',
    ],
  },

  'web3-security': {
    key: 'web3-security',
    emoji: '🛡',
    title: 'Web3 & Security',
    topology: 'pipeline',
    agents: 4,
    desc: 'Sequential security review: recon maps the attack surface, audit digs through the code, verification reproduces each finding honestly, report writes the fix list.',
    purpose: `Defensive security review of <TARGET — replace me, e.g. "~/soag-gate (token-gated inference worker)">.

This is an authorized review of our own code. Focus on: leaked/hardcoded secrets, key and
wallet handling, RPC/input trust boundaries, authn/authz gaps, and fund-moving paths.
Findings must be verified (reproduce or trace the exact code path) — no speculative CVE
theater. Deliverable: severity-ranked findings with file:line, proof, and a concrete fix each.`,
    roleHints: [
      'recon — map the attack surface: entry points, secrets locations, dependencies, deploy story',
      'auditor — line-level review of the surfaces recon mapped; raw findings with file:line',
      'verifier — adversarially re-check every finding: reproduce it or kill it; no maybes',
      'reporter — severity-ranked REPORT.md with fixes; include what was checked and found clean',
    ],
  },
};

function list() {
  return Object.values(PRESETS);
}

function get(key) {
  const p = PRESETS[String(key || '').toLowerCase()];
  if (!p) throw new Error(`unknown preset "${key}" (have: ${Object.keys(PRESETS).join(', ')})`);
  return p;
}

module.exports = { PRESETS, list, get };
