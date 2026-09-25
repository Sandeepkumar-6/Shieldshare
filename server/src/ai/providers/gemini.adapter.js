import { GoogleGenAI } from '@google/genai';

// Google Gemini adapter for the Shield AI provider seam (ai/provider.js). The agent loop in
// ai/shieldai.service.js keeps a provider-neutral `input` list:
//   { role: 'user', content }                         the admin's message
//   ...response.output                                this adapter's own model turns
//   { type: 'function_call_output', call_id, output } a tool result
// This adapter translates that list to Gemini `contents` and back, so the loop, the tools,
// the pending-action flow and the validation of blocks/citations stay the same for every
// provider.

const MODEL_TURN = 'gemini_model_turn';

// Call ids: Gemini's own id when it sends one, otherwise "<name>#<index>" (see below), so the
// function name can always be recovered for the functionResponse.
function toContents(input) {
  const contents = [];
  const callNames = new Map();
  let pendingResponses = null;

  const flushResponses = () => {
    if (pendingResponses?.length) contents.push({ role: 'user', parts: pendingResponses });
    pendingResponses = null;
  };

  for (const item of input) {
    if (item?.type === MODEL_TURN) {
      flushResponses();
      for (const part of item.content?.parts ?? []) {
        if (part.functionCall?.id) callNames.set(part.functionCall.id, part.functionCall.name);
      }
      contents.push(item.content);
    } else if (item?.type === 'function_call_output') {
      pendingResponses ??= [];
      const callId = String(item.call_id);
      const name = callNames.get(callId) ?? callId.split('#')[0];
      pendingResponses.push({ functionResponse: { ...(callNames.has(callId) ? { id: callId } : {}), name, response: { output: item.output } } });
    } else if (item?.role === 'user') {
      flushResponses();
      contents.push({ role: 'user', parts: [{ text: String(item.content ?? '') }] });
    }
  }
  flushResponses();
  return contents;
}

// Gemini answers 429/503 when a model is briefly overloaded. Retry twice with backoff, but
// never past the caller's abort signal (the overall Shield AI timeout still applies).
const RETRYABLE = new Set([429, 500, 503]);
const BACKOFF_MS = [1500, 4000];

async function withRetry(call, signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const status = Number(error?.status ?? error?.code);
      if (!RETRYABLE.has(status) || attempt >= BACKOFF_MS.length || signal?.aborted) throw error;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, BACKOFF_MS[attempt]);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(error); }, { once: true });
      });
    }
  }
}

export function createGeminiProvider(aiConfig) {
  if (!aiConfig.apiKey) {
    return {
      name: 'gemini',
      status: () => ({ available: false, reason: 'Gemini is not configured. Set GEMINI_API_KEY in server/.env.' }),
      async createResponse() { throw new Error('Gemini is not configured.'); },
    };
  }

  const client = new GoogleGenAI({ apiKey: aiConfig.apiKey });
  return {
    name: 'gemini',
    status: () => ({ available: true }),
    async createResponse({ instructions, input, tools, signal }) {
      const response = await withRetry(() => client.models.generateContent({
        model: aiConfig.model,
        contents: toContents(input),
        config: {
          systemInstruction: instructions,
          tools: [{
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.input_schema,
            })),
          }],
          maxOutputTokens: aiConfig.maxOutputTokens,
          abortSignal: signal,
          httpOptions: { timeout: aiConfig.timeoutMs },
        },
      }), signal);

      const content = response.candidates?.[0]?.content ?? { role: 'model', parts: [] };
      // Gemini may omit call ids; give each call one that carries its name.
      const toolCalls = (response.functionCalls ?? []).map((call, index) => ({
        callId: call.id ?? `${call.name}#${index}`,
        name: call.name,
        arguments: call.args ?? {},
      }));
      return {
        id: response.responseId ?? null,
        text: toolCalls.length ? '' : (response.text ?? ''),
        output: [{ type: MODEL_TURN, content: { role: 'model', parts: content.parts ?? [] } }],
        toolCalls,
      };
    },
  };
}

export const __testing = { toContents };
