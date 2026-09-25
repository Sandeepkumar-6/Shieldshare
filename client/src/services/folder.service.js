import { del, get, patch, post } from './api.js';

// api-contract §2.2
export const folderApi = {
  async list() {
    const { data } = await get('/folders');
    return data;
  },
  async create(name) {
    const { data } = await post('/folders', { name });
    return data;
  },
  async rename(id, name) {
    const { data } = await patch(`/folders/${id}`, { name });
    return data;
  },
  async remove(id) {
    await del(`/folders/${id}`);
  },
};
