// Render a released report to localised text (the published artifact). Prose comes from the
// string table (src/strings curator section) — nothing hardcoded here.

import { getStrings } from '../strings/index.js';
import { renderTransparency } from './transparency.js';

export function renderReport(report, s = getStrings()) {
  const c = s.curator;
  const lines = [c.reportTitle(report.reportId), '', c.themesHeading];
  if (report.themes.length) {
    for (const t of report.themes) lines.push(c.themeLine(t.theme, t.userCount, t.summary));
  } else {
    lines.push(c.noThemes);
  }
  lines.push('', renderTransparency(report.counters, s));
  return lines.join('\n');
}
