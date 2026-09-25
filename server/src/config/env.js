import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Load server/.env when present (Node's built-in loader; no dotenv dependency).
// Variables already set in the process environment take precedence.
const envFile = path.join(serverRoot, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}. See server/.env.example.`);
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function positiveInt(name, fallback) {
  const raw = optional(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters.');
}

const storageDir = path.resolve(serverRoot, optional('STORAGE_DIR', './storage'));

// Spec §30: the simulator is enabled only by the exact value "true", and never in production.
const nodeEnv = optional('NODE_ENV', 'development');
const simulatorEnabled = optional('SIMULATOR_ENABLED', 'false') === 'true';
const mlEnabled = optional('ML_ENABLED', 'false') === 'true';
const aiProvider = optional('AI_PROVIDER', optional('LLM_PROVIDER', 'openai')).toLowerCase();
// Each provider reads its own key; LLM_API_KEY is the provider-neutral fallback.
const AI_KEY_VARIABLE = { openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const aiApiKey = optional(AI_KEY_VARIABLE[aiProvider] ?? 'LLM_API_KEY', optional('LLM_API_KEY', ''));
const AI_DEFAULT_MODEL = { openai: 'gpt-5-mini', gemini: 'gemini-3.8-flash' };
if (simulatorEnabled && nodeEnv === 'production') {
  throw new Error('SIMULATOR_ENABLED must be false in production.');
}

export const config = Object.freeze({
  nodeEnv,
  serverRoot,
  port: positiveInt('PORT', 5000),
  mongoUri: required('MONGO_URI'),
  jwt: Object.freeze({
    secret: jwtSecret,
    accessTtl: optional('JWT_ACCESS_TTL', '15m'),
  }),
  clientOrigin: required('CLIENT_ORIGIN'),
  storageDir,
  maxUploadBytes: positiveInt('MAX_UPLOAD_BYTES', 25 * 1024 * 1024),
  apiRateLimitPerMinute: positiveInt('API_RATE_LIMIT_PER_MINUTE', 300),
  share: Object.freeze({
    maxExpiryDays: positiveInt('SHARE_MAX_EXPIRY_DAYS', 30),
    accessTokenTtlMs: 10 * 60 * 1000, // unlock token for password-protected links
  }),
  simulator: Object.freeze({
    enabled: simulatorEnabled,
    demoUserEmail: optional('SIMULATOR_DEMO_USER_EMAIL', '').toLowerCase(),
    // The simulator signs in as the demo account through the public login endpoint.
    demoUserPassword: process.env.SIMULATOR_DEMO_USER_PASSWORD ?? '',
  }),
  mlService: Object.freeze({
    enabled: mlEnabled,
    url: optional('ML_SERVICE_URL', 'http://127.0.0.1:8000').replace(/\/$/, ''),
  }),
  ai: Object.freeze({
    provider: aiProvider,
    apiKey: aiApiKey,
    model: optional('AI_MODEL', optional('LLM_MODEL', AI_DEFAULT_MODEL[aiProvider] ?? '')),
    timeoutMs: positiveInt('AI_TIMEOUT_MS', 60_000), // whole investigation, all tool rounds
    maxToolRounds: positiveInt('AI_MAX_TOOL_ROUNDS', 6),
    maxOutputTokens: positiveInt('AI_MAX_OUTPUT_TOKENS', 4096), // includes reasoning/thinking tokens on current models
    rateLimitPerMinute: positiveInt('AI_RATE_LIMIT_PER_MINUTE', 20),
  }),
});
