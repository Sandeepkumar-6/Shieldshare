import * as pending from '../ai/pendingActions.service.js';
import * as shieldai from '../ai/shieldai.service.js';
import { clientIp, contextFrom } from '../utils/requestContext.js';

// /api/ai/*. The audience (Shield AI for administrators, the member assistant for everyone
// else) comes from req.user.role, which authenticate loads from the database.
const ownerOf = (req) => ({ id: req.user.id, role: req.user.role });
const contextOf = (req) => ({ adminId: req.user.id, adminStatus: req.user.status, ip: clientIp(req) });
const conversationDTO = (conversation) => ({
  id: String(conversation._id), title: conversation.title, context: conversation.context,
  audience: conversation.audience ?? 'admin',
  messages: conversation.messages, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
});

export async function status(req, res) { res.json({ data: await shieldai.status(req.user.role) }); }

export async function listConversations(req, res) {
  const rows = await shieldai.listConversations(ownerOf(req));
  res.json({ data: rows.map((row) => ({ ...conversationDTO(row), messageCount: row.messages.length, messages: undefined })) });
}

export async function createConversation(req, res) {
  const conversation = await shieldai.createConversation(ownerOf(req), req.valid.body.context);
  res.status(201).json({ data: conversationDTO(conversation) });
}

export async function getConversation(req, res) {
  const result = await shieldai.getConversation(req.valid.params.id, ownerOf(req));
  res.json({ data: { ...conversationDTO(result.conversation), pendingActions: result.pendingActions } });
}

export async function sendMessage(req, res) {
  const message = await shieldai.sendMessage({
    conversationId: req.valid.params.id,
    owner: ownerOf(req),
    ctx: contextFrom(req),
    ...contextOf(req),
    content: req.valid.body.content,
    context: req.valid.body.context,
  });
  res.json({ data: { message } });
}

export async function confirmAction(req, res) {
  const action = await pending.confirm(req.valid.params.id, contextOf(req));
  res.json({ data: pending.toPendingActionDTO(action) });
}

export async function cancelAction(req, res) {
  const action = await pending.cancel(req.valid.params.id, contextOf(req));
  res.json({ data: pending.toPendingActionDTO(action) });
}
