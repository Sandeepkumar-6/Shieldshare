import http from "node:http";
import { connectDb, disconnectDb } from "./config/db.js";
import { createApp } from "./app.js";
import { initSocket } from "./services/socket.js";
import { ensureStorageDirs } from "./utils/storage.js";
import { env } from "./config/env.js";

async function main() {
  ensureStorageDirs();
  await connectDb();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.port, () => {
    console.log(
      `[server] ShieldShare API listening on http://localhost:${env.port}`,
    );
  });

  const shutdown = async () => {
    console.log("\n[server] shutting down...");
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] failed to start:", err.message);
  process.exit(1);
});
