# Mobile haptics (Phase 8)

A small, optional, **presentation-only** vibration layer for the touch version: four important gameplay moments buzz the phone through the
standard browser Vibration API (`navigator.vibrate`). It is **ON by default for new players** (it was OFF until a real-phone test on a Samsung Galaxy S25 showed it is worth having),
a saved OFF is always kept, only the **touch UI** uses it, and it never changes what the game does (damage, cooldowns, lives, scoring, boost and laser behaviour, audio) or how it is drawn.

Status: built and tested in Chromium's touch emulation with a recording spy in place of `navigator.vibrate`, and felt once on a Samsung Galaxy S25 (Android Chrome), which is why it now
defaults to ON. The durations below are still the original guesses (see "Android test"). One real-phone finding: **Samsung's Silent mode can suppress browser vibration even though
`navigator.vibrate()` returns `true`**, so the CONTROLS page says so in one line (see below).

## The four effects

All values live in one table, `src/haptics/hapticPatterns.ts` (`HAPTIC_PATTERNS`). Change a number there and nothing else.

| Effect | Sim event that triggers it | Duration | Priority | Cooldown (same effect) |
| --- | --- | ---: | --- | ---: |
| **Boost** | `boost_started`: a Boost really began | 30 ms | medium | 250 ms |
| **Laser** | `laser_fired`: a Laser Beam really fired (once per beam) | 55 ms | medium | 200 ms |
| **Damage** | `player_hit`: a ship really lost a life | 65 ms | high | 300 ms |
| **Death** | `player_eliminated` or `game_over`: a ship lost its last life | 110 ms | highest | 1000 ms |

They come straight from the **authoritative simulation events** (`GameSim.step` returns them), the same ones the audio layer uses. Nothing is
inferred from key presses, sounds or animations, so:

- BOOST during its cooldown, or LASER with no charges, emit no event and do not vibrate.
- A Laser that stays on screen for several frames vibrates once, when it fires.
- A hit absorbed by a **Shield** or respawn protection emits no `player_hit` and does not vibrate (only a lost life does).
- Ordinary shots, asteroid and UFO kills, power-ups, thrust, steering, score, menus, fullscreen and rotation never vibrate.

`src/core/` was **not changed**: the existing events were enough.

## Rules (`src/haptics/hapticManager.ts`)

A request is checked in this order; the first rule that says no drops it. **Nothing is ever queued**: a buzz that arrives late feels unrelated to what caused it.

1. HAPTICS must be ON, the game not paused, the page visible and focused, and `navigator.vibrate` present.
2. **Cooldown:** the same effect is not repeated within its cooldown (stops repetitive buzzing; damage is also limited by the 2 s of respawn protection).
3. **Priority:** while an effect is still running, a new one replaces it only if its priority is **strictly higher** (death > damage > boost = laser). A lower or equal one is discarded.
4. **Gap:** medium-priority effects (boost, laser) also keep 80 ms of silence after the previous effect (`MEDIUM_PRIORITY_GAP_MS`). Damage and death ignore the gap, so a Laser buzz just before can never swallow them.

Time comes from an injectable clock (`performance.now()` by default), so tests are deterministic and never sleep.

### Damage and death in the same step

When a ship loses its last life the simulation emits `player_hit` **and** `player_eliminated` / `game_over` in the same `step()`. `HapticManager.handle(events)`
resolves the whole step **before** issuing a command: it asks for **one** effect, the top-ranked of the events present (death, then damage, then boost, then laser; that order is
also the tie-break between equal priorities). The order of the events in the array is irrelevant, and the result is a single 110 ms death vibration, never a damage buzz followed by a death buzz.
If that top effect is refused (for example it is in its cooldown) the step stays silent rather than falling back to a lesser effect.

## Settings and menus

- **HAPTIC FEEDBACK: ON / OFF**, saved in `localStorage` as `asteroids.haptics` (`1` / `0`, like the music mute). Anything else stored is ignored; blocked storage means "not remembered", never an error.
  **Default ON** (`DEFAULT_HAPTICS_ENABLED`). The default only applies to a player who has never chosen: a saved `0` stays OFF, a saved `1` stays ON, nothing is migrated or rewritten, and nothing is written
  until the player changes the switch. Nothing vibrates because a menu opened: only gameplay events (touch UI, a run in progress) and the TEST VIBRATION button ask for a buzz.
  It does not touch the music mute or either volume, and it is not the same thing as muting audio.
- **Where:** **CONTROLS** (touch mode), on the title screen and on the pause menu: `HAPTIC FEEDBACK  [ ON | OFF ]`, then `TEST VIBRATION`, then a one-line hint (below). It used to be a row of three
  switches on the title and pause screens; the menus were reorganised in the menu redesign pass ([menus.md](menus.md)). Every target is 90 game px tall, about 47-49 CSS px on a phone.
  The keyboard / controller screens have no haptics control (the CONTROLS page shows it only in touch mode, where it has an effect).
- **The hint:** "Nothing buzzing? A silent phone or its vibration settings can block it." sits under TEST VIBRATION and nowhere else (no warning on the main screen).
  Without `navigator.vibrate` (iPhone Safari) the TEST VIBRATION button is not offered and the line reads "This browser cannot vibrate."; the saved choice can still be changed and nothing errors.
- **TEST VIBRATION:** a deliberate double pulse (80, 60, 80 ms; unlike any gameplay effect), sent from inside the tap itself. It works whether HAPTICS is on or off (it exists to tell
  "this phone cannot" from "the game did not ask"), ignores cooldowns, and reports what the *browser* did, not what the phone did:
  `SENT - FELT IT?` (accepted), `BLOCKED - TAP AGAIN` (the browser refused); where there is no `navigator.vibrate` the button is not shown at all. The label reverts after 2.5 s.
  Detecting the API does not prove there is a motor, and the button never claims it does.
- There is no intensity slider (the API has no intensity) and no pattern editor.

## Data flow and files

`GameSim event -> HapticManager -> VibrationAdapter -> navigator.vibrate`

| File | Role |
| --- | --- |
| `src/haptics/hapticPatterns.ts` | The tunable table, priorities, order, gap, test pattern, and `hapticKindsOf(events)` (the event mapping) |
| `src/haptics/hapticManager.ts` | Priorities, cooldowns, one-effect-per-step, pause / focus / hidden cancellation, test vibration, lifecycle listeners |
| `src/haptics/vibrationAdapter.ts` | `VibrationAdapter` interface + `NavigatorVibrationAdapter` (feature-detected, never throws, `vibrate(0)` cancels) |
| `src/haptics/hapticSettings.ts` | The saved ON / OFF choice (same shape as `SteeringController`) |
| `src/haptics/gameHaptics.ts` | `installHaptics(game)` (one manager in the registry, created in `BootScene`) and `getHaptics(scene)` |
| `src/scenes/GameScene.ts` | Passes each step's events to the manager **only when the touch UI is active**, tells it the pause state, resets it on scene start and shutdown |
| `src/ui/menu/pages/controls.ts` | The HAPTIC FEEDBACK row, TEST VIBRATION and the hint, on the touch CONTROLS page (title and pause) |

Controller rumble can later be a second `VibrationAdapter` fed by the same `hapticKindsOf` mapping; **not implemented** in this pass.

## Cleanup and lifecycle

A running vibration is cancelled with `navigator.vibrate(0)` when: HAPTICS is switched off, the game pauses (any cause: PAUSE, blur, tab hidden, portrait, controller loss), the window loses focus,
the tab is hidden, the page is hidden (`pagehide`), the scene shuts down (retry, main menu) or the game is destroyed. While blurred or hidden no request starts. Events from a paused
or background period are dropped, never replayed. The manager is created **once** per game (registry) and its window / document listeners are added once and removed on destroy; scenes
hold no subscriptions of their own, so restarts cannot stack listeners. Resuming from pause clears a blur whose `focus` event never arrived.

## Browsers

- **Android Chrome / Firefox:** `navigator.vibrate` exists; this is the target. The browser may refuse a call until the page has had a tap (Chrome needs a completed touch, which is the
  `touchend`, not the `touchstart` the buttons react to): a first-ever tap on TEST VIBRATION can say `BLOCKED - TAP AGAIN`, and the second works. Gameplay is after TAP TO PLAY, so it is unaffected.
  Embedded in a cross-origin iframe the page would need `allow="vibrate"`; the GitHub Pages site is not embedded.
- **iPhone Safari:** no Vibration API. The controls are still shown (so the test can say `NOT SUPPORTED`), every request is a silent no-op, and the game is unchanged.
- **Desktop / keyboard / controller:** the manager never receives events (`GameScene` forwards only in touch mode), so a desktop with a phone or controller attached cannot buzz it. Co-op is keyboard / controller only; touch is one player.

## Tests

| What | Where | Result |
| --- | --- | --- |
| Table values, event mapping, each effect, success-only (real `GameSim`: failed Boost / Laser, shield-absorbed hit), damage + death in one step in any order, deterministic ordering, priority both ways, no queue, cooldowns, OFF, disabling cancels, pause / blur / hidden / pagehide cancel, no replay after background, listener bounds, scene reset and restarts, unsupported / refused / throwing browsers, the navigator adapter, TEST VIBRATION, saved setting + junk + blocked storage, sim unchanged by haptics | `npm test` (`tests/haptics.test.ts`) | 62 tests |
| Browser (section "Haptics" of `npm run test:touch`): controls on title and pause screens, default OFF, tap to toggle, persistence, junk value, TEST VIBRATION pattern + result labels, real touch Boost / Laser / damage / death requests, failed Boost / Laser, restart, cancellation, fullscreen + orientation, unsupported API, desktop never calls it | `scripts/touch.mjs` | 38 checks |

The browser tests replace `navigator.vibrate` with a spy: they prove **what the game asks for and when**, not that a motor moves or how it feels.
The existing mute-by-touch check moved to the new position of the music switch (left of the three).

## Known limitations

- Untested on a real phone; the durations are guesses. A single pulse is the only shape used so far; death differs from damage only in length (110 vs 65 ms).
- Android only. `vibrate` has no strength control and some phones ignore very short pulses (under about 20-30 ms), or are quieter in battery-saver or "touch vibration off" system settings.
- A shield absorbing a hit is silent by design (it is not a lost life).

## Android test (about 5 minutes)

Open the build on the phone (`npm run preview:lan`, or the deployed Pages site once it is published). Landscape, Android Chrome, system touch vibration and "do not disturb" off.

1. **Default:** on a fresh browser profile open **CONTROLS** from the title screen: **HAPTIC FEEDBACK** already says **ON** (green) and nothing buzzed on its own. Tap **OFF**, reload, open CONTROLS again: still OFF; **ON** and reload: still ON.
   An existing saved OFF must still be OFF after this update.
2. **TEST VIBRATION:** tap it. Expect a *double* pulse (buzz-pause-buzz) and the label `SENT - FELT IT?`. `BLOCKED - TAP AGAIN`: tap again. `NOT SUPPORTED`: this browser has no API (not an iPhone test).
   If TEST works but gameplay does not, the integration is at fault; if TEST is silent, the phone / browser is.
3. **Boost:** PLAY, tap BOOST: one **very short tick** (30 ms). Tap BOOST again while it is running or cooling down: nothing.
4. **Laser:** tap LASER: one short **thump** (55 ms), once, not while the beam is on screen. Spend all 15 charges to check, then tap with 0 left: nothing.
5. **Damage:** fly into an asteroid (no shield): one firm **bump** (65 ms). Pick a Shield first and hit again: no buzz (shield absorbs it).
6. **Death:** lose the last life: one **longer thud** (110 ms), and **no** double buzz with the damage one.
7. **Cooldown:** tap LASER rapidly: the buzz is spaced out, never a continuous drone (at most one per 200 ms).
8. **Turn it off:** pause, **CONTROLS**, tap **OFF**: play on, nothing buzzes. TEST VIBRATION still buzzes. If TEST is silent on a phone that supports it, check Silent / Do-not-disturb and the system "vibration" and "touch feedback" settings (the hint says the same).
9. **Pause while buzzing:** TEST VIBRATION, then immediately tap PAUSE (and, in a run, die and pause at once): the buzz stops at once.
10. **Switch apps:** during play, swipe to another app and back: the game is paused, nothing buzzes on return and no stale buzz arrives.
11. **Fullscreen / rotation:** enter and leave FULLSCREEN, rotate to portrait and back: no vibration from the transitions.
12. **An intense round:** turn it on, play two or three minutes with lots of rocks, lasers and boosts. Does it stay pleasant?

Questions to answer: does **Boost** feel more satisfying? Does **damage** feel noticeable without being irritating? Is **death** clearly different from damage? Does it stay pleasant in a busy round?

### What to change afterwards (all in `src/haptics/hapticPatterns.ts`)

| If it feels... | Try |
| --- | --- |
| Boost too faint / not felt | `boost.pattern` 30 -> 40-50 (phones often skip pulses under ~25 ms) |
| Laser annoying when tapped fast | raise `laser.cooldownMs` 200 -> 350, or lower `laser.pattern` 55 -> 40 |
| Damage too weak or too strong | `damage.pattern` 65 -> 50-90 |
| Death too similar to damage | `death.pattern` 110 -> 160-220, or a list such as `[110, 50, 80]` (a stutter) |
| Everything too busy | raise `MEDIUM_PRIORITY_GAP_MS` (80 -> 150) or the cooldowns; or remove the Laser effect (set its cooldown very high) |
| Everything blurred together | lengthen the gap and the death pattern; keep boost and laser short |
