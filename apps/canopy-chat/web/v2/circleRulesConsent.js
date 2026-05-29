/**
 * canopy-chat v2 — circle rules consent (web DOM renderer, board 3C).
 *
 * The assembled rules document shown read-only to a joiner, with
 * Agree / Decline. Only non-blank fields render. Pure: the host passes the
 * `doc` + handlers + `t`. (Threading this into the real join flow is the
 * follow-on; for now it's reachable as a preview from the editor.)
 */
import { RULES_FIELDS, normalizeRulesDoc, isRulesEmpty } from '../../src/v2/circleRules.js';

export function renderRulesConsent(container, { doc = {}, t, onAgree, onDecline, onBack } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const d = normalizeRulesDoc(doc);
  container.innerHTML = '';
  container.classList.add('circle-rules-consent');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-rules-consent__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-rules-consent__title';
  head.textContent = tr('circle.rules.consent_title');
  container.appendChild(head);

  if (isRulesEmpty(d)) {
    const empty = document.createElement('div');
    empty.className = 'circle-rules-consent__empty';
    empty.textContent = tr('circle.rules.consent_empty');
    container.appendChild(empty);
  } else {
    const doc_ = document.createElement('div');
    doc_.className = 'circle-rules-consent__doc';
    for (const key of RULES_FIELDS) {
      if (!d[key].trim()) continue;
      const sec = document.createElement('section');
      sec.className = 'circle-rules-consent__field';
      sec.dataset.field = key;
      const h = document.createElement('h3');
      h.className = 'circle-rules-consent__q';
      h.textContent = tr(`circle.rules.q.${key}`);
      const p = document.createElement('p');
      p.className = 'circle-rules-consent__a';
      p.textContent = d[key];
      sec.append(h, p);
      doc_.appendChild(sec);
    }
    container.appendChild(doc_);
  }

  const actions = document.createElement('div');
  actions.className = 'circle-rules-consent__actions';
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'circle-rules-consent__decline';
  decline.textContent = tr('circle.rules.decline');
  decline.addEventListener('click', () => { if (typeof onDecline === 'function') onDecline(); });
  const agree = document.createElement('button');
  agree.type = 'button';
  agree.className = 'circle-rules-consent__agree';
  agree.textContent = tr('circle.rules.agree');
  agree.addEventListener('click', () => { if (typeof onAgree === 'function') onAgree(); });
  actions.append(decline, agree);
  container.appendChild(actions);

  return container;
}
