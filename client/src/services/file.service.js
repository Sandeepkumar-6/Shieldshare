import { del, get, http, patch, post } from './api.js';

// api-contract §2.3
export const fileApi = {
  async list(params) {
    return get('/files', { params }); // { data: File[], meta }
  },
  async get(id) {
    const { data } = await get(`/files/${id}`);
    return data;
  },
  async upload(file, { folderId, onProgress, signal } = {}) {
    const form = new FormData();
    if (folderId) form.append('folderId', folderId);
    form.append('file', file);
    const response = await http.post('/files', form, {
      signal,
      timeout: 0, // large uploads are bounded by the server's size limit, not a timer
      onUploadProgress: (event) => onProgress?.(event.total ? event.loaded / event.total : 0),
    });
    return response.data.data; // { file, version }
  },
  async replaceContent(id, file, { onProgress, signal } = {}) {
    const form = new FormData();
    form.append('file', file);
    const response = await http.put(`/files/${id}/content`, form, {
      signal,
      timeout: 0,
      onUploadProgress: (event) => onProgress?.(event.total ? event.loaded / event.total : 0),
    });
    return response.data.data; // { file, version }
  },
  async update(id, changes) {
    const { data } = await patch(`/files/${id}`, changes);
    return data;
  },
  async remove(id) {
    await del(`/files/${id}`);
  },
  async versions(id) {
    const { data } = await get(`/files/${id}/versions`);
    return data;
  },
  async verify(id, versionId) {
    const { data } = await post(`/files/${id}/verify`, versionId ? { versionId } : {});
    return data; // { passed, expected, actual, verifiedAt, versionNumber }
  },
  async restore(id, versionId) {
    const { data } = await post(`/files/${id}/versions/${versionId}/restore`);
    return data; // { file, newVersion, verification }
  },
  async activity(id, params) {
    return get(`/files/${id}/activity`, { params });
  },
  async download(id, { versionId } = {}) {
    const response = await http.get(`/files/${id}/download`, {
      params: versionId ? { versionId } : undefined,
      responseType: 'blob',
      timeout: 0,
    });
    return { blob: response.data, disposition: response.headers['content-disposition'] };
  },
};
