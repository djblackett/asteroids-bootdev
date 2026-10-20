# GitHub Actions Workflows

## deploy-gh-pages.yml

Builds the Phaser game in `phaser-asteroids/` and publishes it as the GitHub Pages site,
<https://djblackett.github.io/asteroids-bootdev/>. It is the only workflow that deploys to Pages.

- **Push to `main`** touching `phaser-asteroids/**` (or this workflow): validate, then deploy.
- **Pull request:** validate only.
- **Manual run:** Actions → "Deploy to GitHub Pages" → Run workflow. Deploys only from `main`.

Validation (blocks deployment): `npm ci`, typecheck, unit tests, production build, and a headless-Chrome check of the build
(`phaser-asteroids/scripts/pages-check.mjs`).

Full details (one-time Pages setup, troubleshooting, rollback, custom domain, gamepad check):
[phaser-asteroids/docs/deployment.md](../../phaser-asteroids/docs/deployment.md).

## browser-suites.yml

Manual only. Runs the larger real-browser suites (smoke, keyboard, combat, co-op, simulated gamepad). Never blocks a deploy.

The original Python game is not built or published by any workflow.
