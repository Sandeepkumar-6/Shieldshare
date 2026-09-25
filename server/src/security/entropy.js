import fs from 'node:fs/promises';

// Shannon entropy in bits per byte (0–8), spec §13.
//
// Phase 1 stores the value on every File/Version/Activity. Phase 5a's risk rule consumes the
// stored before/after values; measurement remains independent from scoring.

export const SAMPLE_THRESHOLD_BYTES = 1024 * 1024; // files larger than 1 MB are sampled
export const SAMPLE_BLOCK_BYTES = 64 * 1024;
const SAMPLE_BLOCK_COUNT = 6; // first, last and 4 evenly spaced blocks

export function shannonEntropy(counts, total) {
  if (!total) return 0;
  let entropy = 0;
  for (let i = 0; i < 256; i += 1) {
    const count = counts[i];
    if (count) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

function countBytes(counts, buffer, length = buffer.length) {
  for (let i = 0; i < length; i += 1) {
    counts[buffer[i]] += 1;
  }
}

export function entropyOfBuffer(buffer) {
  const counts = new Uint32Array(256);
  countBytes(counts, buffer);
  return shannonEntropy(counts, buffer.length);
}

// Byte ranges analysed for a file of `size` bytes. Up to 1 MB the whole file is read.
// Above that: first 64 KB, last 64 KB and 4 evenly spaced 64 KB blocks in between.
export function sampleRanges(size) {
  if (size <= SAMPLE_THRESHOLD_BYTES) {
    return [{ offset: 0, length: size }];
  }
  const lastOffset = size - SAMPLE_BLOCK_BYTES;
  const ranges = [];
  for (let i = 0; i < SAMPLE_BLOCK_COUNT; i += 1) {
    const offset = Math.round((i * lastOffset) / (SAMPLE_BLOCK_COUNT - 1));
    ranges.push({ offset, length: SAMPLE_BLOCK_BYTES });
  }
  return ranges;
}

export async function measureFileEntropy(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const ranges = sampleRanges(size);
    const counts = new Uint32Array(256);
    const buffer = Buffer.alloc(size <= SAMPLE_THRESHOLD_BYTES ? Math.max(size, 1) : SAMPLE_BLOCK_BYTES);
    let analysed = 0;

    for (const range of ranges) {
      const { bytesRead } = await handle.read(buffer, 0, range.length, range.offset);
      countBytes(counts, buffer, bytesRead);
      analysed += bytesRead;
    }

    return {
      entropy: Math.round(shannonEntropy(counts, analysed) * 10000) / 10000,
      sampled: size > SAMPLE_THRESHOLD_BYTES,
      bytesAnalysed: analysed,
    };
  } finally {
    await handle.close();
  }
}
