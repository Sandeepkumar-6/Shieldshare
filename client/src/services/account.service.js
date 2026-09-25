import { get, post } from './api.js';

// api-contract §2.5: the signed-in user's own overview, activity and security status.
export const accountApi = {
  async dashboard() {
    const { data } = await get('/me/dashboard');
    return data;
  },
  async security() {
    const { data } = await get('/me/security');
    return data;
  },
  async activity(params) {
    return get('/me/activity', { params }); // { data, meta }
  },
  fileAccessRequests(params) {
    return get('/me/file-access-requests', { params });
  },
  async respondToFileAccessRequest(id, decision) {
    const { data } = await post(`/me/file-access-requests/${id}/respond`, { decision });
    return data;
  },
};
