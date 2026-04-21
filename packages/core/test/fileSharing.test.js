/**
 * fileSharing.js tests — sendFile, bulkTransferSend, handleBulkChunk.
 */
import { describe, it, expect } from 'vitest';
import { Agent }         from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { Parts }         from '../src/Parts.js';
import {
  sendFile, bulkTransferSend, handleBulkChunk,
} from '../src/protocol/fileSharing.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

async function makePair() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const alice = new Agent({ identity: idA, transport: tA, label: 'alice' });
  const bob   = new Agent({ identity: idB, transport: tB, label: 'bob' });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();
  return { alice, bob };
}

/** Make a FilePart with base64-encoded data of roughly `byteSize` bytes. */
function makeFilePart(byteSize, mimeType = 'text/plain', name = 'test.txt') {
  const bytes  = Buffer.alloc(byteSize, 'A');
  const data   = bytes.toString('base64');
  return { type: 'FilePart', mimeType, name, data };
}

// ── sendFile — small file (inline) ───────────────────────────────────────────

describe('sendFile — small file', () => {
  it('delivers FilePart inline via OW and bob emits file-received', async () => {
    const { alice, bob } = await makePair();

    // Wire bob's transport so handleBulkChunk sees OW messages.
    bob.transport.setReceiveHandler(env => {
      handleBulkChunk(bob, env);
    });

    const filePart = makeFilePart(100, 'image/png', 'small.png');
    const received = new Promise(r => bob.once('file-received', r));

    await sendFile(alice, bob.address, filePart);

    const evt = await received;
    expect(evt.from).toBe(alice.address);
    expect(evt.filePart.name).toBe('small.png');
    expect(evt.filePart.data).toBe(filePart.data);

    await alice.stop(); await bob.stop();
  });
});

// ── sendFile — large file (bulk transfer) ────────────────────────────────────

describe('sendFile — large file (bulk transfer)', () => {
  it('chunks file into multiple AS envelopes and reassembles on receive', async () => {
    const { alice, bob } = await makePair();

    bob.transport.setReceiveHandler(env => {
      handleBulkChunk(bob, env);
    });

    // File larger than the 64KB inline threshold.
    const filePart = makeFilePart(80 * 1024, 'application/octet-stream', 'large.bin');
    const received = new Promise(r => bob.once('file-received', r));

    await sendFile(alice, bob.address, filePart);

    const evt = await received;
    expect(evt.from).toBe(alice.address);
    expect(evt.filePart.mimeType).toBe('application/octet-stream');
    expect(evt.filePart.data).toBe(filePart.data);

    await alice.stop(); await bob.stop();
  }, 15_000);
});

// ── bulkTransferSend ──────────────────────────────────────────────────────────

describe('bulkTransferSend', () => {
  it('returns a transferId and receiver reassembles data', async () => {
    const { alice, bob } = await makePair();
    bob.transport.setReceiveHandler(env => handleBulkChunk(bob, env));

    const data      = Buffer.alloc(50 * 1024, 'Z').toString('base64');
    const received  = new Promise(r => bob.once('file-received', r));
    const txId      = await bulkTransferSend(alice, bob.address, null, data,
                                             { mimeType: 'text/plain', name: 'chunk.txt' });

    expect(txId).toBeTypeOf('string');
    const evt = await received;
    expect(evt.transferId).toBe(txId);
    expect(evt.filePart.data).toBe(data);

    await alice.stop(); await bob.stop();
  }, 15_000);

  it('accepts an explicit transferId', async () => {
    const { alice, bob } = await makePair();
    bob.transport.setReceiveHandler(env => handleBulkChunk(bob, env));

    const data     = Buffer.alloc(1024, 'X').toString('base64');
    const received = new Promise(r => bob.once('file-received', r));
    const txId     = await bulkTransferSend(alice, bob.address, 'my-transfer-id', data, {});

    expect(txId).toBe('my-transfer-id');
    const evt = await received;
    expect(evt.transferId).toBe('my-transfer-id');

    await alice.stop(); await bob.stop();
  });
});

// ── handleBulkChunk unit tests ────────────────────────────────────────────────

describe('handleBulkChunk', () => {
  it('returns false for unrelated payload types', async () => {
    const { alice } = await makePair();
    const result = handleBulkChunk(alice, { payload: { type: 'ping' } });
    expect(result).toBe(false);
    await alice.stop();
  });

  it('returns true for bulk-chunk payloads', async () => {
    const { alice } = await makePair();
    const result = handleBulkChunk(alice, {
      _from: 'peer',
      payload: {
        type: 'bulk-chunk', transferId: 'x', seq: 0,
        data: Buffer.alloc(10).toString('base64'), final: true, meta: {},
      },
    });
    expect(result).toBe(true);
    await alice.stop();
  });

  it('returns true for inline file payloads', async () => {
    const received = [];
    const fakeAgent = {
      stateManager: { getStream: () => null, openStream: () => {}, closeStream: () => {} },
      emit: (...args) => received.push(args),
    };
    const fp = { type: 'FilePart', mimeType: 'text/plain', data: 'aGk=' };
    const result = handleBulkChunk(fakeAgent, {
      _from: 'peer',
      payload: { type: 'file', filePart: fp, from: 'peer' },
    });
    expect(result).toBe(true);
    expect(received[0][0]).toBe('file-received');
    expect(received[0][1].filePart).toBe(fp);
  });
});
