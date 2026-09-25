import { get, http, post, put } from './api.js';

// api-contract §2.6, §2.8, §2.9 — administrator endpoints. The server enforces the role and
// audit-logs every action; nothing here is trusted client-side.
export const adminApi = {
  users(params) {
    return get('/admin/users', { params }); // { data, meta }
  },
  async user(id) {
    const { data } = await get(`/admin/users/${id}`);
    return data;
  },
  async freeze(id, { reason, signOut }) {
    const { data } = await post(`/admin/users/${id}/freeze`, { reason, signOut: Boolean(signOut) });
    return data;
  },
  async unfreeze(id, { reason }) {
    const { data } = await post(`/admin/users/${id}/unfreeze`, { reason });
    return data;
  },
  files(params) {
    return get('/admin/files', { params });
  },
  async quarantine(fileId, reason) {
    const { data } = await post(`/admin/files/${fileId}/quarantine`, { reason });
    return data;
  },
  quarantineList(params) {
    return get('/admin/quarantine', { params });
  },
  async release(itemId, note) {
    const { data } = await post(`/admin/quarantine/${itemId}/release`, { note });
    return data;
  },
  async requestFileAccess(fileId, { reason, versionId }) {
    const { data } = await post(`/admin/files/${fileId}/access-requests`, {
      reason,
      ...(versionId ? { versionId } : {}),
    });
    return data;
  },
  async forensicDownload(requestId) {
    const response = await http.post(`/admin/file-access-requests/${requestId}/download`, undefined, {
      responseType: 'blob',
      timeout: 0,
    });
    return { blob: response.data, disposition: response.headers['content-disposition'] };
  },
  audit(params) {
    return get('/admin/audit', { params });
  },

  // ── Phase 3: detection, incidents, recovery ──
  async summary() {
    const { data } = await get('/admin/summary');
    return data;
  },
  incidents(params) {
    return get('/admin/incidents', { params });
  },
  async incident(id) {
    const { data } = await get(`/admin/incidents/${id}`);
    return data;
  },
  async incidentRisk(id) {
    const { data } = await get(`/admin/incidents/${id}/risk`);
    return data; // { peak, latest }
  },
  async incidentFiles(id) {
    const { data } = await get(`/admin/incidents/${id}/files`);
    return data;
  },
  async userActivity(userId, { from, to }) {
    const { data } = await get(`/admin/users/${userId}/activity`, { params: { from, to } });
    return data;
  },
  async investigate(id) {
    const { data } = await post(`/admin/incidents/${id}/investigate`);
    return data;
  },
  async resolve(id, { resolution, note, unfreezeUser }) {
    const { data } = await post(`/admin/incidents/${id}/resolve`, { resolution, note, unfreezeUser: Boolean(unfreezeUser) });
    return data;
  },
  async restoreFile(fileId, versionId) {
    const { data } = await post(`/admin/files/${fileId}/restore`, { versionId });
    return data;
  },
  async restoreAll(incidentId) {
    const { data } = await post(`/admin/incidents/${incidentId}/restore-all`);
    return data; // { results, incidentStatus }
  },
  alerts(params) {
    return get('/admin/alerts', { params });
  },
  async acknowledgeAlert(id) {
    const { data } = await post(`/admin/alerts/${id}/ack`);
    return data;
  },
  async recovery(params) {
    const { data } = await get('/admin/recovery', { params });
    return data;
  },
  async detectionConfig() {
    const { data } = await get('/admin/config/detection');
    return data;
  },
  // Phase 6 settings editor: a partial update creates version N+1 (validated, audited).
  async updateDetectionConfig(patch) {
    const { data } = await put('/admin/config/detection', patch);
    return data;
  },
  async detectionConfigVersions() {
    const { data } = await get('/admin/config/detection/versions');
    return data;
  },
  async mlStatus() {
    const { data } = await get('/admin/ml/status');
    return data;
  },

  // ── Phase 4: live feed, analytics, simulator ──
  activityFeed(params) {
    return get('/admin/activity', { params }); // { data: feed items, meta }
  },
  riskTimeline(params) {
    return get('/admin/analytics/risk-timeline', { params }); // { data, meta: { from, to, bucket, bands } }
  },
  async severityDistribution(params) {
    const { data } = await get('/admin/analytics/severity-distribution', { params });
    return data;
  },
  async activityDistribution(params) {
    const { data } = await get('/admin/analytics/activity-distribution', { params });
    return data;
  },
  async simulatorStatus() {
    const { data } = await get('/admin/simulator/status');
    return data;
  },
  async simulatorSeed() {
    const { data } = await post('/admin/simulator/seed');
    return data;
  },
  async simulatorRun({ scenario, paceMs }) {
    const { data } = await post('/admin/simulator/run', { scenario, ...(paceMs ? { paceMs } : {}) });
    return data;
  },
  async simulatorReset() {
    const { data } = await post('/admin/simulator/reset', undefined, { timeout: 120_000 });
    return data;
  },
};
