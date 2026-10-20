# Mobile touch controls (Phase 6 prototype, plus D-pad and fullscreen)

A playable, landscape-first, one-player touchscreen version of the Phaser game, on the same page and the same URL as the desktop
game. It is a **prototype**: it has been exercised in Chromium's touch emulation and in unit tests, **not on a physical phone**. See
[Manual testing](#manual-testing-on-a-real-phone) for what still has to be checked by a person.

Nothing in `src/core/` knows about touch. Touch is one more input source producing the same `PlayerInput` the keyboard and gamepad
produce; scoring, physics, collisions, difficulty, UFOs, power-ups and audio mixing are untouched.

**Second pass (after a first real-phone test):** analogue steering was awkward for manoeuvring while moving and shooting, so there is now a selectable digital
**D-pad** next to the original joystick (see [D-pad](#d-pad-the-second-steering-control) and [Choosing the steering control](#choosing-the-steering-control)), and a **Fullscreen**
button for supported browsers with a Home Screen tip where fullscreen is impossible (see [Fullscreen](#fullscreen)). Both are input / presentation only: `src/core/` is untouched.
Status: automated checks pass (below); **neither has been tried on a physical phone yet**, and fullscreen has not been tried on HTTPS. The script to do that is
[Phone test script](#phone-test-script-d-pad-joystick-and-fullscreen).

## What the player sees

**Title screen (touch mode):** a short how-to, the five power-ups, a big **TAP TO PLAY** button, Music / SFX volume with `-` / `+`
buttons and a music on / off button, the **STEERING: JOYSTICK | D-PAD** choice, a **CONTROLS: TOUCH (tap for keyboard)** button (it takes **two taps**: the first only asks "TAP AGAIN TO SWITCH TO KEYBOARD CONTROLS", and the question lapses after 3 s), and a small **FULLSCREEN** button at the top right. There is deliberately no "tap anywhere to
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
| Steering zone (joystick mode) | left 46 % of the screen; a faint **STEER** ring marks the usual spot | A floating joystick appears under the thumb wherever it lands. Drag left / right to rotate, up / down to fly forward / backward, diagonally to do both. Lift to stop. |
| **D-pad** (D-pad mode, replaces the zone) | lower left, a round pad about 170 CSS px | Digital: Up forward, Down back, Left / Right rotate, corners do both with one thumb. Lift to stop. |
| **FIRE** | bottom right, largest (about 110 CSS px on a phone) | Hold to shoot continuously (no tapping). Works with steering. |
| **LASER** | left of FIRE (about 70 CSS px) | Laser Beam, one beam per press. Shows the charges left; dimmed at 0 or during the cooldown. |
| **BOOST** | above FIRE (about 70 CSS px) | Boost, one activation per press. Shows READY, or the seconds left while active / cooling down. |
| **PAUSE** | top right (52 CSS px) | Pauses. It fires on *release* of a tap, so brushing it does nothing. |

**Pause screen:** RESUME, MAIN MENU, the STEERING choice, Music and SFX `-` / `+`, music on / off, and the FULLSCREEN button. **Game over:** RETRY (disabled for the short delay
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

## D-pad (the second steering control)

The analogue joystick was awkward for manoeuvring while moving and shooting (it is easy to over-steer and start spinning), so there is
now a **digital D-pad** as an alternative. Same commands as the keyboard's W / A / S / D, exactly: nothing analogue, and no change to
rotation speed, acceleration or any other gameplay constant (`src/core/` is untouched).

```
   lower left of the landscape screen          one round touch target, about 170 CSS px on a phone
        .-----------.
      /     [ ^ ]     \      Up    = thrust forward  (the way the ship is FACING, not toward the thumb)
     |  [ < ] ( ) [ > ] |    Down  = move backward
      \     [ v ]     /      Left  = rotate counterclockwise     Right = rotate clockwise
        '-----------'        corners = both: Up + Left, Up + Right, Down + Left, Down + Right
```

| Thumb on the pad | `PlayerInput` | Same as keys |
| --- | --- | --- |
| Up | `move 1` | W |
| Down | `move -1` | S |
| Left | `rotate -1` | A |
| Right | `rotate 1` | D |
| Up + Left / Up + Right | `move 1`, `rotate -1` / `1` | W + A / W + D |
| Down + Left / Down + Right | `move -1`, `rotate -1` / `1` | S + A / S + D |
| Hub (centre) | neutral | none |

The output is **digital**: each axis is -1, 0 or 1 whatever the pressure or distance. A test builds the command for all eight directions and
checks it equals what `readPlayerInputs` produces for the matching keys, and that a scripted run ends in exactly the same ship state as the keys.

### How one thumb gets diagonals

The whole disc is a single control (not four small buttons). The direction is computed from where the thumb is, relative to the pad's centre
(`dpadDirection` in `src/input/touchModel.ts`, a pure function):

- **Eight equal 45 degree sectors**: Up, Up + Right, Right, ... so a diagonal is exactly as easy to hit as a straight direction. An axis switches on
  when the thumb is 22.5 degrees past the other axis (`tan 22.5 = 0.414`).
- **A little hysteresis**: an axis that is already on stays on until the thumb is about 19.8 degrees from the other axis (`0.36`). Sliding along a
  boundary therefore does not flicker between two directions; the sectors you are *in* are about 2.7 degrees wider than the ones you would enter.
- **Dead zone**: inside 22 % of the radius the pad is neutral, so a thumb resting on the hub does nothing. A direction that is already held survives
  down to 14 %, again to stop flicker at the edge.
- **Sliding between directions** never needs a lift: the direction follows the thumb (Up -> Up + Right -> Right ...). Crossing the hub passes
  through neutral for a moment. A full sweep around the pad visits the eight sectors in order, once each (unit and browser tested).
- **Sliding outside the control**: the finger stays bound to the pad from the moment it lands (like every control), and the direction keeps
  following its *angle from the pad's centre* wherever the thumb is on the screen. A thumb that drifts off the edge of the pad while turning keeps
  turning; it does not stop dead. Lifting anywhere releases. (A thumb dragged across the playfield therefore still steers; that is deliberate.)
- **Short taps** act on the first event (no move needed), so a quick tap on Left is a quick, repeatable nudge; releasing is neutral at once.
- **One finger** steers; a second finger on the pad is ignored and never tracked. FIRE / LASER / BOOST / PAUSE are separate controls on their own
  fingers, so the pad works together with all of them (multi-touch is tested with four real simultaneous touches).
- **Pressed feedback**: each lit arm is brighter with a dark chevron, so Up + Left lights exactly the Up and Left arms.
- The pad's rectangle is read at the moment of the touch, on every move and on resize, so a pad that has moved or resized (fullscreen) is aimed
  correctly and a held thumb is re-aimed instead of keeping a stale direction.

Release, cancel, lost pointer capture, pause, game over, window blur, a hidden tab, `pagehide`, a portrait <-> landscape flip and entering or
leaving fullscreen all return everything to neutral at once, like the joystick. The page cannot scroll or zoom under the pad (`touch-action: none`).

Size: `clamp(132px, 44vh, 188px)`, i.e. 171 CSS px on a 390 px-tall phone; larger than FIRE because the thumb lives on it. It sits at the
lower left inside the safe-area inset, clear of the HUD text, FIRE, LASER, BOOST and PAUSE (checked on six phone / tablet sizes).

## Choosing the steering control

- **Where:** the **STEERING: JOYSTICK | D-PAD** row on the title screen (below the volume controls) and on the pause screen (below MAIN MENU). Both
  options are always visible, the chosen one is lit green with a gold outline, and a switch is one tap that applies at once.
- **Remembered:** `localStorage` key `asteroids.touchSteering` (`joystick` or `dpad`). Anything else in storage is ignored. With storage blocked (a private window)
  the choice still applies for the visit and is just not remembered. **The default is the D-pad** (`DEFAULT_STEERING` in `src/input/steeringMode.ts`; after a phone test it
  gave much better control than the joystick): a first-time visitor gets it, and nothing is written to storage until someone actually taps a choice. **A saved choice always wins**:
  anyone who picked the joystick (saved as `joystick`) keeps it, and an unreadable or unknown stored value falls back to the D-pad. The joystick stays one tap away on the title and
  pause screens (a unit test and the browser suite both check that a saved `joystick` is not overridden).
- **Switching** lets go of every finger and removes the inactive control from the screen: the joystick zone and its STEER ring are `display: none` in D-pad
  mode, the pad is `display: none` in joystick mode, and the model refuses a press on the control that is not live. The title screen's how-to text follows
  the choice.
- The analogue joystick is unchanged (same mapping, radius, dead zone and tests). Keyboard and controller mappings are not affected: the choice only decides
  which on-screen control is live.

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
keyboard screen: a big green **TOUCH CONTROLS: OFF / TAP TO TURN ON** button at the top right (full thumb size, at least 44 CSS px tall; it used to be 16 px text that fingers
missed). A desktop without touch never sees it. **On a phone (primary pointer is a finger) a tap on empty space does not start a game from the keyboard title screen**, because that
mode has no touch controls to steer with; Space or a controller starts it, and the prompt says "Press SPACE to start". A stray thumb therefore cannot put the phone on a screen with no
touch controls (the switch to the keyboard takes two taps) and cannot start a run nobody can steer; if it happens anyway, the big button is the way back, and `?touch=1` also works. In touch mode the
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

## Fullscreen

The point is a bigger landscape playfield: with the browser's address bar and navigation hidden, the 16:9 canvas can grow. It uses the standard
Fullscreen API only (plus the old `webkit` prefix where a browser still wants it) and never tries to get around a browser or OS restriction.
Code: `src/input/fullscreen.ts` (pure, tested with a fake document), `src/ui/systemOverlay.ts` (the DOM button).

**Where it is:** a small **FULLSCREEN** button at the top right, shown over the **title screen** and the **pause screen** only (not during play,
which keeps the playfield clear, and not on game over). It reads **EXIT FULLSCREEN** while fullscreen. It is plain DOM rather than a Phaser button
on purpose: the browser only grants fullscreen from a genuine user-activation event, and the button calls `requestFullscreen()` *synchronously* inside
its touch `pointerup` (a mouse uses `click`); Phaser delivers input a frame later. The browser suite records `navigator.userActivation.isActive` and the
event type at the moment of the call and asserts both.

| What the browser says | What the player sees |
| --- | --- |
| `document.fullscreenEnabled` true and the element can be asked (Android Chrome, desktop, iPad via the `webkit` names) | **FULLSCREEN** / **EXIT FULLSCREEN** |
| Request rejected, throws, or `fullscreenerror` | the button reads **FULLSCREEN BLOCKED** (red) for about 2.6 s, then is usable again; the game is unaffected, nothing is thrown |
| `fullscreenEnabled` missing or false, or no `requestFullscreen` (iPhone Safari, a page in an iframe without permission) | **no Fullscreen button.** A **HIDE ADDRESS BAR** button opens a short tip: *add the game to your Home Screen (Share, then Add to Home Screen) and open it from the new icon* |
| Already running as an installed web app (`display-mode: standalone` / `navigator.standalone`) | nothing: there is no address bar to hide |

- **What goes fullscreen:** the root `<html>` element, so the canvas, the touch overlay, the Fullscreen / tip controls, the rotate prompt and every menu
  (the HUD and menus are drawn in the canvas) are all inside it.
- **State is read from the document** (`fullscreenElement`) and tracked through `fullscreenchange` / `webkitfullscreenchange`, so leaving by the system gesture
  (Android back swipe, Esc) is noticed and the button label follows.
- **Layout after a change:** the controls are CSS-fixed to the viewport and follow it by themselves; Phaser's `FIT` scale is told to re-fit three times
  (immediately, +120 ms, +400 ms) because some browsers finish resizing after the event. The stick radius follows the new height. Held fingers are released
  (the layout is moving under them), exactly as for a rotation. Safe-area insets (`env(safe-area-inset-*)`) position the controls, the canvas container, the
  Fullscreen button and the tip.
- **State is preserved:** entering or leaving fullscreen never restarts the scene, never resumes a paused game and never pauses a running one (tested: the same
  `GameSim` object before and after, still paused, RESUME still works). If the system leaves fullscreen mid-run the run simply continues with the controls neutral.
- No orientation lock is requested (still the "Rotate your phone" prompt), no PWA / manifest / service worker is added in this pass: see
  [standalone-web-app.md](standalone-web-app.md) for the possible future configuration.

### What is and is not verified for fullscreen

| | Verified how |
| --- | --- |
| Support detection (available / disabled / iPhone-like / webkit names / standalone), request accepted / rejected / throws / `fullscreenerror`, enter, exit, system exit, duplicate events, cleanup | 29 unit tests with a fake document (`tests/fullscreen.test.ts`) |
| Button wording, the Home Screen tip, the call made inside a real touch's `pointerup` with user activation, refusals shown and cleared, unsupported and standalone cases, canvas re-fit and controls after the viewport changes, pause state kept, no console errors | Browser suite against a **scripted** Fullscreen API in Chromium touch emulation |
| Real `requestFullscreen()` from a real (emulated) touch in headless Chromium: root element becomes fullscreen, button flips, canvas keeps 16:9, exit works | Browser suite; **headless Chromium only** (the window does not actually grow, so it cannot show the address bar disappearing) |
| The address bar really disappearing, the playfield really growing, Android's fullscreen behaviour (including the system's "swipe to exit" hint), notch / gesture-bar insets in fullscreen | **Not verified. Needs a real Android phone** (script below) |
| iPhone: that no Fullscreen button appears and the tip is readable; that Add to Home Screen really opens without Safari's bar | **Not verified. Needs a real iPhone.** On older iOS the Home Screen launch may still open in Safari until the standalone configuration is added (see standalone-web-app.md) |
| HTTPS | The Fullscreen API is not restricted to secure contexts in Chromium, so the **http://LAN-IP** test should work, but that is not confirmed on a phone. Things to re-check on the **HTTPS GitHub Pages** build: that fullscreen enters and exits; that audio still unlocks and plays after entering fullscreen; that Add to Home Screen launches standalone (iOS); that nothing is blocked by a permissions policy. None of these can be tested before the branch is deployed, so they are on the checklist, not claimed. |

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

- **iOS Safari (iPhone)** has no Fullscreen API for pages: there is no Fullscreen button there, only a tip about Add to Home Screen. Whether a Home Screen launch really hides
  the bar depends on the iOS version and on the standalone configuration that is *not* added yet ([standalone-web-app.md](standalone-web-app.md)). **Android Chrome** can go
  fullscreen through the new button, **not yet tried on a phone**.
- Audio needs a real touch: the first tap (TAP TO PLAY) unlocks it, via Phaser's own touchend unlock. Verified in Chromium; **iOS Safari is the browser most likely to behave differently, and the silent switch / ringer mode can mute Web Audio there.**
- Mobile browsers may reserve edge swipes (back / forward gestures, notification shade). FIRE sits 18 px (plus safe area) from the right edge to stay clear; a system gesture
  cancels the touch, which the game treats as a release.
- Browser touch emulation does not reproduce palm rejection, finger size, multi-touch limits of real hardware (some budget phones track 5 fingers) or latency.
- No haptics, no remappable layout, left-handed mirror or button-size setting.
- The D-pad is a fixed pad in the lower left: no left-handed mirror, no size or position setting, no haptics. Its arms are drawn for the eye; the whole disc is the target.
- A thumb that slides off the pad keeps its direction by angle until it lifts (deliberate; see D-pad). If that feels wrong on a phone it is one rule to change.
- The Fullscreen button is only offered on the title and pause screens, not during play; there is no automatic fullscreen and no orientation lock.
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
| D-pad: direction maths (eight sectors, boundaries, dead zone, hysteresis, sweeps), digital output, one finger, sliding, sliding outside, release / cancel, FIRE / LASER / BOOST together, mode switching, a real `GameSim` driven by it (identical to the keys) | `tests/touchDpad.test.ts` | 47 tests |
| D-pad through the binding and facade: taps, slides, cancel, lost capture, blur / hidden / pagehide, rotation, resize, fullscreen change, pause / restart, switching mode mid-hold, listener cleanup | `tests/touchDpadControls.test.ts` | 32 tests |
| Steering choice: D-pad default, a saved joystick / D-pad choice is never overridden, persistence, junk and blocked storage, listeners | `tests/steeringMode.test.ts` | 8 tests |
| Tap-again confirmation for the keyboard switch (arms, confirms inside 3 s, lapses, clock going backwards) | `tests/confirmTap.test.ts` | 5 tests |
| Fullscreen: support detection (incl. iPhone-like, webkit names, standalone), request accepted / rejected / throws / `fullscreenerror`, enter, exit, system exit, button wording, cleanup | `tests/fullscreen.test.ts` | 29 tests |
| Real browser, genuine multi-touch (CDP `Input.dispatchTouchEvent`, 4 fingers at once), mobile emulation DPR 2: everything above on real touches, plus D-pad / fullscreen sections | `npm run test:touch` | 208 checks (101 before the D-pad pass) |

The browser suite covers: load, touch-only start, audio unlock by touch, overlay in landscape, layout and 44 px targets on six phone / tablet
sizes, HUD visible, steering changes the simulation input, FIRE held while steering, LASER and BOOST with other fingers down,
slide / release-outside / cancel, pause with fingers down and no ghost tap, volume and mute by touch, resume, portrait prompt and
back (same run, still paused), focus loss, game over, RETRY with a resting finger, MAIN MENU, listener build-up, mode switch and
persistence, `?touch=0`, portrait-at-load with a tap through the prompt, scroll / overflow, console errors, audio files and the CSS asset
loading, and that the desktop title, pause screen, HUD size, `touch-action` and canvas size are unchanged. Screenshots go to
`scripts/.smoke-output/touch-*.png`.

The D-pad and fullscreen sections add: the steering choice on the title and pause screens, saved and restored across reloads (and junk / blocked storage), the pad's layout, size and clearance on six phone / tablet sizes with screenshots, all eight directions on real touches, a one-thumb sweep, sliding outside, short taps, multi-touch with FIRE / LASER / BOOST, cancel, pause, blur, rotation, game over and RETRY with a resting thumb, switching mode while fingers are down; a scripted Fullscreen API (accept, reject, throw, `fullscreenerror`, exit, system exit, pause state kept, canvas re-fit, user activation inside the gesture), the unsupported (iPhone-like) and standalone cases, the real Fullscreen API of headless Chromium, and desktop showing none of it. Screenshots: `scripts/.smoke-output/touch-dpad-*.png`, `touch-fullscreen-*.png`.

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
- [ ] **Mode switch:** on the title screen CONTROLS asks "TAP AGAIN" first, and a second tap switches to the keyboard screen; there the big green TOUCH CONTROLS button brings touch back, tapping elsewhere does not start a game; the choice survives a reload.

Please report: phone model, browser and version, what felt wrong, and (if you can) a screenshot.

## Phone test script: D-pad, joystick and fullscreen

Serve the build to the phone exactly as in [Manual testing](#manual-testing-on-a-real-phone) (`npm run build`, then `npm run preview:lan`, then
`http://<your PC's address>:4173/` on the phone). Hold the phone in landscape. Nothing here deploys anything.

**A. D-pad (5 minutes)**

1. On the title screen find **STEERING** (below the volume controls). **D-PAD is lit by default** (green with a gold outline; the how-to text on the left says
   "D-PAD: UP = forward ..."), unless you saved the joystick earlier: your saved choice is kept. Tap **JOYSTICK** and back to **D-PAD** to see it switch; reload the
   page and the last one you tapped should still be lit.
2. Tap **TAP TO PLAY**. The lower left shows a round pad with four arms; there is no STEER ring.
3. *Directions.* Tap and hold **Up**: the ship flies forward. Tap **Left** / **Right**: it turns. While it faces some other way, hold Up again: it must fly the way
   it is *facing*, not toward your thumb.
4. *Diagonals with one thumb.* Put the thumb between Up and Left, then between Up and Right: the ship should thrust **and** turn, and exactly the two neighbouring
   arms light up. Slide the thumb slowly around the whole pad without lifting: the direction should change in order, with no flicker at the edges. Can you hold
   a gentle curve while circling an asteroid?
5. *Small corrections.* Quick taps on Left / Right should nudge the ship by a small, repeatable amount. Does a tap ever feel missed, or too big?
6. *Moving while shooting.* Hold **FIRE** with the right thumb and steer with the left for 30 s. Neither should ever drop out. Add **LASER** and **BOOST**: they should
   work while you hold the pad.
7. *Sliding off.* While turning, let the thumb drift off the edge of the pad: it should keep the direction until you lift (then stop at once). Does that feel
   right, or would you rather it stopped when you leave the disc? (Tell me: it is one rule in `touchModel.ts`.)
8. *Sizing.* Is the pad big enough / too big? Does it cover anything you need (asteroids at the lower left, the HUD)? Do your thumbs reach FIRE and the pad without shifting your grip?
9. *Let go.* Lift the thumb mid-turn: turning stops immediately, nothing stays held.

**B. Joystick (still available, unchanged, 2 minutes)** Pause (top right), tap **JOYSTICK** under MAIN MENU, **RESUME**. The STEER ring is back; drag as before. It should feel exactly as it did
before. Switch back and forth a couple of times from the pause screen: nothing should stay held, and each switch should hide the other control.

**C. Fullscreen (Android Chrome)**

1. On the title screen tap **FULLSCREEN** (top right). The address bar and navigation should disappear (Chrome may show a brief "swipe to exit" hint) and the game should grow.
   Check: the canvas is not stretched, FIRE / LASER / BOOST / PAUSE and the pad are all visible and not under a notch or the gesture bar, the HUD is readable.
2. Play for a minute in fullscreen with the D-pad, then pause, tap **EXIT FULLSCREEN**: the game must stay paused (not restart, not resume). Tap **RESUME**.
3. Enter fullscreen again from the pause screen: still paused, same run. Swipe from the edge to leave fullscreen: nothing should restart, nothing should stay held.
4. Rotate to portrait in fullscreen and back: the prompt appears and the game pauses; it stays paused when you turn back.
5. If **FULLSCREEN BLOCKED** ever appears, note when (it means the browser refused).
6. Repeat once with the build from **HTTPS** (GitHub Pages after you decide to publish, or a tunnel) and note any difference, including whether the music still plays.

**D. iPhone Safari**

1. There must be **no FULLSCREEN button**. There should be **HIDE ADDRESS BAR** (top right). Tap it: a short tip about Add to Home Screen appears; **OK** closes it.
2. Follow the tip (Share, Add to Home Screen) and launch from the icon. Does the game open without Safari's bar? (On older iOS it may still open in Safari: that needs
   the standalone configuration in [standalone-web-app.md](standalone-web-app.md); please tell me what you see and your iOS version.) When it opens as a web app, the
   HIDE ADDRESS BAR button should be gone and the game should use the whole screen; check the notch and the home-indicator area.

Report: phone and browser versions, which scheme you preferred and why, anything that felt twitchy, and any screenshot of the layout in fullscreen.

## Suggested next steps (not done)

Based on what usually goes wrong with on-screen controls, in rough order: (1) tune stick radius and dead zone on a real thumb; (2) a left-handed
mirror and a button-size setting; (3) an auto-fire option, only if holding FIRE is tiring (it is not the default, as specified); (4) (done:
fullscreen button; still to verify on Android and iPhone); (5) a haptic tick on LASER / BOOST via `navigator.vibrate` (Android only); (6) an in-game one-time control hint
over the first seconds of play; (7) a preview deployment for pull requests so phones can test without a tunnel.
