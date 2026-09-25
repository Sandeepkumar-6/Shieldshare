import { config as env } from '../config/env.js';

function unavailable(error) {
  return { status: 'UNAVAILABLE', contribution: 0, error: error instanceof Error ? error.message : String(error) };
}

function validScore(body) {
  return body
    && Number.isFinite(body.anomalyScore)
    && body.anomalyScore >= 0
    && body.anomalyScore <= 1
    && typeof body.isAnomaly === 'boolean'
    && typeof body.modelVersion === 'string';
}

export async function scoreWindow(payload, { timeoutMs = 1500, enabled = env.mlService.enabled, baseUrl = env.mlService.url } = {}) {
  if (!enabled) return { status: 'DISABLED', contribution: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return unavailable(`ML service returned HTTP ${response.status}`);
    const body = await response.json();
    if (!validScore(body)) return unavailable('ML service returned an invalid response');
    return { status: 'OK', contribution: body.anomalyScore, ...body };
  } catch (error) {
    return unavailable(error?.name === 'AbortError' ? `ML service timed out after ${timeoutMs} ms` : error);
  } finally {
    clearTimeout(timer);
  }
}

export async function health({ timeoutMs = 1500, enabled = env.mlService.enabled, baseUrl = env.mlService.url } = {}) {
  if (!enabled) return { available: false, status: 'DISABLED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!response.ok) return { available: false, status: 'UNAVAILABLE' };
    const body = await response.json();
    return { available: body?.status === 'ok', status: body?.status === 'ok' ? 'OK' : 'UNAVAILABLE', ...body };
  } catch {
    return { available: false, status: 'UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}
