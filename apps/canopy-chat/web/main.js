/**
 * canopy-chat — v0.2 web demo entry.
 *
 * Multi-thread workspace.  Sidebar lists every thread; user can
 * create new threads with filter + permissions; clicking switches
 * the active thread.  Events from skill dispatches fan out through
 * the EventRouter to every thread whose filter matches (per OQ-4).
 *
 * Pipeline:
 *   user input → parseInput → resolveDispatch → runDispatch
 *              → renderReply → ACTIVE thread state → DOM render
 *   mutation reply → EventRouter.deliver(item-changed event)
 *                  → matching threads receive notifications
 *
 * Phase v0.2 sub-slice 2.3.
 */

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  renderReply, createDefaultThreadStore, createEventRouter,
  initLocalisation, t, setLang, detectDeviceLang, currentLang,
  describeFilter, canopyChatManifest,
} from '../src/index.js';
import { renderStream }              from '../src/web/domAdapter.js';
import { renderSidebar }             from '../src/web/threadSidebar.js';
import { createRealHouseholdAgent }  from '../src/web/realAgent.js';
import { createLocalBuiltins }       from '../src/web/localBuiltins.js';

/* ── DOM refs ──────────────────────────────────────────── */

const sidebarEl  = document.getElementById('sidebar');
const messagesEl = document.getElementById('messages');
const formEl     = document.getElementById('input-form');
const inputEl    = document.getElementById('chat-input');
const langEnBtn  = document.getElementById('lang-en');
const langNlBtn  = document.getElementById('lang-nl');
const headerNameEl   = document.getElementById('active-thread-name');
const headerFilterEl = document.getElementById('active-thread-filter');

/* ── state ─────────────────────────────────────────────── */

const agent = await createRealHouseholdAgent();
const catalog = mergeManifests([
  { manifest: canopyChatManifest },
  { manifest: agent.manifest },
]);
const manifestsByOrigin = {
  'canopy-chat': canopyChatManifest,
  'household':   agent.manifest,
};

const store  = createDefaultThreadStore();
// Seed an extra "Household alerts" thread for the J8 demo.
store.createThread({
  id:     'household-alerts',
  name:   'Household alerts',
  filter: { apps: ['household'], eventTypes: ['item-changed', 'notification'] },
  permissions: { allowCommands: true },
});

const router = createEventRouter({ threadStore: store });

await initLocalisation({ lng: detectDeviceLang() });
updateLangButtons();

const localBuiltins = createLocalBuiltins({ catalog, t });

const callSkill = async (appOrigin, opId, args) => {
  if (appOrigin === 'canopy-chat') {
    const handler = localBuiltins[opId];
    if (!handler) throw new Error(`No local handler for canopy-chat.${opId}`);
    return handler(args ?? {});
  }
  return agent.callSkill(appOrigin, opId, args);
};

/* ── render orchestration ──────────────────────────────── */

function activeThread() { return store.getActiveThread(); }

function renderAll() {
  renderSidebarHere();
  renderActiveHeader();
  renderActiveStream();
}

function renderSidebarHere() {
  renderSidebar(sidebarEl, {
    doc:      document,
    store,
    onSelect: (id) => { store.setActiveThread(id); },
    t,
  });
}

function renderActiveHeader() {
  const t0 = activeThread();
  if (!t0) {
    headerNameEl.textContent = '';
    headerFilterEl.textContent = '';
    return;
  }
  headerNameEl.textContent = t0.name;
  const filterText = describeFilter(t0.filter);
  headerFilterEl.textContent = filterText === '*' ? '' : `(${filterText})`;
}

function renderActiveStream() {
  const t0 = activeThread();
  if (!t0) {
    while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
    return;
  }
  renderStream(messagesEl, t0.messages, makeCtx());
}

function makeCtx() {
  return { doc: document, onButtonTap };
}

/* ── greeting on the Main thread ───────────────────────── */

{
  const main = store.getThread('main');
  const greeting = renderReply({
    payload: 'Welcome to canopy-chat (v0.2). Try /help. Create more threads via the sidebar.',
    shape:   'text',
    threadId: main.id,
  }, { t });
  main.addShellMessage(greeting);
}

renderAll();

/* ── subscriptions ─────────────────────────────────────── */

store.subscribe(() => {
  // ThreadStore changes (create/delete/update/active) → re-render
  // sidebar + the active thread's stream + header.
  renderAll();
});

router.onRouted(() => {
  // An event was delivered to ≥0 threads.  Cheapest correct move:
  // re-render the active thread (the matched threads' state is
  // already in store — just the visible one needs refresh).
  renderActiveStream();
});

/* ── input handler ─────────────────────────────────────── */

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';

  const t0 = activeThread();
  if (!t0) return;
  t0.addUserMessage(text);
  renderActiveStream();

  // Permission gate (v0.2: allowCommands)
  if (t0.permissions.allowCommands === false) {
    const rendered = renderReply({
      payload: 'This thread does not accept commands.',
      shape:   'text', threadId: t0.id,
    }, { t });
    t0.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  await handleUserText(text, t0);
});

/* ── language switch ───────────────────────────────────── */

langEnBtn.addEventListener('click', async () => { await setLang('en'); updateLangButtons(); renderAll(); });
langNlBtn.addEventListener('click', async () => { await setLang('nl'); updateLangButtons(); renderAll(); });

function updateLangButtons() {
  const cur = currentLang();
  langEnBtn.setAttribute('aria-current', cur === 'en' ? 'true' : 'false');
  langNlBtn.setAttribute('aria-current', cur === 'nl' ? 'true' : 'false');
}

/* ── core flow ─────────────────────────────────────────── */

async function handleUserText(text, thread) {
  const parse = parseInput(text, catalog, { threadId: thread.id });
  const route = resolveDispatch(parse, catalog);

  if (route.kind === 'unknown') {
    const rendered = renderReply({
      payload:  t('reply.unknown_command', { input: text }),
      shape:    'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  if (route.kind === 'error') {
    const rendered = renderReply({
      payload: null, shape: 'text', threadId: thread.id,
      error:   { code: route.code, message: route.message },
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  if (route.kind === 'needsForm' || route.kind === 'needsConfirm') {
    const note = route.kind === 'needsForm'
      ? `Missing required params: ${route.missing.join(', ')} (form UX lands in v0.3)`
      : `This op needs confirmation (${route.severity}): ${route.message ?? ''} — confirm UX lands in v0.3`;
    const rendered = renderReply({
      payload: note, shape: 'text', threadId: thread.id,
    }, { t });
    thread.addShellMessage(rendered);
    renderActiveStream();
    return;
  }

  // ready → dispatch + render + (maybe) emit item-changed event.
  await dispatchAndRender(route, thread);
}

async function dispatchAndRender(route, thread) {
  const reply = await runDispatch(route, callSkill);
  const rendered = renderReply(reply, {
    t,
    appOrigin:         route.appOrigin,
    manifestsByOrigin,
  });
  thread.addShellMessage(rendered, { opId: route.opId });

  // Mutation? Fan out per OQ-4 — every thread with a matching
  // filter sees an 'item-changed' event.  We skip listOpen-style
  // reads (Q28 reply: 'list'), /help, and errors.
  const op = catalog.opsById.get(route.opId)?.op;
  const isMutation = op?.verb && !['list', 'help'].includes(op.verb)
                   && !reply.error;
  if (isMutation && reply.payload) {
    router.deliver({
      app:     route.appOrigin,
      type:    'item-changed',
      payload: {
        message: typeof reply.payload.message === 'string'
          ? reply.payload.message
          : `${route.appOrigin}.${route.opId} completed`,
        op:      route.opId,
        result:  reply.payload,
      },
    });
  }

  renderActiveStream();
}

/* ── button tap handler ─────────────────────────────────── */

async function onButtonTap(opId, itemId) {
  const t0 = activeThread();
  if (!t0) return;
  const entry = catalog.opsById.get(opId);
  if (!entry) return;
  const firstReq = (entry.op.params ?? []).find(
    (p) => p?.required && (p.kind === 'string' || p.kind === 'enum'),
  );
  const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };
  const parse = {
    kind: 'slash', opId, args, threadId: t0.id,
    command: '(button)', body: itemId,
  };
  const route = resolveDispatch(parse, catalog);
  if (route.kind !== 'ready') return;
  await dispatchAndRender(route, t0);
}
