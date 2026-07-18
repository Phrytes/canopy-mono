// ULID — see @onderling/item-store for canonical comments.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid() {
  const now = Date.now();
  let timeStr = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += CROCKFORD[rand[i] % 32];
  }
  return timeStr + randStr;
}
