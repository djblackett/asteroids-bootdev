# Physical Android ranked testing — local only

Prepared 2026-10-22. **Physical Android verification is pending.** No new dependencies, tunnel, deployment or Cloudflare account changes.

## Startup

Use Windows PowerShell and `npm.cmd`: this environment's `npm` wrapper swallowed `--host`. Dependencies are already installed; on a fresh checkout, use the existing lockfiles with `npm.cmd ci` in both `phaser-asteroids` and `phaser-asteroids/server`.

Terminal 1 — real local Worker/D1:

```powershell
cd C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids\server
$env:WRANGLER_SEND_METRICS = 'false'
npm.cmd run migrate:lan
npm.cmd run dev:lan
```

Terminal 2 — frontend and player API proxy:

```powershell
cd C:\Users\davej\dev\asteroids-bootdev\phaser-asteroids
npm.cmd run dev:lan -- --host 192.168.7.198
```

Phone and desktop URL: **http://192.168.7.198:5173/**. Start with normal Chrome on the S25, on the same trusted network as the wired PC. No query parameters are needed. `localhost` on the phone refers to the phone itself.

Current Ethernet: IPv4 `192.168.7.198`, mask `255.255.252.0`, gateway `192.168.4.1`, subnet `192.168.4.0/22`, network profile **Private**. The phone's third octet can differ within that subnet. Ignore the WSL adapter (`172.21.240.1`). If DHCP changes the PC IP, use `ipconfig` and update the frontend host, URL and firewall rule. LAN startup refuses wildcard/public/unassigned addresses and fails on port conflicts.

Stop servers with **Ctrl+C in their terminals**. Restart with the same commands. Migrations are repeatable; D1 persists in `server/.wrangler/state-lan`, separate from normal development's `.wrangler/state` and automated tests' temporary databases. Do not delete state during persistence checks.

## Windows Firewall — administrator action remains

Firewall is on and Ethernet is Private. Existing inbound rules for the current Node installation apply to Public; Private rules refer to other Node installations. The agent attempted the following scoped rule but Windows returned **Access denied**. **No firewall change was made.** Local desktop requests do not prove inbound phone traffic is allowed.

Run once in **PowerShell as Administrator**, using the same Node installation:

```powershell
New-NetFirewallRule -Name 'Asteroids-LAN-Dev-5173' `
  -DisplayName 'Asteroids LAN dev 5173 (Private subnet only)' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 `
  -LocalAddress 192.168.7.198 -RemoteAddress 192.168.4.0/22 `
  -Profile Private -InterfaceAlias Ethernet `
  -Program (Get-Command node).Source -EdgeTraversalPolicy Block
```

Inspect: `Get-NetFirewallRule -Name 'Asteroids-LAN-Dev-5173'`. Remove after testing: `Remove-NetFirewallRule -Name 'Asteroids-LAN-Dev-5173'` in Administrator PowerShell. If the IP/interface changes, remove and recreate with new values. Do not disable Firewall, open 8788/9230, change unrelated rules, configure router forwarding, use a tunnel or enable remote Wrangler mode.

## Architecture and browser constraints

```text
S25 -> 192.168.7.198:5173/            Vite, one private interface
    -> 192.168.7.198:5173/api/v1/...  same-origin player API proxy
       -> 127.0.0.1:8788/api/v1/...   real local workerd -> local D1
Inspector: 127.0.0.1:9230 only
```

8787 belongs to an unrelated RStudio service. LAN mode therefore uses 8788. Admin routes are explicitly disabled with a short non-secret placeholder; credentials never enter browser variables. The proxy allows only health, challenge issuance/submission, leaderboard and score-detail routes. It rejects foreign Origin/Host requests before replacing the upstream Origin with an existing allowed loopback origin. Backend source, secret/state files, admin and Wrangler tooling paths are blocked, including encoded/case variants.

Production settings, API URL rules, Worker CORS, normal desktop scripts and existing tests are unchanged. `preview:lan` alone does not configure ranked access; use `dev:lan`. Vite serves frontend source and HMR on the trusted LAN; HTTP traffic is unencrypted. D1 files, Worker tools and administrative endpoints stay inaccessible through the LAN proxy.

The browser's game and API share an HTTP origin. The PC performs the loopback request, avoiding browser cross-origin CORS, mixed content and public-to-private/loopback fetches. No wildcard CORS or Private Network Access headers are added. See Chrome's [Local Network Access guidance](https://developer.chrome.com/blog/local-network-access) for restricted network transitions. If Android/browser asks for a local-network permission, allow only this intentional test; do not disable security flags.

Private-IP HTTP is **not a secure context**, unlike localhost ([secure-context specification](https://www.w3.org/TR/secure-contexts/)). Ranked code uses fetch, recording, optional gzip and localStorage; it needs no browser-side secure-context cryptography. Desktop Chromium confirmed ranked play and gzip with `isSecureContext === false`. Gamepads may be unavailable; service workers/PWA installation and secure-context-only APIs are outside this HTTP test. Fullscreen requires a real tap; Android support and keyboard-related fullscreen exits need manual checks. Refusal must leave windowed play usable. No HTTPS certificate installation or insecure-origin override is needed for ranked/touch testing.

On the phone, open **http://192.168.7.198:5173/api/v1/health**: expect JSON with `ok: true`, `rulesVersion: "1.0.0"`, `timeLimitSeconds: 1200`. If page and health time out, check the administrator firewall step, PC IP, same network, guest Wi-Fi/client isolation and VPN LAN restrictions. Wired PC and Wi-Fi phone are fine when bridged by the router. If the page works but health fails, check the Worker terminal and port 8788. Phone inbound reachability remains unverified until this test succeeds on the phone.

Proxied players share an IP rate-limit bucket: default **30 starts and 30 submissions/hour**. Abandoned starts count; restarting Worker does not clear D1 counters. A rate-limit message differs from a connectivity failure. Personal best and nickname are browser-origin-specific: keep the same IP, port and browser; incognito, clearing site data or changing origin loses the remembered identity.

## Verification performed

- Production build/typecheck passed; focused ranked-client and lifecycle/CORS tests: **101 passed**. No full legacy browser suite ran.
- Both local migrations applied to LAN D1. Health and both leaderboards returned 200 through the LAN IP.
- Sockets confirmed frontend at `192.168.7.198:5173`, Worker at `127.0.0.1:8788`, inspector at `127.0.0.1:9230`.
- Desktop Chromium launched a real ranked run via the LAN URL, played to natural game over, entered `LAN Smoke`, and submitted its recording. Worker replay accepted **80 points**; both boards returned it and its public score ID survived browser reload. This leaves one `LAN Smoke` test score in local LAN D1.
- Foreign-origin POST: 403; admin/tooling: 404; backend files, including encoded/case variants: 403. Loopback Worker's admin route: 404.
- Reproduce the focused browser check with both servers running: `npm.cmd run test:lan -- http://192.168.7.198:5173` from `phaser-asteroids`. It uses existing Chromium/Playwright, may take a few minutes, consumes local run quota and adds a local test score. No legacy suites or deployment.

These verify the PC browser/proxy/real Worker/D1 path. Physical Android, phone inbound firewall passage, Samsung keyboard, real multitouch and Android fullscreen remain manual.

## Exact S25 manual procedure

Record browser/version, Wi-Fi, nickname, game-over score, verified score and failures. Keep both PC terminals visible. Do not reload during submission/retry tests.

1. **Ranked launch:** Open the URL in normal Chrome, rotate landscape, tap **RANKED PLAY**. Confirm one-player rules and 20:00 limit. Tap **START RANKED RUN** once: expect connecting, then gameplay with **RANKED** visible. Failure must not silently start a ranked game.
2. **Touch Assisted Flight:** In Controls enable touch and select **ASSISTED FLIGHT**; use Pause to reach Controls if already playing. Steer with the left thumb while holding **FIRE** with the right. Test **LASER**, **BOOST**, release/re-engage both thumbs, and Pause/Resume. Check for stuck controls.
3. **Game over:** Earn a nonzero score and lose all lives naturally. Note final score; confirm ranked result and nickname field. No verification claim should appear before submission. Optional endurance check: surviving to 20:00 is a valid scored ending.
4. **Android keyboard/nickname:** Tap the field. Confirm Samsung keyboard opens and field/actions stay visible. Try two letters and submit: expect validation without losing the run. Replace with `S25 Pilot` (valid 3–16 characters). Test backspace, editing, Done/Enter, dismiss/reopen. Submit once; repeated taps/Enter must not duplicate. Typing must not steer, pause or restart gameplay.
5. **Verification and boards:** Wait for **SCORE VERIFIED!**, compare with recorded game-over score, note weekly/all-time ranks. Open **HIGH SCORES**, switch **THIS WEEK / ALL TIME**, find same nickname/score and **YOU** marker. Test back and paging if available.
6. **Personal best:** Return to Ranked Play and confirm best verified score. Reload identical URL, then close/reopen the tab in the same browser: nickname/best should remain. Restart Worker with `npm.cmd run dev:lan` in its directory; refresh boards and confirm D1 score remains. Desktop and phone localStorage are independent.
7. **Orientation/fullscreen:** Tap **FULLSCREEN** on title/Pause, exit with button and Android system gesture. Rotate portrait during play: rotate prompt should cover/pause the game. Rotate back and resume; inspect canvas, controls, results and keyboard for clipping. Keyboard-triggered fullscreen exit must leave usable results; refused fullscreen must leave usable windowed play.
8. **Quit/Play Again:** Start ranked, Pause, choose Main Menu/Quit once: expect confirmation. Cancel and resume same run, then confirm quitting unfinished play: no score should appear. Complete another run and choose **PLAY AGAIN**: expect fresh server challenge/score, clear controls, remembered nickname and no reused recording.
9. **Backend unavailable/recovery:** Leave Vite running; stop only Worker (Ctrl+C, Terminal 1). Try ranked start: expect unavailable, **TRY AGAIN**, **PLAY NORMALLY** and Back, with no fake ranked run. High Scores should show error/retry; casual Play remains usable. Restart Worker (`npm.cmd run dev:lan`), retry and confirm recovery. Then start a fresh ranked game online; after game over stop Worker **before submitting**, submit and wait for retryable failure, with no verified claim. Restart Worker and tap **Retry without reloading**: expect one accepted score/board entry. Only acceptance updates personal best. Reload discards the in-memory challenge/replay; the server also expires submissions after its 60-minute window.
