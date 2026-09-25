// The simulator's "encryption" (spec §30 rule 5): XOR with a keystream from a seeded
// pseudo-random generator (mulberry32). It is NOT cryptography and nothing is withheld: the
// seed is below and decode() reverses it.
//
// A keystream rather than a single-byte XOR because a single-byte XOR only relabels the
// bytes of a text file and leaves its entropy unchanged; the keystream spreads them over
// all 256 values, which is the change the entropy signal looks for (spec §13, Phase 5).

export const DEFAULT_SEED = 0x5eedc0de;

// mulberry32: a small 32-bit PRNG. Returns the next unsigned 32-bit value on each call.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export function keystream(length, seed = DEFAULT_SEED) {
  const out = Buffer.alloc(length);
  const next = mulberry32(seed);
  for (let offset = 0; offset < length; offset += 4) {
    const word = next();
    for (let byte = 0; byte < 4 && offset + byte < length; byte += 1) {
      out[offset + byte] = (word >>> (byte * 8)) & 0xff;
    }
  }
  return out;
}

function xor(input, seed) {
  const data = Buffer.from(input);
  const key = keystream(data.length, seed);
  const out = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index += 1) out[index] = data[index] ^ key[index];
  return out;
}

export function encode(input, seed = DEFAULT_SEED) {
  return xor(input, seed);
}

// XOR with the same keystream restores the original bytes.
export function decode(input, seed = DEFAULT_SEED) {
  return xor(input, seed);
}
