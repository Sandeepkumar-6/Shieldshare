import { del, get, post } from './api.js';

// api-contract §2.4 — the signed-in owner's links
export const shareApi = {
  async create(fileId, { permission, expiresAt, recipientLabel, password }) {
    const body = { permission, expiresAt };
    if (recipientLabel?.trim()) body.recipientLabel = recipientLabel.trim();
    if (password) body.password = password;
    const { data } = await post(`/files/${fileId}/shares`, body);
    return data; // { share, token, url } — token and url are returned only here
  },
  async list(params) {
    return get('/shares', { params }); // { data, meta }
  },
  async revoke(id) {
    await del(`/shares/${id}`);
  },
};
