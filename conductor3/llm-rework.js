#!/usr/bin/env node
'use strict';
// LLM rework pass for items the mechanical worker could not fix. Optional; does
// nothing without an enabled llm.json in the queue dir (see conductor3/llm.js).
// Local-first: ollama provider is free. openai-compatible is billable and requires
// the C3_LLM_KEY env var plus Yoshi's spend approval. Nothing is ever sent here.
const W = require('./overseer/worker');
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: llm-rework.js <queueDir>'); process.exit(2); }
  W.llmReworkPass(dir).then((a) => { for (const x of a) console.log(`${x.item}: ${x.rule} answered [llm]`); console.error(`llm answered ${a.length}`); });
}
