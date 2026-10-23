# Deploying to GitHub Pages

The Phaser game is a static site (`npm run build` → `phaser-asteroids/dist/`), with a separate Cloudflare Worker + D1
for ranked play. GitHub Actions validates both, deploys and checks the Worker, then publishes the built site to Pages.

**URL:** <https://djblackett.github.io/asteroids-bootdev/>

The Pages site is exactly the contents of `phaser-asteroids/dist/`. The original Python/Pygame game stays in the repository
root as source code but is no longer built or published (its pygbag web build was retired when Phaser became the primary
game; `BUILD_WEB.md` and `pygbag` still work locally if you want it).

## The workflow

[`.github/workflows/deploy-gh-pages.yml`](../../.github/workflows/deploy-gh-pages.yml) is the only workflow that publishes to Pages.

| Trigger | What runs |
| --- | --- |
| Push to `main` that changes `phaser-asteroids/**` or the workflow file | Validate, deploy Worker, verify compatibility, then publish Pages |
| Pull request to `main` | Validate only. No Pages permissions are used, nothing is published. |
| Manual run (**Actions → Deploy to GitHub Pages → Run workflow**) | Validate; deploys only when run on `main` |

Changes to the Python game or to root docs do not deploy.

**These block deployment** (job `phaser`, Node 22, Ubuntu): `npm ci` → `npm run typecheck` → `npm test` (Vitest unit tests) →
`npm run build` → `node scripts/pages-check.mjs`. The last step loads the production build in real headless Chrome, served
as the site root at `/asteroids-bootdev/` (the Pages URL path) **and** at `/` (a custom domain), and checks: no console or
page errors, no HTTP errors, all 10 start-up audio files load from under that path, the two extra soundtracks are *not* requested at start-up but load from under it when picked (and a saved choice plays after a reload), nothing is requested outside it, the title screen
renders in WebGL, a one-player game starts with the music playing, `?keydebug` loads, and the Gamepad API is available.
It fails (it is never skipped) if Chrome is missing. `npm test` includes `server/tests`, so those focused server tests
are already a release gate. After the browser check, the job installs locked server dependencies, runs the separate
server typecheck, and runs mocked tests of the production health gate.

The `worker` job depends on successful validation, checks out that run's exact commit, installs the server's locked
Wrangler, and downloads that same build. Immediately before deploying, it checks the current `main` SHA; stale queued
runs and old reruns fail without deploying. It runs `npx wrangler deploy --env production` from
`phaser-asteroids/server`, using the existing account, Worker, D1 binding and Cloudflare-managed secrets.

Next, `scripts/production-health.mjs` makes only a read-only GET to
<https://asteroids-leaderboard.davejandrea.workers.dev/api/v1/health>. It requires HTTP success, `ok: true`, and exact
`rulesVersion` / `schemaVersion` matches with `GAMEPLAY_RULES_VERSION` / `REPLAY_SCHEMA_VERSION` exported by the
build's `dist/node/index.js`. These come from shared `src/replay/constants.ts`; there is no separate CI version.
Exact schema equality follows the existing replay compatibility policy. It attempts at most five requests, each
with a 10-second timeout, waiting five seconds between failures. Logs show expected versions and failure reasons.
It never creates challenges or scores. This checks Worker compatibility, not D1 connectivity; an optional read-only
`GET /api/v1/leaderboard/all-time?limit=1` can confirm the database separately.

The `deploy` job requires both `phaser` and `worker` to succeed, then publishes the same `dist/` artifact without
rebuilding. A Worker deployment or health failure prevents frontend publication. The Worker deploys on every release,
including frontend-only changes. Pull requests and manual runs from other branches validate only and receive no token.

**Do not block deployment:** the larger browser suites (smoke, keyboard, combat, co-op, simulated-gamepad). Run them
from **Actions → Phaser browser suites → Run workflow**, or locally (`npm run test:browser`, `test:input`, `test:combat`,
`test:coop`, `test:gamepad`; Chrome or Edge required).

Workflow-level concurrency serializes the entire release on `main`, with `cancel-in-progress: false`. The lock covers
validation through Worker verification and Pages publication; other branches and PRs use separate groups. GitHub may
replace a pending run when another arrives and does not guarantee commit order, hence the stale-SHA check. Once the
Worker deployment starts, the run finishes both deployments even if `main` advances; the newer release waits.
An old run cannot overwrite a newer successful release. Pages also requires the Worker's successful health check
to come from the current run attempt, blocking a Pages-only rerun that would reuse an old Worker result. Use
**Re-run all jobs** so the Worker and health gate execute again under the same lock. Avoid manual deployments while Actions is releasing.
The Pages job retains the `github-pages` environment and is the only job with `pages: write` / `id-token: write`.
Build and Pages artifact names include the run attempt, so retries keep previous artifacts without upload-name conflicts.

> The workflow deliberately has no path filter on `pull_request`. If you ever mark it a *required* status check, a
> path-filtered workflow would leave PRs that don't touch those paths waiting forever.

## One-time setup (repository owner)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** (The repository already publishes from an
   Actions workflow, so this is probably set; confirm it.)
2. **Settings → Environments → github-pages**: if *Deployment branches* is restricted, `main` must be allowed.
3. In Cloudflare's dashboard, open **Account API tokens → Create Token** for account
   `620de0810a6cf29710d9fedb3a966d6f`. Create a custom token for GitHub Actions. Under Workers permissions choose
   **Editor**, scoped to the existing Worker **asteroids-leaderboard**, not all Workers. Do not select Admin.
   [Cloudflare's current Workers permission guide](https://developers.cloudflare.com/workers/authorization/workers/)
   specifies Editor for deploying an existing Worker and says existing D1 bindings need no separate D1 permissions.
   This Worker uses `workers.dev`, so no zone/routes permission is required. Do not grant D1 Edit, KV, R2, account-wide
   Workers access or use a Global API Key. Keep any separate migration credential out of this release workflow.
4. **Repository Settings → Secrets and variables → Actions → Secrets → New repository secret**:
   name `CLOUDFLARE_API_TOKEN`, value the token. It is supplied only to the Worker deploy step. The production account ID
   is already in `server/wrangler.toml`, so no `CLOUDFLARE_ACCOUNT_ID` secret or variable is needed. Missing credentials
   fail explicitly; there is no login fallback. Do not add `IP_HASH_SALT` or `ADMIN_TOKEN` to GitHub: the existing
   Cloudflare secrets remain attached on code-only deployments. Do not run the first-deployment secret helper again.
5. Under **Actions → Variables**, set the repository variable `VITE_LEADERBOARD_API_URL` to
   `https://asteroids-leaderboard.davejandrea.workers.dev` (no `/api/v1`). This public URL is the only backend value
   supplied to Vite. It is a repository variable because validation does not use the `github-pages` environment.
6. Before the initial merge, wait for any runs of the previous workflow to finish (it locked only Pages).
   Review and merge the workflow changes only when ready to enable releases. A qualifying push to `main`, including
   the merge containing this workflow, automatically releases both services. There is no additional enable switch.
   Without the token, validation may succeed but Worker deployment fails and Pages stays unchanged. Do not merge
   merely to test deployment; configure the credentials and review the implementation first.

Production Worker, secrets and D1 already exist. Do not recreate them or reapply schema migrations for routine releases.

## Finding the deployment URL

The `Deploy to GitHub Pages` job summary and the run's **github-pages** environment link show it; so does
**Settings → Pages**. History is under the repository's **Deployments** (right-hand sidebar).

To verify a release, confirm all three jobs succeeded for the intended commit. The Worker job logs its Cloudflare
deployment/version ID and the health gate's expected and observed versions. Open the health URL above and the Pages
site; hard refresh if assets are cached. No production scores are submitted by automation.

## Troubleshooting a failed deployment

- **Which job failed?** `Phaser - validate and build`: run the same commands locally (`npm ci`,
  `npm run typecheck`, `npm test`, `npm run test:pages`, then server install/typecheck).
- **Worker deploy fails:** check the missing-secret diagnostic or Wrangler's permission/configuration error. Do not
  broaden the token to Admin or D1 Edit as a workaround. Check its account and Worker scope. Pages is blocked.
- **Health gate fails:** logs show HTTP, JSON, network or version errors. Check Cloudflare's deployed version and the
  shared versions in this commit. After fixing the issue, run all jobs on current `main`. Pages is blocked; a successful
  Worker upload may already have changed production even if this step fails. See recovery below.
- **Stale release rejected:** run the workflow on current `main`; rerunning the old commit will keep failing.
- **`Get Pages site failed` / `HttpError: Not Found` in Configure Pages:** Pages isn't enabled with Source set to GitHub Actions.
- **`Deployment request failed … 404` or environment protection rules:** *Settings → Environments → github-pages* doesn't allow the branch.
- **Browser check fails only in CI:** open the step log; the failing check names the URL. A Chrome start-up error
  means the runner image changed; `google-chrome --version` is printed just before.
- **Blank page after deploying:** check the browser's network tab for 404s. Run `npm run test:pages` locally; it reproduces
  base-path mistakes.
- A new version can take a minute or two to appear; the CDN caches pages for up to 10 minutes (hard refresh).

## Asset paths: Pages URL vs custom domain

`vite.config.ts` sets `base: './'`: all built URLs and the runtime audio paths (`audio/…` in `src/audio/audioConfig.ts`)
are relative to the page. So **the identical build works** at `https://djblackett.github.io/asteroids-bootdev/` and at the
root of a custom domain. There is no `/asteroids-bootdev/` string anywhere in the app, and nothing to change for a custom
domain. Do not set an absolute base (`'/'`): it would break the `/asteroids-bootdev/` URL (`npm run test:pages` catches this).
The game has no client-side routes, so no `404.html` fallback is needed.

Local development is unchanged: `npm run dev` → <http://localhost:5173/>, `npm run preview` → <http://localhost:4173/>.

## Later: `asteroids.davidandrea.ca` (not configured)

Nothing has been changed for this: no DNS, no `CNAME` file, no GitHub domain setting. No build or workflow change is needed.

1. In the GitHub account settings, **verify** `davidandrea.ca` (Pages → Add a domain) so no one else can claim subdomains.
2. DNS: add a `CNAME` record `asteroids` → `djblackett.github.io`. If the zone is on Cloudflare, start with the proxy off (DNS only) so GitHub can issue the certificate.
3. **Settings → Pages → Custom domain** = `asteroids.davidandrea.ca`, wait for the DNS check, tick **Enforce HTTPS**. With Actions deployment no `CNAME` file is needed.
4. Once it works, `https://djblackett.github.io/asteroids-bootdev/` redirects to the custom domain.

## Verifying gamepad input on the published site

GitHub Pages is HTTPS, a secure context, which the Gamepad API requires.

1. Open the published URL (padlock shown; no `http://`) in Chrome, Edge or Firefox with a controller connected.
2. Press a button on the controller (browsers hide a pad until it is used). The title screen shows `CONTROLLER FOUND / PRESS A TO JOIN` in its top-left corner; press **A** and the
   how-to reference switches to the controller's buttons. **CONTROLS** lists it as `CONTROLLER 1: PLAYER n` (it says `No controller found.` before a press).
3. If CONTROLS says `Controllers need https or localhost.`, the page is not a secure context (typically an `http://` URL).
4. For raw values add `?keydebug` to the URL: the diagnostic panel lists each controller's mapping and live axes/buttons.
   Development-only parameters (`?debug`, `?keydebug`) are inert unless present.

## Rolling back

If Worker deployment/verification fails, Pages remains at its prior version. Wrangler failures can happen after an
upload, so inspect Cloudflare before assuming the Worker is unchanged. If the Worker succeeds but Pages fails,
**the new Worker stays live and the old frontend stays published**; there is no automatic rollback. Ranked play may
temporarily reject mismatched clients. Casual play remains available. An older browser session can also retain old
rules after a successful release; refreshing loads the new client, and a run in progress across a rules update may
be rejected. This workflow does not introduce multi-version verification.

- **Recover forward:** fix credentials, Pages settings or the underlying failure. If the failed commit is still `main`,
  choose **Re-run all jobs** on its run; otherwise **Run workflow** on current `main`. This redeploys and rechecks the
  Worker before Pages, even if the first Worker deployment succeeded. Do not choose only the failed Pages job.
- **Restore previous behavior:** revert the bad change(s) onto `main` and push after review. The resulting new commit
  releases both the known-good Worker code and frontend. An old successful run is deliberately rejected by the stale
  check; do not use it to roll back just one service.
- **Urgent partial-release recovery:** after disabling the workflow and waiting for any active release to finish, an
  operator can use `npx wrangler rollback --env production` from `phaser-asteroids/server` (or the Cloudflare dashboard)
  to restore the known-good Worker version matching the currently published frontend. Confirm the chosen version and
  its health response. Then prepare a matching revert on `main` before re-enabling releases. No D1 restore is needed
  for a code rollback. To take the frontend down entirely: **Settings → Pages → Unpublish site**.

## Manual release when Actions is unavailable

Disable the release workflow and wait for any active run to finish before deploying manually. Use a clean checkout
of one reviewed commit for both services, with Node 22 and Chrome/Edge installed. Set the public
`VITE_LEADERBOARD_API_URL` environment variable as above, then from `phaser-asteroids/` run:

```sh
npm ci
npm run typecheck
npm test
npm run build
node scripts/pages-check.mjs
npm ci --prefix server
npm --prefix server run typecheck
node --test scripts/production-health.test.mjs
cd server
# Authenticate locally with wrangler login, or a securely injected scoped CLOUDFLARE_API_TOKEN.
npx wrangler deploy --env production
node ../scripts/production-health.mjs
```

Stop if any command fails. Preserve the resulting `dist/`; publish exactly that directory only after health succeeds.
GitHub Pages currently uses Actions as its publishing source, so a complete Pages release cannot use this workflow
during an Actions outage. Branch-based Pages publishing also uses GitHub's build/deployment infrastructure and may
be affected by the same outage. Prefer leaving the current release in place until Actions recovers. If branch publishing
is available and a release is urgent, temporarily
set **Settings → Pages → Source → Deploy from a branch**, choose a dedicated publishing branch and `/(root)`, and
publish this same `dist/` at that branch's root, including an empty `.nojekyll`. This is an explicit operator action;
do not copy source files, credentials or local server state into that branch. Verify both URLs, then switch Pages
back to **GitHub Actions** and re-enable the workflow when service recovers. Before any later release, ensure `main`
contains the intended code for both services. Do not race a manual release against Actions.

## Production D1 migrations

Routine releases never run `wrangler d1 migrations apply`, create databases, reset data or change bindings. Existing
V1/V2 score history requires no migration; scores remain in the same production database. Schema changes need a
separate reviewed operation with a migration-capable credential and a recovery plan. Only when explicitly intended,
from `phaser-asteroids/server`, run:

```sh
npx wrangler d1 migrations apply asteroids-leaderboard --env production --remote
```

Coordinate schema compatibility before the code release. The CI token deliberately has no D1 data permissions.
Do not restore/reset D1 to recover from a failed code deployment.

## Trying a branch on a phone before it is published

Only pushes to `main` deploy, so a feature branch (or a pull request, which only runs the validation job) never changes the live site, and there is no
preview deployment. To try the mobile touch controls on a real phone from your own machine without publishing anything, follow
[mobile-touch.md](mobile-touch.md#manual-testing-on-a-real-phone): `npm run build && npm run preview:lan` and open the LAN address, or `adb reverse` for Android.
