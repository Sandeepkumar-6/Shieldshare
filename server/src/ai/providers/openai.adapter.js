import OpenAI from 'openai';

export function createOpenAIProvider(aiConfig) {
  if (!aiConfig.apiKey) {
    return {
      name: 'openai',
      status: () => ({ available: false, reason: 'OpenAI is not configured.' }),
      async createResponse() { throw new Error('OpenAI is not configured.'); },
    };
  }

  const client = new OpenAI({ apiKey: aiConfig.apiKey, timeout: aiConfig.timeoutMs, maxRetries: 1 });
  return {
    name: 'openai',
    status: () => ({ available: true }),
    async createResponse({ instructions, input, tools, signal }) {
      const response = await client.responses.create({
        model: aiConfig.model,
        instructions,
        input,
        tools: tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
          strict: false,
        })),
        tool_choice: 'auto',
        max_output_tokens: aiConfig.maxOutputTokens,
      }, { signal });
      return {
        id: response.id,
        text: response.output_text ?? '',
        output: response.output ?? [],
        toolCalls: (response.output ?? [])
          .filter((item) => item.type === 'function_call')
          .map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments })),
      };
    },
  };
}
