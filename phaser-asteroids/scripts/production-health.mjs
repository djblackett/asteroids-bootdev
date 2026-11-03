// Read-only release gate. Versions come from the SAME built artifact that Pages will publish.
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { GAMEPLAY_RULES_VERSION, REPLAY_SCHEMA_VERSION } from '../dist/node/index.js';
import { readReleased, supportProblems } from '../server/rules/policy.mjs';

const HEALTH_URL = 'https://asteroids-leaderboard.davejandrea.workers.dev/api/v1/health';

/**
 * Checks the deployed Worker before Pages publishes the web build: it must issue the web build's rules by default (rulesVersion /
 * schemaVersion), and its supportedRules must still include every rules version a distributed Android build plays (released.json).
 */
export async function verifyProductionHealth(fetchImpl = fetch, wait = setTimeout, { released = readReleased(), today = new Date() } = {}) {
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
      if (!Array.isArray(health.supportedRules)) throw new Error('Health does not list supportedRules');
      const problems = supportProblems({ supported: health.supportedRules, current: GAMEPLAY_RULES_VERSION, released, today });
      if (problems.length) throw new Error(`Worker would strand installed apps: ${problems.join('; ')}`);
      console.log(`Production Worker healthy: rules=${health.rulesVersion}, schema=${health.schemaVersion}, supported=${health.supportedRules.join(',')}`);
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
