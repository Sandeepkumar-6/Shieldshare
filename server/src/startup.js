import { connectDatabase } from './config/db.js';
import { ensureActiveConfig, onConfigChange } from './security/config.service.js';
import * as windowStore from './security/window.store.js';
import { ensureStorage } from './services/storage.service.js';

// Everything the API needs before it accepts requests. Used by server.js and by in-process
// tests (supertest).
export async function initialize() {
  await ensureStorage();
  await connectDatabase();
  const config = await ensureActiveConfig();
  // A restart must not forget a burst in progress (spec §10).
  const rebuilt = await windowStore.rebuild(config.windowSeconds);
  // A longer window needs older activity than the store holds.
  onConfigChange(async (next, previous) => {
    if (next.windowSeconds > previous.windowSeconds) await windowStore.rebuild(next.windowSeconds);
  });
  return { config, rebuilt };
}
