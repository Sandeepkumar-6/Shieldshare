import { config } from '../config/env.js';

let providerOverride = null;

export function setProviderForTests(provider) {
  providerOverride = provider;
}

export function clearProviderForTests() {
  providerOverride = null;
}

export async function getProvider() {
  if (providerOverride) return providerOverride;
  if (config.ai.provider === 'openai') {
    const { createOpenAIProvider } = await import('./providers/openai.adapter.js');
    return createOpenAIProvider(config.ai);
  }
  if (config.ai.provider === 'gemini') {
    const { createGeminiProvider } = await import('./providers/gemini.adapter.js');
    return createGeminiProvider(config.ai);
  }
  if (config.ai.provider === 'anthropic') {
    const { createAnthropicProvider } = await import('./providers/anthropic.adapter.js');
    return createAnthropicProvider(config.ai);
  }
  return unavailableProvider(`Unsupported AI provider: ${config.ai.provider}.`);
}

export function unavailableProvider(reason) {
  return {
    name: config.ai.provider,
    status: () => ({ available: false, reason }),
    async createResponse() { throw new Error(reason); },
  };
}
