# ShieldShare — Project Instructions for Claude Code

ShieldShare is a MERN secure file-sharing platform with hybrid behavioral ransomware detection, explainable risk scoring, containment, recovery, and an admin-facing Security Copilot (Shield AI).

## Source of truth (read before any non-trivial change)

1. `docs/product/specification.md` (v1.1): product and technical requirements. Wins on any conflict.
2. `docs/api/api-contract.md`: REST endpoints, Mongoose schemas, Socket.IO payloads, ML and Shield AI contracts. Keep it in sync when an endpoint or schema changes.
3. `.claude/skills/shieldshare-frontend/SKILL.md`: frontend standard. Use it for all work in `client/`.

If something is missing from these docs, say it is a gap and ask. Do not silently invent requirements.

## Hard rules

- Stay MERN: React + Vite + Tailwind, Express, MongoDB/Mongoose. Python/FastAPI only for `ml-service/`.
- Never describe detection as "AI detects ransomware". Detection = rules + integrity + entropy + canary + Isolation Forest, fused by the risk engine. One signal alone is never proof.
- The deterministic detection path must reach CRITICAL without the ML service. ML and Shield AI failures must never break core features.
- Shield AI never accesses MongoDB or models directly; tools call services with the admin's identity. Action tools only create PendingActions; execution happens via `POST /api/ai/actions/:id/confirm`.
- The simulator is an API client that only runs as the demo user and only when `SIMULATOR_ENABLED=true`. It never touches arbitrary files.
- No fake functionality: no hardcoded risk numbers, AI responses, stats, testimonials or buttons without a backend.
- Enforce auth and roles server-side. Never trust a role from the client or the token payload alone.
- Never expose storage paths, secrets, `passwordHash`, `tokenHash` or `storageKey` in responses. Never commit `.env`.
- Security logic lives in `server/src/security/` services, not in controllers.

## Working style

- Inspect existing code before changing it. Reuse working code; do not rewrite working features.
- Fix broken flows before adding features. Follow the build order below.
- After each phase, run the relevant acceptance checks from `docs/product/specification.md` §37 and report what passes and what does not.
- Keep changes small and explain them. Ask before large refactors or new dependencies.

## Build order

1. Auth, sessions, freeze middleware; folders; files (upload, modify content, rename/move, soft delete); versions; activity
2. Sharing; quarantine with its side effects
3. Inline rules, canary seeding, risk engine + RiskEvaluation, incident lifecycle, restore + integrity verification
4. Simulator, Socket.IO, admin incident pages
5. Entropy, ML service with fallback, Shield AI (read tools first, pending actions last)

## Commands

Requires Node 20.12+ (developed on Node 24) and a local MongoDB.

```bash
# Everything for the demo (ML service → API → client), from the repo root; Ctrl+C stops all.
node scripts/start-demo.mjs [--simulator] [--no-ml]

# API (http://localhost:5000). First time: npm install, copy .env.example to .env and fill it in.
cd server && npm run seed      # admin + user from SEED_*, demo account from SIMULATOR_DEMO_USER_*, 8 @shieldshare.demo workspaces (idempotent, seeds canaries)
cd server && npm run dev       # node --watch src/server.js
cd server && npm run canaries:backfill   # seed missing canary files for existing users (idempotent)
cd server && npm run sim:reset | sim:seed | sim:run   # controlled simulator via the admin API (SIMULATOR_ENABLED=true)

# Client (http://localhost:5173). First time: npm install, copy .env.example to .env.
cd client && npm run dev
cd client && npm run build

# Tests. Unit tests are pure. phase1/phase2 start their own API and database
# (:5055 / shieldshare_test, :5056 / shieldshare_test_p2); phase3+ run in-process on
# mongodb-memory-server using the local mongod (MONGOMS_SYSTEM_BINARY).
cd server && npm test                # unit + all integration suites
cd server && npm run test:detection  # unit + phase3 only
cd server && npm run test:realtime   # unit + phase4 only
cd ml-service && .venv/Scripts/python.exe -m pytest

# Manual burst for the Phase 3 UI check (a test driver, not the Phase 4 simulator)
node tests/manual/burst.mjs setup    # then wait at least 60 s
node tests/manual/burst.mjs run
```

The Phase 5 ML service lives in `ml-service/`; use its local `.venv`, generate the synthetic datasets, train, then run `python -m uvicorn app:app --host 127.0.0.1 --port 8000`. See README.md for setup from a clean machine and the demo script.
