/**
 * basis v2 — Onderling design tokens (canonical, portable).
 *
 * The "linen + serif + terracotta" design language (the reason for the v2
 * transition). Brand source: outreach/Onderling_v2/_chrome.css; layouts:
 * the 36-page "Canopy interface — interface-ontwerp · print.pdf" at repo root.
 *
 * This object is the single token source. The web mirror lives in
 * web/v2/theme.css (`:root` CSS vars with the SAME values — keep in sync);
 * the mobile theme (basis-mobile/src/screens/v2/theme.js) imports THEME
 * from here via '@onderling-app/basis'.
 */

export const THEME = {
  color: {
    ink:       '#1f1c14', // primary text
    inkSoft:   '#5a5240', // muted text, section labels
    paper:     '#f3efe2', // app background (linen)
    paper2:    '#ebe6d5', // card header strip / inset
    line:      '#d8d1bc', // borders / hairlines
    accent:    '#b04a30', // terracotta — primary buttons, active state
    accentInk: '#8a3a26', // terracotta text on light
    card:      '#fbf8ed', // framed-card inner / bot bubble
    meBg:      '#f6e6e0', // "me" chat bubble (warm)
    // status tokens (from the brand sheet + tag chips)
    green:   '#4a6230', greenBg: '#e0e7d2', // lokaal / AANBOD / "ongewijzigd"
    blue:    '#3f4f76', blueBg:  '#dde2ee', // betaald / VRAAG / "via hop"
    amber:   '#7a5a1f', amberBg: '#ede0c4', // LENEN
    danger:  '#b04a30', dangerBg:'#f6e6e0', // blocked / warning (reuses terracotta)
    trackOff:'#cfc7b0', // pill-toggle off track
    white:   '#ffffff',
  },
  font: {
    // Web font stacks. On mobile these names are remapped to the loaded
    // expo-font families in basis-mobile/src/screens/v2/theme.js.
    serif: '"Source Serif 4", "Iowan Old Style", Georgia, "Times New Roman", serif',
    sans:  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono:  'ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace',
  },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  space:  { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};

// Soft per-circle avatar tints (board 1B — each circle gets its own shade:
// periwinkle / sage / tan / beige / rose). Assigned by a stable hash of the
// circle id so a circle keeps its colour across renders.
export const AVATAR_TINTS = ['#e0e3f2', '#e0e7d2', '#ece2cf', '#ece6d6', '#f3e3df'];

export function circleTint(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

/**
 * Tag-chip palette keyed by the stream item kind (board 5/8). Returns
 * `{ fg, bg }`; unknown kinds fall back to the neutral ink-soft/line pair.
 */
export function tagColors(kind) {
  const c = THEME.color;
  switch (String(kind || '').toLowerCase()) {
    case 'vraag':
    case 'question':
    case 'hop':       return { fg: c.blue,  bg: c.blueBg };
    case 'aanbod':
    case 'offer':     return { fg: c.green, bg: c.greenBg };
    case 'lenen':
    case 'borrow':
    case 'loan':      return { fg: c.amber, bg: c.amberBg };
    case 'agent':     return { fg: c.inkSoft, bg: c.paper2 };
    default:          return { fg: c.inkSoft, bg: c.paper2 };
  }
}
