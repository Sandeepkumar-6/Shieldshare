import { get, post } from './api.js';

export const shieldAiApi = {
  async status() { const { data } = await get('/ai/status'); return data; },
  async conversations() { const { data } = await get('/ai/conversations'); return data; },
  async createConversation(context) { const { data } = await post('/ai/conversations', { ...(context ? { context } : {}) }); return data; },
  async conversation(id) { const { data } = await get(`/ai/conversations/${id}`); return data; },
  async send(id, content, context) { const { data } = await post(`/ai/conversations/${id}/messages`, { content, ...(context ? { context } : {}) }, { timeout: 45_000 }); return data.message; },
  async confirm(id) { const { data } = await post(`/ai/actions/${id}/confirm`); return data; },
  async cancel(id) { const { data } = await post(`/ai/actions/${id}/cancel`); return data; },
};
