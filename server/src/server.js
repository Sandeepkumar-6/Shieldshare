import { config } from './config/env.js';
import { disconnectDatabase } from './config/db.js';
import { createHttpServer } from './httpServer.js';
import { configureSimulator } from './simulator/simulator.service.js';
import { initialize } from './startup.js';

async function main() {
  const { config: detection, rebuilt } = await initialize();
  console.log(`[shieldshare] detection config v${detection.version} active; window rebuilt from ${rebuilt.activities} recent activities`);

  const { server, realtime } = createHttpServer();
  server.listen(config.port, () => {
    // The simulator is an HTTP client of this same server (spec §30).
    configureSimulator({ baseUrl: `http://127.0.0.1:${server.address().port}` });
    console.log(`[shieldshare] API listening on http://localhost:${config.port} (${config.nodeEnv})`);
    if (config.simulator.enabled) console.log('[shieldshare] simulator ENABLED (demo account only)');
  });

  const shutdown = (signal) => {
    console.log(`[shieldshare] ${signal} received, shutting down`);
    // Closes the Socket.IO connections and the HTTP server.
    realtime.close().finally(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[shieldshare] failed to start:', error.message);
  process.exit(1);
});
