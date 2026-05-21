/**
 * canopy-chat — v0.1.4 web demo entry.
 *
 * Wires the full pipeline:
 *   user input → parseInput → resolveDispatch → runDispatch → renderReply
 *              → thread state → DOM render
 *
 * Uses a mock household agent (v0.1.5 wires the real browser-bundled
 * mesh agent — currently blocked by OQ-1.C).  All canopy-chat logic
 * is identical to what production will run.
 *
 * Phase v0.1 sub-slice 1.10.
 */

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  renderReply, Thread,
  initLocalisation, t, setLang, detectDeviceLang, currentLang,
} from '../src/index.js';
import { renderToDom, renderStream }     from '../src/web/domAdapter.js';
import { createMockHouseholdAgent }      from '../src/web/mockAgent.js';

const messagesEl = document.getElementById('messages');
const formEl     = document.getElementById('input-form');
const inputEl    = document.getElementById('chat-input');
const langEnBtn  = document.getElementById('lang-en');
const langNlBtn  = document.getElementById('lang-nl');

const agent   = createMockHouseholdAgent();
const catalog = mergeManifests([{ manifest: agent.manifest }]);
const thread  = new Thread({ id: 'main' });

const manifestsByOrigin = { household: agent.manifest };
const ctxBase = { doc: document };

await initLocalisation({ lng: detectDeviceLang() });
updateLangButtons();

/* ── greeting ─────────────────────────────────────────── */

{
  const greeting = renderReply({
    payload: 'Welcome to canopy-chat. Try /mine to list chores.',
    shape:   'text',
    threadId: thread.id,
  }, { t });
  thread.addShellMessage(greeting);
}
renderStream(messagesEl, thread.messages, makeCtx());

/* ── input handler ─────────────────────────────────────── */

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';

  thread.addUserMessage(text);                     // triggers A2 lifecycle
  renderStream(messagesEl, thread.messages, makeCtx());

  await handleUserText(text);
});

/* ── language switch ───────────────────────────────────── */

langEnBtn.addEventListener('click', async () => {
  await setLang('en');
  updateLangButtons();
});
langNlBtn.addEventListener('click', async () => {
  await setLang('nl');
  updateLangButtons();
});

function updateLangButtons() {
  const cur = currentLang();
  langEnBtn.setAttribute('aria-current', cur === 'en' ? 'true' : 'false');
  langNlBtn.setAttribute('aria-current', cur === 'nl' ? 'true' : 'false');
}

/* ── core flow ─────────────────────────────────────────── */

async function handleUserText(text) {
  const parse = parseInput(text, catalog, { threadId: thread.id });
  const route = resolveDispatch(parse, catalog);

  if (route.kind === 'unknown') {
    const rendered = renderReply({
      payload:  t('reply.unknown_command', { input: text }),
      shape:    'text',
      threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderStream(messagesEl, thread.messages, makeCtx());
    return;
  }

  if (route.kind === 'error') {
    const rendered = renderReply({
      payload:  null,
      shape:    'text',
      threadId: thread.id,
      error:    { code: route.code, message: route.message },
    }, { t });
    thread.addShellMessage(rendered);
    renderStream(messagesEl, thread.messages, makeCtx());
    return;
  }

  if (route.kind === 'needsForm' || route.kind === 'needsConfirm') {
    // v0.1.4 — these gates aren't implemented in the web UI yet
    // (lands in v0.3 alongside the form generator + confirm modal).
    // For now, render an explainer.
    const note = route.kind === 'needsForm'
      ? `Missing required params: ${route.missing.join(', ')} (form UX lands in v0.3)`
      : `This op needs confirmation (${route.severity}): ${route.message ?? ''} — confirm UX lands in v0.3`;
    const rendered = renderReply({
      payload: note, shape: 'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderStream(messagesEl, thread.messages, makeCtx());
    return;
  }

  // route.kind === 'ready' — dispatch + render
  await dispatchAndRender(route);
}

async function dispatchAndRender(route) {
  const reply = await runDispatch(route, agent.callSkill);
  const rendered = renderReply(reply, {
    t,
    appOrigin:         route.appOrigin,
    manifestsByOrigin,
  });
  thread.addShellMessage(rendered, { opId: route.opId });
  renderStream(messagesEl, thread.messages, makeCtx());
}

/* ── button tap handler ─────────────────────────────────── */

async function onButtonTap(opId, itemId) {
  // Buttons skip the parser; we synthesise the parse result directly.
  // Args are the callbackData-encoded ones; we still need to know which
  // param to bind them to.  The router's _match-binding logic only
  // applies to parser positional captures; for buttons we already know
  // the opId, so build the args from the catalog entry.

  // For v0.1: hard-code the convention that callback buttons pass
  // `id`-shaped args.  Tasks-v0 / household / stoop all do this today.
  // A future refinement would consult the op's appliesTo + params to
  // pick the right name.  v0.1 maps to the first required string param.
  const entry = catalog.opsById.get(opId);
  if (!entry) return;

  const firstReq = (entry.op.params ?? []).find(
    (p) => p?.required && (p.kind === 'string' || p.kind === 'enum'),
  );
  const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };

  // Synthesise a slash parseResult so we can route + dispatch the
  // same way the parser does.
  const parse = {
    kind: 'slash', opId, args, threadId: thread.id,
    command: '(button)', body: itemId,
  };

  // Lifecycle: a button tap on a still-live action menu also counts
  // as a "new user action" for A2 purposes — the simplest signal is
  // to append a synthetic user message in the thread so prior list
  // bubbles disable.  For v0.1.4 we keep it minimal and don't append
  // — the button-tap re-renders below pick up any state changes
  // anyway.
  const route = resolveDispatch(parse, catalog);
  if (route.kind !== 'ready') return;
  await dispatchAndRender(route);
}

function makeCtx() {
  return { ...ctxBase, onButtonTap };
}
