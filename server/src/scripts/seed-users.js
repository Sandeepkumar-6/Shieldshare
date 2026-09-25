// Seeds the configured administrator and normal user, plus realistic demo workspaces.
//   SEED_ADMIN_NAME / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
//   SEED_USER_NAME  / SEED_USER_EMAIL  / SEED_USER_PASSWORD
// and, when SIMULATOR_DEMO_USER_EMAIL and SIMULATOR_DEMO_USER_PASSWORD are set (Phase 4),
// the simulator's demo account: a normal user flagged isDemoUser. The simulator refuses any
// account without that flag, so it can never be pointed at someone else's workspace by a
// typo in the email.
//
// Idempotent: an existing account is left as it is (its password is never reset). Accounts
// are created through the same service as registration, so each gets its root folder.
//
// Usage: npm run seed   (from server/)

import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { ensureStorage } from '../services/storage.service.js';
import { User } from '../models/index.js';
import { createUserWithWorkspace } from '../services/auth.service.js';
import { seedRealisticDemoData } from '../seeding/demoSeed.service.js';

function account(prefix, role, defaultName) {
  const email = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`];
  const name = process.env[`${prefix}_NAME`]?.trim() || defaultName;
  if (!email || !password) {
    throw new Error(`Set ${prefix}_EMAIL and ${prefix}_PASSWORD in server/.env before seeding.`);
  }
  if (password.length < 8) {
    throw new Error(`${prefix}_PASSWORD must be at least 8 characters.`);
  }
  return { name, email, password, role };
}

async function seed() {
  const accounts = [
    account('SEED_ADMIN', 'admin', 'ShieldShare Admin'),
    account('SEED_USER', 'user', 'Demo User'),
  ];

  await ensureStorage(); // blobs for canary files
  await connectDatabase();
  console.log(`[seed] connected (${config.nodeEnv})`);

  let admin;
  for (const input of accounts) {
    const existing = await User.findOne({ email: input.email });
    if (existing) {
      const note = existing.role === input.role ? '' : ` (existing role "${existing.role}" left unchanged)`;
      console.log(`[seed] ${input.role.padEnd(5)} ${input.email} already exists${note}`);
      if (input.role === 'admin') admin = existing;
      continue;
    }
    const created = await createUserWithWorkspace(input);
    if (input.role === 'admin') admin = created;
    console.log(`[seed] ${input.role.padEnd(5)} ${input.email} created`);
  }

  await seedDemoAccount();

  // Integration harnesses invoke the same account seeder in isolated test databases. Keep
  // those databases minimal unless a seed-specific test explicitly opts into the full set.
  if (config.nodeEnv !== 'test' || process.env.SEED_REALISTIC_DEMO === 'true') {
    const demo = await seedRealisticDemoData({ password: accounts[1].password, admin });
    console.log(`[seed] demo dataset: ${demo.usersCreated} users created, ${demo.usersExisting} already present, ${demo.files} files available`);
    console.log(`[seed] lifecycle: ${demo.incidents.map((item) => `${item.number} ${item.status} (${item.user})`).join('; ') || 'already seeded'}`);
    if (demo.shares.length) {
      console.log('[seed] active demo links (shown because these links were created in this run):');
      for (const share of demo.shares.filter((item) => item.status === 'ACTIVE')) console.log(`       ${share.label}: ${share.url}`);
    }
  } else {
    console.log('[seed] demo dataset skipped in NODE_ENV=test');
  }
}

async function seedDemoAccount() {
  const email = process.env.SIMULATOR_DEMO_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.SIMULATOR_DEMO_USER_PASSWORD;
  if (!email) {
    console.log('[seed] demo  skipped (SIMULATOR_DEMO_USER_EMAIL is not set)');
    return;
  }
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role === 'admin') {
      console.log(`[seed] demo  ${email} is an administrator; not flagged. The simulator will refuse it. Use a separate account.`);
    } else if (existing.isDemoUser) {
      console.log(`[seed] demo  ${email} already exists`);
    } else {
      await User.updateOne({ _id: existing._id }, { $set: { isDemoUser: true } });
      console.log(`[seed] demo  ${email} flagged as the demo account (its workspace is reset by the simulator)`);
    }
    return;
  }
  if (!password || password.length < 8) {
    throw new Error('Set SIMULATOR_DEMO_USER_PASSWORD (8+ characters) in server/.env to create the demo account.');
  }
  const user = await createUserWithWorkspace({ name: 'Demo Account', email, password, role: 'user' });
  await User.updateOne({ _id: user._id }, { $set: { isDemoUser: true } });
  console.log(`[seed] demo  ${email} created (simulator demo account)`);
}

seed()
  .catch((error) => {
    console.error('[seed] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
