// Shield AI answer parsing: raw JSON must never reach the administrator, even when a model
// wraps the answer in a code fence or is cut off by the output-token limit.
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.JWT_SECRET ??= 'unit-test-secret-unit-test-secret-000000';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused';
process.env.CLIENT_ORIGIN ??= 'http://localhost:5173';
const { parseAssistant } = await import('../../server/src/ai/shieldai.service.js');

test('complete JSON, with or without a code fence or surrounding prose', () => {
  const body = { content: 'Frozen because of **SH-1002**.', blocks: [{ type: 'timeline', source: 'getIncident', incidentId: 'a'.repeat(24) }], citations: [{ kind: 'incident', id: 'a'.repeat(24), label: 'SH-1002' }] };
  for (const text of [JSON.stringify(body), `\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``, `Here you go:\n${JSON.stringify(body)}`]) {
    const parsed = parseAssistant(text);
    assert.equal(parsed.content, body.content);
    assert.equal(parsed.blocks.length, 1);
    assert.equal(parsed.citations.length, 1);
  }
});

test('a reply cut off mid-JSON keeps its narrative, marked as incomplete, without raw JSON', () => {
  const cut = '```json\n{\n  "content": "### Summary\\nIncident SH-1002 affected 8 files.\\n- `a.md.locked` (QUAR';
  const parsed = parseAssistant(cut);
  assert.match(parsed.content, /^### Summary\nIncident SH-1002 affected 8 files\.\n- `a\.md\.locked` \(QUAR/);
  assert.match(parsed.content, /cut short/);
  assert.doesNotMatch(parsed.content, /"content"|```/);
  assert.deepEqual([parsed.blocks, parsed.citations], [[], []]);
});

test('plain prose passes through; empty and unreadable JSON get a clear message', () => {
  assert.equal(parseAssistant('The account was frozen at 07:39.').content, 'The account was frozen at 07:39.');
  assert.match(parseAssistant('').content, /unavailable/);
  assert.match(parseAssistant('{"blocks": [').content, /could not format/);
});
