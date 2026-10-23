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

Local secrets go in `.dev.vars` (git-ignored); copy `.dev.vars.example`.

Production is deployed at **https://asteroids-leaderboard.davejandrea.workers.dev** using the existing account and the separate `env.production.DB` binding in `wrangler.toml`. Both migrations and production secrets are configured; health, both D1-backed leaderboards and live logs were verified on 2026-10-22. GitHub Pages frontend publication remains a separate release. On Windows, `./scripts/production-secrets.ps1 -Action Check` validates the encrypted local secret backup and `-Action DryRun` compiles without publishing. Only `-Action Deploy` publishes and attaches `IP_HASH_SALT` and `ADMIN_TOKEN`. See the full guide's production section before deploying. Never put backend secrets in Vite or GitHub Actions variables.

Physical Android ranked testing: [`../../docs/android-lan-testing.md`](../../docs/android-lan-testing.md). Opt-in `migrate:lan` / `dev:lan` use separate local D1 state, loopback port 8788 and disabled admin routes. The frontend LAN proxy is the only phone-facing listener.
