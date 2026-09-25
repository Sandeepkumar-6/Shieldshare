// Simulator building blocks (spec §30): the reversible transform and the demo-data path
// checks. Pure: no database, no server.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { entropyOfBuffer } from '../../server/src/security/entropy.js';
import { DEMO_DATA_DIR, listSeedFiles, readSeedFile, resolveSeedPath } from '../../server/src/simulator/demoData.js';
import { DEFAULT_SEED, decode, encode, keystream, mulberry32 } from '../../server/src/simulator/transform.js';

const entropy = (buffer) => {
  const value = entropyOfBuffer(buffer);
  return typeof value === 'object' ? value.entropy : value;
};

describe('reversible transform (XOR with a mulberry32 keystream)', () => {
  test('decode(encode(x)) === x for text, binary, empty and odd lengths', () => {
    const samples = [
      Buffer.from('Quarterly budget, draft 3\nline,planned,actual\n'),
      Buffer.from([0, 1, 2, 3, 254, 255, 128, 7]),
      Buffer.alloc(0),
      Buffer.from('x'),
      Buffer.from('odd length!'),
      fs.readFileSync(path.join(DEMO_DATA_DIR, 'finance', 'q3-budget.csv')),
    ];
    for (const sample of samples) {
      const encoded = encode(sample);
      assert.equal(encoded.length, sample.length);
      assert.ok(decode(encoded).equals(sample));
      if (sample.length > 8) assert.ok(!encoded.equals(sample), 'the content actually changes');
    }
  });

  test('deterministic with the fixed seed; a different seed gives a different keystream', () => {
    assert.ok(encode(Buffer.from('same input')).equals(encode(Buffer.from('same input'))));
    assert.ok(!keystream(64, DEFAULT_SEED).equals(keystream(64, DEFAULT_SEED + 1)));
    const next = mulberry32(1);
    const values = Array.from({ length: 5 }, () => next());
    assert.ok(values.every((value) => Number.isInteger(value) && value >= 0 && value < 2 ** 32));
  });

  test('not a single-byte XOR: the keystream uses many byte values and raises the entropy of text', () => {
    const key = keystream(4096);
    assert.ok(new Set(key).size > 200, 'keystream spreads over the byte range');
    const text = fs.readFileSync(path.join(DEMO_DATA_DIR, 'documents', 'meeting-notes.md'));
    const singleByte = Buffer.from(text.map((byte) => byte ^ 0x5a));
    assert.equal(entropy(singleByte).toFixed(6), entropy(text).toFixed(6), 'a single-byte XOR leaves entropy unchanged');
    assert.ok(entropy(text) < 5.5);
    assert.ok(entropy(encode(text)) > 7.5, `encoded entropy ${entropy(encode(text))}`);
  });
});

describe('demo-data paths (realpath, inside server/demo-data only)', () => {
  test('seed files: 15 in documents, finance, projects; mostly low-entropy text plus 2–3 PDF/DOCX', async () => {
    const files = await listSeedFiles();
    assert.equal(files.length, 15);
    assert.deepEqual([...new Set(files.map((file) => file.folder))], ['documents', 'finance', 'projects']);
    const compressed = files.filter((file) => /\.(pdf|docx)$/.test(file.name));
    assert.ok(compressed.length >= 2 && compressed.length <= 3);
    for (const file of files) assert.ok((await readSeedFile(file.relativePath)).length > 0);
  });

  test('"../", absolute paths and escapes are refused before anything is read', async () => {
    for (const bad of ['../package.json', 'documents/../../package.json', '..', '../src/server.js', path.resolve(DEMO_DATA_DIR, '..', 'package.json'), '', 'a\0b']) {
      await assert.rejects(resolveSeedPath(bad), (error) => error.code === 'SEED_PATH_REFUSED', `refused: ${JSON.stringify(bad)}`);
      await assert.rejects(readSeedFile(bad), (error) => error.code === 'SEED_PATH_REFUSED');
    }
    await assert.rejects(resolveSeedPath('documents/not-there.txt'), (error) => error.code === 'SEED_PATH_REFUSED');
    assert.equal(await resolveSeedPath('finance/q3-budget.csv'), fs.realpathSync(path.join(DEMO_DATA_DIR, 'finance', 'q3-budget.csv')));
  });

  // A directory link (a junction on Windows, which needs no special rights) inside
  // demo-data/ that points outside: the path is spelled inside, realpath lands outside.
  test('a link inside demo-data that points outside is refused', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldshare-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const link = path.join(DEMO_DATA_DIR, 'documents', `.link-${process.pid}`);
    try {
      fs.symlinkSync(outside, link, 'junction');
      assert.equal(fs.readFileSync(path.join(link, 'secret.txt'), 'utf8'), 'secret', 'the link works');
      await assert.rejects(resolveSeedPath(`documents/.link-${process.pid}/secret.txt`), (error) => error.code === 'SEED_PATH_REFUSED');
      await assert.rejects(readSeedFile(`documents/.link-${process.pid}/secret.txt`), (error) => error.code === 'SEED_PATH_REFUSED');
      assert.ok(!(await listSeedFiles()).some((file) => file.name.startsWith('.link')), 'links are never listed as seed files');
    } finally {
      // unlink removes the link itself, never the directory it points to.
      try { fs.unlinkSync(link); } catch { /* not created */ }
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
