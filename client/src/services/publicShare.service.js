import axios from 'axios';
import { normalizeError } from './api.js';

// Public share-link access (/s/:token on the API). A separate client on purpose:
//  - it never sends the signed-in user's token to a public endpoint
//  - a 401 here (wrong link password) must not sign anyone out
const root = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const publicHttp = axios.create({ baseURL: `${root}/s`, timeout: 60_000 });
publicHttp.interceptors.response.use((response) => response, async (error) => Promise.reject(await normalizeError(error)));

const enc = encodeURIComponent;

// Opening the page counts as a view on the server (SHARE_ACCESS). Concurrent identical
// requests share one promise so a double-run effect (React StrictMode in development)
// cannot count one visit twice.
const inFlight = new Map();

export const publicShareApi = {
  metadata(token) {
    if (!inFlight.has(token)) {
      const request = publicHttp.get(`/${enc(token)}`)
        .then(({ data }) => data.data) // { fileName, size, permission, expiresAt, requiresPassword }
        .finally(() => inFlight.delete(token));
      inFlight.set(token, request);
    }
    return inFlight.get(token);
  },
  async unlock(token, password) {
    const { data } = await publicHttp.post(`/${enc(token)}/unlock`, { password });
    return data.data; // { accessToken, expiresAt }
  },
  async download(token, accessToken) {
    const response = await publicHttp.get(`/${enc(token)}/download`, {
      responseType: 'blob',
      timeout: 0,
      headers: accessToken ? { 'X-Share-Access': accessToken } : undefined,
    });
    return { blob: response.data, disposition: response.headers['content-disposition'] };
  },
};
