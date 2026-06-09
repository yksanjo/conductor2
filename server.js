#!/usr/bin/env node
'use strict';

// Conductor V2 daemon — configure a swarm BEFORE you fire it, then watch it fly.
//
// Two pages, one zero-dependency server (node:http only):
//   /        Launch Pad — pick a topology (hierarchical / pipeline / mesh), load a preset
//            (deep research / market bots / web3+security), fill in the purpose, FIRE.
//   /board   Cockpit — V1's live board of every Claude Code window, with swarm grouping.
//
// Claude-only, Fable-5-only: every launched window runs `claude --model claude-fable-5`.
//
//   conductor2 up                 start on :7592, open browser
//   conductor2 up --port 8080
//   conductor2 up --no-open

const http = require('http');
const os = require('os');
const { execFile } = require('child_process');
const { collectSessions } = require('./lib');
const manage = require('./manage');
const swarm = require('./swarm');
const topologies = require('./topologies');
const presets = require('./presets');

function parseArgs(argv) {
  const a = { port: parseInt(process.env.CONDUCTOR2_PORT, 10) || 7592, open: true };
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--port') a.port = parseInt(argv[++i], 10) || a.port;
    else if (v === '--no-open') a.open = false;
  }
  return a;
}

function colorHex(name) {
  return ({ green: '#3ee07f', cyan: '#46d8c6', amber: '#f5b13f', red: '#ff5a6a', dim: '#6a6a85' })[name] || '#6a6a85';
}
function statusMeta() {
  const claude = require('./adapters/claude-code');
  const statuses = claude.statuses || [
    { key: 'active', title: 'WORKING', word: 'working', color: 'green' },
    { key: 'open', title: 'OPEN', word: 'open', color: 'cyan' },
    { key: 'recent', title: 'RECENT', word: 'recent', color: 'amber' },
    { key: 'idle', title: 'IDLE', word: 'idle', color: 'dim' },
  ];
  return statuses.map((s) => ({ key: s.key, title: s.title, word: s.word, color: colorHex(s.color) }));
}

// ---------------------------------------------------------------------------------------------
// Shared design system — V1's cockpit CSS verbatim, plus the launch-pad additions.
// ---------------------------------------------------------------------------------------------
const CSS = /* css */ `
  :root {
    --bg:#08080b; --bg2:#0b0b10;
    --line:rgba(255,255,255,.06); --line2:rgba(255,255,255,.12);
    --txt:#f3f3f8; --mut:#9696ab; --dim:#5c5c72;
    --active:#3ee07f; --open:#46d8c6; --recent:#f5b13f; --idle:#6a6a85;
    --accent:#a974ff; --accent2:#ff5cc8;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;
    --sans:ui-sans-serif,-apple-system,"SF Pro Text",Inter,system-ui,sans-serif;
  }
  * { box-sizing:border-box; }
  html { color-scheme:dark; }
  body {
    margin:0; background:var(--bg); color:var(--txt);
    font:13.5px/1.5 var(--sans); -webkit-font-smoothing:antialiased; letter-spacing:.1px;
    min-height:100vh;
    background-image:
      radial-gradient(900px 480px at 88% -8%, rgba(169,116,255,.10), transparent 70%),
      radial-gradient(760px 420px at -4% 108%, rgba(255,92,200,.06), transparent 70%);
  }
  ::selection { background:rgba(169,116,255,.3); }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-thumb { background:#23232f; border-radius:6px; border:2px solid var(--bg); }

  header {
    display:flex; align-items:center; gap:14px; padding:13px 24px; position:sticky; top:0; z-index:20;
    background:rgba(8,8,11,.72); backdrop-filter:blur(14px) saturate(1.2);
    border-bottom:1px solid var(--line);
  }
  .brand { display:flex; align-items:center; gap:9px; font-size:14.5px; font-weight:640; letter-spacing:.2px; }
  .brand .mk { background:linear-gradient(92deg,var(--accent),var(--accent2)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .brand .ck { color:var(--mut); font-weight:500; letter-spacing:1px; }
  .live { width:7px; height:7px; border-radius:50%; background:var(--active); box-shadow:0 0 0 0 var(--active); animation:pulse 2.4s infinite; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(62,224,127,.45);} 70%{box-shadow:0 0 0 8px rgba(62,224,127,0);} 100%{box-shadow:0 0 0 0 rgba(62,224,127,0);} }
  .count { color:var(--mut); font-size:12.5px; font-variant-numeric:tabular-nums; }
  .spacer { flex:1; }
  .legend { display:flex; gap:14px; font-size:11px; color:var(--mut); }
  .legend i { width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:5px; vertical-align:middle; }
  .seg { display:flex; gap:1px; background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:9px; padding:2px; }
  .seg button { border:0; background:transparent; color:var(--mut); font:inherit; font-size:11.5px; font-weight:600; padding:5px 11px; border-radius:7px; cursor:pointer; transition:.12s; }
  .seg button:hover { color:var(--txt); }
  .seg button.on { background:rgba(255,255,255,.09); color:var(--txt); box-shadow:0 1px 2px rgba(0,0,0,.3); }
  .seg button.danger.on { background:rgba(255,90,106,.2); color:#ff8a96; }
  .newbtn { font:inherit; font-size:12px; font-weight:650; color:var(--txt); background:linear-gradient(92deg,var(--accent),var(--accent2)); border:0; border-radius:9px; padding:7px 13px; cursor:pointer; transition:.12s; text-decoration:none; display:inline-block; }
  .newbtn:hover { filter:brightness(1.1); }
  .ghostbtn { font:inherit; font-size:12px; font-weight:600; color:var(--txt); background:rgba(255,255,255,.04); border:1px solid var(--line2); border-radius:9px; padding:7px 13px; cursor:pointer; text-decoration:none; display:inline-block; }
  .ghostbtn:hover { border-color:var(--accent); }
  .fbadge { font-family:var(--mono); font-size:10px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; color:var(--accent); background:rgba(169,116,255,.12); border:1px solid rgba(169,116,255,.3); border-radius:999px; padding:3px 9px; }

  main { padding:14px 24px 64px; max-width:1500px; margin:0 auto; }
  .section-head { display:flex; align-items:center; gap:12px; margin:28px 2px 14px; }
  .section-head:first-child { margin-top:10px; }
  .section-head .sdot { width:7px; height:7px; border-radius:50%; flex:none; box-shadow:0 0 8px currentColor; }
  .section-head .stitle { font-size:10.5px; font-weight:750; letter-spacing:1.6px; text-transform:uppercase; color:var(--mut); white-space:nowrap; }
  .section-head .rule { flex:1; height:1px; background:linear-gradient(90deg,var(--line2),transparent); }
  .section-head .scount { font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; flex:none; }

  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:14px; }
  .card {
    --c:var(--mut);
    background:linear-gradient(165deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
    border:1px solid var(--line); border-radius:15px; padding:15px 16px 14px; cursor:pointer;
    position:relative; isolation:isolate; transition:transform .14s ease, border-color .14s ease, box-shadow .14s ease;
  }
  .card::before {
    content:''; position:absolute; inset:0; border-radius:inherit; padding:1px; pointer-events:none; opacity:0; transition:opacity .14s;
    background:linear-gradient(165deg,var(--c),transparent 55%);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    -webkit-mask-composite:xor; mask-composite:exclude;
  }
  .card:hover { transform:translateY(-2px); box-shadow:0 14px 34px rgba(0,0,0,.5), 0 0 0 1px var(--line2); }
  .card:hover::before { opacity:.55; }
  .card.idle { opacity:.66; }
  .card.idle:hover { opacity:1; }
  .card.sel { --c:var(--accent); border-color:rgba(169,116,255,.55); box-shadow:0 0 0 1px rgba(169,116,255,.45), 0 14px 34px rgba(0,0,0,.5); }
  .card.sel::before { opacity:.7; }

  .ctop { display:flex; align-items:center; gap:8px; margin-bottom:9px; }
  .pill { display:inline-flex; align-items:center; gap:6px; font-size:10.5px; font-weight:650; letter-spacing:.4px; text-transform:uppercase; color:var(--c); background:color-mix(in srgb,var(--c) 13%,transparent); border:1px solid color-mix(in srgb,var(--c) 26%,transparent); padding:3px 8px; border-radius:999px; }
  .pill i { width:6px; height:6px; border-radius:50%; background:var(--c); }
  .pill.active i { box-shadow:0 0 7px var(--c); }
  .time { margin-left:auto; font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap; }

  .label { font-size:15.5px; font-weight:660; letter-spacing:.1px; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .task { color:var(--mut); font-size:12.5px; line-height:1.45; margin:5px 0 13px; min-height:18px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .cfoot { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .chip { font-family:var(--mono); font-size:10.5px; color:var(--mut); background:rgba(255,255,255,.05); border:1px solid var(--line); border-radius:6px; padding:2px 7px; }
  .chip.swarm { color:var(--accent); border-color:rgba(169,116,255,.4); }
  .mbadge { font-size:9px; font-weight:750; letter-spacing:.7px; text-transform:uppercase; color:var(--accent); background:rgba(169,116,255,.12); border:1px solid rgba(169,116,255,.3); border-radius:999px; padding:2px 7px; }
  .bopen { font:inherit; font-size:10.5px; font-weight:650; color:var(--open); background:rgba(70,216,198,.1); border:1px solid rgba(70,216,198,.32); border-radius:7px; padding:2px 8px; cursor:pointer; transition:.12s; }
  .bopen:hover { background:rgba(70,216,198,.22); }
  .xclose { position:absolute; top:6px; left:50%; transform:translateX(-50%); z-index:3; width:18px; height:18px; padding:0; line-height:16px; text-align:center; font-size:11px; font-weight:700; color:var(--mut); background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:50%; cursor:pointer; opacity:0; transition:.12s; }
  .card:hover .xclose { opacity:.55; }
  .xclose:hover { opacity:1; color:#ff8a96; background:rgba(255,90,106,.18); border-color:#ff5a6a; }

  .ctrl { margin-top:12px; padding-top:12px; border-top:1px dashed var(--line); }
  .qbtns { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:7px; }
  .qb { font:inherit; font-size:11px; font-weight:600; color:var(--txt); background:rgba(255,255,255,.05); border:1px solid var(--line2); border-radius:7px; padding:4px 9px; cursor:pointer; transition:.12s; }
  .qb:hover { background:rgba(169,116,255,.18); border-color:var(--accent); }
  .qb.danger { color:#ff8a96; border-color:rgba(255,90,106,.4); }
  .qb.danger:hover { background:rgba(255,90,106,.18); border-color:#ff5a6a; }
  .qrow { display:flex; gap:5px; }
  .qin { flex:1; min-width:0; font:inherit; font-size:11.5px; color:var(--txt); background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:7px; padding:5px 9px; }
  .qin:focus { outline:none; border-color:var(--accent); }
  .qin::placeholder { color:var(--dim); }
  .qsend { font:inherit; color:var(--txt); background:rgba(169,116,255,.18); border:1px solid var(--accent); border-radius:7px; padding:5px 11px; cursor:pointer; }
  .qsend:hover { background:rgba(169,116,255,.3); }
  .toast { position:fixed; bottom:22px; left:50%; transform:translateX(-50%); background:#15151f; border:1px solid var(--line2); color:var(--txt); font-size:12.5px; padding:9px 16px; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.5); opacity:0; transition:opacity .2s; pointer-events:none; z-index:80; }
  .toast.show { opacity:1; }

  .bcast { display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin:18px 0 4px; padding:12px 14px;
    background:linear-gradient(120deg,rgba(169,116,255,.10),rgba(255,92,200,.06)); border:1px solid rgba(169,116,255,.28); border-radius:13px; }
  .bcast .blabel { font-size:12px; font-weight:700; letter-spacing:.3px; color:var(--txt); margin-right:2px; }
  .bcast .blabel b { color:var(--accent); }
  .bcast .bbtns { display:flex; flex-wrap:wrap; gap:5px; }
  .bcast .qin { flex:1; min-width:160px; }

  .card.active { --c:var(--active); } .card.open { --c:var(--open); }
  .card.recent { --c:var(--recent); } .card.idle { --c:var(--idle); }

  .empty { color:var(--mut); text-align:center; padding:90px 0; font-size:13px; }

  .scrim { position:fixed; inset:0; background:rgba(4,4,7,.72); backdrop-filter:blur(5px); display:none; align-items:center; justify-content:center; z-index:60; padding:24px; }
  .scrim.show { display:flex; animation:fade .14s ease; }
  @keyframes fade { from{opacity:0;} to{opacity:1;} }
  .modal { width:min(660px,100%); max-height:86vh; overflow:auto; background:linear-gradient(180deg,#13131b,#0e0e14); border:1px solid var(--line2); border-radius:20px; padding:26px 28px; box-shadow:0 30px 80px rgba(0,0,0,.6); }
  .modal h2 { margin:0 0 3px; font-size:22px; font-weight:680; letter-spacing:.2px; }
  .modal .sub { color:var(--dim); font-size:12px; font-family:var(--mono); margin-bottom:20px; word-break:break-all; }
  .kv { margin:15px 0; }
  .kv .k { color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px; font-weight:700; }
  .kv .v { color:var(--txt); font-size:13.5px; word-break:break-word; line-height:1.5; }
  .close { float:right; cursor:pointer; color:var(--mut); font-size:22px; line-height:1; border:0; background:0; transition:color .12s; }
  .close:hover { color:var(--txt); }
  .foot { color:var(--dim); font-size:11px; font-family:var(--mono); margin-top:24px; padding-top:16px; border-top:1px solid var(--line); }

  /* launch pad */
  .diag { font-family:var(--mono); font-size:10.5px; line-height:1.5; color:var(--accent); white-space:pre; margin:8px 0 10px; opacity:.85; }
  .pdesc { color:var(--mut); font-size:12px; line-height:1.5; margin:5px 0 12px; min-height:36px; }
  .ta { width:100%; min-height:130px; resize:vertical; font:12.5px/1.6 var(--mono); color:var(--txt); background:rgba(0,0,0,.3); border:1px solid var(--line); border-radius:11px; padding:12px 14px; }
  .ta:focus { outline:none; border-color:var(--accent); }
  .formrow { display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end; margin-top:14px; }
  .formrow .kv { margin:0; flex:1; min-width:170px; }
  .formrow .kv.tight { flex:0 1 auto; }
  .biginput { width:100%; font:inherit; font-size:13px; color:var(--txt); background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:9px; padding:9px 12px; }
  .biginput:focus { outline:none; border-color:var(--accent); }
  .firebar { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:22px; padding:16px 18px;
    background:linear-gradient(120deg,rgba(169,116,255,.12),rgba(255,92,200,.07)); border:1px solid rgba(169,116,255,.3); border-radius:15px; }
  .firebtn { font:inherit; font-size:14px; font-weight:750; letter-spacing:.4px; color:#0b0b10; background:linear-gradient(92deg,var(--accent),var(--accent2)); border:0; border-radius:11px; padding:11px 26px; cursor:pointer; transition:.12s; }
  .firebtn:hover { filter:brightness(1.12); transform:translateY(-1px); }
  .firebtn:disabled { opacity:.4; cursor:not-allowed; transform:none; }
  .crew { display:flex; flex-wrap:wrap; gap:6px; }
  .crew .chip { font-size:10px; }
  .warn { color:var(--recent); font-size:11.5px; font-family:var(--mono); }
  .quickfire { position:absolute; right:12px; top:12px; z-index:3; font:inherit; font-size:10.5px; font-weight:700; color:#0b0b10; background:linear-gradient(92deg,var(--accent),var(--accent2)); border:0; border-radius:7px; padding:4px 10px; cursor:pointer; opacity:0; transition:.12s; }
  .card:hover .quickfire { opacity:1; }
`;

// ---------------------------------------------------------------------------------------------
// Launch Pad page
// ---------------------------------------------------------------------------------------------
const PAD = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conductor V2 — Launch Pad</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <span class="live"></span>
  <span class="brand">🎼 <span class="mk">Conductor V2</span> <span class="ck">Launch Pad</span></span>
  <span class="fbadge">⚡ FABLE 5 · MAX POWER</span>
  <span class="spacer"></span>
  <span class="count" id="swcount"></span>
  <a class="newbtn" href="/board">🗂 Cockpit board →</a>
</header>
<main>
  <div class="section-head"><span class="sdot" style="color:var(--accent);background:var(--accent)"></span>
    <span class="stitle">Presets — lazy fire-off</span><span class="rule"></span></div>
  <div class="grid" id="presets"></div>

  <div class="section-head"><span class="sdot" style="color:var(--open);background:var(--open)"></span>
    <span class="stitle">Swarm topology</span><span class="rule"></span></div>
  <div class="grid" id="topos"></div>

  <div class="section-head"><span class="sdot" style="color:var(--recent);background:var(--recent)"></span>
    <span class="stitle">Mission</span><span class="rule"></span></div>
  <textarea class="ta" id="purpose" placeholder="What is this swarm for? Be specific — every agent reads this."></textarea>
  <div class="formrow">
    <div class="kv"><div class="k">Swarm name</div><input class="biginput" id="name" placeholder="e.g. x402-research"></div>
    <div class="kv"><div class="k">Folder</div><input class="biginput" id="cwd" placeholder="~ (home) — or ~/soag-grid"></div>
    <div class="kv tight"><div class="k">Agents</div><div class="seg" id="agents"></div></div>
    <div class="kv tight"><div class="k">Permissions</div><div class="seg" id="perm"></div></div>
    <div class="kv tight"><div class="k">Model</div><span class="fbadge" title="V2 is Claude-only — every window launches claude --model claude-fable-5">__MODEL__ · locked</span></div>
  </div>

  <div class="firebar">
    <button class="firebtn" id="fire">🔥 FIRE UP SWARM</button>
    <div style="flex:1;min-width:200px">
      <div class="kv" style="margin:0"><div class="k">Crew preview</div><div class="crew" id="crew"><span class="chip">—</span></div></div>
      <div class="warn" id="warn"></div>
    </div>
  </div>

  <div class="section-head"><span class="sdot" style="color:var(--active);background:var(--active)"></span>
    <span class="stitle">Live swarms</span><span class="rule"></span><span class="scount" id="livecount"></span></div>
  <div class="grid" id="liveswarms"></div>
  <div class="empty" id="noswarms" style="display:none;padding:30px 0">No live swarms — configure one above and fire.</div>
  <div class="foot">topology decides who talks to whom · agents coordinate via swarm-say (tmux) + a shared swarm directory · watch and steer every window from the <a href="/board" style="color:var(--accent)">cockpit board</a></div>
</main>
<div class="toast" id="toast"></div>
<script>
const CONFIG = __CONFIG__;   // { presets:[], topologies:[], model, permissionModes:[] }
const esc = (s)=> (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let SEL = { preset:null, topology:'hierarchical', agents:4, perm:'acceptEdits' };

let toastT;
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2600); }

function renderPresets(){
  document.getElementById('presets').innerHTML = CONFIG.presets.map(p=>\`
    <div class="card \${SEL.preset===p.key?'sel':''}" data-preset="\${p.key}">
      <button class="quickfire" data-quick="\${p.key}" title="Fire this preset right now, as-is">⚡ fire as-is</button>
      <div class="ctop"><span class="pill" style="--c:var(--accent)"><i></i>preset</span><span class="time">\${p.agents} agents</span></div>
      <div class="label">\${p.emoji} \${esc(p.title)}</div>
      <div class="pdesc">\${esc(p.desc)}</div>
      <div class="cfoot"><span class="chip swarm">\${esc(p.topology)}</span><span class="chip">\${CONFIG.model}</span></div>
    </div>\`).join('')
    + \`<div class="card \${SEL.preset===null?'sel':''}" data-preset="">
      <div class="ctop"><span class="pill" style="--c:var(--open)"><i></i>custom</span></div>
      <div class="label">🛠 Custom</div>
      <div class="pdesc">Blank slate — pick a topology, write your own mission, choose the crew size.</div>
      <div class="cfoot"><span class="chip">any topology</span></div>
    </div>\`;
}
function renderTopos(){
  document.getElementById('topos').innerHTML = CONFIG.topologies.map(t=>\`
    <div class="card \${SEL.topology===t.key?'sel':''}" data-topo="\${t.key}">
      <div class="ctop"><span class="pill" style="--c:var(--open)"><i></i>\${esc(t.sub)}</span></div>
      <div class="label">\${t.emoji} \${esc(t.name)}</div>
      <div class="diag">\${esc(t.diagram)}</div>
      <div class="pdesc">\${esc(t.desc)}</div>
    </div>\`).join('');
}
function renderSegs(){
  document.getElementById('agents').innerHTML = [2,3,4,5,6,8].map(n=>
    \`<button data-n="\${n}" class="\${SEL.agents===n?'on':''}">\${n}</button>\`).join('');
  document.getElementById('perm').innerHTML = CONFIG.permissionModes.map(m=>{
    const danger = m==='bypassPermissions';
    return \`<button data-perm="\${m}" class="\${danger?'danger ':''}\${SEL.perm===m?'on':''}" title="\${danger?'agents run with NO permission prompts — full autonomy, full trust':''}">\${m==='bypassPermissions'?'bypass ⚠':m}</button>\`;
  }).join('');
}

function applyPreset(key){
  SEL.preset = key || null;
  if (key) {
    const p = CONFIG.presets.find(x=>x.key===key);
    SEL.topology = p.topology; SEL.agents = p.agents;
    document.getElementById('purpose').value = p.purpose;
    document.getElementById('name').value = p.key;
  }
  renderPresets(); renderTopos(); renderSegs(); preview();
}

function currentConfig(){
  return {
    name: document.getElementById('name').value.trim() || (SEL.preset||'swarm'),
    preset: SEL.preset || undefined,
    topology: SEL.topology,
    purpose: document.getElementById('purpose').value.trim(),
    agents: SEL.agents,
    cwd: document.getElementById('cwd').value.trim(),
    permissionMode: SEL.perm,
  };
}

let prevT;
function preview(){
  clearTimeout(prevT);
  prevT = setTimeout(async ()=>{
    try {
      const r = await fetch('/api/plan',{method:'POST',headers:{'content-type':'application/json','x-conductor':'1'},body:JSON.stringify(currentConfig())});
      const j = await r.json();
      if (!j.ok) { document.getElementById('crew').innerHTML='<span class="chip">'+esc(j.error)+'</span>'; document.getElementById('warn').textContent=''; return; }
      document.getElementById('crew').innerHTML = j.plan.agents.map(a=>'<span class="chip'+(a.initiator?' swarm':'')+'" title="'+esc(a.role)+'">'+esc(a.window)+'</span>').join('');
      document.getElementById('warn').textContent = (j.plan.warnings||[]).join(' · ');
    } catch(e){}
  }, 250);
}

async function fire(config){
  const warn = document.getElementById('warn').textContent;
  if (warn && !confirm('⚠ '+warn+'\\n\\nFire anyway?')) return;
  if (!config.purpose) { toast('give the swarm a purpose first'); return; }
  const btn = document.getElementById('fire'); btn.disabled = true; btn.textContent = '🔥 firing…';
  try {
    const r = await fetch('/api/fire',{method:'POST',headers:{'content-type':'application/json','x-conductor':'1'},body:JSON.stringify(config)});
    const j = await r.json();
    if (j.ok) { toast('🔥 swarm "'+j.swarm+'" is up — '+j.agents.length+' Fable 5 agents. Opening the board…'); setTimeout(()=>location.href='/board', 1400); }
    else toast('fire failed: '+(j.error||'?'));
  } catch(e){ toast('fire failed'); }
  btn.disabled = false; btn.textContent = '🔥 FIRE UP SWARM';
  loadSwarms();
}

async function quickFire(key){
  const p = CONFIG.presets.find(x=>x.key===key);
  if (!confirm('⚡ Fire "'+p.title+'" as-is?\\n\\n'+p.agents+' Fable 5 agents · '+p.topology+' topology.\\nThe purpose template fires unedited — edit it in the form for a sharper mission.')) return;
  applyPreset(key);
  fire(currentConfig());
}

async function loadSwarms(){
  try {
    const r = await fetch('/api/swarms');
    const j = await r.json();
    const box = document.getElementById('liveswarms');
    document.getElementById('livecount').textContent = j.swarms.length || '';
    document.getElementById('swcount').textContent = j.swarms.length ? j.swarms.length+' live swarm'+(j.swarms.length>1?'s':'') : '';
    document.getElementById('noswarms').style.display = j.swarms.length ? 'none' : 'block';
    box.innerHTML = j.swarms.map(s=>\`
      <div class="card" style="--c:var(--active);cursor:default">
        <div class="ctop"><span class="pill active" style="--c:var(--active)"><i></i>live</span><span class="time">\${esc(s.topology||'')}</span></div>
        <div class="label">🕸 \${esc(s.swarm)}</div>
        <div class="pdesc">\${s.windows.map(w=>'<span class="chip" title="'+esc(w.role||'')+'">'+esc(w.window)+'</span>').join(' ')}</div>
        <div class="cfoot">
          <a class="bopen" href="/board" style="text-decoration:none">↗ board</a>
          <button class="qb danger" data-stopswarm="\${esc(s.swarm)}">✕ stop swarm</button>
        </div>
      </div>\`).join('');
  } catch(e){}
}

document.getElementById('presets').addEventListener('click', e=>{
  const q = e.target.closest('.quickfire'); if (q) { e.stopPropagation(); quickFire(q.dataset.quick); return; }
  const c = e.target.closest('[data-preset]'); if (c) applyPreset(c.dataset.preset);
});
document.getElementById('topos').addEventListener('click', e=>{
  const c = e.target.closest('[data-topo]'); if (!c) return;
  SEL.topology = c.dataset.topo; SEL.preset = null; renderPresets(); renderTopos(); preview();
});
document.getElementById('agents').addEventListener('click', e=>{
  const b = e.target.closest('button'); if (!b) return; SEL.agents = +b.dataset.n; renderSegs(); preview();
});
document.getElementById('perm').addEventListener('click', e=>{
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.perm==='bypassPermissions' && !confirm('⚠ bypassPermissions runs every agent with NO permission prompts.\\nThey can run any command unattended. Sure?')) return;
  SEL.perm = b.dataset.perm; renderSegs(); preview();
});
document.getElementById('liveswarms').addEventListener('click', async e=>{
  const b = e.target.closest('[data-stopswarm]'); if (!b) return;
  const name = b.dataset.stopswarm;
  if (!confirm('Stop swarm "'+name+'"?\\n\\nKills every window in it — their live sessions are lost. Cannot be undone.')) return;
  const r = await fetch('/api/stop-swarm',{method:'POST',headers:{'content-type':'application/json','x-conductor':'1'},body:JSON.stringify({swarm:name, confirm:name})});
  const j = await r.json();
  toast(j.ok ? '✕ stopped "'+name+'" ('+j.stopped.length+' windows)' : 'stop failed: '+(j.error||'?'));
  loadSwarms();
});
['purpose','name','cwd'].forEach(id=>document.getElementById(id).addEventListener('input', preview));
document.getElementById('fire').addEventListener('click', ()=>fire(currentConfig()));

renderPresets(); renderTopos(); renderSegs(); preview(); loadSwarms();
setInterval(loadSwarms, 5000);
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------------------------
// Cockpit board — V1's live board, claude-only, with swarm chips.
// ---------------------------------------------------------------------------------------------
const BOARD = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conductor V2 — Board</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <span class="live"></span>
  <span class="brand">🎼 <span class="mk">Conductor V2</span> <span class="ck">Board</span></span>
  <span class="count" id="count"></span>
  <span class="spacer"></span>
  <div class="legend">
    <span><i style="background:#3ee07f"></i>working</span>
    <span><i style="background:#46d8c6"></i>open</span>
    <span><i style="background:#f5b13f"></i>recent</span>
  </div>
  <div class="seg" id="seg">
    <button data-m="10">10m</button>
    <button data-m="60" class="on">1h</button>
    <button data-m="1440">1d</button>
    <button data-m="all">all</button>
  </div>
  <a class="newbtn" href="/">🔥 Launch pad</a>
</header>
<main>
  <div class="bcast" id="bcast" style="display:none">
    <span class="blabel">⚡ Prompt all managed <b id="bcount">0</b></span>
    <div class="bbtns" id="bbtns"></div>
    <input class="qin" id="binput" placeholder="message all managed windows…">
    <button class="qsend" id="bsend">↵</button>
  </div>
  <div id="board"></div>
  <div class="empty" id="empty" style="display:none"></div>
</main>
<div class="toast" id="toast"></div>
<script>
let META = __META__;                 // { statuses:[{key,title,word,color}] }
let WINDOW = '60';
let DATA = [];
let lastHash = '';
let BCAST = {};

function bcastChip(label){
  const b = BCAST[label]; if (!b) return '';
  if (Date.now() - b.at > 45000) return '';
  const M = {
    started: ['✅ running','#3ecf8e','prompt accepted — turn is running'],
    sent:    ['↵ sent','#3ecf8e','prompt delivered to a ready prompt'],
    skipped: ['⏸ '+(b.stage==='trust'?'trust prompt':b.stage==='resume'?'resume picker':'busy'),'#d9a441','not at a ready prompt — nothing was typed'],
    gone:    ['✕ gone','var(--dim)','window no longer exists'],
    error:   ['⚠ error','#e5484d','send failed'],
  };
  const m = M[b.status]; if (!m) return '';
  return '<span class="chip" style="color:'+m[1]+';border-color:'+m[1]+'" title="'+esc(m[2])+'">'+esc(m[0])+'</span>';
}
function recordBcast(results){
  const now = Date.now();
  (results||[]).forEach(r => { if (r && r.label) BCAST[r.label] = { status:r.status, stage:r.stage, at:now }; });
}

const esc = (s)=> (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function statusMeta(k){ return (META.statuses||[]).find(s=>s.key===k) || { key:k, title:k, word:k, color:'#6a6a85' }; }
function statusLabel(k){ return statusMeta(k).word; }
function sections(){ return (META.statuses||[]).map(s=>({ k:s.key, t:s.title, c:s.color })); }

function typingNow() {
  const a = document.activeElement;
  return a && a.classList && a.classList.contains('qin');
}
async function load() {
  const q = WINDOW==='all' ? 'all=1' : 'minutes='+WINDOW;
  try {
    const r = await fetch('/api/sessions?'+q);
    const j = await r.json();
    DATA = j.sessions;
    if (j.statuses) META = { statuses:j.statuses };
    const structure = WINDOW + '|' + JSON.stringify(DATA.map(s=>[s.sessionId,s.status,s.managed,s.swarm]));
    if (structure !== lastHash && !typingNow()) { lastHash = structure; render(); }
    else updateInPlace();
  } catch(e) { /* keep last render */ }
}

function updateInPlace() {
  document.getElementById('count').textContent = DATA.length ? DATA.length+' window'+(DATA.length>1?'s':'') : '';
  const bc = document.getElementById('bcount'); if (bc) bc.textContent = DATA.filter(s=>s.managed).length;
  for (const s of DATA) {
    const card = document.querySelector('.card[data-id="'+s.sessionId+'"]');
    if (!card) continue;
    const t = card.querySelector('.time'); if (t && t.textContent !== s.lastActiveRel) t.textContent = s.lastActiveRel;
    const tk = card.querySelector('.task'); const v = s.lastAction || s.intent || '—';
    if (tk && tk.textContent !== v) tk.textContent = v;
  }
}

const QUICK = [
  ['Yes','yes'], ['No','no'], ['Continue','continue'],
  ['Review','review what you just did and report back'],
  ['Re-iterate','re-iterate and improve it'],
  ['Test+deploy','review and test it before deploying'],
];

function ctrlHTML(s) {
  const attr = s.managed ? 'data-label="'+esc(s.mlabel)+'"' : 'data-session="'+esc(s.sessionId)+'"';
  const ph = s.managed ? 'reply to '+esc(s.mlabel)+'…' : 'reply — adopts this window…';
  const btns = QUICK.map(q => '<button class="qb" '+attr+' data-text="'+esc(q[1])+'">'+q[0]+'</button>').join('');
  return '<div class="ctrl"><div class="qbtns">'+btns+'</div>'
       + '<div class="qrow"><input class="qin" '+attr+' placeholder="'+ph+'">'
       + '<button class="qsend" '+attr+'>↵</button></div></div>';
}

function cardHTML(s) {
  const sm = statusMeta(s.status);
  return \`<div class="card \${s.status}" data-id="\${s.sessionId}" style="--c:\${sm.color}">
      \${s.managed ? '<button class="xclose" data-close="'+esc(s.mlabel)+'" title="Close this window (kills its tmux session — irreversible)">✕</button>' : ''}
      <div class="ctop">
        <span class="pill \${s.status}" style="--c:\${sm.color}"><i></i>\${statusLabel(s.status)}</span>
        \${s.swarm ? '<span class="mbadge">🕸 '+esc(s.swarm)+'</span>' : (s.managed ? '<span class="mbadge">managed</span>' : '')}
        <span class="time">\${esc(s.lastActiveRel)}</span>
      </div>
      <div class="label">\${esc(s.title || s.label)}</div>
      <div class="task">\${esc(s.lastAction || s.intent || '—')}</div>
      <div class="cfoot">\${s.managed ? bcastChip(s.mlabel) : ''}\${s.role ? '<span class="chip swarm" title="swarm role">'+esc(s.role.split('—')[0].trim())+'</span>' : ''}\${s.place ? '<span class="chip">'+esc(s.place)+'</span>' : ''}\${s.gitBranch ? '<span class="chip">'+esc(s.gitBranch)+'</span>' : ''}\${s.managed ? '<button class="bopen" data-open="'+esc(s.mlabel)+'" title="Open this window in Terminal">↗ open</button>' : ''}</div>
      \${ctrlHTML(s)}
    </div>\`;
}

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove('show'), 2200);
}
async function reply(label, text) {
  if (!text || !text.trim()) return;
  try {
    const r = await fetch('/api/say', { method:'POST', headers:{'content-type':'application/json','x-conductor':'1'}, body:JSON.stringify({label, text}) });
    const j = await r.json();
    recordBcast([{ label: j.label || label, status: j.ok ? (j.status||'sent') : (j.status||'error'), stage: j.stage }]);
    if (j.ok) toast(j.status==='started' ? '✅ '+label+' is running it' : '↵ sent to '+label);
    else toast(j.status==='skipped' ? '⏸ '+label+' not ready ('+(j.stage||'busy')+') — nothing typed' : 'send failed: '+(j.error||j.status||'?'));
    render();
  } catch(e) { toast('send failed'); }
}
async function replyAll(text) {
  if (!text || !text.trim()) return;
  try {
    const r = await fetch('/api/say-all', { method:'POST', headers:{'content-type':'application/json','x-conductor':'1'}, body:JSON.stringify({text}) });
    const j = await r.json();
    if (!j.ok) { toast('broadcast failed'); return; }
    recordBcast(j.results);
    const n = j.total||0, ok = j.started||0, skip = j.skipped||0;
    toast(skip ? '⚡ '+ok+'/'+n+' got it · '+skip+' skipped (see cards)' : '⚡ all '+ok+' window'+(ok===1?'':'s')+' got “'+text+'”');
    render();
  } catch(e) { toast('broadcast failed'); }
}
async function replyAdopt(sessionId, text) {
  if (!text || !text.trim()) return;
  toast('adopting window + sending “'+text+'”…');
  try {
    const r = await fetch('/api/adopt-say', { method:'POST', headers:{'content-type':'application/json','x-conductor':'1'}, body:JSON.stringify({session:sessionId, text}) });
    const j = await r.json();
    toast(j.ok ? '✓ “'+j.label+'” adopted — reply goes to the managed copy; close the original tab' : 'failed: '+(j.error||'?'));
    lastHash=''; load();
  } catch(e) { toast('failed'); }
}
async function openTerm(label) {
  toast('opening “'+label+'” in Terminal…');
  try {
    const r = await fetch('/api/open', { method:'POST', headers:{'content-type':'application/json','x-conductor':'1'}, body:JSON.stringify({label}) });
    const j = await r.json();
    toast(j.ok ? (j.attached ? '↗ brought Terminal to front · '+label : '↗ opened “'+label+'” in a new Terminal') : 'open failed: '+(j.error||'?'));
  } catch(e) { toast('open failed'); }
}
async function closeWindow(label) {
  if (!confirm('Close “'+label+'”?\\n\\nThis kills its tmux session — the live Claude session and its state are lost. This cannot be undone.')) return;
  toast('closing “'+label+'”…');
  try {
    const r = await fetch('/api/stop', { method:'POST', headers:{'content-type':'application/json','x-conductor':'1'}, body:JSON.stringify({label, confirm:label}) });
    const j = await r.json();
    toast(j.ok ? '✕ closed “'+label+'”' : 'close failed: '+(j.error||'?'));
    if (j.ok) { lastHash=''; load(); }
  } catch(e) { toast('close failed'); }
}
async function openCLI(id) {
  const s = DATA.find(x=>x.sessionId===id);
  if (!s) return;
  if (s.managed) { openTerm(s.mlabel); return; }
  toast('opening CLI — adopting this window…');
  try {
    const r = await fetch('/api/adopt', { method:'POST', headers:{'content-type':'application/json','x-conductor':'1'}, body:JSON.stringify({session:id}) });
    const j = await r.json();
    if (j.ok) { openTerm(j.label); lastHash=''; load(); }
    else toast('open failed: '+(j.error||'?'));
  } catch(e) { toast('open failed'); }
}

function render() {
  const board = document.getElementById('board');
  const empty = document.getElementById('empty');
  document.getElementById('count').textContent = DATA.length ? DATA.length+' window'+(DATA.length>1?'s':'') : '';
  const mc = DATA.filter(s=>s.managed).length;
  document.getElementById('bcount').textContent = mc;
  document.getElementById('bcast').style.display = mc ? 'flex' : 'none';
  if (!DATA.length) {
    board.innerHTML=''; empty.style.display='block';
    empty.textContent = 'No sessions in this window. Try a wider range → or fire a swarm from the Launch pad.';
    return;
  }
  empty.style.display='none';
  let html = '';
  // Swarm sections first — a fired fleet is what you came to watch.
  const swarms = [...new Set(DATA.filter(s=>s.swarm).map(s=>s.swarm))];
  for (const sw of swarms) {
    const items = DATA.filter(s => s.swarm === sw);
    html += \`<div class="section-head"><span class="sdot" style="color:var(--accent);background:var(--accent)"></span>\`
         +  \`<span class="stitle">🕸 swarm · \${esc(sw)}</span><span class="rule"></span>\`
         +  \`<span class="scount">\${items.length}</span></div>\`;
    html += '<div class="grid">' + items.map(cardHTML).join('') + '</div>';
  }
  const rest = DATA.filter(s=>!s.swarm);
  for (const sec of sections()) {
    const items = rest.filter(s => s.status === sec.k);
    if (!items.length) continue;
    html += \`<div class="section-head"><span class="sdot" style="color:\${sec.c};background:\${sec.c}"></span>\`
         +  \`<span class="stitle">\${sec.t}</span><span class="rule"></span>\`
         +  \`<span class="scount">\${items.length}</span></div>\`;
    html += '<div class="grid">' + items.map(cardHTML).join('') + '</div>';
  }
  board.innerHTML = html;
}

document.getElementById('seg').addEventListener('click', e=>{
  const b=e.target.closest('button'); if(!b) return;
  document.querySelectorAll('#seg button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); WINDOW=b.dataset.m; lastHash=''; load();
});
const boardEl = document.getElementById('board');
function dispatchReply(el, text) {
  if (el.dataset.label != null) reply(el.dataset.label, text);
  else if (el.dataset.session != null) replyAdopt(el.dataset.session, text);
}
boardEl.addEventListener('click', e=>{
  const ob = e.target.closest('.bopen');
  if (ob) { e.stopPropagation(); openTerm(ob.dataset.open); return; }
  const cb = e.target.closest('.xclose');
  if (cb) { e.stopPropagation(); closeWindow(cb.dataset.close); return; }
  const qb = e.target.closest('.qb,.qsend');
  if (qb) {
    e.stopPropagation();
    if (qb.classList.contains('qsend')) { const inp = qb.parentElement.querySelector('.qin'); dispatchReply(qb, inp.value); inp.value=''; }
    else dispatchReply(qb, qb.dataset.text);
    return;
  }
  if (e.target.closest('.ctrl')) return;
  const card = e.target.closest('.card');
  if (card) openCLI(card.dataset.id);
});
document.getElementById('bbtns').innerHTML = QUICK.map(q => '<button class="qb" data-all="'+esc(q[1])+'">'+q[0]+'</button>').join('');
const bcastEl = document.getElementById('bcast');
bcastEl.addEventListener('click', e=>{
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'bsend') { const i=document.getElementById('binput'); replyAll(i.value); i.value=''; }
  else if (b.dataset.all != null) replyAll(b.dataset.all);
});
document.getElementById('binput').addEventListener('keydown', e=>{
  if (e.key === 'Enter') { replyAll(e.target.value); e.target.value=''; }
});
boardEl.addEventListener('keydown', e=>{
  if (e.target.classList && e.target.classList.contains('qin') && e.key==='Enter') {
    dispatchReply(e.target, e.target.value); e.target.value=''; e.stopPropagation();
  }
});

load();
setInterval(load, 4000);
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------------------------
// HTTP plumbing — V1's CSRF/DNS-rebinding guard verbatim.
// ---------------------------------------------------------------------------------------------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
// JSON safe to inline inside a <script> tag: escape '<' so a "</script>" inside any string can't
// close the tag. Always used via String.replace's FUNCTION form so '$&'/'$'' in the JSON are never
// expanded as replacement patterns (BUG-6).
function jsonForScript(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }
function readBody(req, res, cb) {
  let b = '', over = false;
  req.on('data', (c) => {
    b += c;
    if (b.length > 65536 && !over) { over = true; sendJSON(res, 413, { ok: false, error: 'body too large' }); req.destroy(); }
  });
  req.on('end', () => { if (over) return; let p; try { p = JSON.parse(b || '{}'); } catch { p = {}; } cb(p); });
}
function localHost(req) {
  const h = (req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}
function localOrigin(req) {
  const o = req.headers.origin;
  if (!o || o === 'null') return true;
  try { const u = new URL(o); return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'; }
  catch { return false; }
}
function writeAllowed(req) {
  return localHost(req) && localOrigin(req) && req.headers['x-conductor'] === '1';
}

function launchConfig() {
  return {
    model: swarm.MODEL,
    permissionModes: swarm.PERMISSION_MODES,
    topologies: topologies.list(),
    presets: presets.list(),
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && !writeAllowed(req)) {
    return sendJSON(res, 403, { ok: false, error: 'forbidden — local origin + X-Conductor header required' });
  }
  // BUG-5: the read API exposes transcript titles, last prompts, cwds, and git branches for every
  // recent Claude session. A DNS-rebinding page could GET /api/* from a rebound origin and harvest
  // that, so gate the JSON read endpoints on a local Host too (the HTML pages stay open so the
  // browser can load them normally).
  if (url.pathname.startsWith('/api/') && !localHost(req)) {
    return sendJSON(res, 403, { ok: false, error: 'forbidden — local host only' });
  }

  if (url.pathname === '/api/config') return sendJSON(res, 200, launchConfig());

  // Preview what WOULD launch — pure, no side effects. Drives the crew preview.
  if (url.pathname === '/api/plan' && req.method === 'POST') {
    readBody(req, res, (p) => {
      try {
        const pl = swarm.plan(p);
        sendJSON(res, 200, { ok: true, plan: { ...pl, agents: pl.agents.map((a) => ({ window: a.window, slot: a.slot, role: a.role, initiator: a.initiator })) } });
      } catch (e) { sendJSON(res, 200, { ok: false, error: e.message }); }
    });
    return;
  }

  // FIRE. Launches real Claude windows — the irreversibility gate is the explicit click/confirm
  // in the UI plus the CSRF guard; the server refuses double-fires into a live swarm.
  if (url.pathname === '/api/fire' && req.method === 'POST') {
    readBody(req, res, (p) => {
      try { const r = swarm.fire(p); sendJSON(res, r.ok ? 200 : 400, r); }
      catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/swarms') return sendJSON(res, 200, { swarms: swarm.listSwarms() });

  if (url.pathname === '/api/stop-swarm' && req.method === 'POST') {
    readBody(req, res, (p) => {
      if (!p.swarm) return sendJSON(res, 400, { ok: false, error: 'swarm required' });
      if (p.confirm !== p.swarm) return sendJSON(res, 400, { ok: false, error: 'stopping a swarm is irreversible — confirm token (the swarm name) required' });
      const r = swarm.stopSwarm(p.swarm);
      sendJSON(res, r.ok ? 200 : 400, r);
    });
    return;
  }

  if (url.pathname === '/api/sessions') {
    const all = url.searchParams.get('all') === '1';
    const minutes = parseInt(url.searchParams.get('minutes'), 10) || 60;
    try {
      const rows = await collectSessions({ minutes, all });
      const mgd = manage.managedBySession();
      for (const r of rows) {
        const w = mgd[r.sessionId];
        if (w) { r.managed = true; r.mlabel = w.label; r.swarm = w.swarm || null; r.role = w.role || null; }
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ generatedAt: new Date().toISOString(), statuses: statusMeta(), count: rows.length, sessions: rows }));
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  if (url.pathname === '/api/say' && req.method === 'POST') {
    readBody(req, res, (p) => {
      const r = p.key ? manage.key(p.label, p.key) : manage.deliver(p.label, p.text || '');
      sendJSON(res, r.ok ? 200 : 400, r);
    });
    return;
  }

  if (url.pathname === '/api/say-all' && req.method === 'POST') {
    readBody(req, res, (p) => sendJSON(res, 200, manage.sayAll(p)));
    return;
  }

  if (url.pathname === '/api/open' && req.method === 'POST') {
    readBody(req, res, (p) => { const r = manage.openTerminal(p.label); sendJSON(res, r.ok ? 200 : 400, r); });
    return;
  }

  if (url.pathname === '/api/stop' && req.method === 'POST') {
    readBody(req, res, (p) => {
      if (!p.label) return sendJSON(res, 400, { ok: false, error: 'label required' });
      if (p.confirm !== p.label) return sendJSON(res, 400, { ok: false, error: 'closing a window is irreversible — confirm token (the label) required' });
      const r = manage.stop(p.label);
      sendJSON(res, r.ok ? 200 : 400, r);
    });
    return;
  }

  if (url.pathname === '/api/adopt-say' && req.method === 'POST') {
    readBody(req, res, async (p) => {
      try {
        const text = p.text || '';
        const existing = manage.managedBySession()[p.session];
        if (existing) {
          const r = manage.say(existing.label, text);
          return sendJSON(res, r.ok ? 200 : 400, { ...r, label: existing.label });
        }
        const rows = await collectSessions({ minutes: 4320 });
        const s = rows.find((r) => r.sessionId === p.session || r.shortId === p.session);
        if (!s) return sendJSON(res, 400, { ok: false, error: 'session not found' });
        const label = manage.uniqueLabel(s.label || s.shortId, s.sessionId);
        const r = manage.adopt(label, s.sessionId, s.cwd, { capture: false });
        if (r.ok) {
          manage.deliverAdopted(label, text);
          return sendJSON(res, 200, { ok: true, label, adopted: true });
        }
        const sr = manage.say(label, text);
        sendJSON(res, sr.ok ? 200 : 400, { ok: sr.ok, label, error: sr.ok ? undefined : r.error });
      } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/adopt' && req.method === 'POST') {
    readBody(req, res, async (p) => {
      try {
        const rows = await collectSessions({ minutes: 4320 });
        const s = rows.find((r) => r.sessionId === p.session || r.shortId === p.session);
        if (!s) return sendJSON(res, 400, { ok: false, error: 'session not found' });
        const label = manage.uniqueLabel(s.label || s.shortId, s.sessionId);
        const r = manage.adopt(label, s.sessionId, s.cwd, { capture: false });
        if (r.ok) manage.deliverAdopted(r.label, '');
        sendJSON(res, r.ok ? 200 : 400, r);
      } catch (e) { sendJSON(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/board') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(BOARD.replace('__META__', () => jsonForScript({ statuses: statusMeta() })));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(PAD.replace('__CONFIG__', () => jsonForScript(launchConfig())).replace('__MODEL__', () => swarm.MODEL));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

function openBrowser(url) {
  if (process.platform === 'darwin') execFile('open', [url]);
  else if (process.platform === 'linux') execFile('xdg-open', [url]);
  else console.log(`open ${url}`);
}

function main() {
  const args = parseArgs(process.argv);
  const url = `http://localhost:${args.port}`;
  const server = http.createServer(handle);

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      const req = http.get({ host: '127.0.0.1', port: args.port, path: '/api/config', timeout: 1500 }, (r) => {
        let d = ''; r.on('data', (c) => d += c);
        r.on('end', () => {
          if (d.includes('"topologies"')) {
            console.log(`🎼 Conductor V2 is already running → ${url}  (opening it)`);
            if (args.open) openBrowser(url);
            process.exit(0);
          } else {
            console.error(`Port ${args.port} is in use by something else. Try: conductor2 up --port 8080`);
            process.exit(1);
          }
        });
      });
      req.on('error', () => { console.error(`Port ${args.port} is busy. Try: conductor2 up --port 8080`); process.exit(1); });
      req.on('timeout', () => { req.destroy(); console.error(`Port ${args.port} is busy. Try: conductor2 up --port 8080`); process.exit(1); });
      return;
    }
    console.error('conductor2 server error:', e.message);
    process.exit(1);
  });

  server.listen(args.port, '127.0.0.1', () => {
    console.log(`🎼 Conductor V2 launch pad → ${url}  (Ctrl+C to stop)`);
    if (args.open) openBrowser(url);
  });
}

if (require.main === module) main();
module.exports = { handle, launchConfig };
