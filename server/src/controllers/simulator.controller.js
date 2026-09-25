import * as simulator from '../simulator/simulator.service.js';
import { clientIp } from '../utils/requestContext.js';

// /api/admin/simulator/* (api-contract §2.10). Reachable only when SIMULATOR_ENABLED is
// exactly "true" (routes/index.js) and only for administrators (admin router). Seed, run
// and reset are audit-logged through middleware/adminAction.js.

export async function status(req, res) {
  res.json({ data: await simulator.status() });
}

export async function seed() {
  const result = await simulator.seed();
  return {
    targetId: result.demoUserId,
    after: { uploaded: result.uploaded, skipped: result.skipped },
    send: (res) => res.json({ data: result }),
  };
}

export async function run(req) {
  const { scenario, paceMs } = req.valid.body;
  const started = await simulator.startRun({ scenario, paceMs });
  return {
    after: { scenario, paceMs: started.paceMs, runId: started.id },
    send: (res) => res.status(202).json({ data: started }),
  };
}

export async function reset(req) {
  const result = await simulator.reset({ adminId: req.user.id, ip: clientIp(req) });
  return {
    targetId: result.demoUserId,
    before: result.before,
    after: {
      unfrozen: result.unfrozen,
      closedIncidents: result.closedIncidents,
      purged: result.purged,
      canaries: result.canaries,
      seeded: result.seeded.uploaded,
    },
    send: (res) => res.json({ data: result }),
  };
}
