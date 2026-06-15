/**
 * canopy-chat v2 — contact DM thread (web DOM renderer, feedback-extension P5).
 *
 * Pure render of a 1:1 conversation with a contact-bot: a header (with a back
 * link to the roster), the message list (user + bot bubbles, with optional
 * reply-buttons), and a composer. The host injects the message list + `t` +
 * handlers; the conversational transport (the contact-thread channel over
 * sa.peer) + the message state live in `circleApp.js`, so this stays unit-
 * testable under happy-dom. Mirrors the other `renderX(container, ctx)`
 * components.
 */

export function renderContactThread(container, {
  name = '',
  messages = [],
  skills = [],
  busy = false,
  error = null,
  t,
  onSend,
  onBack,
  onButtonTap,
  onSkillTap,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-cthread';

  // ── header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cc-cthread__header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-cthread__back';
  back.textContent = tr('circle.contacts.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  header.appendChild(back);
  const title = document.createElement('h2');
  title.className = 'cc-cthread__title';
  title.textContent = tr('circle.contacts.thread_title', { name });
  header.appendChild(title);
  container.appendChild(header);

  // ── messages ──────────────────────────────────────────────────────────────
  const log = document.createElement('div');
  log.className = 'cc-cthread__log';
  for (const m of messages) {
    const row = document.createElement('div');
    row.className = `cc-cthread__msg cc-cthread__msg--${m.origin === 'user' ? 'user' : 'bot'}`;
    if (m.pending) row.classList.add('is-pending');
    const bubble = document.createElement('div');
    bubble.className = 'cc-cthread__bubble';
    bubble.textContent = m.text ?? '';
    row.appendChild(bubble);
    if (Array.isArray(m.buttons) && m.buttons.length) {
      const btnRow = document.createElement('div');
      btnRow.className = 'cc-cthread__buttons';
      for (const b of m.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-cthread__btn';
        btn.dataset.buttonId = b.id ?? '';
        btn.textContent = b.label ?? b.id ?? '';
        btn.addEventListener('click', () => { if (typeof onButtonTap === 'function') onButtonTap(b, m); });
        btnRow.appendChild(btn);
      }
      row.appendChild(btnRow);
    }
    log.appendChild(row);
  }
  if (busy) {
    const pend = document.createElement('div');
    pend.className = 'cc-cthread__sending';
    pend.textContent = tr('circle.contacts.sending');
    log.appendChild(pend);
  }
  container.appendChild(log);

  if (error) {
    const err = document.createElement('div');
    err.className = 'cc-cthread__error';
    err.textContent = tr('circle.contacts.send_failed', { name });
    container.appendChild(err);
  }

  // ── skill quick-actions (P5/#13) — the bot's exposed P4 skills as chips ──────
  if (Array.isArray(skills) && skills.length) {
    const skillRow = document.createElement('div');
    skillRow.className = 'cc-cthread__skills';
    for (const sk of skills) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cc-cthread__skill';
      chip.dataset.skillId = sk.id;
      chip.textContent = `/${sk.id}`;
      if (sk.description) chip.title = sk.description;
      chip.addEventListener('click', () => { if (typeof onSkillTap === 'function') onSkillTap(sk); });
      skillRow.appendChild(chip);
    }
    container.appendChild(skillRow);
  }

  // ── composer ──────────────────────────────────────────────────────────────
  const composer = document.createElement('form');
  composer.className = 'cc-cthread__composer';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cc-cthread__input';
  input.placeholder = tr('circle.contacts.composer', { name });
  composer.appendChild(input);
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'cc-cthread__send';
  sendBtn.textContent = tr('circle.contacts.send');
  composer.appendChild(sendBtn);
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (typeof onSend === 'function') onSend(text);
  });
  container.appendChild(composer);

  return container;
}
