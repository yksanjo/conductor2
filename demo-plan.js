'use strict';
// Offline planning demo: no tmux, model calls, shell execution or files written.
const assert = require('node:assert/strict');
const swarm = require('./swarm');
for (const topology of ['hierarchical', 'pipeline', 'mesh']) {
  const p = swarm.plan({ name: `demo-${topology}`, topology, agents: 3,
    purpose: 'Review a synthetic fixture. Do not send, publish, deploy or pay.',
    permissionMode: 'default' });
  assert.equal(p.agents.length, 3);
  console.log(`${topology}: ${p.agents.map(a => a.window).join(' -> ')}`);
  console.log(`launch order: ${p.launchOrder.join(', ')}`);
}
console.log('Planning only. No agents launched.');
