# Mobile touch controls (Phase 6 prototype)

A playable, landscape-first, one-player touchscreen version of the Phaser game, on the same page and the same URL as the desktop
game. It is a **prototype**: it has been exercised in Chromium's touch emulation and in unit tests, **not on a physical phone**. See
[Manual testing](#manual-testing-on-a-real-phone) for what still has to be checked by a person.

Nothing in `src/core/` knows about touch. Touch is one more input source producing the same `PlayerInput` the keyboard and gamepad
produce; scoring, physics, collisions, difficulty, UFOs, power-ups and audio mixing are untouched.

## What the player sees

**Title screen (touch mode):** a short how-to, the five power-ups, a big **TAP TO PLAY** button, Music / SFX volume with `-` / `+`
buttons and a music on / off button, and a **CONTROLS: TOUCH (tap for keyboard)** button. There is deliberately no "tap anywhere to
start": a stray touch must not begin a run.

**During play (landscape):**

```
 P1: 0          00:12                                  [ || ]  pause (top right, 52 px)
 Lives: 3
 LASER: 15/15                                           (BOOST 6s)   boost: above FIRE
 BOOST: READY
                                                       (LASER 15)  ( FIRE )
   ( STEER )  <- the whole left 46 % is the stick       laser: left of FIRE
```

| Control | Where | What it does |
| --- | --- | --- |
| Steering zone | left 46 % of the screen; a faint **STEER** ring marks the usual spot | A floating joystick appears under the thumb wherever it lands. Drag left / right to rotate, up / down to fly forward / backward, diagonally to do both. Lift to stop. |
| **FIRE** | bottom right, largest (about 110 CSS px on a phone) | Hold to shoot continuously (no tapping). Works with steering. |
| **LASER** | left of FIRE (about 70 CSS px) | Laser Beam, one beam per press. Shows the charges left; dimmed at 0 or during the cooldown. |
| **BOOST** | above FIRE (about 70 CSS px) | Boost, one activation per press. Shows READY, or the seconds left while active / cooling down. |
| **PAUSE** | top right (52 CSS px) | Pauses. It fires on *release* of a tap, so brushing it does nothing. |

**Pause screen:** RESUME, MAIN MENU, Music and SFX `-` / `+`, music on / off. **Game over:** RETRY (disabled for the short delay
after the ship is lost, as with the R key) and MAIN MENU. The on-screen controls are only drawn while a run is actually being
played, so the canvas gets every tap in menus. The HUD at the top left is drawn 1.4x larger in touch mode (`TOUCH_HUD_SCALE`) so it is
readable at phone size; desktop is unchanged.

**Portrait:** an opaque full-screen prompt, a phone outline turning sideways and "Rotate your phone to play.", covers the game and takes
every touch. The run pauses when the phone is turned upright and **stays paused** when it is turned back (the pause screen is
waiting; RESUME needs a tap), so nothing starts or fires by accident. Orientation locking is not used (it is unavailable in most
mobile browsers).

## Joystick mapping

Defined in `src/input/touchModel.ts`; it reuses the gamepad's `stickAxis` and so its dead zone.

- The anchor is where the thumb landed, so touching down is always neutral and nobody has to find the stick.
- `dx`, `dy` are the thumb's offset in CSS pixels. Full deflection is `R` CSS px from the anchor, where `R` is 15 % of the shorter
  screen side, clamped to 52-72 px (about 59 px on an 844 x 390 phone).
- `rotate = stickAxis(clamp(dx / R))`, `move = -stickAxis(clamp(dy / R))` (up is forward). Each axis is clamped to [-1, 1] **separately**
  (a square gate): pushing into a corner turns *and* flies at full rate, like holding W and D. `stickAxis` returns 0 inside the
  controller's 0.15 dead zone and the raw value outside it (not rescaled), so a half push is half a turn.
- Release, cancel, pause, game over, rotation, focus loss and visibility loss all return everything to neutral at once.
- A second finger on the steering zone is ignored; a finger stays bound to the control it started on (see below).

`readPlayerInputs` merges the touch command into Player 1 after the keyboard and pad, with the existing policy: the keyboard wins an
axis it pushes, otherwise the analogue value is used, and buttons are OR-ed. Touch never drives Player 2.

## Multi-touch and lifecycle rules

Implemented with Pointer Events on DOM elements (`src/ui/touchOverlay.ts`, `src/input/touchBinding.ts`), not Phaser objects: the browser
gives real simultaneous pointers with pointer capture, CSS-pixel layout (a button is the same physical size whatever the 1280 x 720
canvas is scaled to), `env(safe-area-inset-*)` and engine-level `touch-action`.

- `pointerdown` is handled on each control's own element; `pointermove / up / cancel / lostpointercapture` on the `window`. A finger therefore keeps the control it
  started on, still releases when it lifts outside it or is cancelled, and works if pointer capture is unavailable.
- Sliding from FIRE onto LASER does nothing to LASER; dragging far from a button keeps it held until the finger lifts.
- `preventDefault()` on `pointerdown` stops synthesised mouse events and clicks, so there is no double firing and no ghost tap on a
  button that appears where the finger was.
- **Phaser also listens for touches on `window`** and processes any whose target is not the canvas unless the event is
  default-prevented. A pointer event's `preventDefault` does not do that, so the overlay also cancels its `touchstart / move / end / cancel`
  events. (Without this, a tap on the rotate prompt started a game through the hidden PLAY button; the browser suite caught it.)
- Everything is released on window `blur`, `pagehide`, a hidden tab, and a portrait <-> landscape flip. A plain resize (browser toolbar
  sliding away) keeps fingers that are down. Pause releases all touches; so do game over and leaving the scene.
- Phaser's default of one touch pointer would make a menu ignore a tap while the other thumb rests on the screen, so
  `input.activePointers` is 3.
- Listener counts are fixed: the overlay adds a constant number of listeners however many touches there are, and removes them on destroy.

## Input-mode selection (`src/input/inputMode.ts`)

1. `?touch=1` / `?touch=0` in the URL decides for that visit (for testing, or a link to send someone).
2. Otherwise the player's last choice on the **CONTROLS** button is used (`localStorage` key `asteroids.inputMode`: `touch` or `desktop`;
   anything else is ignored, so it can never go stale in a confusing way, and the button always says what it is set to).
3. Otherwise automatic: touch controls when the device's **primary pointer is coarse** (`(pointer: coarse)`: phones and tablets).
   A desktop, and a touch-screen laptop whose primary pointer is the mouse / trackpad, get the keyboard game.

Not used on purpose: user-agent sniffing; "the browser supports touch events" (true on most desktops); viewport size (a tablet is a
touch device, a narrow desktop window is not); a connected gamepad (switching mode by itself mid-run would be confusing).

The title screen offers the CONTROLS button always in touch mode, and on any device that reports touch support even while it shows the
keyboard screen ("TOUCH CONTROLS: OFF (tap to turn on)", small, top right). A desktop without touch never sees it. In touch mode the
keyboard still works (Space starts, M mutes, held keys drive the ship); a controller has to be assigned on the keyboard / controller
screen, so a phone with a Bluetooth controller should switch CONTROLS to keyboard. Touch mode is always one player; the title screen forces
`playerCount` to 1 so a two-player choice made earlier cannot leak into a run that cannot drive a second ship.

## Layout and responsiveness

- The 1280 x 720 playfield and Phaser's `FIT` scaling are unchanged. On a 20:9 phone the canvas is letterboxed and the side bars are
  free for controls; on 16:9 screens the controls overlay the canvas edges. A canvas is never stretched, so game coordinates stay
  correct and nothing about the playfield changes.
- Control sizes use CSS pixels derived from the viewport height (`clamp()` in `src/ui/touch.css`): FIRE 92-140, LASER / BOOST 64-92, PAUSE 52,
  with 14 px gaps. All are at least 44 CSS px; the browser suite checks this on 844x390, 667x375, 932x430, 740x360, 915x412 and 1024x768.
- Safe areas: `viewport-fit=cover` in the viewport meta; the canvas container is inset by `env(safe-area-inset-*)` and the controls
  position themselves inside the same insets. On desktop all insets are 0, so nothing changes. (Not verified on a notched device.)
- Page-level touch rules (`touch-action: none`, `overscroll-behavior: none`, no selection or callout) apply only under `body.tc-active`,
  i.e. in touch mode. Desktop is not affected; the suite checks `touch-action` is `auto` there.
- High-density displays: the controls are DOM (CSS pixels, crisp at any DPR); the canvas stays 1280 x 720 and is scaled by the
  browser, which is about 1:1 on a 3x phone. Text is already rendered at 2x.

## Performance observations

- The touch layer does no per-frame DOM work. The model notifies the view only when a pointer event changes something, and the view writes to
  the DOM only when the value differs from the last write (transforms for the stick, a class toggle per button). The LASER / BOOST labels are
  compared by key every frame and written only when they change.
- Nothing is allocated per frame by the overlay itself; the per-frame `PlayerInput` objects are the same few small objects the keyboard
  and pad paths already create.
- No renderer changes and no gameplay reduction were made. Measured in Chromium's phone emulation (844 x 390, DPR 3, **software WebGL**, which is
  much slower than a phone GPU), with forced extreme spawning (about 20 asteroids a second, peaks of 55-68 on the field, roughly twice the busiest
  desktop suite) and a ship steering with FIRE held:
  - frame time avg 18.7 ms (x1 CPU) / 19.5 ms (x4 CPU throttle), p95 33 ms; one 100-180 ms spike while a ship was being destroyed. At normal load
    (the desktop suites' "intense combat" scenario) it is 16.6 ms avg, p95 16.8 ms. CPU throttling barely changed the result, so the limit is the
    software rasteriser, not JavaScript.
  - DOM writes by the touch layer: 50-100 mutations in 8 s of continuous stick movement and firing (a transform write per stick move, a class toggle per
    button change); none while idle.
  - A/B with the same stress and no touches, three ways (touch UI on, touch UI on but `display:none`, touch mode off): averages 26-29 ms in every
    configuration; p95 flipped between 33 and 50 ms at random in all three. **No measurable cost from the overlay**, but also no proof about real phones: **"performance under
    intense combat" is on the manual checklist.** If a device struggles, the obvious, independent knobs are `TOUCH_HUD_SCALE` (HUD text re-rasterisation)
    and the star count in `core/starfield.ts`; neither has been needed here.

## Browser limits and known issues

- **iOS Safari** has no Fullscreen API for pages: the address bar and toolbar stay, so the playfield is smaller. Adding the page to the
  Home Screen would hide them (a PWA is out of scope). **Android Chrome** can go fullscreen, but there is no button for it yet.
- Audio needs a real touch: the first tap (TAP TO PLAY) unlocks it, via Phaser's own touchend unlock. Verified in Chromium; **iOS Safari is the browser most likely to behave differently, and the silent switch / ringer mode can mute Web Audio there.**
- Mobile browsers may reserve edge swipes (back / forward gestures, notification shade). FIRE sits 18 px (plus safe area) from the right edge to stay clear; a system gesture
  cancels the touch, which the game treats as a release.
- Browser touch emulation does not reproduce palm rejection, finger size, multi-touch limits of real hardware (some budget phones track 5 fingers) or latency.
- No haptics, no remappable layout, left-handed mirror or button-size setting.
- The two-player and controller-assignment screens are not reachable in touch mode (switch CONTROLS to keyboard).
- The HUD's top-right corner can be close to the PAUSE button on 16:9 screens (the combo readout sits at x ~ 1030 +/- 120 game px, y 78-150).

## Tests

| What | Command | Result |
| --- | --- | --- |
| Touch model: dead zone edges, proportional / diagonal / both directions, FIRE, LASER, BOOST, simultaneous input, pointer identity, cancel, disable | `npm test` (`tests/touchModel.test.ts`) | 26 tests |
| Binding: multi-touch, sliding between buttons, release outside, cancel, lost capture, pause tap, blur, hidden tab, pagehide, rotation, plain resize, destroy, bounded listeners | `tests/touchBinding.test.ts` | 22 tests |
| Facade: mode / layer, portrait prompt and pause, pause forwarding, cleanup, ability labels | `tests/touchControls.test.ts` | 19 tests |
| Mode policy: automatic choice, URL override, stored choice, blocked storage, toggle offered | `tests/inputMode.test.ts` | 29 tests |
| Touch + keyboard + pad merging, and a real `GameSim` driven by touch (steer, fly, FIRE, once-per-press LASER / BOOST, pause, game over) | `tests/touchInput.test.ts` | 16 tests |
| Real browser, genuine multi-touch (CDP `Input.dispatchTouchEvent`, 4 fingers at once), mobile emulation DPR 2 | `npm run test:touch` | 101 checks |

The browser suite covers: load, touch-only start, audio unlock by touch, overlay in landscape, layout and 44 px targets on six phone / tablet
sizes, HUD visible, steering changes the simulation input, FIRE held while steering, LASER and BOOST with other fingers down,
slide / release-outside / cancel, pause with fingers down and no ghost tap, volume and mute by touch, resume, portrait prompt and
back (same run, still paused), focus loss, game over, RETRY with a resting finger, MAIN MENU, listener build-up, mode switch and
persistence, `?touch=0`, portrait-at-load with a tap through the prompt, scroll / overflow, console errors, audio files and the CSS asset
loading, and that the desktop title, pause screen, HUD size, `touch-action` and canvas size are unchanged. Screenshots go to
`scripts/.smoke-output/touch-*.png`.

Not covered by any test: a real phone, iOS Safari, a real GPU, thumb ergonomics, hardware multi-touch limits, the notch / safe-area
insets (they are `0` in emulation), and a touch laptop (this Chromium reports a coarse pointer whenever touch is emulated, so
that case is covered by the policy's unit tests only).

## Manual testing on a real phone

Run these from `phaser-asteroids/`. Nothing here pushes, publishes or deploys anything.

**Option A - same Wi-Fi (works for Android and iPhone).**

1. `npm run build` then `npm run preview:lan` (serves `dist/` on all interfaces, port 4173). `npm run dev -- --host` also works.
2. On the PC: `ipconfig`, note the Wi-Fi IPv4 address (on the machine this was developed on: 192.168.7.198, which may change).
3. Allow Node through the Windows firewall when it asks (private networks only), phone on the same Wi-Fi, **not** a guest network (client isolation).
4. On the phone open `http://<that address>:4173/`. Add `?debug` only if you want `window.__game`.
5. This is an **insecure context** (plain http on a LAN address). The game runs, but anything that needs a secure context behaves
   differently: the Gamepad API is unavailable (irrelevant for touch), and the page may be treated slightly differently by the browser.
   Audio, `localStorage` and Pointer Events work. Prefer B or C for the final check.

**Option B - Android + USB (a real secure context, no Wi-Fi needed).** Enable USB debugging, plug in, `adb reverse tcp:4173 tcp:4173`,
run `npm run preview`, open `http://localhost:4173/` in the phone's Chrome (`localhost` counts as secure). `chrome://inspect` on the PC
shows the console.

**Option C - an HTTPS tunnel (also works for iPhone).** Install `cloudflared` or `ngrok` yourself; this **publishes a temporary public URL**
to your local build, so it is your decision. `vite preview` rejects the tunnel's unknown `Host` header, so have the tunnel rewrite it,
for example `cloudflared tunnel --url http://localhost:4173 --http-host-header localhost:4173` or `ngrok http 4173 --host-header=localhost:4173`
(I did not install or run either, so check the flags against their current docs). Without the rewrite Vite answers 403 "Blocked request".

**Option D - GitHub.** Pushing this branch and opening a pull request only runs the *validation* job; deployment happens only for pushes
to `main` (see `docs/deployment.md`), and there is no preview deployment, so GitHub alone cannot give you an HTTPS preview of the branch.
Do not merge to `main` until you are happy: that is what publishes it.

What to check on **Android Chrome** and **iPhone Safari** (landscape):

- [ ] **First load:** the title screen says TOUCH; text is readable; TAP TO PLAY starts; the music starts after the tap (iPhone: check the ringer / silent switch is not on).
- [ ] **Control comfort:** can you hold the phone for a few minutes? Do both thumbs reach everything without moving your grip?
- [ ] **Joystick responsiveness:** does the stick appear under your thumb and track it without lag? Is the turning too twitchy or too sluggish
      (full turn takes about a thumb's width)? Do small thumb drifts cause turning while you meant to go straight?
- [ ] **Steering while firing:** hold FIRE and steer at the same time for 30 s. Does either ever drop out?
- [ ] **Button spacing / accidental taps:** do you ever hit LASER or BOOST when aiming for FIRE? Do you ever hit PAUSE?
- [ ] **LASER / BOOST:** one tap fires one beam / boost; the button labels update; no repeated firing if you hold them.
- [ ] **HUD legibility:** score, lives, laser, boost and clock readable at arm's length; nothing hidden under a thumb, the notch or the rounded corners.
- [ ] **Safe area (notched phones):** controls inside the curved / notched edges; canvas not cut off.
- [ ] **Rotation:** turn to portrait mid-game: the prompt appears, the game is paused. Turn back: paused, RESUME works, nothing fires by itself.
- [ ] **Pause / restart:** PAUSE, change the volume, RESUME; die, RETRY, MAIN MENU.
- [ ] **Browser interruptions:** pull down the notification shade, take a call / switch apps, lock the screen, swipe from the edge: the game must pause and nothing may stay held on return.
- [ ] **Page behaviour:** no scrolling, pull-to-refresh, zoom on double-tap, text selection or long-press menu while playing; the address bar does not jump around.
- [ ] **Performance under intense combat:** let a few minutes of asteroids build up, use Mega Power: any stutter, heat, or slow-motion feel?
- [ ] **Audio:** music and effects balance as on desktop; volume buttons on the pause screen work; mute works; no double music after rotating or retrying.
- [ ] **Mode switch:** on the title screen CONTROLS switches to the keyboard screen and back; the choice survives a reload.

Please report: phone model, browser and version, what felt wrong, and (if you can) a screenshot.

## Suggested next steps (not done)

Based on what usually goes wrong with on-screen controls, in rough order: (1) tune stick radius and dead zone on a real thumb; (2) a left-handed
mirror and a button-size setting; (3) an auto-fire option, only if holding FIRE is tiring (it is not the default, as specified); (4) a
fullscreen button on Android; (5) a haptic tick on LASER / BOOST via `navigator.vibrate` (Android only); (6) an in-game one-time control hint
over the first seconds of play; (7) a preview deployment for pull requests so phones can test without a tunnel.
