/**
 * canopy-chat v2 — circle noticeboard / prikbord (web DOM renderer, S1 #1).
 *
 * The buurt noticeboard surface inside a circle's PRIKBORD tab: a post composer
 * (ask / offer / lend + text) and the open-post list with per-row actions. Pure
 * render — the host (`circleApp.js`) fetches `listOpen`, computes `mine`, and
 * dispatches the stoop ops (`postRequest` / `respondToItem` / `cancelRequest` /
 * `reportPost` / `markReturned`) behind `onPost` / `onAction`. Mirrors the other
 * `renderX(container, ctx)` components so it's happy-dom-testable.
 *
 * Scope note (S1): canopy-chat runs ONE shared stoop agent today (`cc-default-buurt`),
 * so this shows the shared buurt's posts; per-circle scoping arrives with the pod
 * foundation (REMAINING-WORK §4 E2 / S4).
 */

import { embedChipsOf, embedTypeLabelKey, shortRef } from '../../src/v2/embedChips.js';

const INTENTS = ['ask', 'offer', 'lend'];

export function renderCircleNoticeboard(container, {
  posts = [],
  t,
  busy = false,
  intent = 'ask',
  onPost,
  onAction,
  onIntent,
  attachment = null,        // S5 — the pending image attachment ({thumbnail, name}) or null
  onAttach,                 // (file) => void — host encodes + sets the pending attachment
  onClearAttach,            // () => void
  onViewAttachment,         // ({post, att}) => void — open the full image
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-prikbord';

  // ── composer ────────────────────────────────────────────────────────────
  const composer = document.createElement('form');
  composer.className = 'cc-prikbord__composer';

  const pills = document.createElement('div');
  pills.className = 'cc-prikbord__intents';
  for (const it of INTENTS) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `cc-prikbord__intent${it === intent ? ' is-active' : ''}`;
    pill.dataset.intent = it;
    pill.textContent = tr(`circle.noticeboard.intent.${it}`);
    pill.addEventListener('click', () => { if (typeof onIntent === 'function') onIntent(it); });
    pills.appendChild(pill);
  }
  composer.appendChild(pills);

  const row = document.createElement('div');
  row.className = 'cc-prikbord__composer-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cc-prikbord__input';
  input.placeholder = tr(`circle.noticeboard.placeholder.${intent}`);
  row.appendChild(input);
  // S5 — attach an inline image (gated on the host wiring the encoder).
  let fileInput = null;
  if (typeof onAttach === 'function') {
    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'cc-prikbord__attach';
    attachBtn.title = tr('circle.noticeboard.attach');
    attachBtn.textContent = '📎';
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp';
    fileInput.className = 'cc-prikbord__file';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) onAttach(f);
      fileInput.value = '';
    });
    attachBtn.addEventListener('click', () => fileInput.click());
    row.appendChild(attachBtn);
    row.appendChild(fileInput);
  }
  const post = document.createElement('button');
  post.type = 'submit';
  post.className = 'cc-prikbord__post';
  post.textContent = tr('circle.noticeboard.post');
  row.appendChild(post);
  composer.appendChild(row);

  // S5 — pending-attachment preview (thumbnail + remove).
  if (attachment && attachment.thumbnail) {
    const preview = document.createElement('div');
    preview.className = 'cc-prikbord__attach-preview';
    const img = document.createElement('img');
    img.className = 'cc-prikbord__attach-thumb';
    img.src = attachment.thumbnail;
    img.alt = attachment.name || tr('circle.noticeboard.attach');
    preview.appendChild(img);
    if (typeof onClearAttach === 'function') {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'cc-prikbord__attach-remove';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', tr('circle.noticeboard.attach_remove'));
      rm.addEventListener('click', () => onClearAttach());
      preview.appendChild(rm);
    }
    composer.appendChild(preview);
  }

  // S3 #4 — a lend post can carry a return-by date (drives the notifier reminder).
  let due = null;
  if (intent === 'lend') {
    const dueRow = document.createElement('label');
    dueRow.className = 'cc-prikbord__due';
    const dueLabel = document.createElement('span');
    dueLabel.textContent = tr('circle.noticeboard.due');
    due = document.createElement('input');
    due.type = 'date';
    due.className = 'cc-prikbord__due-input';
    dueRow.appendChild(dueLabel);
    dueRow.appendChild(due);
    composer.appendChild(dueRow);
  }

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !attachment) return;   // S5 — an image-only post is valid
    input.value = '';
    const dueAt = due?.value ? Date.parse(due.value) : undefined;
    if (typeof onPost === 'function') onPost({ intent, text, ...(Number.isFinite(dueAt) ? { dueAt } : {}) });
  });
  container.appendChild(composer);

  if (busy) {
    const b = document.createElement('div');
    b.className = 'cc-prikbord__busy';
    b.textContent = tr('circle.noticeboard.posting');
    container.appendChild(b);
  }

  // ── post list ───────────────────────────────────────────────────────────
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'cc-prikbord__empty';
    empty.textContent = tr('circle.noticeboard.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('ul');
  list.className = 'cc-prikbord__list';
  for (const p of posts) {
    const li = document.createElement('li');
    li.className = `cc-prikbord__post-row cc-prikbord__post-row--${p.type || 'ask'}`;
    li.dataset.postId = p.id;

    const badge = document.createElement('span');
    badge.className = `cc-prikbord__badge cc-prikbord__badge--${p.type || 'ask'}`;
    badge.textContent = tr(`circle.noticeboard.intent.${p.type || 'ask'}`);
    li.appendChild(badge);

    const text = document.createElement('div');
    text.className = 'cc-prikbord__text';
    text.textContent = p.text ?? p.label ?? '';
    li.appendChild(text);

    // embeds[] — cross-object references this post carries (a task / event /
    // other post). Surfaced as "See also" chips; the embed's own label, else a
    // shortened ref. (Resolving the ref to a live card is a follow-up.)
    const embeds = embedChipsOf(p);
    if (embeds.length) {
      const wrap = document.createElement('div');
      wrap.className = 'cc-prikbord__embeds';
      const heading = document.createElement('span');
      heading.className = 'cc-prikbord__embeds-label';
      heading.textContent = tr('circle.embed.see_also');
      wrap.appendChild(heading);
      for (const e of embeds) {
        const chip = document.createElement('span');
        chip.className = `cc-prikbord__embed cc-prikbord__embed--${e.type}`;
        chip.dataset.ref = e.ref;
        const typeKey = embedTypeLabelKey(e.type);
        const typeLabel = tr(typeKey);
        const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
        chip.textContent = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
        wrap.appendChild(chip);
      }
      li.appendChild(wrap);
    }

    // S5 — inline image attachments: render the thumbnail; tap opens the full image.
    const atts = Array.isArray(p.attachments) ? p.attachments : [];
    if (atts.length) {
      const gallery = document.createElement('div');
      gallery.className = 'cc-prikbord__attachments';
      for (const att of atts) {
        if (!att?.thumbnail) continue;
        const img = document.createElement('img');
        img.className = 'cc-prikbord__att';
        img.src = att.thumbnail;
        img.alt = tr('circle.noticeboard.attach');
        img.loading = 'lazy';
        if (att.width && att.height) img.style.aspectRatio = `${att.width} / ${att.height}`;
        if (typeof onViewAttachment === 'function') {
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', () => onViewAttachment({ post: p, att }));
        }
        gallery.appendChild(img);
      }
      if (gallery.childNodes.length) li.appendChild(gallery);
    }

    const meta = document.createElement('div');
    meta.className = 'cc-prikbord__meta';
    meta.textContent = [p.addedByLabel || p.addedBy, p.when].filter(Boolean).join(' · ');
    li.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'cc-prikbord__actions';
    const chip = (action, labelKey, extraClass = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-prikbord__chip${extraClass}`;
      b.dataset.action = action;
      b.textContent = tr(labelKey);
      b.addEventListener('click', () => { if (typeof onAction === 'function') onAction({ action, post: p }); });
      actions.appendChild(b);
    };
    if (!p.mine) chip('respond', 'circle.noticeboard.action.respond');
    if (p.type === 'lend' && p.mine) chip('assign', 'circle.noticeboard.action.assign');
    if (p.type === 'lend' && p.mine) chip('markReturned', 'circle.noticeboard.action.returned');
    if (p.mine) chip('cancel', 'circle.noticeboard.action.cancel');
    if (!p.mine) chip('report', 'circle.noticeboard.action.report', ' cc-prikbord__chip--muted');
    if (!p.mine) chip('mute', 'circle.noticeboard.action.mute', ' cc-prikbord__chip--muted');
    li.appendChild(actions);

    list.appendChild(li);
  }
  container.appendChild(list);
  return container;
}
