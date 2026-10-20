import Phaser from 'phaser';
import { getAudio, type AudioDirector } from '../audio/phaserAudio';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import { GameSim, type SimEvent } from '../core/game';
import { NO_INPUT, type PlayerInput } from '../core/player';
import { getSetup, simConfigOf } from '../gameSetup';
import { getGamepadHub } from '../input/gameGamepads';
import { getHeldKeys } from '../input/gameKeys';
import { getSteering, getTouchControls } from '../input/gameTouch';
import type { GamepadHub } from '../input/gamepadHub';
import type { HeldKeys } from '../input/heldKeys';
import type { TouchControls } from '../input/touchControls';
import {
  keyDiagnosticsEnabled,
  mountKeyDiagnostics,
  PHASER_KEY_NAMES,
  type MountedDiagnostics,
} from '../input/keyDiagnostics';
import { createKeyPressDispatcher } from '../input/keyPress';
import { keySchemesFor, type KeyScheme } from '../input/keyboardControls';
import { readPlayerInputs } from '../input/playerInputs';
import { drawStarfield, drawWorld } from '../render/worldRenderer';
import { AbilityHud, ComboHud, Hud, KillStreakBanner, Overlay, playerColor, TeamHud, TOUCH_HUD_SCALE } from '../ui/hud';
import { addText, COLORS } from '../ui/text';
import { abilityLabels } from '../ui/touchLabels';
import { TouchGameOverButtons, TouchPauseMenu } from '../ui/touchMenus';
import { VolumePanel } from '../ui/volumePanel';
import { SCENE_GAME, SCENE_START } from './keys';

const CENTER_X = SCREEN_WIDTH / 2;
const CENTER_Y = SCREEN_HEIGHT / 2;

/**
 * Owns one `GameSim` per run and is only glue: it reads input, steps the simulation, draws the
 * result and shows pause / game-over overlays. Restarting re-enters this scene, which builds a
 * brand-new simulation, display list and set of listeners.
 */
export class GameScene extends Phaser.Scene {
  /** Public so the dev/test hook (`?debug`) and browser automation can inspect game state. */
  sim!: GameSim;

  private paused = false;
  /** Timestamp of the previous frame (ms); null until the first frame of a run. */
  private lastFrameTime: number | null = null;
  private starGfx!: Phaser.GameObjects.Graphics;
  private worldGfx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private abilityHuds: AbilityHud[] = [];
  private teamHud: TeamHud | null = null;
  private comboHud!: ComboHud;
  private streakBanner!: KillStreakBanner;
  private pauseOverlay!: Overlay;
  private gameOverOverlay!: Overlay;
  private retryButton!: Phaser.GameObjects.Rectangle;
  private retryLabel!: Phaser.GameObjects.Text;
  /** Last RETRY-button state drawn, so its Text is only restyled when it changes. */
  private retryReady: boolean | null = null;
  /** Game-wide held keys (see heldKeys.ts); survives pause, retry and scene changes. */
  private held!: HeldKeys;
  /** Game-wide gamepad hub (see gamepadHub.ts): another input source for the same players. */
  private pads!: GamepadHub;
  /** Set when an assigned controller disappears mid-run; shown on the pause screen until play resumes. */
  private padNote = '';
  /** Only present with `?keydebug`. */
  private keyDiag: MountedDiagnostics | null = null;
  private phaserDiagKeys: Array<[string, Phaser.Input.Keyboard.Key]> = [];
  private audio!: AudioDirector;
  private volumePanel!: VolumePanel;
  /** Key scheme of each player, in player order (one for a one-player game). */
  private schemes: readonly KeyScheme[] = [];
  /** Game-wide touch controls (see touchControls.ts): inert and invisible unless touch mode is on. */
  private touch!: TouchControls;
  /** Touch mode for this run: decided when the run starts (the mode can only be changed on the title screen). */
  private touchUi = false;
  private touchPause: TouchPauseMenu | null = null;
  private touchOver: TouchGameOverButtons | null = null;
  /** Last pause-menu state shown, so its buttons are only toggled when it changes. */
  private touchPauseShown = false;

  constructor() {
    super(SCENE_GAME);
  }

  init(): void {
    // State lives in init(), not the constructor, so every restart begins clean. The title screen's choices come from the
    // registry; the simulation (and with it every co-op detail) is always built from scratch.
    const setup = getSetup(this.registry);
    const config = simConfigOf(setup);
    this.sim = new GameSim({ config });
    this.schemes = keySchemesFor(config.playerCount, setup.p2Keys);
    this.abilityHuds = [];
    this.teamHud = null;
    this.paused = false;
    this.lastFrameTime = null;
    this.retryReady = null;
    this.padNote = '';
    this.touchPause = null;
    this.touchOver = null;
    this.touchPauseShown = false;
  }

  create(): void {
    this.starGfx = this.add.graphics().setDepth(0);
    this.worldGfx = this.add.graphics().setDepth(1);
    const players = this.sim.players.length;
    this.touch = getTouchControls(this);
    this.touchUi = this.touch.isActive && players === 1;
    const hudScale = this.touchUi ? TOUCH_HUD_SCALE : 1;
    this.hud = new Hud(this, players, hudScale);
    this.abilityHuds = this.sim.players.map((_, i) => new AbilityHud(this, i, hudScale));
    this.teamHud = players > 1 ? new TeamHud(this) : null;
    this.comboHud = new ComboHud(this, players > 1);
    this.streakBanner = new KillStreakBanner(this);
    this.audio = getAudio(this);
    this.audio.startMusicWhenUnlocked();

    // Touch mode keeps the pause title near the top: its buttons fill the middle of the screen.
    this.pauseOverlay = new Overlay(this, 0.59, 72, this.touchUi ? 100 : CENTER_Y - 80, 4);
    this.pauseOverlay.setTitle('PAUSED');
    // Lines 0 (resume), 1 (music toggle), 2 (menu) and 3 (controller note) are refreshed every frame in updateOverlays.
    this.volumePanel = new VolumePanel(this, this.audio, CENTER_X, CENTER_Y + 105, 24, 34, 21);
    this.volumePanel.setVisible(false);

    this.gameOverOverlay = new Overlay(this, 0.7, 54, CENTER_Y - 250, 6);
    this.gameOverOverlay.setTitle('GAME OVER');
    this.retryButton = this.add
      .rectangle(CENTER_X, CENTER_Y + 100, 220, 60, 0x646464)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(21)
      .setVisible(false);
    this.retryButton.on('pointerdown', () => this.retry());
    this.retryLabel = addText(this, CENTER_X, CENTER_Y + 100, 'RETRY', { size: 28, originX: 0.5, originY: 0.5 })
      .setDepth(22)
      .setVisible(false);

    if (this.touchUi) {
      this.touchPause = new TouchPauseMenu(this, this.audio, getSteering(this), { resume: () => this.togglePause(), menu: () => this.toMenu() });
      this.touchOver = new TouchGameOverButtons(this, { retry: () => this.retry(), menu: () => this.toMenu() });
    }

    this.setupInput();
    this.setupLifecycle();
  }

  override update(time: number): void {
    const sim = this.sim;
    // Phaser's own `delta` is smoothed and, for 120 frames after boot or wake-up, clamped to 1/60 s,
    // which would run the game in slow motion on slower displays. The raw frame timestamp gives an
    // exact game clock; `GameSim.step` clamps unusually long frames itself.
    const dt = this.lastFrameTime === null ? 0 : Math.max(0, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;

    this.handlePadPresses();
    const inputs = sim.isGameOver ? this.schemes.map(() => NO_INPUT) : this.readInputs();
    if (!this.paused) {
      const events = sim.step(dt, inputs[0] ?? NO_INPUT, inputs[1] ?? NO_INPUT);
      this.audio.sfx.handle(events);
      this.announce(events, time);
      this.applyShake();
    }
    const [p1, p2] = sim.players;
    this.keyDiag?.update({
      phaserHeld: this.phaserDiagKeys.filter(([, key]) => key.isDown).map(([name]) => name),
      trackerHeld: this.held.snapshot(),
      input: inputs[0] ?? NO_INPUT,
      pad: {
        lines: this.pads.diagnosticLines(this.playerCount),
        driven: [this.pads.padFor(0, this.playerCount) !== null, this.pads.padFor(1, this.playerCount) !== null],
      },
      ...(p2 ? { input2: inputs[1] ?? NO_INPUT, sim2: this.diagSnapshot(p2) } : {}),
      sim: this.diagSnapshot(p1 ?? sim.player),
    });

    drawStarfield(this.starGfx, sim.starfield);
    drawWorld(this.worldGfx, sim, time);
    this.hud.update(sim);
    for (const abilities of this.abilityHuds) abilities.update(sim, time);
    this.teamHud?.update(sim, time);
    this.comboHud.update(sim);
    this.streakBanner.update(sim);
    if (this.touchUi) this.updateTouchControls();
    this.audio.music.setGamePaused(this.paused);
    this.audio.music.setMegaPowerActive(sim.players.some((p) => p.megaPower.active));
    this.updateOverlays();
  }

  /**
   * The on-screen controls are shown only while the run is being played; pausing, game over and leaving the scene take them away
   * (and with them every finger that was on them), so nothing is held into a menu and the canvas gets the menu's taps. The pause
   * screen also shows the system controls (Fullscreen).
   */
  private updateTouchControls(): void {
    const playing = !this.paused && !this.sim.isGameOver;
    this.touch.setLayer(playing ? 'play' : this.paused && !this.sim.isGameOver ? 'menu' : 'off');
    if (playing) this.touch.setAbilities(abilityLabels(this.sim.player));
  }

  /** One input per player: that player's own keys, merged with the controller assigned to them (if any). */
  private readInputs(): PlayerInput[] {
    return readPlayerInputs(this.held, this.pads, this.schemes, this.touchUi ? this.touch : undefined);
  }

  private get playerCount(): 1 | 2 {
    return this.schemes.length === 2 ? 2 : 1;
  }

  /**
   * One-shot controller buttons, from controllers assigned to a player in this game only: START pauses / resumes, A retries
   * after Game Over, BACK returns to the menu (paused or game over), the D-pad adjusts the volumes on the pause screen.
   * Each is a fresh press (up to down); holding a button down never repeats it.
   */
  private handlePadPresses(): void {
    const count = this.playerCount;
    for (const press of this.pads.drainPresses()) {
      if (this.pads.playerOf(press.padKey, count) === null) continue;
      switch (press.button) {
        case 'start':
          this.togglePause();
          break;
        case 'a':
          this.retry();
          break;
        case 'back':
          this.toMenu();
          break;
        case 'up':
          this.adjustVolumes('ArrowUp');
          break;
        case 'down':
          this.adjustVolumes('ArrowDown');
          break;
        case 'left':
          this.adjustVolumes('ArrowLeft');
          break;
        case 'right':
          this.adjustVolumes('ArrowRight');
          break;
        default:
          break;
      }
    }
  }

  private diagSnapshot(p: GameSim['player']): { rotation: number; boostActive: boolean; canShoot: boolean; shootTimer: number; shots: number } {
    return { rotation: p.rotation, boostActive: p.boost.active, canShoot: p.canShoot, shootTimer: p.shootTimer, shots: this.sim.shots.length };
  }

  /** Short on-screen messages for the two co-op moments the HUD alone would make easy to miss. */
  private announce(events: readonly SimEvent[], nowMs: number): void {
    if (!this.teamHud) return;
    for (const event of events) {
      if (event.type === 'player_revived') this.teamHud.flash(`PLAYER ${event.player} IS BACK!`, playerColor(event.player - 1), nowMs);
      else if (event.type === 'player_eliminated') this.teamHud.flash(`PLAYER ${event.player} IS OUT!`, '#ff6464', nowMs);
    }
  }

  // --- input ----------------------------------------------------------------

  private setupInput(): void {
    this.held = getHeldKeys(this);
    this.pads = getGamepadHub(this);
    // A run starts with every controller neutral until its buttons are released: the A that pressed RETRY (or START on the
    // title screen) is also the cannon, and must not fire the moment the run begins. Presses meant for the last scene go too.
    this.pads.disarmAll('run started');
    this.ignoreHeldAbilityKeys();
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    // Gameplay reads `this.held`; Phaser is only asked to stop these keys scrolling / moving focus in the browser.
    keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
    // One-shot keys go through a dispatcher that ignores replayed events and auto-repeat (see keyPress.ts).
    keyboard.on(
      Phaser.Input.Keyboard.Events.ANY_KEY_DOWN,
      createKeyPressDispatcher({
        KeyP: () => this.togglePause(),
        KeyM: () => this.audio.music.toggleMuted(),
        ArrowUp: () => this.adjustVolumes('ArrowUp'),
        ArrowDown: () => this.adjustVolumes('ArrowDown'),
        ArrowLeft: () => this.adjustVolumes('ArrowLeft'),
        ArrowRight: () => this.adjustVolumes('ArrowRight'),
        Escape: () => this.toMenu(),
        KeyR: () => this.retry(),
        // Enter is Player 2's cannon in a two-player game, so it only retries a one-player run.
        Enter: () => {
          if (this.sim.players.length === 1) this.retry();
        },
      }),
    );
    this.retryButton.setInteractive({ useHandCursor: true });

    if (keyDiagnosticsEnabled(window.location.search)) {
      this.keyDiag = mountKeyDiagnostics(window, this.schemes[0] as KeyScheme, this.schemes[1] ?? null);
      this.phaserDiagKeys = [...new Set(Object.values(PHASER_KEY_NAMES))].map((name) => [name, keyboard.addKey(name, false)]);
    }
  }

  /**
   * Laser and boost fire once per key *press*. A key that is already down when a run starts or play resumes (held
   * through a retry, or pressed while paused) must not count as a fresh press, so mark it as already used.
   */
  private ignoreHeldAbilityKeys(): void {
    const inputs = this.readInputs();
    this.sim.players.forEach((player, i) => {
      player.laser.keyHeld = !!inputs[i]?.laser;
      player.boost.keyHeld = !!inputs[i]?.boost;
    });
  }

  private togglePause(): void {
    if (this.sim.isGameOver) return;
    this.paused = !this.paused;
    // Touch is different from keys: a finger that was steering has no state to resume, so every touch is let go on pause.
    if (this.paused) this.touch.releaseAll();
    // Held movement keys are deliberately NOT reset: the keyboard has not released them, so play resumes with them held.
    if (!this.paused) {
      this.padNote = '';
      this.ignoreHeldAbilityKeys();
    }
  }

  /** The arrow keys also steer the ship, so they only work the volume controls on the pause screen. */
  private adjustVolumes(code: string): void {
    if (this.paused && !this.sim.isGameOver) this.volumePanel.handleKey(code);
  }

  private toMenu(): void {
    if (this.paused || this.sim.isGameOver) this.scene.start(SCENE_START);
  }

  private retry(): void {
    if (this.sim.isGameOver && this.sim.retryDelay <= 0) this.scene.restart();
  }

  // --- browser lifecycle -----------------------------------------------------

  /** Pauses automatically when the tab is hidden or the window loses focus, and cleans up on shutdown. */
  private setupLifecycle(): void {
    const autoPause = (): void => {
      if (this.sim.isGameOver) return;
      // Keys released while the window was unfocused never send a keyup; HeldKeys forgets them itself on blur / hide.
      this.paused = true;
    };
    // A controller that drives a ship in this run disappearing pauses the game at once (its commands are already neutral),
    // so nobody plays on with a dead ship; reconnecting it hands the ship back, and START resumes.
    const stopPadEvents = this.pads.onEvent((event) => {
      if (event.type === 'connected') this.keyDiag?.note(`controller connected: #${event.pad.index} ${event.pad.name}`);
      else if (event.type === 'disconnected') this.keyDiag?.note(`controller DISCONNECTED: #${event.pad.index} ${event.pad.name}`);
      else if (event.type === 'disarmed') this.keyDiag?.note(`controllers neutral: ${event.reason}`);
      if (event.type !== 'disconnected' || this.sim.isGameOver) return;
      const slot = this.playerCount === 2 ? event.slot : event.soloSlot;
      if (slot === null) return;
      this.paused = true;
      this.padNote = `PLAYER ${slot + 1}'S CONTROLLER DISCONNECTED - plug it in again`;
    });
    // Touch: the PAUSE button pauses; turning the phone upright (the rotate prompt covers the screen) pauses too, and stays paused on return.
    const stopTouchEvents = [
      this.touch.onPauseTap(() => {
        if (this.touchUi && !this.paused) this.togglePause();
      }),
      this.touch.onPortrait(() => autoPause()),
    ];
    const events = this.game.events;
    events.on(Phaser.Core.Events.BLUR, autoPause);
    events.on(Phaser.Core.Events.HIDDEN, autoPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      stopPadEvents();
      for (const stop of stopTouchEvents) stop();
      this.touch.setLayer('off');
      this.keyDiag?.destroy();
      this.keyDiag = null;
      this.phaserDiagKeys = [];
      events.off(Phaser.Core.Events.BLUR, autoPause);
      events.off(Phaser.Core.Events.HIDDEN, autoPause);
      // Leave the shared audio in a neutral state: effects stop, music resumes normal speed and is not held paused.
      this.audio.sfx.stopAll();
      this.audio.music.setGamePaused(false);
      this.audio.music.setMegaPowerActive(false);
    });
  }

  // --- presentation ----------------------------------------------------------

  private applyShake(): void {
    const s = this.sim.isGameOver ? 0 : this.sim.screenShake;
    if (s > 0) this.worldGfx.setPosition(Phaser.Math.FloatBetween(-s, s), Phaser.Math.FloatBetween(-s, s));
    else this.worldGfx.setPosition(0, 0);
  }

  private updateOverlays(): void {
    const over = this.sim.isGameOver;
    const showPause = this.paused && !over;
    this.pauseOverlay.setVisible(showPause);
    this.volumePanel.setVisible(showPause && !this.touchUi);
    // Controller hints appear only while a controller is actually driving a ship in this run.
    const padActive = (showPause || over) && this.padActive();
    if (this.touchUi) {
      if (showPause !== this.touchPauseShown) {
        this.touchPauseShown = showPause;
        this.touchPause?.setVisible(showPause);
      }
      if (showPause) this.touchPause?.update(this.time.now);
    } else if (showPause) {
      this.pauseOverlay.setLine(0, padActive ? 'Press P or START to Resume' : 'Press P to Resume', CENTER_Y + 10, COLORS.hint, 28);
      this.pauseOverlay.setLine(2, padActive ? 'Press ESC or BACK for Main Menu' : 'Press ESC for Main Menu', CENTER_Y + 240, COLORS.dim, 22);
      this.pauseOverlay.setLine(3, this.padNote, CENTER_Y + 205, '#ff6464', 20);
      const music = this.audio.music.isMuted ? 'Off' : 'On';
      this.pauseOverlay.setLine(1, `Press M to Toggle Music (${music})`, CENTER_Y + 55, COLORS.dim, 22);
      this.volumePanel.update();
    }
    this.gameOverOverlay.setVisible(over);
    this.retryButton.setVisible(over && !this.touchUi);
    this.retryLabel.setVisible(over && !this.touchUi);
    this.touchOver?.setVisible(over);
    if (!over) return;

    const sim = this.sim;
    const ready = sim.retryDelay <= 0;
    const coop = sim.players.length > 1;
    this.gameOverOverlay.setLine(0, `Player 1: ${sim.player.score}`, CENTER_Y - 190, COLORS.player1, 30);
    // Two players: both scores, the team total and why the run ended. (Lines 3-5 stay empty in a one-player game.)
    this.gameOverOverlay.setLine(3, coop ? `Player 2: ${sim.player2?.score ?? 0}` : '', CENTER_Y - 150, COLORS.player2, 30);
    this.gameOverOverlay.setLine(4, coop ? `TEAM TOTAL: ${sim.totalScore}` : '', CENTER_Y - 105, COLORS.white, 26);
    const reason = sim.gameOverReason === 'shared_lives_exhausted' ? 'THE SHARED LIVES ARE ALL USED UP' : 'BOTH PLAYERS ARE ELIMINATED';
    this.gameOverOverlay.setLine(5, coop ? reason : '', CENTER_Y - 65, COLORS.dim, 22);
    this.touchOver?.setRetryReady(ready);
    if (ready !== this.retryReady) {
      this.retryReady = ready;
      this.retryButton.setFillStyle(ready ? 0x646464 : 0x3c3c3c).setStrokeStyle(3, ready ? 0xffffff : 0x646464);
      this.retryLabel.setColor(ready ? COLORS.white : '#969696');
    }
    if (this.touchUi) {
      // The buttons say what to do; only the short wait before RETRY works needs words.
      this.gameOverOverlay.setLine(1, ready ? '' : `Wait ${Math.floor(sim.retryDelay) + 1}...`, CENTER_Y + 220, '#969696', 28);
      this.gameOverOverlay.setLine(2, '', CENTER_Y + 260, COLORS.dim, 20);
      return;
    }
    this.gameOverOverlay.setLine(
      1,
      ready ? (padActive ? 'Press R, A or click RETRY' : 'Press R or click RETRY') : `Wait ${Math.floor(sim.retryDelay) + 1}...`,
      CENTER_Y + 220,
      ready ? COLORS.hint : '#969696',
      28,
    );
    this.gameOverOverlay.setLine(2, padActive ? 'Press ESC or BACK for Main Menu' : 'Press ESC for Main Menu', CENTER_Y + 260, COLORS.dim, 20);
  }

  /** Whether a connected controller currently drives a ship in this run. */
  private padActive(): boolean {
    const count = this.playerCount;
    return this.pads.padFor(0, count) !== null || this.pads.padFor(1, count) !== null;
  }
}
