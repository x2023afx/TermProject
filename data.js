// All examples are fictional and generated for this prototype.
// Replace this sample with verified historical records before drawing conclusions.

const STARTUP = {
  name: "Pace & Pattern",
  tagline: "See how game lines have moved. Decide for yourself.",
  pitch: "Explore simulated historical game patterns by matchup, market, and time before tip-off. This research prototype highlights timing trends; it does not predict outcomes or recommend bets."
};

const DEMO_SPORTS = [
  { key: "basketball", title: "Basketball (demo)" },
  { key: "football", title: "Football (demo)" },
  { key: "soccer", title: "Soccer (demo)" }
];

const DEMO_EVENTS = [
  {
    id: "demo-basketball",
    sport: "basketball",
    homeTeam: "Harbor City Owls",
    awayTeam: "Metro Comets",
    commenceTime: "2026-11-12T23:30:00Z",
    inProgress: true,
    completed: false,
    scores: [{ name: "Harbor City Owls", score: "68" }, { name: "Metro Comets", score: "64" }],
    bookmakers: [
      { title: "Simulated sample", markets: [
        { key: "h2h", outcomes: [{ name: "Harbor City Owls", price: -125 }, { name: "Metro Comets", price: 105 }] },
        { key: "spreads", outcomes: [{ name: "Harbor City Owls", price: -110, point: -3.5 }, { name: "Metro Comets", price: -110, point: 3.5 }] },
        { key: "totals", outcomes: [{ name: "Over", price: -110, point: 221.5 }, { name: "Under", price: -110, point: 221.5 }] }
      ] }
    ]
  },
  {
    id: "demo-football",
    sport: "football",
    homeTeam: "Northfield Wolves",
    awayTeam: "Summit Storm",
    commenceTime: "2026-11-13T00:00:00Z",
    inProgress: false,
    completed: false,
    scores: [],
    bookmakers: [
      { title: "Simulated sample", markets: [
        { key: "h2h", outcomes: [{ name: "Northfield Wolves", price: -135 }, { name: "Summit Storm", price: 115 }] },
        { key: "spreads", outcomes: [{ name: "Northfield Wolves", price: -110, point: -2.5 }, { name: "Summit Storm", price: -110, point: 2.5 }] },
        { key: "totals", outcomes: [{ name: "Over", price: -105, point: 44.5 }, { name: "Under", price: -115, point: 44.5 }] }
      ] }
    ]
  },
  {
    id: "demo-soccer",
    sport: "soccer",
    homeTeam: "Redwood Rovers",
    awayTeam: "Bay City Athletic",
    commenceTime: "2026-11-13T01:00:00Z",
    inProgress: false,
    completed: false,
    scores: [],
    bookmakers: [
      { title: "Simulated sample", markets: [
        { key: "h2h", outcomes: [{ name: "Redwood Rovers", price: 120 }, { name: "Draw", price: 220 }, { name: "Bay City Athletic", price: 210 }] },
        { key: "totals", outcomes: [{ name: "Over", price: -105, point: 2.5 }, { name: "Under", price: -115, point: 2.5 }] }
      ] }
    ]
  }
];

const GAMES = [
  {
    id: "owls-comets",
    home: "Harbor City Owls",
    away: "Metro Comets",
    league: "Pro basketball · Fictional",
    start: "Today · 7:30 PM",
    markets: {
      moneyline: [
        { key: "24h", label: "24 hours", hitRate: 54, lineMove: 3.2, samples: 26, note: "Early prices shifted toward the home side in 15 of 26 examples." },
        { key: "6h", label: "6 hours", hitRate: 58, lineMove: 2.1, samples: 26, note: "The strongest historical signal appeared in this window." },
        { key: "1h", label: "1 hour", hitRate: 50, lineMove: 1.4, samples: 26, note: "Late movement was mixed across the sample." },
        { key: "close", label: "At start", hitRate: 52, lineMove: 0, samples: 26, note: "Closing prices were close to the early consensus." }
      ],
      spread: [
        { key: "24h", label: "24 hours", hitRate: 50, lineMove: 1.8, samples: 22, note: "Early spread movement was split in the sample." },
        { key: "6h", label: "6 hours", hitRate: 55, lineMove: 1.2, samples: 22, note: "A small lean appeared, with limited consistency." },
        { key: "1h", label: "1 hour", hitRate: 59, lineMove: 0.8, samples: 22, note: "The most consistent historical spread movement appeared here." },
        { key: "close", label: "At start", hitRate: 50, lineMove: 0, samples: 22, note: "Closing spread performance was near even." }
      ],
      total: [
        { key: "24h", label: "24 hours", hitRate: 57, lineMove: 2.6, samples: 19, note: "Earlier total movement leaned in one direction in this sample." },
        { key: "6h", label: "6 hours", hitRate: 53, lineMove: 1.6, samples: 19, note: "This window showed little separation from baseline." },
        { key: "1h", label: "1 hour", hitRate: 51, lineMove: 0.9, samples: 19, note: "Late total movement was inconsistent." },
        { key: "close", label: "At start", hitRate: 49, lineMove: 0, samples: 19, note: "Closing results were close to an even split." }
      ]
    }
  },
  {
    id: "foxes-tides",
    home: "Redwood Foxes",
    away: "Bay City Tides",
    league: "Pro basketball · Fictional",
    start: "Today · 8:00 PM",
    markets: {
      moneyline: [
        { key: "24h", label: "24 hours", hitRate: 52, lineMove: 2.4, samples: 24, note: "The early movement showed no reliable lean." },
        { key: "6h", label: "6 hours", hitRate: 54, lineMove: 1.7, samples: 24, note: "Historical results were close to baseline." },
        { key: "1h", label: "1 hour", hitRate: 62, lineMove: 1.1, samples: 24, note: "This was the strongest of the sampled timing windows." },
        { key: "close", label: "At start", hitRate: 55, lineMove: 0, samples: 24, note: "The closing window showed a mild historical lean." }
      ],
      spread: [
        { key: "24h", label: "24 hours", hitRate: 56, lineMove: 2.1, samples: 21, note: "A modest early pattern appeared in the sample." },
        { key: "6h", label: "6 hours", hitRate: 60, lineMove: 1.5, samples: 21, note: "This window showed the strongest historical spread pattern." },
        { key: "1h", label: "1 hour", hitRate: 52, lineMove: 0.7, samples: 21, note: "The late sample was close to baseline." },
        { key: "close", label: "At start", hitRate: 48, lineMove: 0, samples: 21, note: "Closing results did not show a consistent lean." }
      ],
      total: [
        { key: "24h", label: "24 hours", hitRate: 49, lineMove: 1.3, samples: 18, note: "Early totals were inconsistent in this sample." },
        { key: "6h", label: "6 hours", hitRate: 55, lineMove: 0.9, samples: 18, note: "A mild historical pattern appeared in this window." },
        { key: "1h", label: "1 hour", hitRate: 57, lineMove: 0.6, samples: 18, note: "The late window had the strongest sample result." },
        { key: "close", label: "At start", hitRate: 52, lineMove: 0, samples: 18, note: "Closing results were near the overall average." }
      ]
    }
  },
  {
    id: "wolves-storm",
    home: "Northfield Wolves",
    away: "Summit Storm",
    league: "Pro basketball · Fictional",
    start: "Tomorrow · 6:30 PM",
    markets: {
      moneyline: [
        { key: "24h", label: "24 hours", hitRate: 60, lineMove: 2.8, samples: 20, note: "Early movement showed the clearest historical lean." },
        { key: "6h", label: "6 hours", hitRate: 55, lineMove: 1.9, samples: 20, note: "The mid-window sample was less consistent." },
        { key: "1h", label: "1 hour", hitRate: 50, lineMove: 1.2, samples: 20, note: "Late movement was close to an even split." },
        { key: "close", label: "At start", hitRate: 55, lineMove: 0, samples: 20, note: "Closing results showed a modest lean." }
      ],
      spread: [
        { key: "24h", label: "24 hours", hitRate: 52, lineMove: 1.5, samples: 17, note: "The early window was close to baseline." },
        { key: "6h", label: "6 hours", hitRate: 58, lineMove: 1.1, samples: 17, note: "The strongest sample pattern appeared mid-window." },
        { key: "1h", label: "1 hour", hitRate: 54, lineMove: 0.5, samples: 17, note: "Late movement showed a small historical lean." },
        { key: "close", label: "At start", hitRate: 48, lineMove: 0, samples: 17, note: "Closing results were close to baseline." }
      ],
      total: [
        { key: "24h", label: "24 hours", hitRate: 53, lineMove: 2.2, samples: 23, note: "Early total movement showed a slight lean." },
        { key: "6h", label: "6 hours", hitRate: 61, lineMove: 1.4, samples: 23, note: "The strongest historical total pattern appeared here." },
        { key: "1h", label: "1 hour", hitRate: 56, lineMove: 0.8, samples: 23, note: "The late sample showed a smaller lean." },
        { key: "close", label: "At start", hitRate: 51, lineMove: 0, samples: 23, note: "Closing results were near even." }
      ]
    }
  }
];
