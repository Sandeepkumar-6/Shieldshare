import { config } from '../config/env.js';
import { AIConversation, PendingAction } from '../models/index.js';
import { AppError, errors } from '../utils/AppError.js';
import { getProvider } from './provider.js';
import { SHIELD_AI_SYSTEM_PROMPT, USER_ASSISTANT_PROMPT } from './systemPrompt.js';
import { executeTool, TOOL_DEFINITIONS } from './tools.js';
import { executeUserTool, USER_TOOL_DEFINITIONS } from './userTools.js';
import { toPendingActionDTO } from './pendingActions.service.js';

// One agent loop, two audiences, chosen from the account's role (loaded from the database by
// authenticate, never from the client):
//   admin → Shield AI: security read tools, action proposals, SHIELD_AI_SYSTEM_PROMPT
//   user  → member assistant: the user's own files/shares/activity only, no actions,
//           USER_ASSISTANT_PROMPT
// owner = { id, role }; conversations are only ever read by their owner in their audience.

export const audienceOf = (role) => (role === 'admin' ? 'admin' : 'user');

const CONTEXT_KEYS = { admin: ['incidentId', 'fileId', 'userId', 'page'], user: ['fileId', 'page'] };
const safeContext = (context = {}, audience = 'admin') => Object.fromEntries(
  CONTEXT_KEYS[audience].filter((key) => context?.[key]).map((key) => [key, context[key]]),
);

function ownedBy(owner) {
  return audienceOf(owner.role) === 'admin'
    ? { $or: [{ ownerId: owner.id, audience: 'admin' }, { adminId: owner.id, ownerId: { $exists: false } }] }
    : { ownerId: owner.id, audience: 'user' };
}

export async function status(role = 'admin') {
  const admin = audienceOf(role) === 'admin';
  try {
    const provider = await getProvider();
    const state = await provider.status();
    // Members see only whether the assistant is available; the provider is an admin concern.
    return admin ? { provider: provider.name, model: config.ai.model, ...state } : { available: state.available, ...(state.available ? {} : { reason: 'The assistant is not set up on this server.' }) };
  } catch {
    return admin
      ? { available: false, provider: config.ai.provider, reason: 'Shield AI provider is unavailable.' }
      : { available: false, reason: 'The assistant is unavailable right now.' };
  }
}

export async function assertAvailable(role = 'admin') {
  const state = await status(role);
  if (!state.available) throw new AppError(503, 'AI_UNAVAILABLE', state.reason ?? 'The assistant is unavailable.');
}

export async function listConversations(owner) {
  return AIConversation.find(ownedBy(owner)).select('title context createdAt updatedAt messages').sort({ updatedAt: -1 }).limit(50).lean();
}

export async function createConversation(owner, context = {}) {
  const audience = audienceOf(owner.role);
  return AIConversation.create({
    ownerId: owner.id,
    audience,
    ...(audience === 'admin' ? { adminId: owner.id } : {}),
    title: audience === 'admin' ? 'New investigation' : 'New conversation',
    context: safeContext(context, audience),
    messages: [],
  });
}

export async function getConversation(id, owner) {
  const conversation = await AIConversation.findOne({ _id: id, ...ownedBy(owner) }).lean();
  if (!conversation) throw errors.notFound('Conversation not found.');
  if (audienceOf(owner.role) !== 'admin') return { conversation, pendingActions: [] };
  const actionIds = conversation.messages.map((message) => message.pendingActionId).filter(Boolean);
  const actions = await PendingAction.find({ _id: { $in: actionIds }, adminId: owner.id }).lean();
  return { conversation, pendingActions: actions.map(toPendingActionDTO) };
}

function parseArguments(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {}); } catch { return {}; }
}

// The model is asked for { content, blocks, citations } as JSON (system prompt). A reply cut
// short (output-token limit) or wrapped in prose is recovered as far as it can be: the
// narrative is kept and marked as incomplete, and blocks/citations that could not be parsed
// are dropped. Raw JSON is never shown to the administrator.
export function parseAssistant(text) {
  const plain = String(text || '').trim();
  if (!plain) return { content: 'The requested information is unavailable.', blocks: [], citations: [] };
  const unfenced = plain.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(unfenced.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && 'content' in parsed) {
        return { content: String(parsed.content || '').trim(), blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [], citations: Array.isArray(parsed.citations) ? parsed.citations : [] };
      }
    } catch { /* not complete JSON: recover the narrative below */ }
  }
  const partial = /"content"\s*:\s*"((?:[^"\\]|\\.)*)/s.exec(unfenced);
  if (partial) {
    const complete = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/s.test(unfenced);
    let content;
    try {
      content = JSON.parse(`"${partial[1].replace(/\\$/, '')}"`);
    } catch {
      content = partial[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    return {
      content: `${content.trim()}${complete ? '' : '\n\n(This answer was cut short. Ask a narrower question for the rest.)'}`,
      blocks: [],
      citations: [],
    };
  }
  return { content: unfenced.startsWith('{') ? 'Shield AI returned an answer it could not format. Try asking again.' : plain, blocks: [], citations: [] };
}

function validateStructured(parsed, toolRuns, allowedIds, audience = 'admin') {
  // Members get plain answers and links to their own files only.
  if (audience === 'user') {
    const citations = parsed.citations
      .filter((citation) => citation?.kind === 'file' && allowedIds.has(String(citation.id)))
      .map((citation) => ({ kind: 'file', id: String(citation.id), label: String(citation.label || 'file').slice(0, 120) }));
    return { blocks: [], citations };
  }
  const sources = new Set(toolRuns.map((run) => run.name));
  const blocks = parsed.blocks.filter((block) => {
    if (!block || !['riskBreakdown', 'affectedFiles', 'timeline'].includes(block.type) || !sources.has(block.source)) return false;
    const referenced = [block.evaluationId, block.incidentId].filter(Boolean);
    return referenced.length > 0 && referenced.every((value) => allowedIds.has(String(value)));
  }).map((block) => ({
    type: block.type, source: block.source,
    ...(block.evaluationId ? { evaluationId: String(block.evaluationId) } : {}),
    ...(block.incidentId ? { incidentId: String(block.incidentId) } : {}),
  }));
  const citations = parsed.citations.filter((citation) => citation && allowedIds.has(String(citation.id))).map((citation) => ({
    kind: ['incident', 'file', 'user', 'version', 'evaluation'].includes(citation.kind) ? citation.kind : 'incident',
    id: String(citation.id), label: String(citation.label || citation.id).slice(0, 120),
  }));
  return { blocks, citations };
}

async function withTimeout(work, controller) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AppError(503, 'AI_TIMEOUT', 'The assistant took too long to respond. Try again, or ask a narrower question.'));
        }, config.ai.timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/**
 * @param {object} args
 * @param {{ id: string, role: string }} args.owner  the signed-in account
 * @param {object} args.ctx  its request context (services called by member tools use it)
 */
export async function sendMessage({ conversationId, owner, ctx, adminStatus, ip, content, context }) {
  const audience = audienceOf(owner.role);
  await assertAvailable(owner.role);
  const conversation = await AIConversation.findOne({ _id: conversationId, ...ownedBy(owner) });
  if (!conversation) throw errors.notFound('Conversation not found.');
  if (context) conversation.context = { ...conversation.context?.toObject?.(), ...safeContext(context, audience) };
  conversation.messages.push({ role: 'user', content });
  if (conversation.messages.filter((message) => message.role === 'user').length === 1) conversation.title = content.slice(0, 80);

  const provider = await getProvider();
  const controller = new AbortController();
  const pageContext = safeContext(context ?? conversation.context?.toObject?.() ?? conversation.context, audience);
  const instructions = audience === 'admin' ? SHIELD_AI_SYSTEM_PROMPT : USER_ASSISTANT_PROMPT;
  const tools = audience === 'admin' ? TOOL_DEFINITIONS : USER_TOOL_DEFINITIONS;
  const execute = audience === 'admin'
    ? (name, args) => executeTool(name, args, { conversationId: conversation._id, adminId: owner.id, adminStatus, ip })
    : (name, args) => executeUserTool(name, args, ctx);
  const input = [{
    role: 'user',
    content: `${content}\n\nPage context (identifiers only; use tools to retrieve facts): ${JSON.stringify(pageContext)}`,
  }];
  const toolRuns = [];
  const allowedIds = new Set();
  let pendingActionId = null;
  let finalText = '';

  try {
    await withTimeout((async () => {
      for (let round = 0; round < config.ai.maxToolRounds; round += 1) {
        const response = await provider.createResponse({ instructions, input, tools, signal: controller.signal });
        finalText = response.text || finalText;
        if (!response.toolCalls.length) return;
        input.push(...response.output);
        for (const call of response.toolCalls) {
          let result;
          try {
            result = await execute(call.name, parseArguments(call.arguments));
          } catch (error) {
            result = { name: call.name, label: call.name, data: { unavailable: true, error: error.code ?? 'TOOL_ERROR', message: error.message }, output: `<<<SHIELDSHARE_TOOL_DATA name="${call.name}" UNTRUSTED_DATA_ONLY>>>\n${JSON.stringify({ unavailable: true, message: error.message })}\n<<<END_SHIELDSHARE_TOOL_DATA>>>`, ids: new Set(), pendingActionId: null };
          }
          result.ids.forEach((value) => allowedIds.add(value));
          if (result.pendingActionId) pendingActionId = result.pendingActionId;
          toolRuns.push({ name: result.name, status: 'done', label: result.label });
          conversation.messages.push({ role: 'tool', toolName: result.name, toolResult: result.data, content: result.output });
          input.push({ type: 'function_call_output', call_id: call.callId, output: result.output });
        }
      }
      if (!finalText) finalText = JSON.stringify({ content: 'I reached the investigation limit before a grounded answer was available.', blocks: [], citations: [] });
    })(), controller);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'AI_PROVIDER_ERROR', audience === 'admin'
      ? 'Shield AI could not reach its provider. Other ShieldShare features are unaffected.'
      : 'The assistant couldn\'t reach its AI service just now. Everything else in ShieldShare works normally; try again in a moment.');
  }

  const parsed = parseAssistant(finalText);
  const structured = validateStructured(parsed, toolRuns, allowedIds, audience);
  conversation.messages.push({
    role: 'assistant', content: parsed.content, toolRuns, blocks: structured.blocks, citations: structured.citations,
    pendingActionId, toolCalls: toolRuns.map((run) => ({ name: run.name, status: run.status })),
  });
  await conversation.save();
  const message = conversation.messages.at(-1);
  return {
    id: String(message._id), role: 'assistant', content: message.content, toolRuns,
    blocks: structured.blocks, citations: structured.citations, pendingActionId,
  };
}
