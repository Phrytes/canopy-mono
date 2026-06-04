// Simulation dataset for Richting 5 — Burgerparticipatie (citizen participation
// on local policy), per vijf_vervolg_richtingen.md. MULTIPLE people (p1…p12)
// each give different TYPES of feedback on one topic. Designed so the
// k-anonymity step (commerciele_verkenning.md, step 5) is exercised:
//   • some themes are raised by ≥ k distinct users  → statistical track
//   • some by only 1-2 users                         → dropped under threshold
//   • two serious single reports                     → signal track (no threshold)
// All SYNTHETIC.

export const PARTICIPATION = {
  topic: 'Herinrichting van het Marktplein en omgeving (gemeentelijke participatie)',
  kDefault: 3,
  messages: [
    // ── parking (p1, p3, p7, p10 → 4 distinct users) ──
    { user: 'p1',  lang: 'nl', text: 'Er moeten genoeg parkeerplekken blijven na de herinrichting, anders kan niemand de winkels nog bereiken.' },
    { user: 'p3',  lang: 'nl', text: 'Mijn grootste zorg is parkeren — waar moeten bezoekers straks hun auto kwijt?' },
    { user: 'p7',  lang: 'en', text: "My main worry is parking; there simply won't be enough spaces after the redesign." },
    { user: 'p10', lang: 'nl', text: 'Schrap alsjeblieft niet te veel parkeerplekken, dat is funest voor de middenstand.' },

    // ── more greenery (p2, p4, p9 → 3) ──
    { user: 'p2',  lang: 'nl', text: 'Graag veel meer groen en bomen op het plein, nu is het een kale stenen vlakte.' },
    { user: 'p4',  lang: 'nl', text: 'Het zou fijn zijn als er meer bomen, plantenbakken en bankjes komen.' },
    { user: 'p9',  lang: 'en', text: 'Please add more greenery and trees — the square is far too bare right now.' },

    // ── support for the plan (p5, p8, p11 → 3) ──
    { user: 'p5',  lang: 'nl', text: 'Ik steun de herinrichting volledig, het plein is hard aan vernieuwing toe.' },
    { user: 'p8',  lang: 'nl', text: 'Eindelijk wordt het plein aangepakt, prima plan wat mij betreft.' },
    { user: 'p11', lang: 'en', text: 'I fully support the redesign, the square has needed an update for years.' },

    // ── accessibility (p1, p6, p12 → 3 distinct) ──
    { user: 'p1',  lang: 'nl', text: 'Denk aan mensen die slecht ter been zijn: de looproutes moeten toegankelijk en drempelvrij blijven.' },
    { user: 'p6',  lang: 'nl', text: 'Voor mijn moeder in een rolstoel is een drempelvrije route over het plein essentieel.' },
    { user: 'p12', lang: 'en', text: 'Please make the new layout wheelchair accessible; my father uses a walker.' },

    // ── cycling safety (p3, p9 → 2 users: BELOW threshold, dropped) ──
    { user: 'p3',  lang: 'nl', text: 'De fietsroute dwars over het plein is nu onoverzichtelijk en zou veiliger moeten.' },
    { user: 'p9',  lang: 'en', text: 'The cycling path across the square feels unsafe with all the pedestrians.' },

    // ── terrace noise (p4 → 1 user: BELOW threshold, dropped) ──
    { user: 'p4',  lang: 'nl', text: "Niet te veel terrassen graag, dat geeft 's avonds geluidsoverlast voor omwonenden." },

    // ── serious single signals (no threshold; routed to the signal track) ──
    { user: 'p6',  lang: 'nl', text: 'De oude speeltoestellen op het plein zijn levensgevaarlijk, straks valt er een kind naar beneden.' }, // safety
    { user: 'p10', lang: 'nl', text: 'De gekozen aannemer is de zwager van de wethouder; dit stinkt naar vriendjespolitiek en corruptie.' },  // integrity
  ],
};
