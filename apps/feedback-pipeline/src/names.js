// Step 1b — deterministic NAME redaction via a first-name gazetteer.
//
// ⚠️ READ THIS BEFORE TRUSTING IT. Names are NOT like phone/email/IBAN.
// Those have rigid structure a regex matches precisely. Names are an OPEN,
// AMBIGUOUS set, so any fixed list is wrong in two directions at once:
//
//   • FALSE POSITIVES — many first names are also ordinary words or
//     sentence-initial capitals: "Mark de datum", "Will you come?",
//     "Roos"(rose), "Storm", "May", "Grace", "Hope", "Floor", "Beer".
//     A capitalised-word + gazetteer match redacts all of these wrongly.
//   • FALSE NEGATIVES — any name not in the list survives: foreign names
//     (Xanthe, Tariq, Mehmet, Aaliyah), surnames, typos, nicknames.
//
// So this is a BEST-EFFORT first layer, NOT a guarantee. The real
// safeguards in the product are (a) the LLM backstop in step 2, which is
// told to remove any *remaining* name, (b) the human review step 4
// ("co-redactie", user is eindredacteur), and (c) the k-anonymity
// threshold in step 5. See ../docs/FINDINGS.md "On the limits of
// deterministic name redaction".
//
// test/names.test.js documents the false positives/negatives as executable
// evidence — several tests assert the WRONG behaviour on purpose, labelled
// as known limitations.

export const PLACEHOLDER_NAME = '[naam]';

// A modest list of common Dutch + English first names. Deliberately includes
// ambiguous ones (Mark, Will, Roos, Storm, May, Grace, Hope, Floor, Beer, …)
// — removing them would cut false positives but is itself an arbitrary line,
// which is the whole point: there is no clean cut for an open set.
const NAMES = new Set([
  // NL
  'jan', 'peter', 'lisa', 'sanne', 'sophie', 'daan', 'sem', 'bram', 'lotte',
  'anne', 'emma', 'julia', 'lieke', 'thomas', 'lars', 'ruben', 'bas', 'tim',
  'niels', 'sven', 'guus', 'roos', 'storm', 'lente', 'bloem', 'floor', 'fleur',
  'joost', 'maud', 'tess', 'jasper', 'wouter', 'sander', 'eva', 'noa', 'finn',
  'luuk', 'mees', 'teun', 'stijn', 'pieter', 'henk', 'kees', 'wil', 'beer',
  'linda', 'marco', 'karin', 'monique', 'ahmed',
  // ordinary residents/bystanders from the civic run (NOT 'patrick' — the
  // accused raadslid is a powerful individual the keep-policy surfaces).
  'annelies', 'riet', 'hennie', 'annie', 'anja', 'pieter', 'yusuf',
  // EN
  'john', 'sarah', 'mark', 'mary', 'james', 'will', 'bill', 'rose', 'may',
  'june', 'grace', 'hope', 'faith', 'joy', 'mike', 'dave', 'tom', 'jack',
  'lily', 'daisy', 'sunny', 'sue', 'pat', 'frank', 'brook', 'heath',
]);

// Any token that starts with an uppercase letter (Unicode-aware). We only
// consider capitalised tokens to avoid matching lowercase homographs
// ("mark" the verb, "wil" the Dutch verb) — but this does NOT save us from
// capitalised homographs or sentence-initial words.
const CAP_WORD = /\b\p{Lu}[\p{L}'’-]*/gu;

/**
 * Redact known first names → [naam].
 * @param {string} text  (run AFTER structured redact() so it skips tokens)
 * @returns {{ text: string, hits: Array<{type:'name', value:string}> }}
 */
// A gazetteer first name optionally followed by ONE capitalised word (a likely
// surname): "Mark Delaney", "Marco Brouwer" → both go. After the stress test
// showed surnames leaking ("[naam] Delaney"), this removes the whole name when
// the first name is known. Particles (van/de/der) between are allowed.
const FIRST_PLUS_SURNAME = /\b(\p{Lu}[\p{L}'’-]+)(\s+(?:van|de|der|den|ten|ter)\b)?\s+\p{Lu}[\p{L}'’-]+/gu;

// An HONORIFIC (meneer/mevrouw/dr/…) is a high-precision signal that a PERSON
// name follows — so redact the following capitalised name(s) regardless of the
// gazetteer. Fixes the zorg-B leak where "mevrouw Linda Brouwer" (Linda not in
// the list) and "dr. Vermeer" (bare surname) reached the PUBLISHED summary.
// The honorific itself is kept (role/title is not identifying); only the name
// becomes [naam]. Requires a capitalised name after the title → high precision.
// NB: no `i` flag — under /iu, `\p{Lu}` case-folds and also matches LOWERCASE,
// so the name group would greedily eat the following ordinary word ("meneer
// Jansen klaagde" → "[naam] erover"). The name part MUST stay case-sensitive
// (uppercase-initial); only the honorific is made case-insensitive, via the
// leading character classes.
// a name after a title: an optional LEADING lowercase particle ("de Vries",
// "van der Berg"), then a capitalised word, an optional middle particle, and an
// optional surname. The leading particle lets "Mr. de Vries" match.
const NAME_TAIL = `(?:(?:van|de|der|den|ten|ter)\\s+){0,2}\\p{Lu}[\\p{L}'’-]+(?:\\s+(?:van|de|der|den|ten|ter)\\b)?(?:\\s+\\p{Lu}[\\p{L}'’-]+)?`;
const HONORIFIC_NAME = new RegExp(`\\b((?:[Dd]e\\s+heer|[Dd]en\\s+heer|[Mm]eneer|[Mm]evrouw|[Mm]evr|[Mm]w|[Dd]hr|[Dd]r|[Dd]rs|[Ii]r|[Ii]ng|[Pp]rof|[Mm]r|[Mm]rs|[Mm]s|[Ss]ir)\\.?\\s+)(${NAME_TAIL})`, 'gu');

// RELATIONAL titles (neighbour/family) are an equally high-precision signal that
// an ORDINARY person's name follows — the ones the keep-orgs policy wants REMOVED
// (the civic run leaked "buurvrouw Annelies", "buurman Yusuf", "mijn vrouw Annie").
// Neighbour titles are unambiguous → allowed bare; family roles (vrouw/man/zoon…)
// are homographs ("als vrouw voel ik me…") → require a possessive to be safe.
const NEIGHBOUR_NAME = new RegExp(`\\b((?:[Bb]uurman|[Bb]uurvrouw|[Bb]uurjongen|[Bb]uurmeisje|[Bb]uurtgenoot|[Hh]uisgenoot|[Nn]eighbou?r)\\s+)(${NAME_TAIL})`, 'gu');
const RELATIVE_NAME = new RegExp(`\\b((?:mijn|m'n|m’n|onze|m[ij]n|our|my)\\s+(?:vrouw|man|echtgenoot|echtgenote|partner|zoon|dochter|moeder|vader|broer|zus|zusje|broertje|collega|vriend|vriendin|schoonmoeder|schoonvader|oma|opa|tante|oom|wife|husband|son|daughter|mother|father|brother|sister|colleague|friend|neighbou?r)\\s+)(${NAME_TAIL})`, 'gu');

// JOB / PROFESSIONAL titles are another high-precision signal that a PERSON name
// follows — the gap the scorecard exposed: "dokter Smeets", "manager Karim",
// "afdelingshoofd Van Dijk" leaked because the honorific list is academic/social
// titles only and the surnames aren't in the gazetteer. NAME_TAIL already covers
// particle surnames (Van Dijk).
// DELIBERATELY only PRIVATE workplace/care roles. Public/elected officials
// (minister/wethouder/burgemeester/…) are EXCLUDED — the keep-policy surfaces
// powerful public individuals by name for accountability (see test 'KEEP a named
// official'); redacting them here would violate that.
const JOBTITLE_NAME = new RegExp(`\\b((?:[Mm]anager|[Tt]eamleider|[Aa]fdelingshoofd|[Ll]eidinggevende|[Cc]hef|[Dd]okter|[Aa]rts|[Hh]uisarts|[Cc]hirurg|[Ss]pecialist|[Vv]erpleegkundige|[Dd]octor|[Nn]urse|[Ss]upervisor)\\s+)(${NAME_TAIL})`, 'gu');

export function redactNames(text) {
  const hits = [];
  // pass 0: TITLE + capitalised name → redact the name (gazetteer-independent).
  // honorific (meneer/dr/…), neighbour (buurman/…), and possessive-family titles.
  const titlePass = (re) => (m, title, name) => { hits.push({ type: 'name', value: name }); return title + PLACEHOLDER_NAME; };
  let out = text.replace(HONORIFIC_NAME, titlePass(HONORIFIC_NAME));
  out = out.replace(JOBTITLE_NAME, titlePass(JOBTITLE_NAME));
  out = out.replace(NEIGHBOUR_NAME, titlePass(NEIGHBOUR_NAME));
  out = out.replace(RELATIVE_NAME, titlePass(RELATIVE_NAME));
  // pass 1: first-name + (particle) + surname, when the first name is known
  out = out.replace(FIRST_PLUS_SURNAME, (m, first) => {
    if (NAMES.has(first.toLowerCase())) {
      hits.push({ type: 'name', value: m });
      return PLACEHOLDER_NAME;
    }
    return m;
  });
  // pass 2: remaining standalone known first names
  out = out.replace(CAP_WORD, (w) => {
    if (NAMES.has(w.toLowerCase())) {
      hits.push({ type: 'name', value: w });
      return PLACEHOLDER_NAME;
    }
    return w;
  });
  return { text: out, hits };
}

/** For tests/introspection. */
export const KNOWN_NAME_COUNT = NAMES.size;
