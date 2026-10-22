/* The Pocket: structured plan data derived from content.js (which stays verbatim).
   bpm: tempos in order of appearance in the day's own text or its week's structure text.
   subdiv: subdivisions the text names (1 quarter, 2 eighth, 3 triplets, 4 sixteenth); null if not named.
   suggest: an EDITORIAL hint, not from the source text. The UI must label it "suggested".
   min: default session timer length in minutes. seg: optional timer segments. */
window.POCKET_PLAN = (function () {
  var P = {
    1: { bpm: [60], subdiv: [1] },
    2: { bpm: [60], subdiv: [1] },
    3: { bpm: [60], subdiv: [1, 2] },
    4: { bpm: [60], subdiv: [1, 2] },
    5: { bpm: [60], subdiv: [1, 2, 4] },
    6: { bpm: [60], subdiv: [1, 2, 4] },
    7: { bpm: [60], subdiv: [1, 2, 4] },
    8: { bpm: [70], subdiv: null },
    9: { bpm: [70, 100], subdiv: null },
    10: { bpm: [70, 100, 130], subdiv: null },
    11: { bpm: [70], subdiv: null, suggest: { subdiv: 3, note: 'shuffle' } },
    12: { bpm: [70, 100], subdiv: null, suggest: { subdiv: 3, note: 'shuffle' } },
    13: { bpm: [70, 100], subdiv: null },
    14: { bpm: [70, 100, 130], subdiv: null },
    15: { bpm: [70], subdiv: [1] },
    16: { bpm: [70], subdiv: null },
    17: { bpm: [70], subdiv: null },
    18: { bpm: [85], subdiv: null },
    19: { bpm: [70], subdiv: null, suggest: { subdiv: 3, note: 'shuffle' } },
    20: { seg: [{ label: 'Pad', min: 10 }, { label: 'Guitar', min: 10 }] },
    22: { min: 15 }
  };
  for (var d = 1; d <= 28; d++) {
    var e = P[d] || (P[d] = {});
    if (!e.bpm) e.bpm = [];
    if (e.subdiv === undefined) e.subdiv = null;
    if (!e.min) e.min = 20;
  }
  return P;
})();
