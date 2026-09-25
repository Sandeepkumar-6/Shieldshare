import http from 'node:http';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socket.js';

// The API's HTTP server: Express for REST plus Socket.IO on the same port (api-contract §1).
// Used by server.js and by in-process tests.
export function createHttpServer() {
  const app = createApp();
  const server = http.createServer(app);
  const realtime = attachRealtime(server);
  return { app, server, realtime };
}
