# Asteroids leaderboard backend

Cloudflare Worker + D1. A ranked score is accepted only if the server replays the player's recorded inputs, with the seed and configuration the server itself issued, and reproduces the result.

Full design, API contracts, security analysis, cost estimate and deployment steps: [`../../docs/leaderboard-backend.md`](../../docs/leaderboard-backend.md).

```bash
npm install            # wrangler + @types/node (dev only)
npm run migrate:local  # creates the local D1 database (server/.wrangler/state)
npm run dev            # http://127.0.0.1:8787  (workerd, no Cloudflare account needed)
```

From `phaser-asteroids/`: `npm run test:server` (unit/adversarial), `npm run test:worker` (real workerd + D1), `npm run test:ranked` (Chromium end to end).

Layout: `src/` portable service (+ `worker.ts`/`d1.ts` Cloudflare glue), `migrations/`, `tests/`, `testing/` (SQLite test adapter, autonomous bot), `scripts/` (integration and benchmark), `bench/` (feasibility Worker), `wrangler.toml`.

Local secrets go in `.dev.vars` (git-ignored); copy `.dev.vars.example`. Nothing here deploys anything.
