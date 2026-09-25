import { del, get, post } from './api.js';

// api-contract §2.1
export const authApi = {
  async register({ name, email, password }) {
    const { data } = await post('/auth/register', { name, email, password });
    return data; // { user, accessToken }
  },
  async login({ email, password }) {
    // A 401 here means wrong credentials, not an expired session.
    const { data } = await post('/auth/login', { email, password }, { skipAuthExpiry: true });
    return data;
  },
  async logout() {
    await post('/auth/logout', null, { skipAuthExpiry: true });
  },
  async me() {
    const { data } = await get('/auth/me');
    return data.user;
  },
  async sessions() {
    const { data } = await get('/auth/sessions');
    return data;
  },
  async revokeSession(id) {
    await del(`/auth/sessions/${id}`);
  },
};
