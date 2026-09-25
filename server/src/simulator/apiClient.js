// The simulator's only way to act: an HTTP client of ShieldShare's own public REST API
// (spec §30 "Simulator Architecture"). It signs in as the demo account and calls the same
// endpoints the web client uses, so every operation creates real Activity, goes through
// requireNotFrozen and reaches detection. It never imports services or models.

const USER_AGENT = 'ShieldShare-Simulator/1.0 (controlled demo, demo account only)';

export class SimulatorHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'SimulatorHttpError';
    this.status = status;
    this.code = code;
  }
}

export function createApiClient(baseUrl) {
  if (!baseUrl) throw new Error('The simulator has no API address yet (the server is not listening).');
  let token = null;

  async function request(method, route, { json, form, binary = false } = {}) {
    const headers = { 'User-Agent': USER_AGENT };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const res = await fetch(`${baseUrl}/api${route}`, { method, headers, body });
    if (binary && res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!res.ok) {
      throw new SimulatorHttpError(res.status, payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? `HTTP ${res.status}`);
    }
    return payload;
  }

  const fileForm = (name, content, mimeType, fields = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', new Blob([content], { type: mimeType }), name);
    return form;
  };

  return {
    async login(email, password) {
      const { data } = await request('POST', '/auth/login', { json: { email, password } });
      token = data.accessToken;
      return data.user;
    },
    async logout() {
      if (!token) return;
      try {
        await request('POST', '/auth/logout');
      } catch {
        /* the session expires on its own */
      }
      token = null;
    },
    async folders() {
      return (await request('GET', '/folders')).data;
    },
    async createFolder(name) {
      return (await request('POST', '/folders', { json: { name } })).data;
    },
    // Every page. `all: true` is the enumeration endpoint (includes hidden and deleted files).
    async listFiles({ all = false } = {}) {
      const items = [];
      for (let page = 1; page <= 50; page += 1) {
        const { data, meta } = await request('GET', `/files?limit=100&page=${page}${all ? '&all=true' : ''}`);
        items.push(...data);
        if (!meta || items.length >= meta.total || data.length === 0) break;
      }
      return items;
    },
    async upload({ name, content, mimeType, folderId }) {
      return (await request('POST', '/files', { form: fileForm(name, content, mimeType, folderId ? { folderId } : {}) })).data;
    },
    async download(fileId) {
      return request('GET', `/files/${fileId}/download`, { binary: true });
    },
    async replaceContent(fileId, name, content, mimeType = 'application/octet-stream') {
      return (await request('PUT', `/files/${fileId}/content`, { form: fileForm(name, content, mimeType) })).data;
    },
    async rename(fileId, name) {
      return (await request('PATCH', `/files/${fileId}`, { json: { name } })).data;
    },
  };
}
