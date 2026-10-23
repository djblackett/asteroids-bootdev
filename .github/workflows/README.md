# GitHub Actions Workflows

## deploy-gh-pages.yml

Builds the Phaser game in `phaser-asteroids/`, deploys and verifies its production Cloudflare Worker,
then publishes the already-built GitHub Pages site, <https://djblackett.github.io/asteroids-bootdev/>.
It is the only release workflow; both deployments use the same commit.

- **Push to `main`** touching `phaser-asteroids/**` (or this workflow): validate, deploy Worker, verify health/versions, then deploy Pages.
- **Pull request:** validate only.
- **Manual run:** Actions → "Deploy to GitHub Pages" → Run workflow. Deploys only from `main`.

Validation (blocks deployment): `npm ci`, typecheck, unit tests (including server tests), production build,
headless-Chrome check (`phaser-asteroids/scripts/pages-check.mjs`), locked server install and server typecheck,
and mocked tests of the production health gate. Full browser suites remain optional.

Set the repository Actions **secret** `CLOUDFLARE_API_TOKEN` to a token with **Editor access only to the existing
`asteroids-leaderboard` Worker** in account `620de0810a6cf29710d9fedb3a966d6f`. No D1 access is needed just to deploy
the existing binding. The account ID is already in `wrangler.toml`. Never use a Global API Key.
Exact token setup, verification, manual release and recovery instructions are in the
[deployment guide](../../phaser-asteroids/docs/deployment.md#one-time-setup-repository-owner).

The whole release is serialized without cancelling active runs. Stale commits fail before Worker deployment.
Worker deploy/health failures block Pages. If Pages fails after the Worker succeeds, the Worker remains updated;
rerun **all jobs on current main** (or revert on main to restore both). Do not rerun only Pages.
Production D1 migrations are explicit manual operations, never part of this workflow.

The build requires the repository Actions variable `VITE_LEADERBOARD_API_URL` (public HTTPS Worker origin, without `/api/v1`) and fails before building if it is missing or empty. The production value is `https://asteroids-leaderboard.davejandrea.workers.dev`. Backend `IP_HASH_SALT` and `ADMIN_TOKEN` are Cloudflare secrets and must never enter the frontend build; see [the backend deployment guide](../../docs/leaderboard-backend.md#14-production-setup-and-deployment).

Full details (one-time Pages setup, troubleshooting, rollback, custom domain, gamepad check):
[phaser-asteroids/docs/deployment.md](../../phaser-asteroids/docs/deployment.md).

## browser-suites.yml

Manual only. Runs the larger real-browser suites (smoke, keyboard, combat, co-op, simulated gamepad). Never blocks a deploy.

The original Python game is not built or published by any workflow.
