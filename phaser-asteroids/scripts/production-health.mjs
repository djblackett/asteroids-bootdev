// Read-only release gate. Versions come from the SAME built artifact that Pages will publish.
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../dist/node/index.js';

const HEALTH_URL = 'https://asteroids-leaderboard.davejandrea.workers.dev/api/v1/health';

export async function verifyProductionHealth(fetchImpl = fetch, wait = setTimeout) {
  console.log(`Expected rules=${GAMEPLAY_RULES_VERSION}, schema=${REPLAY_SCHEMA_VERSION}`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetchImpl(HEALTH_URL, {
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Health returned HTTP ${response.status}`);
      const health = await response.json();
      // Exact schema equality is the compatibility policy used by the replay validator.
      if (health?.ok !== true || health.rulesVersion !== GAMEPLAY_RULES_VERSION || health.schemaVersion !== REPLAY_SCHEMA_VERSION) {
        throw new Error(`Incompatible health: ok=${JSON.stringify(health?.ok)}, rules=${JSON.stringify(health?.rulesVersion)}, schema=${JSON.stringify(health?.schemaVersion)}`);
      }
      console.log(`Production Worker healthy: rules=${health.rulesVersion}, schema=${health.schemaVersion}`);
      return;
    } catch (error) {
      console.error(`Health attempt ${attempt}/5 failed: ${error.message}`);
      if (attempt === 5) throw new Error('Production Worker verification failed; do not publish the frontend.');
      await wait(5_000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyProductionHealth().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
