# ShieldShare — Agent Instructions

ShieldShare is a MERN secure file-sharing platform with hybrid behavioral ransomware detection, explainable risk scoring, containment, recovery, and an admin-facing Security Copilot (Shield AI).

## Source of truth (read before any non-trivial change)

1. `docs/product/specification.md` (v1.1): product and technical requirements. Wins on any conflict.
2. `docs/api/api-contract.md`: REST endpoints, Mongoose schemas, Socket.IO payloads, ML and Shield AI contracts. Keep it in sync when an endpoint or schema changes.
3. `.claude/skills/shieldshare-frontend/SKILL.md`: the frontend design and engineering standard. Read it fully before any work in `client/`.
4. `phase_plan.md`: build order and the prompt for each phase.

**Name mapping:** the phase prompts say "use the shieldshare-frontend skill". That means: read and follow `.claude/skills/shieldshare-frontend/SKILL.md`. The prompts may also mention CLAUDE.md; this AGENTS.md file carries the same rules.

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
- Work on one phase at a time from `phase_plan.md`. Do not start the next phase without being asked.
- Fix broken flows before adding features.
- After each phase, run the tests and the phase's checks and report PASS/FAIL for each one, plus skipped items and spec gaps.
- Keep changes small and explain them. Ask before large refactors or new dependencies.

## Commands

Requires Node 20.12+ and a local MongoDB. First time: `npm install` in `server/` and `client/`, copy each `.env.example` to `.env`, and set up `ml-service/` as described in README.md.

```bash
node scripts/start-demo.mjs [--simulator] [--no-ml]   # ML service → API → client, from the repo root

cd server && npm run seed      # accounts from SEED_* / SIMULATOR_DEMO_USER_* plus demo workspaces (idempotent)
cd server && npm run dev       # API on http://localhost:5000
cd client && npm run dev       # client on http://localhost:5173
cd client && npm run build

cd server && npm test          # unit + all integration suites
cd ml-service && .venv/Scripts/python.exe -m pytest   # needs generate_synthetic.py + train.py first
```

Tests and acceptance runs use their own databases; never point them at a developer's working database.
