# Deploying to GitHub Pages

The Phaser game is a static site (`npm run build` → `phaser-asteroids/dist/`): no server, no backend, nothing to
install for players. GitHub Actions builds it and publishes it to GitHub Pages.

**URL:** <https://djblackett.github.io/asteroids-bootdev/phaser/>

## What gets published

A repository has one Pages site and every deployment replaces all of it, so
[`.github/workflows/deploy-gh-pages.yml`](../../.github/workflows/deploy-gh-pages.yml) assembles the whole site:

| Path | Content |
| --- | --- |
| `/phaser/` | This game (the `phaser` job's `dist/`). |
| `/` | The pygbag build of the original Python game, as before. If that build fails, a small page that links to `/phaser/`. |

The Python game's workflow had been failing since 2026-05-07 (the live Python site is the 2026-01-25 build). Its job is now
best effort: a pygbag failure produces a warning and the link page, and never blocks the Phaser deployment. Fixing
pygbag is separate from this work.

## The workflow

| Trigger | What runs |
| --- | --- |
| Push to `main` (except changes only to `*.md`, `docs/`, `tests/`, `.claude/`) | Validate, then deploy |
| Pull request to `main` | Validate only. No Pages permissions are used, nothing is published. |
| Manual run (**Actions → Deploy to GitHub Pages → Run workflow**) | Validate; deploys only when run on `main` |

**These block deployment** (job `phaser`, Node 22, Ubuntu): `npm ci` → `npm run typecheck` → `npm test` (Vitest unit tests) →
`npm run build` → `node scripts/pages-check.mjs`. The last step loads the production build in real headless Chrome served
under `/asteroids-bootdev/phaser/` **and** `/`, and checks: no console/page errors, no HTTP errors, all 10 audio files load
from the base path, nothing is requested outside it, the title screen renders in WebGL, a one-player game starts with the
music playing, `?keydebug` loads, and the Gamepad API is available. It fails (it is never skipped) if Chrome is missing.

**Do not block deployment:** the larger browser suites (smoke, keyboard, combat, co-op, simulated-gamepad). Run them
from **Actions → Phaser browser suites → Run workflow**, or locally (`npm run test:browser`, `test:input`, `test:combat`,
`test:coop`, `test:gamepad`; Chrome or Edge required).

The deploy job uses the `github-pages` environment and a `pages` concurrency group that never cancels a running
deployment, so overlapping pushes are serialised. Only that job has `pages: write` / `id-token: write`.

> The workflow deliberately has no path filter on `pull_request`. If you ever mark it a *required* status check, a
> path-filtered workflow would leave PRs that don't touch those paths waiting forever.

## One-time setup (repository owner)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** (The repository already publishes from an
   Actions workflow, so this is probably set; confirm it.)
2. **Settings → Environments → github-pages**: if *Deployment branches* is restricted, `main` must be allowed.
3. Merge or push to `main`, or run the workflow manually on `main`.

## Finding the deployment URL

The `Deploy to GitHub Pages` job summary and the run's **github-pages** environment link show it; so does
**Settings → Pages**. History is under the repository's **Deployments** (right-hand sidebar).

## Troubleshooting a failed deployment

- **Which job failed?** `Phaser - validate and build`: a real problem; run the same commands locally (`npm ci`,
  `npm run typecheck`, `npm test`, `npm run test:pages`). `Deploy`: see below.
- **`Get Pages site failed` / `HttpError: Not Found` in Configure Pages:** Pages isn't enabled with Source set to GitHub Actions.
- **`Deployment request failed … 404` or environment protection rules:** *Settings → Environments → github-pages* doesn't allow the branch.
- **Browser check fails only in CI:** open the step log; the failing check names the URL. A Chrome start-up error
  means the runner image changed; `google-chrome --version` is printed just before.
- **Warning "pygbag build failed":** expected while the Python web build is broken. The game itself still deploys.
- **Blank page after deploying:** check the browser's network tab for 404s. Everything must be under `/asteroids-bootdev/phaser/`.
  Run `npm run test:pages` locally; it reproduces this.
- A new version can take a minute or two to appear; the CDN caches pages for up to 10 minutes (hard refresh).

## Asset paths: project URL vs custom domain

`vite.config.ts` sets `base: './'`: all built URLs and the runtime audio paths (`audio/…` in `src/audio/audioConfig.ts`)
are relative to the page. So **the identical build works** at `https://djblackett.github.io/asteroids-bootdev/phaser/`
and at the root of a custom domain. There is no `/asteroids-bootdev/` string anywhere in the app, and nothing to change
for a custom domain. Do not set an absolute base (`'/'`): it would break the project URL (`npm run test:pages` catches this).
The game has no client-side routes, so no `404.html` fallback is needed.

Local development is unchanged: `npm run dev` → <http://localhost:5173/>, `npm run preview` → <http://localhost:4173/>.

## Later: `asteroids.davidandrea.ca` (not configured)

Nothing has been changed for this: no DNS, no `CNAME` file, no GitHub domain setting.

1. In the GitHub account settings, **verify** `davidandrea.ca` (Pages → Add a domain) so no one else can claim subdomains.
2. DNS: add a `CNAME` record `asteroids` → `djblackett.github.io`. If the zone is on Cloudflare, start with the proxy off (DNS only) so GitHub can issue the certificate.
3. **Settings → Pages → Custom domain** = `asteroids.davidandrea.ca`, wait for the DNS check, tick **Enforce HTTPS**. With Actions deployment no `CNAME` file is needed.
4. Decide what lives at the domain root. As deployed, `https://asteroids.davidandrea.ca/` would be the Python game / link page and the game would be at `/phaser/`. To serve the Phaser game at the root, in the `deploy` job of `deploy-gh-pages.yml` download `phaser-site` to `path: site` (not `site/phaser`), and remove the `python` job, the *Download Python site* step, the link-page step and `python` from `needs`, and the `test -f site/phaser/…` lines (use `site/…`).
5. Redeploy. No build change is needed; `npm run test:pages` already checks the build mounted at `/`.

## Verifying gamepad input on the published site

GitHub Pages is HTTPS, a secure context, which the Gamepad API requires.

1. Open the published URL (padlock shown; no `http://`) in Chrome, Edge or Firefox with a controller connected.
2. Press a button on the controller (browsers hide a pad until it is used). On the title screen the controller line changes
   from `No controller detected - press a button on it` to `Controller 1: <name> -> PLAYER n`.
3. If it says `Gamepads unavailable (needs https or localhost)`, the page is not a secure context (typically an `http://` URL).
4. For raw values add `?keydebug` to the URL: the diagnostic panel lists each controller's mapping and live axes/buttons.
   Development-only parameters (`?debug`, `?keydebug`) are inert unless present.

## Rolling back

Pages keeps no history of its own; roll back by redeploying a known-good commit:

- **Fastest:** **Actions → Deploy to GitHub Pages**, open the last good *successful* run on `main`, **Re-run all jobs**. That
  rebuilds from that run's commit and publishes it. (A re-run keeps that run's commit, not today's `main`.)
- **Durable:** `git revert <bad-commit>` and push to `main`; the workflow deploys the reverted tree.
- To take the site down entirely: **Settings → Pages → Unpublish site**.
