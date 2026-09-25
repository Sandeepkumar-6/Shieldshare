// Provider seam only: no Anthropic SDK is installed until that provider is implemented.
export function createAnthropicProvider() {
  const reason = 'Anthropic support is not installed yet. Set AI_PROVIDER=openai or add the Anthropic adapter.';
  return {
    name: 'anthropic',
    status: () => ({ available: false, reason }),
    async createResponse() { throw new Error(reason); },
  };
}
