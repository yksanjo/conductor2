'use strict';

// Conductor V2 topologies — the three swarm shapes and the role briefing each agent gets.
//
// A swarm is N Claude Code windows in the conductor2 tmux session that coordinate through
// two dumb, reliable channels:
//   files     — a shared swarm directory (~/.conductor2/swarms/<name>/) for artifacts
//   messages  — `swarm-say <window> "<one line>"` (tmux send-keys), for handoffs/pings
//
// The topology decides WHO talks to WHOM and WHO starts. Everything else (what to actually
// do) comes from the purpose + the per-agent briefing built here. Briefings are written to
// disk and each window is kicked off with a one-liner pointing at its briefing file — long
// multi-line prompts never travel through tmux send-keys.

// Shared rules every agent gets, regardless of topology.
function commonRules(ctx, self) {
  const peers = ctx.agents
    .map((a) => `  - ${a.window}${a.window === self.window ? '  ← YOU' : ''} — ${a.role}`)
    .join('\n');
  return `# Swarm briefing — agent "${self.window}"

You are one agent in the swarm **${ctx.swarm}** (topology: ${ctx.topology}). You are NOT alone:
every window below is a live Claude Code session working the same mission.

## Mission
${ctx.purpose}

## The swarm
${peers}

## Shared ground
- Swarm directory: \`${ctx.dir}\` — mission.md, out/ (artifacts), notes/ (scratch).
- Write real work products to \`${ctx.dir}/out/\`. Files are the source of truth.
- Message another agent with: \`${ctx.sayPath} <window> "<message>"\` (Bash). ONE LINE only —
  put anything longer in a file under the swarm directory and send a pointer to it.
- Never message a window not listed above. Never kill or restart other windows.
- Sign messages with your window name so the receiver knows who is talking.
`;
}

const TOPOLOGIES = {
  hierarchical: {
    key: 'hierarchical',
    name: 'Hierarchical',
    sub: 'Orchestrator → Workers',
    emoji: '🏛',
    diagram: '      ┌─ ORC ─┐\n  ┌───┼───┬───┼───┐\n  w1  w2  w3  w4',
    desc: 'One orchestrator decomposes the mission, delegates one task per worker, collects reports, and synthesizes the final result. Best for missions that split into independent chunks.',
    minAgents: 2,
    // n = total windows (orchestrator + n-1 workers)
    roles(n, hints = []) {
      const out = [{ slot: 'orc', role: 'orchestrator', initiator: true }];
      for (let i = 1; i < n; i++) {
        out.push({ slot: `w${i}`, role: hints[i - 1] || `worker ${i}`, initiator: false });
      }
      return out;
    },
    briefing(ctx, self) {
      if (self.slot === 'orc') {
        const workers = ctx.agents.filter((a) => a.slot !== 'orc');
        return commonRules(ctx, self) + `
## Your role: ORCHESTRATOR
You own the mission end to end. Do not do the leg work yourself — delegate it.

1. Decompose the mission into ${workers.length} independent task(s), one per worker. Suggested
   angles are in each worker's role above — refine them against the mission.
2. For each worker, write the full task spec to \`${ctx.dir}/out/tasks/<window>.md\`
   (context, exact deliverable, where to write it), then dispatch it:
   \`${ctx.sayPath} <window> "TASK from ${self.window}: read ${ctx.dir}/out/tasks/<window>.md and execute it."\`
3. Workers report back by message when done. While waiting, prepare the synthesis skeleton.
4. When all reports are in (check \`${ctx.dir}/out/reports/\`), synthesize everything into
   \`${ctx.dir}/out/REPORT.md\` — the single deliverable a human reads. Resolve conflicts
   between workers; if two reports disagree, say so explicitly.
5. Announce completion to every worker, thank them, and finish with a summary of REPORT.md.
`;
      }
      return commonRules(ctx, self) + `
## Your role: WORKER (${self.role})
You work ONLY on the task the orchestrator (${ctx.agents[0].window}) sends you.

1. WAIT. Do nothing until a message from ${ctx.agents[0].window} arrives in this window.
2. When tasked, read your task file, execute it thoroughly, and write your deliverable to
   \`${ctx.dir}/out/reports/${self.window}.md\`.
3. Report back: \`${ctx.sayPath} ${ctx.agents[0].window} "DONE ${self.window}: report at ${ctx.dir}/out/reports/${self.window}.md — <one-line headline>"\`
4. Stay available — the orchestrator may send follow-up questions.
`;
    },
  },

  pipeline: {
    key: 'pipeline',
    name: 'Pipeline',
    sub: 'Sequential stages',
    emoji: '⛓',
    diagram: '  s1 ──▶ s2 ──▶ s3 ──▶ s4\n  each stage hands off\n  to the next',
    desc: 'Stages run in order; each consumes the previous stage\'s output and hands off to the next. Best for missions with a natural order — recon → analyze → verify → report.',
    minAgents: 2,
    roles(n, hints = []) {
      const out = [];
      for (let i = 1; i <= n; i++) {
        out.push({ slot: `s${i}`, role: hints[i - 1] || `stage ${i}`, initiator: i === 1 });
      }
      return out;
    },
    briefing(ctx, self) {
      const idx = ctx.agents.findIndex((a) => a.window === self.window);
      const prev = ctx.agents[idx - 1];
      const next = ctx.agents[idx + 1];
      const stageList = ctx.agents.map((a, i) => `  ${i + 1}. ${a.window} — ${a.role}`).join('\n');
      let body = `
## Your role: STAGE ${idx + 1} of ${ctx.agents.length} (${self.role})
The pipeline, in order:
${stageList}

Your output file: \`${ctx.dir}/out/stage-${idx + 1}-${self.slot}.md\`
`;
      body += prev
        ? `
1. WAIT. Do nothing until ${prev.window} messages you that its stage is complete.
2. Read ALL earlier stage outputs in \`${ctx.dir}/out/\` (your inputs), then do your stage.
`
        : `
1. You start the pipeline — begin IMMEDIATELY, no one will message you.
2. Do your stage from the mission alone.
`;
      body += next
        ? `3. Write your output file, then hand off:
   \`${ctx.sayPath} ${next.window} "HANDOFF from ${self.window}: stage ${idx + 1} done — read ${ctx.dir}/out/ and begin your stage."\`
4. Stay available for questions from later stages.
`
        : `3. You are the FINAL stage: fold everything into \`${ctx.dir}/out/REPORT.md\` — the single
   deliverable a human reads — then finish with a summary of it.
`;
      return commonRules(ctx, self) + body;
    },
  },

  mesh: {
    key: 'mesh',
    name: 'Mesh',
    sub: 'Peer-to-peer',
    emoji: '🕸',
    diagram: '  p1 ─── p2\n   │ ╲ ╱ │\n   │ ╱ ╲ │\n  p3 ─── p4',
    desc: 'Equal peers self-organize: each claims a distinct angle, works it, and broadcasts findings to the others. Peer 1 doubles as scribe and merges the final report. Best for open-ended exploration.',
    minAgents: 2,
    roles(n, hints = []) {
      const out = [];
      for (let i = 1; i <= n; i++) {
        out.push({ slot: `p${i}`, role: (hints[i - 1] || `peer ${i}`) + (i === 1 ? ' + scribe' : ''), initiator: true });
      }
      return out;
    },
    briefing(ctx, self) {
      const idx = ctx.agents.findIndex((a) => a.window === self.window);
      const others = ctx.agents.filter((a) => a.window !== self.window);
      let body = `
## Your role: PEER (${self.role})
All peers start at once and self-organize. Claims file: \`${ctx.dir}/notes/claims.md\`.

1. Read \`${ctx.dir}/notes/claims.md\` (create it if missing), pick an angle of the mission
   NOT yet claimed (your suggested angle: "${self.role}"), and append one line:
   \`- ${self.window}: <angle>\`. If your angle is taken, pick the nearest free one.
2. Work your angle. Write findings to \`${ctx.dir}/out/${self.window}.md\` as you go.
3. When you learn something another peer needs, tell them directly:
   \`${ctx.sayPath} <window> "FYI from ${self.window}: <one line>"\`
4. When done, broadcast to every other peer:
${others.map((o) => `   \`${ctx.sayPath} ${o.window} "DONE ${self.window}: findings at ${ctx.dir}/out/${self.window}.md"\``).join('\n')}
`;
      if (idx === 0) {
        body += `
## Your extra role: SCRIBE
You also own the final deliverable. Once every peer (including you) has a findings file in
\`${ctx.dir}/out/\` — peers announce DONE by message — merge everything into
\`${ctx.dir}/out/REPORT.md\`, resolving disagreements explicitly, then finish with a summary.
`;
      }
      return commonRules(ctx, self) + body;
    },
  },
};

function list() {
  return Object.values(TOPOLOGIES).map((t) => ({
    key: t.key, name: t.name, sub: t.sub, emoji: t.emoji, diagram: t.diagram, desc: t.desc, minAgents: t.minAgents,
  }));
}

function get(key) {
  const t = TOPOLOGIES[String(key || '').toLowerCase()];
  if (!t) throw new Error(`unknown topology "${key}" (have: ${Object.keys(TOPOLOGIES).join(', ')})`);
  return t;
}

module.exports = { TOPOLOGIES, list, get };
