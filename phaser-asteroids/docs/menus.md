# Menus: title screen, AUDIO, CONTROLS, pause

The title screen and the pause screen are one small menu system (`src/ui/menu/`). It replaced the development-era screens (a wall of controls,
volume rows, switches and selectors on the first screen) with a player-facing hierarchy: **the first screen says how to start, how to steer and
what the pick-ups do; everything that is a setting is one step away.** Gameplay, audio mixing, music playback rules and vibration patterns were not touched.

## Hierarchy

```
Title                                            Pause (during a run)
├── PLAY            (Space; start the run)       ├── RESUME           (P / START; continues, cannon kept quiet)
├── 1 PLAYER | 2 PLAYERS   (keyboard; 1 / 2)     ├── AUDIO       ──┐
├── AUDIO       ───────────────┐                 ├── CONTROLS    ──┤  the same pages as on the title
├── CONTROLS    ───────────────┤                 └── RETURN TO MENU   (two presses; Esc goes straight there)
├── CO-OP       (two players only)  ── TWO-PLAYER OPTIONS
└── POWER-UPS card ── POWER-UP GUIDE              AUDIO:    MUSIC on | off · MUSIC TRACK < > · MUSIC VOLUME - + · SOUND EFFECTS - +
                                                  CONTROLS: touch:     MOVEMENT classic d-pad | point-to-fly | assisted flight · HAPTIC FEEDBACK on | off · TEST VIBRATION
                                                                       · SWITCH TO KEYBOARD (title only, two taps)
                                                            keyboard:  key map · controllers and who they drive · CONTROLLER LAYOUT
                                                                       · PLAYER 2 KEYS (two players, title only)
                                                                       · big TOUCH CONTROLS ARE OFF - TAP HERE TO TURN THEM ON (touch-capable device, title only)
                                                  TWO-PLAYER OPTIONS: LIVES · FRIENDLY FIRE · PLAYER 1 / 2 SPEED
```

Opening a page from the pause menu leaves the game exactly as it was: still paused, same run.

## Escape / Back

Escape, the controller's BACK button (and B on the pause menu) and the on-screen BACK buttons all go *backwards through the menus*; none of them ever abandons a run in
progress. The one deliberate way out of a run is **RETURN TO MENU** on the pause menu, which takes two presses. The rule is one function, `handleBack` (`ui/menu/backAction.ts`),
used by the keyboard and the controller alike.

| Where you are | Escape / BACK |
|---|---|
| Playing | Pause (opens the pause menu) |
| Pause menu | Resume (the cannon, Laser and Boost stay quiet until released, like RESUME itself) |
| Pause > AUDIO / CONTROLS (> CONTROLLER LAYOUT) | Back one page, with the same button lit; the game stays paused |
| Title > AUDIO / CONTROLS / POWER-UPS / CO-OP (> CONTROLLER LAYOUT) | Back one page to the title page |
| Title page | Nothing (never starts or quits anything) |
| Game over | Main menu (the run is already over) |

- **Keyboard:** `Esc`. One physical press is one step: auto-repeat while it is held and the engine's replayed key events are filtered (`keyPress.ts`), so holding Escape cannot skip pages.
  P (and the controller's START) still pause / resume from anywhere, inside a sub-page too.
- **Controller:** `B` is Boost in play, so it is the menu's cancel button only while the pause menu is open (and on the title screen). `BACK` (Select / View) is the same
  as Escape everywhere, including pausing a run in play. `START` is unchanged: pause / resume.
- **Mouse and touch:** the visible BACK button on every sub-page (nothing else is needed on the pause menu: RESUME is its way out).
- A press of Escape that lands in the same frame as the P that paused the game, before the pause menu exists, is ignored: it neither resumes nor leaves.

## What the title screen shows

- **PLAY**, large and green, top of the right column. On a phone it is the only big green thing (see "Phones in keyboard mode" below).
- **How to play**, the controls that are active *now*: a phone shows the on-screen controls in their in-game colours (D-PAD or STICK, FIRE, LASER, BOOST, PAUSE);
  a keyboard shows key caps generated from the real key schemes (`src/ui/menu/controlHelp.ts`, so a key that does not work cannot be listed); a player with an assigned
  controller sees the controller rows; two players see two columns.
- **Power-ups**, a compact legend (icon, name, three words) as one tappable card; opening it gives the **power-up guide**: one plain sentence each, with the
  durations taken from the simulation's constants (`src/ui/menu/powerupInfo.ts`). Revive is in the two-player legend and in the guide marked as two-player only.
- **AUDIO** and **CONTROLS** as secondary buttons. Nothing else is a setting: no volumes, music, haptics, steering or controller status on the first screen
  (a controller that was found but not given to a player says so in the top-left corner until it joins).
- The **FULLSCREEN** pill (DOM, top right, touch mode) is unchanged and kept clear of every button.

## Where each existing setting lives now

| Setting | Was | Now |
| --- | --- | --- |
| Music on / off | M key, a switch on the touch screens | AUDIO > MUSIC ON / OFF (M still works everywhere) |
| Music track (Original, Mega Man, Gatekeeper, Random) | Track row on the title / pause screen; X on a controller | AUDIO > MUSIC TRACK (X on a controller still steps it on the title screen) |
| Music volume, SFX volume | Rows on the title / pause screen; arrow keys; D-pad | AUDIO > MUSIC VOLUME / SOUND EFFECTS |
| Haptic feedback, TEST VIBRATION | Switches on the touch title / pause screens | CONTROLS (touch mode) > HAPTIC FEEDBACK ON / OFF, TEST VIBRATION |
| Movement mode: Classic D-Pad / Point-to-Fly / Assisted Flight | Selector on the touch title / pause screens | CONTROLS (touch mode) > MOVEMENT (see [movement-modes.md](movement-modes.md)) |
| Touch controls on / off | CONTROLS button on the touch title / TOUCH CONTROLS button on the keyboard title | CONTROLS > SWITCH TO KEYBOARD (two taps) / the green way back (title corner and CONTROLS page) |
| One / two players | 1 / 2 keys, clickable labels | 1 PLAYER / 2 PLAYERS switch on the title (1 / 2 keys; D-pad on the switch) |
| Lives, friendly fire, speeds | L, F, S, D on the two-player title | CO-OP > TWO-PLAYER OPTIONS (L, F, S, D still work on the two-player title and on that page) |
| Player 2 keys | K on the two-player title | CONTROLS > PLAYER 2 KEYS (K still works on the title) |
| Controller assignment and layout | Status lines, G, C, LB / RB, Y | CONTROLS > CONTROLLERS (click / A to change who a controller drives), CONTROLLER LAYOUT; G, C, LB, RB still work on the title; Y opens CONTROLS |
| Fullscreen | DOM pill on touch title / pause screens | unchanged (also visible on every touch menu page) |

## Input

Every device drives the same state machine (`menuController.ts`):

- **Keyboard:** arrows move the focus (and Left / Right change the focused slider or choice), Enter / Space press it, Escape goes back (see "Escape / Back" above). Page hotkeys keep working
  (Space = PLAY on the title page, P, M, 1 / 2, L / F / K / S / D, G, C). Space and Enter on RESUME never fire a shot: every cannon that is down when the menu resumes the
  game stays quiet until it has been released once (`GameScene.resumeFromMenu`).
- **Mouse:** hovering moves the focus; a click presses. A click on empty space does nothing (there is no click-anywhere start).
- **Touch:** a tap presses; no focus ring is drawn after a tap. Taps are swallowed for 220 ms after a page change so a double tap cannot hit the next page's button.
  Menu taps never reach the game: the on-screen game controls are hidden while any menu is open, and the pause menu swallows every tap.
- **Controller:** D-pad moves, A presses, B or BACK goes back, START starts / resumes. (Controllers with a non-standard layout have no D-pad: they can still start and
  resume with A / START.)

## Phones: safeguards kept

- **No tap-anywhere start.** PLAY is a button; empty space does nothing. On a phone that is in keyboard mode the PLAY button is *keys only* ("PLAY WITH KEYBOARD", tapping it does nothing).
- **Leaving touch mode takes two taps** on a deliberately plain button ("SWITCH TO KEYBOARD", then "TAP AGAIN TO SWITCH TO KEYBOARD CONTROLS"; the question lapses after 3 s; a second touch
  within 300 ms is not a confirmation). It exists only on the title screen's CONTROLS page: the mode cannot change during a run.
- **A way back that cannot be missed.** On a touch-capable device in keyboard mode the title screen has a large green **TOUCH CONTROLS: OFF / TAP TO TURN ON** button top right, and the CONTROLS page starts with a full-width
  green bar. Switching modes rebuilds the page in place (no scene restart) and clears every held input.
- **Classic D-Pad is the default movement mode** (an experiment, see [movement-modes.md](movement-modes.md)); Point-to-Fly and Assisted Flight are one tap away in CONTROLS (also from the pause menu); a saved choice is never overridden. The old relative JOYSTICK choice is no longer offered.
- **RETURN TO MENU needs two presses** on every device, and it is the only way out of a run in progress: Escape and BACK only pause, resume and go back.
- Portrait still covers everything with the rotate prompt and pauses the run.

## Haptics default

New players start with **HAPTIC FEEDBACK: ON** (`DEFAULT_HAPTICS_ENABLED`). A saved `asteroids.haptics` value of `0` stays OFF, `1` stays ON, junk falls back to the default, and
nothing is written to storage until the player changes the switch. Nothing vibrates because a menu opened; only gameplay events (touch mode) and TEST VIBRATION ask for a buzz.
The CONTROLS page carries a one-line hint that a silent phone or its vibration settings can block it (Samsung's Silent mode does, even though `navigator.vibrate()` reports success).
Without `navigator.vibrate` the TEST VIBRATION button is not offered and the page says "This browser cannot vibrate.".

## Code

| File | Role |
| --- | --- |
| `src/ui/menu/focusNav.ts` | Directional focus (`neighbour`), the page stack with focus memory. Pure. |
| `src/ui/menu/menuController.ts` | The state machine: pages, focus, keyboard / pad / pointer handling, the input lock, `snapshot()` for tests. Pure. |
| `src/ui/menu/widgets.ts` | Drawn pieces: `MenuButton`, `MenuStepper` (`-  bar  +`, `<  name  >`), `MenuChoice` (`[ ON \| OFF ]`), `PageKit` (owns what one page made). |
| `src/ui/menu/menuView.ts` | Puts a controller on a scene: builds each page when it opens and destroys it when it closes, forwards the pointer. |
| `src/ui/menu/context.ts` | `MenuContext`: what pages read and change (audio, haptics, input mode, movement, pads, setup). Title and pause build the same pages from it. |
| `src/ui/menu/pages/*.ts` | `title`, `audio`, `controls`, `coop`, `powerups`, `padLayout`, `pause`, plus `reference.ts` (key caps and touch icons) and `common.ts`. |
| `src/ui/menu/controlHelp.ts`, `powerupInfo.ts` | The control reference and power-up text as pure data (unit tested against the real key schemes, `padToInput` and the sim constants). |
| `src/scenes/StartScene.ts`, `GameScene.ts` | Own the menu view, route keys and controller buttons, start / resume / leave. |

Design notes: buttons are `MIN_TARGET` = 90 game px tall (about 47 CSS px on a 667 x 375 phone, never below 44); type is 22-30 px for everything the player needs (11-15 CSS px on the smallest phone) and 20 px (10 CSS px) only for hint lines such as the keyboard shortcuts; a page is
rebuilt when its content changes (player count, mode, a controller assigned) with the focus kept; the animated icons use `prefers-reduced-motion`. There is no general UI framework: about 2,000 lines in total (the page layouts are most of it), no dependencies.

## Tests

| What | Where |
| --- | --- |
| Focus geometry, wrap-around, page stack | `tests/menuNav.test.ts` |
| The controller: keys, pad, mouse, touch, input lock, rebuild, no build-up | `tests/menuController.test.ts` |
| Power-up text from the constants, the key / pad / touch reference against the real mappings, legend widths | `tests/menuContent.test.ts` |
| Haptics default ON, saved OFF kept, junk, blocked storage, nothing written | `tests/haptics.test.ts` |
| Browser: hierarchy, keys listed are the keys that work, AUDIO / CONTROLS / CO-OP navigation and persistence, pause submenus keep the run paused, Space / A / held laser and boost never fire on resume, taps never reach the game, 25 + 20 open / close rounds leak nothing, controller navigation, **an automated layout review of every page at 5 phone and 5 desktop sizes**, reduced motion | `npm run test:menu` (`scripts/menu.mjs`, screenshots in `scripts/.smoke-output/menu-*.png`) |
| Browser: the touch, keyboard, controller, music and co-op suites drive the new menus through `menuSnapshot()` / `pauseMenuSnapshot()` (the scene's debug hook lists every button's id, label and rectangle) | `npm run test:touch`, `test:input`, `test:gamepad`, `test:music`, `test:coop`, `test:browser`, `test:pages` |

## Known limits

- Safe-area insets cannot be emulated in headless Chromium; the canvas container is inset by `env(safe-area-inset-*)` (see `index.html`) and the Fullscreen pill uses the same insets, which is covered by design, not by a test.
- A controller with a non-standard mapping has no D-pad, so it cannot move around the menus (A / START still work).
- Desktop has no on-screen Fullscreen button (use the browser's F11); the pill is part of the touch layer.
- The text sizes were reviewed in screenshots, not on a real phone: see the checklist in the final report of the redesign pass and `docs/mobile-touch.md` ("Manual testing").
