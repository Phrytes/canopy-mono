// helpAnswer.js — the pure, offline help-answer engine behind the standing
// help Q&A. It ports the onderling.org site matcher (the two deterministic,
// no-network layers) so answers stay identical across the site and the app:
//
//   layer 0 — word rules: self-referential questions ("who are you?", "where
//             does my question go?") and greetings, matched by regex first.
//   layer 1 — tag/heading overlap: score each card on how many query words hit
//             its per-language tags (and an exact heading word), function words
//             stoplisted; the best card wins if it clears the threshold.
//
// There is NO layer 2 here. A miss returns null — that null is exactly where a
// caller may later offer the consent-gated language-model fallback. The engine
// itself never calls a network or a model; it only ever returns human-written
// cards, with a transparency source label saying so.
//
// Pure: no DOM, no network, no storage. answerHelp(query, { lang }) is the
// whole surface; helpTopics({ lang }) lists the answerable headings.

import { helpDeck } from './kaartjes.js';

// Layer-0 word rules, per language. A rule maps a query pattern to a card id,
// or to '@opening' for the bare greeting. Ported verbatim from the site matcher.
const RULES = {
  nl: [
    [/\b(deze|mijn|m'n) vraag\b|waar gaat .*vraag/, 'veilig.dezevraag'],
    [/wie ben (jij|je)\b|wat ben (jij|je)\b|ben (jij|je) een (bot|ai|mens)/, 'meta.bot'],
    [/^(hoi|hallo|hey|hee|goedemorgen|goedemiddag|goedenavond|dag)[!. ]*$/, '@opening'],
  ],
  en: [
    [/\b(this|my) question\b|where does .*question go/, 'veilig.dezevraag'],
    [/who are you|what are you\b|are you a (bot|an ai|human)/, 'meta.bot'],
    [/^(hi|hello|hey|good (morning|afternoon|evening))[!. ]*$/, '@opening'],
  ],
};

// Function words that made every question look like every card — stoplisted
// before scoring. Ported verbatim from the site matcher.
const STOP = {
  nl: ('de het een en of te dat dit deze die is zijn ben bent was wat wie hoe waar welke wanneer ' +
       'ik jij je u we wij jullie ze zij mijn jouw er kan kun kunnen moet moeten mag mogen wil willen ' +
       'wordt worden gaat gaan doet doen heeft hebben had niet wel ook nog al naar van voor met over aan als bij op in uit om dan zo').split(' '),
  en: ('the a an and or of to for with about at as also on by in out is are am was were be been do does did ' +
       'what who how where why which when i you we they my your it its can could must may will would want ' +
       'not no yes there this that these those go goes have has had').split(' '),
};

function createMatcher(deck, lang) {
  const stop = STOP[lang];
  function words(s) {
    const norm = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = norm.replace(/[^a-z0-9@/*]+/g, ' ').split(' ').filter(Boolean);
    return list.filter((w) => stop.indexOf(w) === -1);
  }
  // exact hit = 2, prefix-stem hit = 1 ("kost" ~ "kosten"), miss = 0.
  // Exact must outrank stem, or "werkt" ~ "werk" ties a real "telefoon".
  function hits(word, list) {
    let stem = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t === word) return 2;
      if (word.length >= 4 && t.length >= 4 && (t.indexOf(word) === 0 || word.indexOf(t) === 0)) stem = 1;
    }
    return stem;
  }
  // → { type: 'opening' } | { type: 'kaartje', id, layer } | { type: 'fallback' }
  function match(q) {
    const low = q.toLowerCase();
    const rules = RULES[lang];
    for (let r = 0; r < rules.length; r++) {
      if (rules[r][0].test(low)) {
        return rules[r][1] === '@opening'
          ? { type: 'opening', layer: 0 }
          : { type: 'kaartje', id: rules[r][1], layer: 0 };
      }
    }
    const qw = words(q);
    let best = null, bestScore = 0;
    for (let i = 0; i < deck.kaartjes.length; i++) {
      const k = deck.kaartjes[i];
      if (k.id === deck.fallbackId) continue;
      const tags = k.tags[lang], kw = words(k.kop[lang]);
      let score = 0;
      for (let j = 0; j < qw.length; j++) {
        // tag hit (exact 2 / stem 1) plus an exact heading hit (1) — they
        // stack, so "kost" (stem of kosten) + heading "Wat kost het?" = 2.
        score += hits(qw[j], tags) + (hits(qw[j], kw) === 2 ? 1 : 0);
      }
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return bestScore >= 2 ? { type: 'kaartje', id: best.id, layer: 1 } : { type: 'fallback' };
  }
  return { match, words };
}

function cardById(deck, id) {
  for (let i = 0; i < deck.kaartjes.length; i++) if (deck.kaartjes[i].id === id) return deck.kaartjes[i];
  return null;
}

// The transparency source. kind 'local' = answered on-device from a fixed,
// human-written card, no language model. label mirrors the site badge
// ("answered directly — no language model used"); cardId is the provenance
// (which card), or null for the bare greeting.
function localSource(deck, lang, cardId) {
  return { kind: 'local', label: deck.srcLocal[lang], cardId: cardId };
}

/**
 * answerHelp(query, { lang }) → { text, layer, source } | null
 *
 *   text   — the localized card text (or the greeting), human-written.
 *   layer  — 0 for a word-rule hit, 1 for a tag/heading overlap hit.
 *   source — { kind: 'local', label, cardId } transparency provenance.
 *
 * Returns null when nothing matches (the honest no-answer): the caller decides
 * whether to offer a consent-gated model fallback there.
 */
export function answerHelp(query, { lang } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  const deck = helpDeck;
  if (typeof query !== 'string' || !query.trim()) return null;

  const m = createMatcher(deck, l).match(query);

  if (m.type === 'opening') {
    return { text: deck.opening[l], layer: 0, source: localSource(deck, l, null) };
  }
  if (m.type === 'kaartje') {
    const k = cardById(deck, m.id);
    if (!k) return null;
    return { text: k[l], layer: m.layer, source: localSource(deck, l, k.id) };
  }
  // fallback / no match → null (the consent-gated model fallback lives here).
  return null;
}

/**
 * helpTopics({ lang }) → [{ id, kop }]
 *
 * The answerable topics, as their localized headings — the material a caller
 * builds a slash-command help list or "or pick one" chips from. Excludes the
 * fallback (no-answer) card.
 */
export function helpTopics({ lang } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  const deck = helpDeck;
  return deck.kaartjes
    .filter((k) => k.id !== deck.fallbackId)
    .map((k) => ({ id: k.id, kop: k.kop[l] }));
}
