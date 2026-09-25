// Gemini adapter (ai/providers/gemini.adapter.js): the provider-neutral agent-loop input is
// translated to Gemini contents. Pure: no network.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __testing } from '../../server/src/ai/providers/gemini.adapter.js';

const { toContents } = __testing;

test('user text, model turns and tool results become Gemini contents, results grouped per turn', () => {
  const contents = toContents([
    { role: 'user', content: 'Why was this account frozen?' },
    {
      type: 'gemini_model_turn',
      content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'getIncident', args: { incidentId: 'x' } } }, { functionCall: { name: 'getRiskBreakdown', args: {} } }] },
    },
    { type: 'function_call_output', call_id: 'c1', output: 'incident data' },
    { type: 'function_call_output', call_id: 'getRiskBreakdown#1', output: 'risk data' },
  ]);
  assert.equal(contents.length, 3);
  assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'Why was this account frozen?' }] });
  assert.equal(contents[1].role, 'model');
  assert.deepEqual(contents[2], {
    role: 'user',
    parts: [
      { functionResponse: { id: 'c1', name: 'getIncident', response: { output: 'incident data' } } },
      { functionResponse: { name: 'getRiskBreakdown', response: { output: 'risk data' } } },
    ],
  });
});

test('the same tool called twice in one turn keeps both results', () => {
  const contents = toContents([
    { role: 'user', content: 'Compare two files' },
    { type: 'gemini_model_turn', content: { role: 'model', parts: [{ functionCall: { name: 'getFileDetails', args: { fileId: 'a' } } }, { functionCall: { name: 'getFileDetails', args: { fileId: 'b' } } }] } },
    { type: 'function_call_output', call_id: 'getFileDetails#0', output: 'a' },
    { type: 'function_call_output', call_id: 'getFileDetails#1', output: 'b' },
  ]);
  assert.deepEqual(contents[2].parts.map((part) => [part.functionResponse.name, part.functionResponse.response.output]), [['getFileDetails', 'a'], ['getFileDetails', 'b']]);
});
