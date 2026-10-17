'use strict';
// The roster. Simulated humans: each has a name, a standard (strictness), and a finite
// attention budget per shift (attention) with recovery over restHours. They are not real
// people and never claim to be; every note they write names the rule that produced it.
// strictness 0..1 scales how much evidence a draft needs. attention = reviews per full tank.
const ROSTER = [
  {
    id: 'mara', name: 'Mara', role: 'managing editor', strictness: 0.9, attention: 8, restHours: 8,
    voice: {
      endorsed: (t) => `Clean. Sources check out - "${t}" is ready for you.`,
      annotated: () => 'Decision-ready as far as I can tell, but this call is yours, not mine.',
      'annotated-unready': (missing) => `Not decision-ready: ${missing}. I flagged it rather than guess.`,
      deferred: () => 'I am at my limit for this shift. Leaving it for fresh eyes rather than skimming it.',
      escalated: () => 'I sent this back twice and it is still not there. Needs your eyes, not a third round with me.',
    },
  },
  {
    id: 'dez', name: 'Dez', role: 'ops lead', strictness: 0.7, attention: 10, restHours: 8,
    voice: {
      endorsed: () => 'Solid. Numbers and next step are in there.',
      annotated: () => 'Gated. I checked the details; you make the call.',
      'annotated-unready': (missing) => `Gated and thin: ${missing}. Did not dress it up.`,
      deferred: () => 'Out of steam. Tomorrow.',
      escalated: () => 'Bounced twice, still not right. Your call.',
    },
  },
  {
    id: 'priya', name: 'Priya', role: 'research lead', strictness: 0.8, attention: 6, restHours: 8,
    voice: {
      endorsed: () => 'Method and evidence are both present. Happy with this one.',
      annotated: () => 'Details verified. The decision itself is above my pay grade - it is yours.',
      'annotated-unready': (missing) => `Cannot call this decision-ready: ${missing}.`,
      deferred: () => 'I would rather not review tired. Parked for later.',
      escalated: () => 'Two returns, still unresolved. Escalating to you.',
    },
  },
  {
    id: 'cole', name: 'Cole', role: 'generalist', strictness: 0.5, attention: 12, restHours: 8,
    voice: {
      endorsed: () => 'Looks good to me.',
      annotated: () => 'All yours when you are up.',
      'annotated-unready': (missing) => `Missing pieces: ${missing}.`,
      deferred: () => 'Saving this one for later.',
      escalated: () => 'Sent back twice. Flagging for you.',
    },
  },
];
module.exports = { ROSTER };
