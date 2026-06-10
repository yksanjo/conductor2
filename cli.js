#!/usr/bin/env node
'use strict';

// Conductor V2 CLI — fire and manage swarms without opening the launch pad.
//
//   conductor2 up [--port 7592] [--no-open]      web launch pad + cockpit board
//   conductor2 presets                           list the premade setups
//   conductor2 plan  <preset> [overrides]        show what WOULD launch (no side effects)
//   conductor2 fire  <preset> [overrides]        launch the swarm (lazy fire-off)
//   conductor2 swarms                            list live swarms
//   conductor2 stop  <swarm> --yes               kill every window of a swarm
//
// Overrides: --purpose "…" --name x --topology hierarchical|pipeline|mesh --agents N
//            --cwd ~/dir --perm acceptEdits|default|plan|bypassPermissions --model <claude-id>

const { spawn } = require('child_process');
const path = require('path');
const swarm = require('./swarm');
const presets = require('./presets');
const topologies = require('./topologies');

const C = { dim: '\x1b[2m', mut: '\x1b[38;5;245m', acc: '\x1b[38;5;141m', ok: '\x1b[38;5;78m', warn: '\x1b[38;5;215m', err: '\x1b[38;5;203m', b: '\x1b[1m', r: '\x1b[0m' };

function parseOverrides(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--purpose') o.purpose = argv[++i];
    else if (v === '--name') o.name = argv[++i];
    else if (v === '--topology') o.topology = argv[++i];
    else if (v === '--agents') o.agents = parseInt(argv[++i], 10);
    else if (v === '--cwd') o.cwd = argv[++i];
    else if (v === '--perm') o.permissionMode = argv[++i];
    else if (v === '--model') o.model = argv[++i];
    else if (v === '--yes') o.yes = true;
    else if (!v.startsWith('--') && !o._preset) o._preset = v;
  }
  return o;
}

function configFrom(o) {
  const c = { ...o };
  if (o._preset) c.preset = o._preset;
  delete c._preset; delete c.yes;
  return c;
}

function printPlan(p) {
  console.log(`\n${C.b}🎼 swarm ${C.acc}${p.swarm}${C.r}  ${C.mut}topology=${p.topology} · model=${p.model} · perm=${p.permissionMode} · cwd=${p.cwd}${C.r}`);
  console.log(`${C.mut}   dir: ${p.dir}${C.r}\n`);
  for (const a of p.agents) {
    console.log(`   ${a.initiator ? C.ok + '▶' : C.dim + '·'}${C.r} ${C.b}${a.window}${C.r}  ${C.mut}${a.role}${C.r}`);
  }
  for (const w of p.warnings) console.log(`\n   ${C.warn}⚠ ${w}${C.r}`);
  console.log('');
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseOverrides(rest);

  if (!cmd || cmd === 'up') {
    const args = [path.join(__dirname, 'server.js'), ...rest];
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  if (cmd === 'presets') {
    console.log(`\n${C.b}Premade setups${C.r}  ${C.mut}(conductor2 fire <key> --purpose "…")${C.r}\n`);
    for (const p of presets.list()) {
      console.log(`   ${p.emoji} ${C.b}${p.key}${C.r}  ${C.acc}${p.topology}${C.r} · ${p.agents} agents`);
      console.log(`      ${C.mut}${p.desc}${C.r}`);
    }
    console.log(`\n${C.b}Topologies${C.r}\n`);
    for (const t of topologies.list()) console.log(`   ${t.emoji} ${C.b}${t.key}${C.r}  ${C.mut}${t.sub} — ${t.desc}${C.r}`);
    console.log('');
    return;
  }

  if (cmd === 'plan') {
    try { printPlan(swarm.plan(configFrom(o))); }
    catch (e) { console.error(`${C.err}✗ ${e.message}${C.r}`); process.exit(1); }
    return;
  }

  if (cmd === 'fire') {
    let p;
    try { p = swarm.plan(configFrom(o)); }
    catch (e) { console.error(`${C.err}✗ ${e.message}${C.r}`); process.exit(1); }
    printPlan(p);
    if (p.warnings.length && !o.yes) {
      console.error(`${C.warn}⚠ purpose still has template placeholders — pass --purpose "…" or add --yes to fire anyway.${C.r}`);
      process.exit(1);
    }
    const r = swarm.fire(configFrom(o));
    if (!r.ok) { console.error(`${C.err}✗ ${r.error}${C.r}`); process.exit(1); }
    console.log(`${C.ok}🔥 swarm "${r.swarm}" is up — ${r.agents.length} Fable 5 agents.${C.r}`);
    console.log(`${C.mut}   watch:  conductor2 up   ·   attach: ${r.attach}${C.r}\n`);
    return;
  }

  if (cmd === 'swarms') {
    const list = swarm.listSwarms();
    if (!list.length) { console.log(`${C.mut}no live swarms${C.r}`); return; }
    for (const s of list) {
      console.log(`\n   🕸 ${C.b}${s.swarm}${C.r}  ${C.mut}${s.topology || ''} · ${s.windows.length} windows${C.r}`);
      for (const w of s.windows) console.log(`      ${C.acc}${w.window}${C.r}  ${C.mut}${w.role || ''}${C.r}`);
    }
    console.log('');
    return;
  }

  if (cmd === 'stop') {
    const name = o._preset;
    if (!name) { console.error(`${C.err}✗ usage: conductor2 stop <swarm> --yes${C.r}`); process.exit(1); }
    if (!o.yes) { console.error(`${C.warn}⚠ stopping kills every window in "${name}" — add --yes to confirm.${C.r}`); process.exit(1); }
    const r = swarm.stopSwarm(name);
    if (!r.ok && !(r.stopped && r.stopped.length)) { console.error(`${C.err}✗ ${r.error || ('failed to kill: ' + (r.failed || []).join(', '))}${C.r}`); process.exit(1); }
    if (r.stopped.length) console.log(`${C.ok}✕ stopped "${r.swarm}" (${r.stopped.join(', ')})${C.r}`);
    // A failed kill leaves a live window — say so instead of folding it into "stopped".
    if (r.failed && r.failed.length) { console.error(`${C.err}✗ failed to kill: ${r.failed.join(', ')} — still live${C.r}`); process.exit(1); }
    return;
  }

  console.error(`${C.err}✗ unknown command "${cmd}"${C.r} — try: up · presets · plan · fire · swarms · stop`);
  process.exit(1);
}

main();
