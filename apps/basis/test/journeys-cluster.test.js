/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VERIFICATION-JOURNEY HARNESS — the capabilities / tasks / roles cluster.
 *
 * This file IS the cluster's acceptance net. It is the EXECUTABLE counterpart
 * of the pre-build spec `plans/PLAN-cluster-verification-journeys.md` (J1–J10),
 * written spec-first as the independent acceptance target.
 *
 * Growing harness: journeys whose features exist run GREEN now; the rest are
 * scaffolded as `it.todo(...)` (or `describe.skip`) carrying the spec's steps +
 * assertion intent verbatim as comments, so each flips to a real assertion the
 * moment the phase that unblocks it lands. Each pending block names the phase.
 *
 *   GREEN now : J1 (task lifecycle — the store-convergence keystone).
 *   TODO      : J2 J3 J4 J5 J6 J7 J8 J9 J10 (features not built yet).
 *
 * SCOPE: test-only. Imports the built substrate from `@onderling/item-store`;
 * edits no source. Lives in apps/basis (which already depends on item-store),
 * so it collects cleanly and is unaffected by the tasks-mobile module-resolution
 * collection failures (a different app / different resolver).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';
import {
  CircleItemStore,
  createTaskStore,
  computeStatus,
  computeDagStatus,
  assigneesOf,
  addChildTo,
  collectSubtree,
} from '@onderling/item-store';

// ── Fixtures ────────────────────────────────────────────────────────────────

const ROOT = 'pod://circle/';
const uriOf = (id) => `${ROOT}items/${id}.json`;

const ANNE = 'https://id.example/anne'; // "member A" / creator
const BOB = 'https://id.example/bob'; //   "member B" / claimer
const CARA = 'https://id.example/cara'; //  "member C" / racing second claimer

/**
 * A CAS-capable "central pod": per-path etag + If-Match enforcement. This is the
 * etag-capable fake from `packages/item-store/test/circleItemStore-cas.test.js`
 * (`makeCasPodSource`) — the CircleItemStore `putIfMatch` path threads the base
 * etag into `write(..., { ifMatch })`, so a concurrent second writer that raced
 * off the same stale etag loses deterministically (HTTP 412 → conflict).
 */
function makeCasPodSource() {
  const store = new Map();
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    async read(path) {
      return store.get(path)?.data ?? null;
    },
    async readEtag(path) {
      return store.get(path)?.etag ?? null;
    },
    async write(path, data, opts = {}) {
      const cur = store.get(path);
      if (opts && opts.ifMatch != null && (cur?.etag ?? null) !== opts.ifMatch) {
        throw Object.assign(new Error('If-Match failed'), { code: 'CONFLICT', status: 412 });
      }
      const etag = nextEtag();
      store.set(path, { data, etag });
      return { etag };
    },
    async delete(path) {
      store.delete(path);
    },
    async list(prefix = '') {
      return [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// J1 — Task lifecycle  (REUSE regression — must stay GREEN through the refactor)
//
// Spec steps:
//   1. add task {text:'heg knippen', circleId:C} → item created, status `ready`,
//      assignee null.
//   2. list (listOpen) → task present.
//   3. claim as member B → assignee=B, status `claimed`; second claimer gets
//      `already-claimed`.
//   4. complete → status `completed`, completedBy=B.
// Verifies: item-store CAS claim survives Phase 0 reconciliation.
//
// Realistic bundle: `createTaskStore` (the live-app compatibility surface:
// Emitter + audit + sync over a CircleItemStore) — the same `store.<verb>(args,
// {actor})` surface the ~26 tasks-v0 call sites use. Mapping of the spec's
// pre-build status words to the substrate's real `computeStatus` values:
//   spec `ready`     → computeDagStatus 'ready' (no open deps) + computeStatus 'open' + no assignee.
//   spec `claimed`   → computeStatus 'claimed'.
//   spec `completed` → computeStatus 'complete'.
// ═══════════════════════════════════════════════════════════════════════════
describe('J1 — task lifecycle (GREEN: store-convergence keystone)', () => {
  it('add → list → claim (CAS single-winner) → complete', async () => {
    const pod = makeCasPodSource();
    const circle = new CircleItemStore({ dataSource: pod, rootContainer: ROOT });
    const tasks = createTaskStore(circle); // realistic Emitter+audit+sync bundle

    // ── 1. add ──────────────────────────────────────────────────────────────
    // Fixed id so the racing peer below can address the same task deterministically.
    const [t] = await tasks.addItems(
      [{ id: 'heg', text: 'heg knippen' }],
      { actor: ANNE },
    );
    expect(t.id).toBe('heg');
    expect(t.type).toBe('task'); // defaulted
    expect(t.text).toBe('heg knippen');
    expect(t.assignee ?? null).toBeNull(); // spec: assignee null
    expect(computeStatus(t)).toBe('open'); // spec `ready` → substrate 'open' (unassigned, no reviewLog)
    expect(computeDagStatus(t, [t], [])).toBe('ready'); // spec `ready` — no open deps

    // ── 2. list (listOpen) → task present ────────────────────────────────────
    const open = await tasks.listOpen();
    expect(open.map((i) => i.id)).toContain('heg');

    // ── 3. claim as B → assignee=B, status `claimed`; a racing 2nd claimer
    //       gets `already-claimed` (CAS single-winner) ─────────────────────────
    // Snapshot the UNASSIGNED base — the etag a racing peer observed *before*
    // either wrote. Cara will thread this stale etag into her claim.
    const staleData = await pod.read(uriOf('heg'));
    const staleEtag = await pod.readEtag(uriOf('heg'));

    // Bob claims for real → the pod etag advances; assignee becomes Bob.
    const bobRes = await tasks.claim('heg', { actor: BOB });
    expect(bobRes.error).toBeUndefined();
    expect(bobRes.assignee).toBe(BOB);
    expect(computeStatus(bobRes)).toBe('claimed'); // spec: status `claimed`

    // Cara races: she still observes the pre-claim snapshot (stale read) AND
    // threads the stale base etag → the pod rejects her CAS write (412 CONFLICT)
    // → the verb surfaces `already-claimed` with the winner in `.current`.
    const realRead = pod.read.bind(pod);
    let served = false;
    pod.read = async (p) => {
      if (p === uriOf('heg') && !served) {
        served = true; // serve Cara's read-check the stale (unassigned) snapshot exactly once
        return staleData;
      }
      return realRead(p);
    };
    const caraRes = await tasks.claim('heg', { actor: CARA, expectedEtag: staleEtag });
    pod.read = realRead;

    expect(caraRes.error).toBe('already-claimed'); // the loser is told
    expect(caraRes.current.assignee).toBe(BOB); // re-read surfaces the single winner

    // The pod holds exactly ONE winner.
    expect(JSON.parse(await pod.read(uriOf('heg'))).assignee).toBe(BOB);

    // ── 4. complete → status `completed`, completedBy=B ──────────────────────
    const [done] = await tasks.markComplete([{ id: 'heg' }], { actor: BOB });
    expect(computeStatus(done)).toBe('complete'); // spec: status `completed`
    expect(done.completedBy).toBe(BOB); // spec: completedBy=B
    expect(typeof done.completedAt).toBe('number');

    // Regression witness: the completed task left the open list, entered closed.
    expect((await tasks.listOpen()).map((i) => i.id)).not.toContain('heg');
    expect((await tasks.listClosed()).map((i) => i.id)).toContain('heg');
  });

  it('CAS parity on a non-etag source: last claim is refused as already-claimed', async () => {
    // The spec's single-winner outcome must also hold over a plain MemorySource
    // (no etag) — there the assignee read-check (not If-Match) catches the loser.
    const circle = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    const tasks = createTaskStore(circle);
    await tasks.addItems([{ id: 'm', text: 'mow' }], { actor: ANNE });

    const first = await tasks.claim('m', { actor: BOB });
    const second = await tasks.claim('m', { actor: CARA });
    expect(first.assignee).toBe(BOB);
    expect(second.error).toBe('already-claimed');
    expect(second.current.assignee).toBe(BOB);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J2 — Co-ownership ◇   (Phase 1 — IN PROGRESS: assignees[] / maxAssignees)
//
// Unblocks when the substrate grows a co-owner API (`assignees[]` +
// `maxAssignees` + a `joinTask`/co-owning `claim`). As of this harness the
// item-store src carries no `assignees` / `maxAssignees` / `joinTask` — so this
// stays TODO. Flip to real once that API is present.
//
// Spec: add task → member B claim → member C ◇joinTask/claim as co-owner →
//   assert `assignees` contains {B,C} (not a single overwrite); both see it in
//   `listMine`; `complete` policy = the chosen rule (any co-owner vs all) —
//   assert that rule.
// Verifies: co-ownership is a set, not a last-writer overwrite of `assignee`.
// ═══════════════════════════════════════════════════════════════════════════
describe('J2 — co-ownership (GREEN: assignees[] / maxAssignees)', () => {
  const DAVE = 'https://id.example/dave'; // the over-the-cap third claimer

  it('co-ownable task: B + C both claim → assignees {B,C}; full rejects; any co-owner completes', async () => {
    const circle = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    const tasks = createTaskStore(circle);

    // A task that ALLOWS two co-owners (maxAssignees: 2). Default (1) would be
    // exclusive — that's the J1 case; here we opt into co-ownership.
    await tasks.addItems([{ id: 'heg2', text: 'heg samen knippen', maxAssignees: 2 }], { actor: ANNE });

    // B claims → in the set (not an overwrite of a single field).
    const b = await tasks.claim('heg2', { actor: BOB });
    expect(b.error).toBeUndefined();
    expect(assigneesOf(b)).toEqual([BOB]);

    // C claims the SAME task → JOINS as a co-owner; assignees is now {B,C}.
    const c = await tasks.claim('heg2', { actor: CARA });
    expect(c.error).toBeUndefined();
    expect([...assigneesOf(c)].sort()).toEqual([BOB, CARA].sort());

    // Both see it as theirs (membership, not equality with one assignee).
    const openMine = (actor) => tasks.listOpen().then((all) => all.filter((t) => assigneesOf(t).includes(actor)));
    expect((await openMine(BOB)).map((t) => t.id)).toContain('heg2');
    expect((await openMine(CARA)).map((t) => t.id)).toContain('heg2');

    // A THIRD claim on the now-full set (cap 2) → already-claimed.
    const d = await tasks.claim('heg2', { actor: DAVE });
    expect(d.error).toBe('already-claimed');
    expect([...assigneesOf(d.current)].sort()).toEqual([BOB, CARA].sort());

    // ANY co-owner can complete (Frits's default) — Cara, the non-mirror owner.
    const [done] = await tasks.markComplete([{ id: 'heg2' }], { actor: CARA });
    expect(computeStatus(done)).toBe('complete');
    expect(done.completedBy).toBe(CARA);
  });

  it('regression: a default (exclusive) task still rejects the 2nd claimer — J1 preserved', async () => {
    const circle = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    const tasks = createTaskStore(circle);
    await tasks.addItems([{ id: 'solo', text: 'solo' }], { actor: ANNE }); // no maxAssignees → default 1

    const b = await tasks.claim('solo', { actor: BOB });
    expect(assigneesOf(b)).toEqual([BOB]);
    const c = await tasks.claim('solo', { actor: CARA });
    expect(c.error).toBe('already-claimed'); // exclusive: the cap-1 set is full
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J3 — Cross-circle "all my tasks" ◇   (Phase 1 — the self-chat aggregate)
//
// Unblocks when a cross-circle aggregate op (`listMyTasksAcrossCircles`) exists.
//
// Spec seed: task assigned to me in C1; task assigned to me in C2; an unassigned
//   task in C1.
// Spec: ◇listMyTasksAcrossCircles (central/self ctx) → assert BOTH my tasks
//   returned across circles, the unassigned one excluded; each row carries
//   `circleId` (deep-link target).
// Verifies: the aggregate is ITEMS (not just the existing per-circle counts).
// ═══════════════════════════════════════════════════════════════════════════
// The WIRED op (`listMyTasksAcrossCircles`, over the tasks-v0 circlesProvider)
// is proven in apps/tasks-v0/test/v2_5-dashboard.test.js. Here we assert the
// MECHANISM it rests on — membership-filtered aggregation across circle stores,
// each row carrying its circleId — over two CircleItemStores directly.
describe('J3 — cross-circle "my tasks" (GREEN: membership aggregate across circles)', () => {
  it('aggregates my open tasks across C1+C2, excludes unassigned, rows carry circleId', async () => {
    const circles = {
      'circle-a': createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'pod://c1/' })),
      'circle-b': createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'pod://c2/' })),
    };
    // seed: a task mine in C1, a task mine in C2, an unassigned task in C1
    await circles['circle-a'].addItems([{ id: 'a-mine', text: 'mine in A' }], { actor: ANNE });
    await circles['circle-a'].claim('a-mine', { actor: ANNE });
    await circles['circle-a'].addItems([{ id: 'a-open', text: 'unassigned in A' }], { actor: BOB });
    await circles['circle-b'].addItems([{ id: 'b-mine', text: 'mine in B' }], { actor: ANNE });
    await circles['circle-b'].claim('b-mine', { actor: ANNE });

    // the aggregate: for each circle, my open tasks (membership), flattened with circleId
    const mine = [];
    for (const [circleId, store] of Object.entries(circles)) {
      for (const t of await store.listOpen()) {
        if (assigneesOf(t).includes(ANNE)) mine.push({ ...t, circleId });
      }
    }

    expect(mine.map((r) => r.id).sort()).toEqual(['a-mine', 'b-mine']); // both mine, across circles
    expect(mine.map((r) => r.id)).not.toContain('a-open'); // unassigned excluded
    expect(mine.find((r) => r.id === 'a-mine').circleId).toBe('circle-a'); // deep-link target
    expect(mine.find((r) => r.id === 'b-mine').circleId).toBe('circle-b');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J4 — Attach a file via the attachment projector ◇   (Phase 2)
//
// Unblocks when the attachment projector (`renderAttachments`) + the
// `embed-file` op with `surfaces.attach` land, retiring the hardcoded 📎 path.
//
// Spec:
//   1. ◇renderAttachments(manifest) → menu lists `embed-file` (op w/ surfaces.attach)
//      AND registry item-types (media, calendar-event, task, contact) as
//      attachables; slash-parity: the same ops appear in renderSlash/commandMenu.
//   2. Pick a file → embed-file → add task with returned embeds:[{type:'media',ref}]
//      → task carries the media embed; fitness: no bespoke attach button in
//      circleNoticeboard.
// Verifies: attachment is manifest-declared, not a hardcoded button.
// ═══════════════════════════════════════════════════════════════════════════
describe('J4 — attachment projector (TODO: Phase 2 renderAttachments/embed-file)', () => {
  it.todo(
    'renderAttachments lists embed-file + registry types; embed-file → task carries embeds:[{type:media,ref}]',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// J5 — Send a LIST ◇   (Phase 1 — lists were unnamed; make them first-class)
//
// Unblocks when a `list` item-type (ordered collection of item-refs) is
// sendable through the attachment menu + resolves for recipients.
//
// Spec:
//   1. ◇add a `list` item {title:'boodschappen', items:[ref…]} (ordered
//      collection of item-refs) → created.
//   2. renderAttachments menu includes `list`; attach the list to a message; send
//      to circle C → recipients resolve the list + its member items (via
//      embeds/shared-ref), order preserved.
// Verifies: a list is a first-class sendable collection, not just a view/filter.
// ═══════════════════════════════════════════════════════════════════════════
// The whole-list cross-circle SEND (shareContainerTree fanning the single-item
// share, with nesting reconstruction) is proven in apps/basis/test/v2/
// circleShareContainer.test.js. Here we assert the MECHANISM sendable-lists
// rests on: the ordered pre-order subtree walk that gets fanned.
describe('J5 — sendable lists (GREEN: ordered subtree walk)', () => {
  it('collectSubtree walks a list + nested children in pre-order (container first)', async () => {
    const store = new CircleItemStore({ dataSource: new MemorySource(), rootContainer: ROOT });
    await store.put({ id: 'lst', type: 'list', text: 'boodschappen' }, { by: ANNE });
    const melk = await addChildTo(store, 'lst', { type: 'list-item', text: 'melk' });
    await addChildTo(store, melk.id, { type: 'list-item', text: 'volle melk' }); // nested under melk
    await addChildTo(store, 'lst', { type: 'list-item', text: 'brood' });

    const order = (await collectSubtree(store, 'lst')).map((n) => (typeof n === 'string' ? n : n.id));
    // pre-order: the list, then melk + its nested child, then brood
    expect(order[0]).toBe('lst'); // container first — the send carries it, then members in order
    expect(order).toContain(melk.id);
    expect(order.length).toBe(4); // list + 3 descendants, each enumerated once
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// J6 — Requestable bridge: an offering invoked becomes a task ◇   (Phase 4)
//
// Unblocks when a `requestable` skill flag + the member→device invoke routing +
// the humanInTheLoop→task bridge land.
//
// Spec:
//   1. A sets offering "fix leaks" (skill-kind), marks it ◇requestable in circle C
//      (default OFF).
//   2. B's agent ◇invokes A's requestable skill (member→device routing,
//      group-gated) → arrives to A as a TASK ("Kun je mijn lek maken?") with a
//      requestable/rust badge, NOT an action.
//   3. A accept → task claimed by A; OR A counters via the core input-required
//      round-trip → the IR exchange carries the counter and B's simple responder
//      can still answer.
// Verifies: humanInTheLoop:required → task; posture:negotiable → IR counter;
//   direct-to-device routing.
// ═══════════════════════════════════════════════════════════════════════════
describe('J6 — requestable bridge (TODO: Phase 4 requestable→task)', () => {
  it.todo(
    'requestable skill invoked by B arrives to A as a task (not action); accept → claimed; counter → IR round-trip',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// J7 — Standing via a role bundle ◇   (Phase 3 + 4)
//
// Unblocks when a role = named capability bundle exists (`grantRole` materialises
// cap-tokens; `standing` = pre-consent).
//
// Spec:
//   1. ◇ define role `warden` = bundle {rank, grants:[emergency-skill @ standing]}.
//   2. ◇grantRole(warden → member W) → W's cap-tokens for the bundle are
//      MATERIALIZED (not just a string set); W's advertised emergency skill is
//      now `standing`-mode.
//   3. Invoke the emergency skill → immediate obligation (no fresh consent),
//      because W pre-consented by accepting the role. Revoke role → the skill
//      reverts to `requestable`.
// Verifies: role=named capability bundle; grant materialises capabilities;
//   standing = pre-consent.
// ═══════════════════════════════════════════════════════════════════════════
describe('J7 — standing via role bundle (TODO: Phase 3+4 grantRole/standing)', () => {
  it.todo(
    'define warden bundle → grantRole materialises cap-tokens → standing invoke = no fresh consent → revoke reverts to requestable',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// J8 — Task-scoped grant, attenuated + broker + revoked ◇   (Phase 5)
//
// Unblocks when task-scoped grants (Toegang picker attenuation + broker/proxy
// default + revoke-on-complete) land.
//
// Spec:
//   1. Create task for prediction-bot; ◇attach grant "read: my agenda" via the
//      Toegang picker → the picker offered ONLY what I hold (attenuation at the
//      UI); grant defaults to broker/proxy.
//   2. Bot invokes the granted read → succeeds within scope; a read OUTSIDE scope
//      is denied (attenuation); keys never left (broker), only answers.
//   3. complete/cancel the task → the grant is revoked (a subsequent read fails).
// Verifies: BotAgentRegistry-pattern generalised; grants off-by-default,
//   attenuated, temporary, brokered.
// ═══════════════════════════════════════════════════════════════════════════
describe('J8 — task-scoped grant (TODO: Phase 5 attenuated broker grant)', () => {
  it.todo(
    'attach attenuated agenda-read grant to a bot task → in-scope read ok, out-of-scope denied, keys stay; complete → revoked',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// J9 — Matchable but NOT disclosed ◇   (Phase 4 — the three axes)
//
// Unblocks when property axes (matchable / disclosed / requestable) + the
// on-device match-proposal trigger land.
//
// Spec:
//   1. In an anonymous circle, A sets hobby matchable:true, disclosed:false,
//      requestable:false.
//   2. B (same hobby, matchable) joins/updates → ◇match-proposal trigger fires →
//      BOTH get a "someone here shares your hobby" proposal; the roster shows
//      NEITHER hobby (not disclosed); no request channel opened (not requestable).
// Verifies: matchable ≠ disclosed ≠ requestable; on-device matcher;
//   join/property-change trigger.
// ═══════════════════════════════════════════════════════════════════════════
describe('J9 — matchable-not-disclosed (TODO: Phase 4 three axes + matcher)', () => {
  it.todo(
    'A matchable/undisclosed hobby + B same → both get match-proposal; roster hides both hobbies; no request channel',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// J10 — Governance role folded into the bundle model ◇   (Phase 0 + 3)
//
// Unblocks when governance role is enforced through one canonical PolicyEngine
// `requiredRole` path (no inline `role==='admin'` string gate remains).
//
// Spec:
//   1. setRole(admin → A) via the single canonical path → an admin-gated op (e.g.
//      `reassign`) is allowed for A, denied for a plain member — enforced through
//      PolicyEngine `requiredRole`, NOT an inline role==='admin' string check
//      (fitness: no inline role-string gates remain).
// Verifies: governance role IS a capability bundle; one enforcement point; drift
//   guards hold.
// ═══════════════════════════════════════════════════════════════════════════
describe('J10 — governance-role-as-bundle (TODO: Phase 0+3 canonical requiredRole)', () => {
  it.todo(
    'setRole(admin) via canonical path → admin-gated op allowed for A, denied for member via PolicyEngine requiredRole (no inline role-string gate)',
  );
});
