import Phaser from 'phaser';
import { getAudio, type AudioDirector } from '../audio/phaserAudio';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import { GameSim } from '../core/game';
import { NO_INPUT } from '../core/player';
import { getHeldKeys } from '../input/gameKeys';
import type { HeldKeys } from '../input/heldKeys';
import {
  keyDiagnosticsEnabled,
  mountKeyDiagnostics,
  PHASER_KEY_NAMES,
  type MountedDiagnostics,
} from '../input/keyDiagnostics';
import { createKeyPressDispatcher } from '../input/keyPress';
import { readPlayerInput, SOLO_KEYS } from '../input/keyboardControls';
import { drawStarfield, drawWorld } from '../render/worldRenderer';
import { AbilityHud, ComboHud, Hud, KillStreakBanner, Overlay } from '../ui/hud';
import { addText, COLORS } from '../ui/text';
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
  private abilityHud!: AbilityHud;
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
  /** Only present with `?keydebug`. */
  private keyDiag: MountedDiagnostics | null = null;
  private phaserDiagKeys: Array<[string, Phaser.Input.Keyboard.Key]> = [];
  private audio!: AudioDirector;
  private volumePanel!: VolumePanel;

  constructor() {
    super(SCENE_GAME);
  }

  init(): void {
    // State lives in init(), not the constructor, so every restart begins clean.
    this.sim = new GameSim();
    this.paused = false;
    this.lastFrameTime = null;
    this.retryReady = null;
  }

  create(): void {
    this.starGfx = this.add.graphics().setDepth(0);
    this.worldGfx = this.add.graphics().setDepth(1);
    this.hud = new Hud(this);
    this.abilityHud = new AbilityHud(this);
    this.comboHud = new ComboHud(this);
    this.streakBanner = new KillStreakBanner(this);
    this.audio = getAudio(this);
    this.audio.startMusicWhenUnlocked();

    this.pauseOverlay = new Overlay(this, 0.59, 72, CENTER_Y - 80, 3);
    this.pauseOverlay.setTitle('PAUSED');
    this.pauseOverlay.setLine(0, 'Press P to Resume', CENTER_Y + 10, COLORS.hint, 28);
    // Line 1 (music toggle) is refreshed every frame in updateOverlays.
    this.pauseOverlay.setLine(2, 'Press ESC for Main Menu', CENTER_Y + 240, COLORS.dim, 22);
    this.volumePanel = new VolumePanel(this, this.audio, CENTER_X, CENTER_Y + 105, 24, 34, 21);
    this.volumePanel.setVisible(false);

    this.gameOverOverlay = new Overlay(this, 0.7, 54, CENTER_Y - 250, 4);
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

    const input = sim.isGameOver ? NO_INPUT : readPlayerInput(this.held, SOLO_KEYS);
    if (!this.paused) {
      const events = sim.step(dt, input);
      this.audio.sfx.handle(events);
      this.applyShake();
    }
    this.keyDiag?.update({
      phaserHeld: this.phaserDiagKeys.filter(([, key]) => key.isDown).map(([name]) => name),
      trackerHeld: this.held.snapshot(),
      input,
      sim: {
        rotation: sim.player.rotation,
        boostActive: sim.player.boost.active,
        canShoot: sim.player.canShoot,
        shootTimer: sim.player.shootTimer,
        shots: sim.shots.length,
      },
    });

    drawStarfield(this.starGfx, sim.starfield);
    drawWorld(this.worldGfx, sim, time);
    this.hud.update(sim);
    this.abilityHud.update(sim, time);
    this.comboHud.update(sim);
    this.streakBanner.update(sim);
    this.audio.music.setGamePaused(this.paused);
    this.audio.music.setMegaPowerActive(sim.player.megaPower.active);
    this.updateOverlays();
  }

  // --- input ----------------------------------------------------------------

  private setupInput(): void {
    this.held = getHeldKeys(this);
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
        Enter: () => this.retry(),
      }),
    );
    this.retryButton.setInteractive({ useHandCursor: true });

    if (keyDiagnosticsEnabled(window.location.search)) {
      this.keyDiag = mountKeyDiagnostics(window, SOLO_KEYS);
      this.phaserDiagKeys = [...new Set(Object.values(PHASER_KEY_NAMES))].map((name) => [name, keyboard.addKey(name, false)]);
    }
  }

  /**
   * Laser and boost fire once per key *press*. A key that is already down when a run starts or play resumes (held
   * through a retry, or pressed while paused) must not count as a fresh press, so mark it as already used.
   */
  private ignoreHeldAbilityKeys(): void {
    const input = readPlayerInput(this.held, SOLO_KEYS);
    this.sim.player.laser.keyHeld = !!input.laser;
    this.sim.player.boost.keyHeld = !!input.boost;
  }

  private togglePause(): void {
    if (this.sim.isGameOver) return;
    this.paused = !this.paused;
    // Held movement keys are deliberately NOT reset: the keyboard has not released them, so play resumes with them held.
    if (!this.paused) this.ignoreHeldAbilityKeys();
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
    const events = this.game.events;
    events.on(Phaser.Core.Events.BLUR, autoPause);
    events.on(Phaser.Core.Events.HIDDEN, autoPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
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
    this.volumePanel.setVisible(showPause);
    if (showPause) {
      const music = this.audio.music.isMuted ? 'Off' : 'On';
      this.pauseOverlay.setLine(1, `Press M to Toggle Music (${music})`, CENTER_Y + 55, COLORS.dim, 22);
      this.volumePanel.update();
    }
    this.gameOverOverlay.setVisible(over);
    this.retryButton.setVisible(over);
    this.retryLabel.setVisible(over);
    if (!over) return;

    const sim = this.sim;
    const ready = sim.retryDelay <= 0;
    this.gameOverOverlay.setLine(0, `Player 1: ${sim.player.score}`, CENTER_Y - 190, COLORS.player1, 30);
    if (ready !== this.retryReady) {
      this.retryReady = ready;
      this.retryButton.setFillStyle(ready ? 0x646464 : 0x3c3c3c).setStrokeStyle(3, ready ? 0xffffff : 0x646464);
      this.retryLabel.setColor(ready ? COLORS.white : '#969696');
    }
    this.gameOverOverlay.setLine(
      1,
      ready ? 'Press R or click RETRY' : `Wait ${Math.floor(sim.retryDelay) + 1}...`,
      CENTER_Y + 220,
      ready ? COLORS.hint : '#969696',
      28,
    );
    this.gameOverOverlay.setLine(2, 'Press ESC for Main Menu', CENTER_Y + 260, COLORS.dim, 20);
  }
}
