import Phaser from 'phaser';
import { Sfx } from '../audio/sfx';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import { GameSim } from '../core/game';
import { KeyboardControls } from '../input/keyboardControls';
import { drawStarfield, drawWorld } from '../render/worldRenderer';
import { Hud, Overlay } from '../ui/hud';
import { addText, COLORS } from '../ui/text';
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
  private pauseOverlay!: Overlay;
  private gameOverOverlay!: Overlay;
  private retryButton!: Phaser.GameObjects.Rectangle;
  private retryLabel!: Phaser.GameObjects.Text;
  /** Last RETRY-button state drawn, so its Text is only restyled when it changes. */
  private retryReady: boolean | null = null;
  private controls!: KeyboardControls;
  private sfx!: Sfx;

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
    this.sfx = new Sfx(this.sound);

    this.pauseOverlay = new Overlay(this, 0.59, 72, CENTER_Y - 80, 3);
    this.pauseOverlay.setTitle('PAUSED');
    this.pauseOverlay.setLine(0, 'Press P to Resume', CENTER_Y + 10, COLORS.hint, 28);
    this.pauseOverlay.setLine(1, 'Press ESC for Main Menu', CENTER_Y + 60, COLORS.dim, 22);

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

    if (!this.paused) {
      const wasOver = sim.isGameOver;
      const events = sim.step(dt, wasOver ? undefined : this.controls.read());
      this.sfx.handle(events);
      this.applyShake();
    }

    drawStarfield(this.starGfx, sim.starfield);
    drawWorld(this.worldGfx, sim, time);
    this.hud.update(sim);
    this.updateOverlays();
  }

  // --- input ----------------------------------------------------------------

  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.controls = new KeyboardControls(keyboard);
    keyboard.on('keydown-P', () => this.togglePause());
    keyboard.on('keydown-ESC', () => this.toMenu());
    keyboard.on('keydown-R', () => this.retry());
    keyboard.on('keydown-ENTER', () => this.retry());
    this.retryButton.setInteractive({ useHandCursor: true });
  }

  private togglePause(): void {
    if (this.sim.isGameOver) return;
    this.paused = !this.paused;
    if (this.paused) this.input.keyboard?.resetKeys();
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
      this.paused = true;
      // Keys released while the window was unfocused never send a keyup; forget them.
      this.input.keyboard?.resetKeys();
    };
    const events = this.game.events;
    events.on(Phaser.Core.Events.BLUR, autoPause);
    events.on(Phaser.Core.Events.HIDDEN, autoPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      events.off(Phaser.Core.Events.BLUR, autoPause);
      events.off(Phaser.Core.Events.HIDDEN, autoPause);
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
    this.pauseOverlay.setVisible(this.paused && !over);
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
