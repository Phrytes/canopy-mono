/**
 * J4 — pod data: read and write structured data against a pod-shaped store
 * without running a Solid server.
 *
 * The imagined developer: an app author whose app stores user data "in the
 * pod", but who wants to develop and test fully offline. The platform's
 * answer is `@onderling/pseudo-pod`: a Solid-shaped local store with the
 * same read / write / list / subscribe surface, so the app code is
 * identical whether a real pod is attached or not.
 *
 * What it proves: `@onderling/pseudo-pod` + `@onderling/sdk` suffice to
 *   1. create an in-memory pod (standalone mode — local store is canonical),
 *   2. write and read structured JSON resources with etags,
 *   3. list a container and observe live change notifications (subscribe),
 *   4. expose the pod over the agent wire: the pod's own `fetch-resource`
 *      skill is registered on a host agent and a second, external agent
 *      fetches a resource through the same skill-call waist — still with
 *      no server anywhere.
 *
 * Everything here runs offline in one Node process.
 */
import assert from 'node:assert/strict';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgent, InternalBus, Parts } from '@onderling/sdk';

function step(n, text) { console.log(`  ${n}. ${text}`); }

console.log('J4 pod-data — structured storage on an in-memory pod, then over the wire');

// ── 1. An in-memory pod: Solid-shaped, no server ────────────────────────────
const pod = createPseudoPod({
  backend:  createMemoryBackend(),
  mode:     'standalone',
  deviceId: 'journey-device',
});
assert.equal(pod.deviceId, 'journey-device');
step(1, `created a standalone pseudo-pod for device "${pod.deviceId}"`);

// ── 2. Write structured resources; etags come back ──────────────────────────
const noteUri    = 'pseudo-pod://journey-device/notes/first';
const contactUri = 'pseudo-pod://journey-device/contacts/carol';
const changes = [];
pod.subscribe(noteUri, (evt) => changes.push(evt));

const { etag } = await pod.write(noteUri, { type: 'note', body: 'Water the plants' });
await pod.write(contactUri, { type: 'contact', name: 'Carol', circle: 'garden' });
assert.ok(etag, 'writes return an etag');
step(2, `wrote two JSON resources (note etag ${String(etag).slice(0, 12)}…)`);

// ── 3. Read one back and list a container ──────────────────────────────────
const rec = await pod.read(noteUri);
assert.equal(rec.uri, noteUri, 'read echoes the uri');
assert.equal(rec.bytes.body, 'Water the plants', 'structured value round-trips');
assert.ok(rec.etag, 'reads carry the etag');

const listed = await pod.list('pseudo-pod://journey-device/notes/');
assert.equal(listed.length, 1, 'the notes container lists exactly the note');
assert.ok(changes.length >= 1, 'the subscription observed the write');
step(3, `read the note back (etag-tracked) and listed the container (${listed.length} entry); subscription fired ${changes.length}x`);

// ── 4. Update in place — the etag changes, the subscription fires again ────
await pod.write(noteUri, { type: 'note', body: 'Water the plants — done' });
const rec2 = await pod.read(noteUri);
assert.notEqual(rec2.etag, rec.etag, 'a new revision gets a new etag');
step(4, 'updated the note; the etag advanced');

// ── 5. Serve the pod over the agent wire — still no server ─────────────────
// The pod mints its own `fetch-resource` skill; a host agent registers it.
// An external agent then fetches a resource through the ordinary skill-call
// waist. This is the same peer-fetch protocol a real deployment uses.
const bus      = new InternalBus();
const hostApp  = await createAgent({ bus, label: 'pod-host' });
const external = await createAgent({ bus, label: 'external-reader' });
hostApp.addPeer(external.address, external.pubKey);
external.addPeer(hostApp.address, hostApp.pubKey);
hostApp.skills.register(pod.fetchResourceSkill());
step(5, 'registered the pod\'s fetch-resource skill on a host agent');

const parts   = await external.invoke(hostApp.address, 'fetch-resource', Parts.wrap({ uri: contactUri }));
const fetched = Parts.data(parts);
assert.equal(fetched.uri, contactUri, 'the wire fetch echoes the uri');
assert.equal(fetched.bytes.name, 'Carol', 'the external agent received the stored structured value');
step(6, `external agent fetched ${contactUri} over the wire → ${JSON.stringify(fetched.bytes)}`);

await external.stop();
await hostApp.stop();

console.log('✓ J4 pod-data: PASS');
