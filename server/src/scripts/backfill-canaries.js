// One-time (and safe to repeat) backfill: seeds missing canary files into every existing
// user's workspace (spec §14). Users who already have a canary for a template are skipped.
//
// Usage: npm run canaries:backfill   (from server/)

import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { ensureStorage } from '../services/storage.service.js';
import { User } from '../models/index.js';
import { seedForUser } from '../security/canary.service.js';

async function backfill() {
  await ensureStorage(); // blobs for canary files
  await connectDatabase();
  const users = await User.find({}).select('email').lean();
  let created = 0;
  let failed = 0;
  for (const user of users) {
    try {
      const count = await seedForUser(user._id);
      created += count;
      if (count) console.log(`[canaries] ${user.email}: ${count} seeded`);
    } catch (error) {
      failed += 1;
      console.error(`[canaries] ${user.email}: ${error.message}`);
    }
  }
  console.log(`[canaries] ${users.length} users checked, ${created} canary files created, ${failed} failures`);
  if (failed) process.exitCode = 1;
}

backfill()
  .catch((error) => {
    console.error('[canaries] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
