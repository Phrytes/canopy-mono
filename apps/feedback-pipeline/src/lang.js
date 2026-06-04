// Language detection (NL vs EN) + hybrid resolution for routing to a
// monolingual clean prompt.
//
// Detection uses ELD (Efficient Language Detector) restricted to {nl, en} —
// an n-gram model that is far more robust on short/real text than the old
// stopword heuristic, and the foundation for going beyond NL/EN later.
// Borrowed approach from Klai's stack (they use Lingua for the same job); see
// ../docs/KLAI-evaluation.md.
//
// The HYBRID resolver is unchanged and still matters: ELD is confident even on
// a 3-word English phrase, but a Dutch user dropping one English line should
// NOT flip the whole message's processing. So very short / token-only messages
// are treated as low-signal and we lean on the per-user default.

import { eld } from 'eld/medium';
try { eld.dynamicLangSubset(['nl', 'en']); } catch { /* full set is fine too */ }

/**
 * Detect NL vs EN for a single message.
 * @returns {{ lang:'nl'|'en'|'unknown', confidence:'high'|'medium'|'low'|'none', nl:number, en:number }}
 */
export function detectLang(text) {
  // [tokens] are not language — strip them so a redacted message reads as
  // "no signal", not as Dutch (the placeholder words are Dutch).
  const stripped = String(text).replace(/\[[^\]]*\]/g, ' ');
  const words = (stripped.match(/[a-zà-ÿ][a-zà-ÿ'’-]*/gi) || []);
  // Need a few real words to say anything; one word leans on the default.
  if (words.length < 2) return { lang: 'unknown', confidence: 'none', nl: 0, en: 0 };

  const r = eld.detect(stripped);
  const scores = (r.getScores && r.getScores()) || {};
  const nl = scores.nl || 0, en = scores.en || 0;
  let lang = r.language === 'nl' || r.language === 'en' ? r.language : (nl === en ? 'unknown' : (nl > en ? 'nl' : 'en'));

  const reliable = r.isReliable ? r.isReliable() : false;
  const margin = Math.abs(nl - en);
  const short = words.length < 4;
  let confidence;
  if (lang === 'unknown' || !reliable) confidence = 'low';
  else if (short || margin < 0.2) confidence = 'medium';  // reliable but too thin to OVERRIDE a default
  else confidence = 'high';
  return { lang, confidence, nl, en };
}

/**
 * Hybrid resolution: a per-user default is the spine; per-message detection
 * only OVERRIDES it when the message is high-confidence the OTHER language.
 * Without a user default, fall back to detection, then to `fallback`.
 *
 * @param {{ text:string, userDefault?:'nl'|'en', fallback?:'nl'|'en' }} p
 * @returns {{ lang:'nl'|'en', source:'default'|'override'|'detected'|'fallback', detected:object }}
 */
export function resolveLang({ text, userDefault, fallback = 'en' }) {
  const detected = detectLang(text);
  if (userDefault) {
    if (detected.lang !== 'unknown' && detected.lang !== userDefault && detected.confidence === 'high') {
      return { lang: detected.lang, source: 'override', detected };
    }
    return { lang: userDefault, source: 'default', detected };
  }
  if (detected.lang !== 'unknown') return { lang: detected.lang, source: 'detected', detected };
  return { lang: fallback, source: 'fallback', detected };
}
