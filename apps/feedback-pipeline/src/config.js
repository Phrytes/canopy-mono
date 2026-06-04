// Project-level configuration.

// The language the aggregation/summaries are produced in. Cleaned messages are
// translated to this language BEFORE summarizing, so dedup compares like with
// like and every summary bullet is in one language. Override with FP_LANG.
// Default 'nl' — the product's primary market is Dutch (OR / zorg / UWV).
export const PREFERRED_LANGUAGE = (process.env.FP_LANG || 'nl').toLowerCase();

export const LANG_NAME = { nl: 'Dutch', en: 'English' };
export const langName = (code) => LANG_NAME[code] || 'Dutch';
