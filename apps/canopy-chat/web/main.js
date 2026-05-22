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
  renderReply, ThreadStore, createDefaultThreadStore, createEventRouter,
  initLocalisation, t, setLang, detectDeviceLang, currentLang,
  describeFilter, canopyChatManifest,
  IndexedDBStore, attachPersistence,
  collectFollowUps, claimEmbed,
  AppRegistry, filterCatalog,
} from '../src/index.js';
import { buildFormSpec, validateAndCoerce } from '../src/forms/buildFormSpec.js';
import { renderStream }              from '../src/web/domAdapter.js';
import { renderForm }                from '../src/web/domForm.js';
import { renderSidebar }             from '../src/web/threadSidebar.js';
import { createRealHouseholdAgent }  from '../src/web/realAgent.js';
import { mockStoopManifest,
         mockFolioManifest }         from '../src/web/mockAgent.js';
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
// v0.4 cross-app surface: stoop + folio manifests join the merged
// catalog so users see their commands in /help.  Q32 runtime filter
// drops folio's sync/watch (node-only) ops in the browser build.
const rawCatalog = mergeManifests([
  { manifest: canopyChatManifest },
  { manifest: agent.manifest },
  { manifest: mockStoopManifest },
  { manifest: mockFolioManifest },
], { runtime: 'browser' });

// v0.6 OQ-4.B — app-toggle registry.  Filters disabled apps out of
// the catalog seen by parser/router/dispatch/renderer.  Persistence
// rides on the same IndexedDB store as threads in a future slice;
// today the registry is in-memory + survives the session.
const appRegistry = new AppRegistry();
appRegistry.syncWithCatalog(rawCatalog.appOrigins);
let catalog = filterCatalog(rawCatalog, appRegistry);
appRegistry.subscribe(() => { catalog = filterCatalog(rawCatalog, appRegistry); });

const manifestsByOrigin = {
  'canopy-chat': canopyChatManifest,
  'household':   agent.manifest,
  'stoop':       mockStoopManifest,
  'folio':       mockFolioManifest,
};

// v0.2.4 — IndexedDB persistence.  Load existing threads on boot;
// seed defaults on fresh install; subscribe so future changes
// persist automatically.
const idb = new IndexedDBStore();
let store;
const persisted = await idb.loadAll();
if (persisted.length > 0) {
  // Hydrate from disk.
  store = new ThreadStore();
  for (const t0 of persisted) {
    // ThreadStore.createThread builds its own Thread; we want THE
    // persisted instance.  Insert directly via a small bypass: use
    // the same id + filter + permissions so the public API stays
    // honest, then graft the messages + listings back on.
    const created = store.createThread({
      id:          t0.id,
      name:        t0.name,
      filter:      t0.filter,
      permissions: t0.permissions,
    });
    created.createdAt = t0.createdAt;
    created.messages  = t0.messages;
    for (const [opId, listing] of t0._listings) {
      created._listings.set(opId, listing);
    }
  }
} else {
  store = createDefaultThreadStore();
  // Seed an extra "Household alerts" thread for the J8 demo (only
  // on fresh install — existing users keep their layout).
  store.createThread({
    id:     'household-alerts',
    name:   'Household alerts',
    filter: { apps: ['household'], eventTypes: ['item-changed', 'notification'] },
    permissions: { allowCommands: true },
  });
}

// Persist future changes asynchronously.
attachPersistence({ threadStore: store, idb });

const router = createEventRouter({ threadStore: store });

await initLocalisation({ lng: detectDeviceLang() });
updateLangButtons();

// v0.5.1 — local actor identity for embed issuance.  Real
// identity wiring lands in v0.6 with the OIDC sign-in flow (J6);
// v0.5.x uses a stable demo webid so the [Claim] button correctly
// hides when the local user is the issuer.
const LOCAL_ACTOR = 'webid:local-demo-user';

// v0.5.6 — simulated cross-peer demo.  A second thread + identity
// representing "Anne" — lets /send-to anne route an embed to Anne's
// thread without real network.  Real cross-peer delivery rides on
// each hosting app's chat surface (per v0.5.3 audit).
const SIM_ANNE_THREAD_ID = 'sim-anne';
const SIM_ANNE_WEBID     = 'webid:anne';

if (!store.getThread(SIM_ANNE_THREAD_ID)) {
  store.createThread({
    id:          SIM_ANNE_THREAD_ID,
    name:        "Anne's view (simulated)",
    filter:      { actors: [SIM_ANNE_WEBID] },
    permissions: { allowCommands: false },   // read-only thread — represents Anne's chat
  });
}

const SIM_PEERS = {
  anne: { threadId: SIM_ANNE_THREAD_ID, webid: SIM_ANNE_WEBID },
};

// callSkill is declared further down; createLocalBuiltins needs it
// for the /embed factory.  Forward-declared variable + helper.
let callSkillRef;
// Pass `catalog` as a getter so /apps and /help always see the
// CURRENT filtered catalog (re-derived when appRegistry changes).
const localBuiltins = createLocalBuiltins({
  // Builtins receive the current rawCatalog for app listing; opsById
  // / commandMenu are read at call time on the filtered catalog via
  // the dispatch path.  /apps surfaces both enabled AND disabled
  // apps (so the user can re-enable).
  catalog: rawCatalog,
  t,
  threadStore: store,
  setActive:   (id) => store.setActiveThread(id),
  callSkill:   (appOrigin, opId, args) => callSkillRef(appOrigin, opId, args),
  localActor:  LOCAL_ACTOR,
  simPeers:    SIM_PEERS,
  appRegistry,
});

const callSkill = async (appOrigin, opId, args) => {
  if (appOrigin === 'canopy-chat') {
    const handler = localBuiltins[opId];
    if (!handler) throw new Error(`No local handler for canopy-chat.${opId}`);
    return handler(args ?? {});
  }
  if (appOrigin === 'household') {
    return agent.callSkill(appOrigin, opId, args);
  }
  // v0.4 cross-app demo: stoop + folio manifests are in the catalog
  // but their agents aren't wired in the v0.1 in-process topology.
  // Return placeholder data so /help discovery + dispatch feedback
  // demonstrate the cross-app surface.
  if (appOrigin === 'stoop') {
    if (opId === 'listFeed') {
      return { items: [
        { id: 'p-1', label: 'Anne needs help moving a couch', state: 'open' },
        { id: 'p-2', label: 'Karl offers tomato seedlings',    state: 'open' },
      ] };
    }
    if (opId === 'postRequest') {
      return { ok: true, message: `✓ Posted: ${args?.text ?? '(empty)'}` };
    }
  }
  if (appOrigin === 'folio') {
    if (opId === 'readNote') {
      return { message: `[demo] readNote("${args?.path ?? ''}") — folio agent not wired in this build` };
    }
    if (opId === 'shareFolder') {
      return { ok: true, message: `✓ [demo] would share "${args?.folder}" with ${args?.with}` };
    }
  }
  return { ok: false, error: `${appOrigin}.${opId} not wired in this demo build` };
};
callSkillRef = callSkill;

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
  return {
    doc: document,
    localActor: LOCAL_ACTOR,
    manifestsByOrigin,
    onButtonTap,
    onCloseMessage: (messageId) => {
      const t0 = activeThread();
      if (!t0) return;
      t0.closeMessage(messageId);
      renderActiveStream();
    },
    onClaimEmbed: (messageId) => {
      // v0.5.1 — receiver-claim path.  Find the message, claim its
      // embed in-place, re-render.  The claim is local-state only in
      // v0.5.x; real cross-peer claim propagation rides on the
      // hosting chat substrate (stoop's chat-p2p, etc.) and is
      // app-side work (deferred per v0.5.3 audit).
      const t0 = activeThread();
      if (!t0) return;
      const msg = t0.messages.find((m) => m.messageId === messageId);
      if (!msg?.rendered?.embed) return;
      msg.rendered.embed = claimEmbed(msg.rendered.embed, LOCAL_ACTOR);
      renderActiveStream();
    },
    onFollowUp: async (entry) => {
      // v0.4 — clicking a follow-up button dispatches it as if the
      // user had typed the slash with the prefilled args.
      const t0 = activeThread();
      if (!t0) return;
      const parse = {
        kind: 'slash', opId: entry.opId, args: entry.prefilledArgs ?? {},
        threadId: t0.id, command: '(followup)', body: '',
      };
      const route = resolveDispatch(parse, catalog);
      // If args are missing, the form gate kicks in — that's correct UX.
      if (route.kind === 'needsForm') {
        await handleUserText(`/${entry.opId}`, t0);
        return;
      }
      if (route.kind !== 'ready') return;
      await dispatchAndRender(route, t0);
    },
  };
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

  if (route.kind === 'needsForm') {
    // v0.3.0 — render an inline form; on submit, retry dispatch.
    const spec = buildFormSpec({
      opParams:      catalog.opsById.get(route.opId)?.op?.params ?? [],
      missing:       route.missing,
      prefilledArgs: route.prefilledArgs,
      opId:          route.opId,
      appOrigin:     route.appOrigin,
      threadId:      thread.id,
    });
    const formEl = renderForm(spec, {
      doc: document, t,
      onSubmit: async (values) => {
        const v = validateAndCoerce(spec, values);
        if (!v.ok) {
          const errMsg = v.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
          const errEl = renderReply({
            payload: null, shape: 'text', threadId: thread.id,
            error:   { code: 'form-invalid', message: errMsg },
          }, { t });
          thread.addShellMessage(errEl);
          renderActiveStream();
          return;
        }
        // Dispatch with the full args.
        const parse = {
          kind: 'slash', opId: route.opId, args: v.args,
          threadId: thread.id, command: '(form)', body: '',
        };
        const route2 = resolveDispatch(parse, catalog);
        if (route2.kind !== 'ready') {
          const errEl = renderReply({
            payload: `Form submission failed: ${route2.kind}`,
            shape: 'text', threadId: thread.id,
          }, { t });
          thread.addShellMessage(errEl);
          renderActiveStream();
          return;
        }
        await dispatchAndRender(route2, thread);
      },
      onCancel: () => {
        const cancelMsg = renderReply({
          payload: t('form.cancelled', { defaultValue: 'Form cancelled.' }),
          shape: 'text', threadId: thread.id,
        }, { t });
        thread.addShellMessage(cancelMsg);
        renderActiveStream();
      },
    });
    // Append the form DOM directly into the messages stream as a
    // shell-side "live" message.  We synthesise a thread message so
    // the thread.tail() and lifecycle machinery treat it like any
    // other shell reply.
    thread.addShellMessage({
      kind:           'form',
      messageId:      `form-${Date.now()}`,
      threadId:       thread.id,
      lifecycleState: 'live',
      formElement:    formEl,
      text:           `Form: ${route.opId}`,
    });
    renderActiveStream();
    // The DOM stream rebuild will use our message's text fallback —
    // append the actual form element on top.  Easiest: re-attach
    // the form DOM in a tick (after renderActiveStream).
    setTimeout(() => {
      // Find the form-placeholder bubble + replace its content with
      // the live form element.  Identified by messageId.
      const messages = thread.messages;
      const last = messages[messages.length - 1];
      const node = messagesEl.querySelector(`[data-message-id="${last.messageId}"]`);
      if (node) {
        while (node.firstChild) node.removeChild(node.firstChild);
        node.appendChild(formEl);
      }
    }, 0);
    return;
  }

  if (route.kind === 'needsConfirm') {
    const note = `This op needs confirmation (${route.severity}): ${route.message ?? ''} — confirm UX lands in v0.3+`;
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
  // v0.4 — when dispatch succeeded, look up follow-up suggestions
  // (per-op Q31 hints from the catalog + cross-app chains from the
  // static registry) and attach them to the reply so the renderer
  // surfaces them as buttons under the text.
  if (!reply.error) {
    const followUps = collectFollowUps(route.opId, route.appOrigin, reply.payload, catalog);
    if (followUps.length > 0) reply.followUps = followUps;
  }
  const rendered = renderReply(reply, {
    t,
    appOrigin:         route.appOrigin,
    manifestsByOrigin,
  });
  thread.addShellMessage(rendered, { opId: route.opId });

  // Mutation? Fan out per OQ-4 — every thread with a matching
  // filter sees an 'item-changed' event EXCEPT the thread the user
  // dispatched from (the mutation reply already appears there, so
  // a notification copy would duplicate).
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
    }, { excludeThreadIds: [thread.id] });
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
