import { useEffect, useState } from 'react';
import { adminApi } from '../../services/admin.service.js';

// Whether the controlled simulator exists on this server. Its routes answer 404 unless
// SIMULATOR_ENABLED is exactly "true" (spec §30), so the navigation entry only appears when
// the status endpoint answers. Asked once per page load.
let cached = null;

export function useSimulatorAvailability(enabled) {
  const [available, setAvailable] = useState(cached);
  useEffect(() => {
    if (!enabled || cached !== null) return undefined;
    let active = true;
    adminApi.simulatorStatus().then(
      () => { cached = true; if (active) setAvailable(true); },
      (error) => { if (error?.status === 404) cached = false; if (active) setAvailable(false); },
    );
    return () => { active = false; };
  }, [enabled]);
  return enabled ? available : false;
}
