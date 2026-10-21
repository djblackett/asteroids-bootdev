# Deploying to GitHub Pages

The Phaser game is a static site (`npm run build` → `phaser-asteroids/dist/`): no server, no backend, nothing to
install for players. GitHub Actions builds it and publishes it as the repository's GitHub Pages site.

**URL:** <https://djblackett.github.io/asteroids-bootdev/>

The Pages site is exactly the contents of `phaser-asteroids/dist/`. The original Python/Pygame game stays in the repository
root as source code but is no longer built or published (its pygbag web build was retired when Phaser became the primary
game; `BUILD_WEB.md` and `pygbag` still work locally if you want it).

## The workflow

[`.github/workflows/deploy-gh-pages.yml`](../../.github/workflows/deploy-gh-pages.yml) is the only workflow that publishes to Pages.

| Trigger | What runs |
| --- | --- |
| Push to `main` that changes `phaser-asteroids/**` or the workflow file | Validate, then deploy |
| Pull request to `main` | Validate only. No Pages permissions are used, nothing is published. |
| Manual run (**Actions → Deploy to GitHub Pages → Run workflow**) | Validate; deploys only when run on `main` |

Changes to the Python game or to root docs do not deploy.

**These block deployment** (job `phaser`, Node 22, Ubuntu): `npm ci` → `npm run typecheck` → `npm test` (Vitest unit tests) →
`npm run build` → `node scripts/pages-check.mjs`. The last step loads the production build in real headless Chrome, served
as the site root at `/asteroids-bootdev/` (the Pages URL path) **and** at `/` (a custom domain), and checks: no console or
page errors, no HTTP errors, all 10 start-up audio files load from under that path, the two extra soundtracks are *not* requested at start-up but load from under it when picked (and a saved choice plays after a reload), nothing is requested outside it, the title screen
renders in WebGL, a one-player game starts with the music playing, `?keydebug` loads, and the Gamepad API is available.
It fails (it is never skipped) if Chrome is missing. The deploy job then publishes that same `dist/` (it is passed on as an
artifact, not rebuilt).

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
3. Push to `main` (touching `phaser-asteroids/**` or the workflow), or run the workflow manually on `main`.

The first successful deployment **replaces** the existing Python (pygbag) site completely.

## Finding the deployment URL

The `Deploy to GitHub Pages` job summary and the run's **github-pages** environment link show it; so does
**Settings → Pages**. History is under the repository's **Deployments** (right-hand sidebar).

## Troubleshooting a failed deployment

- **Which job failed?** `Phaser - validate and build`: a real problem; run the same commands locally (`npm ci`,
  `npm run typecheck`, `npm test`, `npm run test:pages`). `Deploy to GitHub Pages`: see below.
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

Pages keeps no history of its own; roll back by redeploying a known-good commit:

- **Fastest:** **Actions → Deploy to GitHub Pages**, open the last good *successful* run on `main`, **Re-run all jobs**. That
  rebuilds from that run's commit and publishes it. (A re-run keeps that run's commit, not today's `main`.)
- **Durable:** `git revert <bad-commit>` and push to `main`; the workflow deploys the reverted tree.
- To take the site down entirely: **Settings → Pages → Unpublish site**.

## Trying a branch on a phone before it is published

Only pushes to `main` deploy, so a feature branch (or a pull request, which only runs the validation job) never changes the live site, and there is no
preview deployment. To try the mobile touch controls on a real phone from your own machine without publishing anything, follow
[mobile-touch.md](mobile-touch.md#manual-testing-on-a-real-phone): `npm run build && npm run preview:lan` and open the LAN address, or `adb reverse` for Android.
