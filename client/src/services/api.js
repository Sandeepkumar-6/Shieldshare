import axios from 'axios';
import { tokenStore } from './tokenStore.js';

// The one place the client talks HTTP. Components never call axios directly.
//  - attaches the bearer token
//  - unwraps the { data, meta } envelope
//  - turns every failure into an ApiError with a message that is safe to show
//  - broadcasts 401 (session over) and 423 (account frozen) so app state can react

const baseURL = `${(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')}/api`;

export const AUTH_EXPIRED_EVENT = 'shieldshare:auth-expired';
export const ACCOUNT_FROZEN_EVENT = 'shieldshare:account-frozen';

export class ApiError extends Error {
  constructor({ status, code, message, details = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const http = axios.create({ baseURL, timeout: 60_000 });

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const apiError = await normalizeError(error);
    if (apiError.status === 401 && !error.config?.skipAuthExpiry) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: apiError }));
    }
    if (apiError.status === 423) {
      window.dispatchEvent(new CustomEvent(ACCOUNT_FROZEN_EVENT, { detail: apiError }));
    }
    return Promise.reject(apiError);
  },
);

export async function normalizeError(error) {
  if (error instanceof ApiError) return error;

  if (axios.isCancel(error)) {
    return new ApiError({ status: 0, code: 'CANCELLED', message: 'The request was cancelled.' });
  }

  const response = error.response;
  if (!response) {
    if (error.code === 'ECONNABORTED') {
      return new ApiError({ status: 0, code: 'TIMEOUT', message: 'ShieldShare took too long to respond. Try again.' });
    }
    return new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Can\'t reach ShieldShare. Check your connection and that the server is running, then try again.',
    });
  }

  let body = response.data;
  // Blob requests (downloads) receive error bodies as Blobs.
  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text());
    } catch {
      body = null;
    }
  }

  const envelope = body && typeof body === 'object' ? body.error : null;
  if (envelope?.message) {
    return new ApiError({
      status: response.status,
      code: envelope.code || 'ERROR',
      message: envelope.message,
      details: envelope.details ?? null,
    });
  }
  return new ApiError({
    status: response.status,
    code: 'UNEXPECTED_RESPONSE',
    message: response.status >= 500
      ? 'ShieldShare ran into a problem. Try again in a moment.'
      : 'The request could not be completed.',
  });
}

// Small helpers that return the unwrapped envelope: { data, meta }.
export async function get(url, config) {
  const response = await http.get(url, config);
  return response.data;
}

export async function post(url, body, config) {
  const response = await http.post(url, body, config);
  return response.data;
}

export async function put(url, body, config) {
  const response = await http.put(url, body, config);
  return response.data;
}

export async function patch(url, body, config) {
  const response = await http.patch(url, body, config);
  return response.data;
}

export async function del(url, config) {
  const response = await http.delete(url, config);
  return response.data;
}
