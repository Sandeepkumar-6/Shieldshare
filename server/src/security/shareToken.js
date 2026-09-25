import crypto from 'node:crypto';
import { config } from '../config/env.js';

// Share-link secrets (spec §7). The raw token exists only in the creation response and in
// the recipient's URL; the database stores its SHA-256.

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding

export function newShareToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashShareToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// Unlock token for password-protected links: "<expiry, base36>.<HMAC>". It is opaque on
// purpose. It carries no link id or other internal identifier, and it is bound to one link
// because the HMAC covers the link id, which the server looks up from the URL token.
// A key derived from JWT_SECRET keeps these tokens separate from user access tokens.
const accessKey = crypto.createHash('sha256').update(`shieldshare:share-access:${config.jwt.secret}`).digest();

function mac(linkId, expires) {
  return crypto.createHmac('sha256', accessKey).update(`${linkId}.${expires}`).digest('base64url');
}

export function issueShareAccessToken(linkId) {
  const expires = Date.now() + config.share.accessTokenTtlMs;
  return { token: `${expires.toString(36)}.${mac(String(linkId), expires)}`, expiresAt: new Date(expires) };
}

export function verifyShareAccessToken(token, linkId) {
  if (typeof token !== 'string' || token.length > 200) return false;
  const [expiresPart, signature] = token.split('.');
  const expires = Number.parseInt(expiresPart, 36);
  if (!Number.isFinite(expires) || expires <= Date.now() || !signature) return false;
  const expected = Buffer.from(mac(String(linkId), expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
