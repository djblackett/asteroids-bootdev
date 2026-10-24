import Phaser from 'phaser';
import { getAudio, type AudioDirector } from '../audio/phaserAudio';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import { GameSim, type SimEvent } from '../core/game';
import { resolveGameConfig } from '../core/gameConfig';
import { NO_INPUT, type PlayerInput } from '../core/player';
import { seededRng } from '../core/rng';
import { getSetup, simConfigOf } from '../gameSetup';
import { getHaptics } from '../haptics/gameHaptics';
import type { HapticManager } from '../haptics/hapticManager';
import { getGamepadHub } from '../input/gameGamepads';
import { getHeldKeys } from '../input/gameKeys';
import { getInputMode, getMovement, getTouchControls } from '../input/gameTouch';
import type { GamepadHub } from '../input/gamepadHub';
import type { HeldKeys } from '../input/heldKeys';
import type { TouchControls } from '../input/touchControls';
import {
  keyDiagnosticsEnabled,
  mountKeyDiagnostics,
  PHASER_KEY_NAMES,
  type MountedDiagnostics,
} from '../input/keyDiagnostics';
import { createKeyPressRouter } from '../input/keyPress';
import { keySchemesFor, readPlayerInput, type KeyScheme } from '../input/keyboardControls';
import { readPlayerInputs } from '../input/playerInputs';
import { getApiBase, type RankedChallenge } from '../ranked/api';
import { ControlTracker } from '../ranked/controls';
import { localBest, readLocalScores, startingNickname, type LocalScore } from '../ranked/localScores';
import { refreshPersonalBest, type PersonalBest } from '../ranked/personalBest';
import { ScoresModel } from '../ranked/scoresModel';
import { rankedSession } from '../ranked/session';
import { SubmissionFlow } from '../ranked/submission';
import { drawStarfield, drawWorld } from '../render/worldRenderer';
import {
  FIXED_DT,
  FIXED_TICK_RATE,
  FixedStepRunner,
  ReplayRecorder,
  toPlayerInput,
  toRecordedInput,
  type ReplayRecord,
} from '../replay';
import { AbilityHud, ComboHud, Hud, KillStreakBanner, Overlay, playerColor, TeamHud, TOUCH_HUD_SCALE } from '../ui/hud';
import { NicknameInput } from '../ui/nicknameInput';
import { addText, COLORS, formatClock } from '../ui/text';
import { abilityLabels } from '../ui/touchLabels';
import type { MenuContext, PageNav } from '../ui/menu/context';
import type { MenuSnapshot } from '../ui/menu/menuController';
import { MenuView, type PageBuilder } from '../ui/menu/menuView';
import { buildAudioPage } from '../ui/menu/pages/audio';
import { buildControlsPage } from '../ui/menu/pages/controls';
import { buildPadLayoutPage } from '../ui/menu/pages/padLayout';
import { buildPausePage } from '../ui/menu/pages/pause';
import { buildRankedResultPage, type RankedResultContext } from '../ui/menu/pages/rankedResult';
import { buildScoresPage, type ScoresContext } from '../ui/menu/pages/scores';
import { handleBack } from '../ui/menu/backAction';
import { TouchGameOverButtons } from '../ui/touchMenus';
import { SCENE_GAME, SCENE_START } from './keys';

const CENTER_X = SCREEN_WIDTH / 2;
const CENTER_Y = SCREEN_HEIGHT / 2;

function parseVerifiedMode(search: string): { verified: boolean; seed: number } {
  try {
    const params = new URLSearchParams(search);
    const hasVerified = params.has('verified') || params.has('seed');
    if (!hasVerified) return { verified: false, seed: 0 };
    const rawSeed = params.get('seed');
    const seed = rawSeed !== null && !isNaN(Number(rawSeed)) ? Number(rawSeed) >>> 0 : 1;
    return { verified: true, seed };
  } catch {
    return { verified: false, seed: 0 };
  }
}

export interface ReplayWindowApi {
  isVerified: boolean;
  seed: number;
  getReplay: () => ReplayRecord | undefined;
  getSerialized: () => string | undefined;
  isGameOver: () => boolean;
  getScore: () => number;
  getTicks: () => number;
}

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
  /** Everything the HUD classes drew (score, lives, ability lines, banners). Hidden while a full-width pause page is open. */
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  /** The HUD objects that were showing when the HUD was hidden, so exactly those come back. */
  private hudHidden: Phaser.GameObjects.GameObject[] = [];
  /** The dimmed backdrop behind the pause menu (the menu itself is `pauseMenu`). */
  private pauseDim!: Phaser.GameObjects.Rectangle;
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
  /** Game-wide haptic manager (see haptics/): buzzes the phone for a few important events, in touch mode only. */
  private haptics!: HapticManager;
  /** The pause menu: RESUME, AUDIO, CONTROLS, RETURN TO MENU (the title screen's own AUDIO and CONTROLS pages on top of it). */
  private pauseMenu!: MenuView;
  /** Per player: ignore the cannon until it has been released once (a menu press that resumed play must not also fire a shot). */
  private shotGuard: boolean[] = [];
  /** RESUME was just pressed from the menu: the guard is taken at the start of the next frame (see `resumeFromMenu`). */
  private guardNextFrame = false;
  /** Key scheme of each player, in player order (one for a one-player game). */
  private schemes: readonly KeyScheme[] = [];
  /** Game-wide touch controls (see touchControls.ts): inert and invisible unless touch mode is on. */
  private touch!: TouchControls;
  /** Touch mode for this run: decided when the run starts (the mode can only be changed on the title screen). */
  private touchUi = false;
  private touchOver: TouchGameOverButtons | null = null;

  // Verified replay runner and recorder (null in casual play)
  private isVerifiedMode = false;
  private verifiedSeed = 0;
  private fixedRunner: FixedStepRunner | null = null;
  private replayRecorder: ReplayRecorder | null = null;
  // Ranked run (null in casual and in the experimental ?verified mode): issued by the server, submitted once the run has ended.
  private rankedChallenge: RankedChallenge | null = null;
  /** When the challenge stops being valid, on this device's clock (see `localExpiry`). */
  private rankedExpiresAt = 0;
  /** The challenge ran out while the run was in progress: playing on is allowed, submitting is not (and the player is told). */
  private rankedExpired = false;
  /** The ranked time limit was reached with the ship still alive. The simulation stops there; the result page takes over. */
  private timeUp = false;
  private controlTracker = new ControlTracker();
  /** Ranked only: owns everything between "the run ended" and "the server answered" (see ranked/submission.ts). */
  private rankedFlow: SubmissionFlow | null = null;
  private resultMenu: MenuView | null = null;
  private resultDim: Phaser.GameObjects.Rectangle | null = null;
  private nicknameInput: NicknameInput | null = null;
  private scoresModel!: ScoresModel;
  private personalBest: PersonalBest | null = null;
  /** The best verified score before this run, fixed when the run ends (for the "new personal best" line). */
  private priorBest: LocalScore | null = null;
  private resultOpenedAt = 0;
  private rankedLabel: Phaser.GameObjects.Text | null = null;
  private rankedClock: Phaser.GameObjects.Text | null = null;
  private rankedNotice: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(SCENE_GAME);
  }

  init(): void {
    // State lives in init(), not the constructor, so every restart begins clean. The title screen's choices come from the
    // registry; the simulation (and with it every co-op detail) is always built from scratch.
    const setup = getSetup(this.registry);
    // A ranked run takes its seed AND configuration from the server's challenge; nothing from the menu or the URL applies.
    const taken = rankedSession.takeChallenge();
    const challenge = taken?.challenge ?? null;
    this.rankedChallenge = challenge;
    this.rankedExpiresAt = taken?.expiresAtLocal ?? 0;
    this.rankedExpired = false;
    this.timeUp = false;
    this.rankedFlow = null;
    this.resultMenu = null;
    this.resultDim = null;
    this.nicknameInput = null;
    this.priorBest = null;
    this.resultOpenedAt = 0;
    this.rankedLabel = this.rankedClock = this.rankedNotice = null;
    this.controlTracker = new ControlTracker();
    const config = challenge ? resolveGameConfig(challenge.config) : simConfigOf(setup);

    const verifiedInfo = challenge
      ? { verified: true, seed: challenge.seed }
      : typeof window !== 'undefined'
        ? parseVerifiedMode(window.location.search)
        : { verified: false, seed: 0 };
    this.isVerifiedMode = verifiedInfo.verified;
    this.verifiedSeed = verifiedInfo.seed;

    if (this.isVerifiedMode) {
      this.sim = new GameSim({ rng: seededRng(this.verifiedSeed), config });
      this.fixedRunner = new FixedStepRunner(FIXED_TICK_RATE, FIXED_DT);
      this.replayRecorder = new ReplayRecorder(this.verifiedSeed, config);
      if (typeof window !== 'undefined') {
        (window as unknown as { __ASTEROIDS_REPLAY__?: ReplayWindowApi }).__ASTEROIDS_REPLAY__ = {
          isVerified: true,
          seed: this.verifiedSeed,
          getReplay: () => this.replayRecorder?.exportReplay(),
          getSerialized: () => this.replayRecorder?.serialize(),
          isGameOver: () => this.sim.isGameOver,
          getScore: () => this.sim.totalScore,
          getTicks: () => this.replayRecorder?.ticks ?? 0,
        };
      }
    } else {
      this.sim = new GameSim({ config });
      this.fixedRunner = null;
      this.replayRecorder = null;
    }

    this.schemes = keySchemesFor(config.playerCount, setup.p2Keys);
    this.abilityHuds = [];
    this.teamHud = null;
    this.paused = false;
    this.lastFrameTime = null;
    this.retryReady = null;
    this.padNote = '';
    this.shotGuard = [];
    this.guardNextFrame = false;
    this.touchOver = null;
  }

  create(): void {
    this.starGfx = this.add.graphics().setDepth(0);
    this.worldGfx = this.add.graphics().setDepth(1);
    const players = this.sim.players.length;
    this.touch = getTouchControls(this);
    this.touchUi = this.touch.isActive && players === 1;
    const hudScale = this.touchUi ? TOUCH_HUD_SCALE : 1;
    const beforeHud = this.children.list.length;
    this.hud = new Hud(this, players, hudScale);
    this.abilityHuds = this.sim.players.map((_, i) => new AbilityHud(this, i, hudScale));
    this.teamHud = players > 1 ? new TeamHud(this) : null;
    this.comboHud = new ComboHud(this, players > 1);
    this.streakBanner = new KillStreakBanner(this);
    if (this.rankedChallenge) this.createRankedHud();
    this.hudObjects = this.children.list.slice(beforeHud);
    this.hudHidden = [];
    this.audio = getAudio(this);
    this.haptics = getHaptics(this);
    // Nothing from an earlier run (a buzz in progress, cooldowns, a pause) carries into this one.
    this.haptics.reset();
    // A new game: in Random mode this is where the soundtrack for the run is picked (and only here).
    this.audio.music.beginRun();
    this.audio.startMusicWhenUnlocked();

    this.pauseDim = this.add.rectangle(CENTER_X, CENTER_Y, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.78).setDepth(20).setVisible(false);
    this.pauseMenu = this.createPauseMenu();
    // The pause screen itself leaves the game faintly visible; AUDIO and CONTROLS are full-width pages and need a calmer backdrop.
    this.pauseMenu.controller.onPageChange((_page, depth) => {
      this.pauseDim.setAlpha(depth > 1 ? 0.95 : 0.78);
      this.setHudHidden(depth > 1);
    });

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

    // A ranked run ends on its own result page (name, submit, verdict), never on the casual RETRY / MAIN MENU buttons.
    if (this.touchUi && !this.rankedChallenge) {
      this.touchOver = new TouchGameOverButtons(this, { retry: () => this.retry(), menu: () => this.toMenu() });
    }
    if (this.rankedChallenge) this.createResultMenu();

    this.setupInput();
    this.setupLifecycle();
    // Tree-shaken from production, and never injected into any recorded or ranked simulation.
    if (import.meta.env.DEV && !this.isVerifiedMode && !this.rankedChallenge && new URLSearchParams(window.location.search).has('lightningtrial')) {
      const sim = this.sim;
      void import('../dev/lightningTrial').then(({ installLightningTrial }) => {
        if (this.scene.isActive() && this.sim === sim) installLightningTrial(this, sim);
      });
    }
  }

  override update(time: number): void {
    const sim = this.sim;
    // Phaser's own `delta` is smoothed and, for 120 frames after boot or wake-up, clamped to 1/60 s,
    // which would run the game in slow motion on slower displays. The raw frame timestamp gives an
    // exact game clock; `GameSim.step` clamps unusually long frames itself.
    const dt = this.lastFrameTime === null ? 0 : Math.max(0, (time - this.lastFrameTime) / 1000);
    this.lastFrameTime = time;

    this.handlePadPresses();
    // Taken here, not when RESUME was pressed: Phaser delivers the key event before this game's own held-key tracker has seen it, so
    // at that moment the key that pressed RESUME (Space, Enter) still reads as up.
    if (this.guardNextFrame) {
      this.guardNextFrame = false;
      this.shotGuard = this.readInputsUnguarded().map((input) => input.shoot);
    }

    if (this.isVerifiedMode && this.fixedRunner && this.replayRecorder) {
      const runner = this.fixedRunner;
      const recorder = this.replayRecorder;
      if (!this.paused) {
        runner.update(dt, (tick, fixedDt) => {
          // The run already ended inside this frame (time limit): the ticks the runner still owes this frame are not played.
          if (this.timeUp) return;
          const rawInputs = sim.isGameOver ? this.schemes.map(() => NO_INPUT) : this.readInputs();
          if (this.rankedChallenge && !sim.isGameOver) this.observeControls();
          const p1Input = toPlayerInput(toRecordedInput(rawInputs[0] ?? NO_INPUT));
          if (!recorder.isFinalized) {
            recorder.recordTick(tick, p1Input);
          }
          const events = sim.step(fixedDt, p1Input, rawInputs[1] ?? NO_INPUT);
          if (sim.isGameOver && !recorder.isFinalized) {
            recorder.markGameOver(sim);
          }
          // A natural game over always takes precedence; the limit only ends a run whose ship is still alive, at exactly the tick the
          // server issued. The recording stops here and the server replays exactly this many ticks.
          if (this.rankedChallenge && !sim.isGameOver && tick + 1 >= this.rankedChallenge.timeLimitTicks) {
            recorder.markTimeLimit(sim);
            this.timeUp = true;
          }
          if (this.runOver) this.beginRankedResult();
          this.audio.sfx.handle(events);
          if (this.touchUi) this.haptics.handle(events);
          this.announce(events, time);
        });
        this.applyShake();
      }
    } else {
      const inputs = sim.isGameOver ? this.schemes.map(() => NO_INPUT) : this.readInputs();
      if (!this.paused) {
        const events = sim.step(dt, inputs[0] ?? NO_INPUT, inputs[1] ?? NO_INPUT);
        this.audio.sfx.handle(events);
        // Only the touch UI buzzes: the same events on a keyboard or controller run (or a second player's ship) never reach the phone's motor.
        if (this.touchUi) this.haptics.handle(events);
        this.announce(events, time);
        this.applyShake();
      }
    }

    const [p1, p2] = sim.players;
    const currentInputs = sim.isGameOver ? this.schemes.map(() => NO_INPUT) : this.readInputs();
    this.keyDiag?.update({
      phaserHeld: this.phaserDiagKeys.filter(([, key]) => key.isDown).map(([name]) => name),
      trackerHeld: this.held.snapshot(),
      input: currentInputs[0] ?? NO_INPUT,
      pad: {
        lines: this.pads.diagnosticLines(this.playerCount),
        driven: [this.pads.padFor(0, this.playerCount) !== null, this.pads.padFor(1, this.playerCount) !== null],
      },
      ...(p2 ? { input2: currentInputs[1] ?? NO_INPUT, sim2: this.diagSnapshot(p2) } : {}),
      sim: this.diagSnapshot(p1 ?? sim.player),
    });

    drawStarfield(this.starGfx, sim.starfield);
    drawWorld(this.worldGfx, sim, time);
    // While a pause page hides the HUD its objects must not be touched: the game is frozen, so there is nothing new to show.
    if (this.hudHidden.length === 0) {
      this.hud.update(sim);
      for (const abilities of this.abilityHuds) abilities.update(sim, time);
      this.teamHud?.update(sim, time);
      this.comboHud.update(sim);
      this.streakBanner.update(sim);
      this.updateRankedHud();
    }
    this.checkRankedExpiry();
    if (this.touchUi) this.updateTouchControls();
    this.haptics.setPaused(this.paused);
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
    const playing = !this.paused && !this.runOver;
    this.touch.setLayer(playing ? 'play' : this.paused && !this.runOver ? 'menu' : 'off');
    if (playing) this.touch.setAbilities(abilityLabels(this.sim.player));
  }

  /** Ranked only: notes which input sources really drove the ship, for the (untrusted) control-scheme report. */
  private observeControls(): void {
    const scheme = this.schemes[0];
    if (!scheme) return;
    this.controlTracker.observe(
      {
        keyboard: readPlayerInput(this.held, scheme),
        gamepad: this.pads.command(0, 1),
        touch: this.touchUi ? this.touch.command() : null,
      },
      getMovement(this).mode,
    );
  }

  /** The run is over: the ship was lost, or (ranked only) the time limit was reached with the ship still alive. */
  private get runOver(): boolean {
    return this.sim.isGameOver || this.timeUp;
  }

  // --- ranked: HUD, expiry, result page ------------------------------------------------------------------------------------

  /** `RANKED` beside the clock, a countdown in the last minute, and (if it happens) the expiry notice. Subtle: nothing near the ship. */
  private createRankedHud(): void {
    const y = 18;
    this.rankedLabel = addText(this, CENTER_X - 76, y, 'RANKED', { size: 20, color: COLORS.heading, originX: 1 }).setDepth(10);
    this.rankedClock = addText(this, CENTER_X + 76, y, '', { size: 20, color: COLORS.hint, originX: 0 }).setDepth(10).setVisible(false);
    this.rankedNotice = addText(this, CENTER_X, 150, 'RANKED RUN EXPIRED: THIS SCORE CAN NOT BE SUBMITTED', { size: 22, color: '#ffa050', originX: 0.5, originY: 0.5 })
      .setDepth(10)
      .setVisible(false);
  }

  private updateRankedHud(): void {
    const challenge = this.rankedChallenge;
    if (!challenge || !this.rankedLabel || !this.rankedClock || !this.rankedNotice) return;
    const ticks = this.replayRecorder?.ticks ?? 0;
    const left = Math.max(0, Math.ceil((challenge.timeLimitTicks - ticks) / FIXED_TICK_RATE));
    const closing = !this.runOver && left <= 60;
    this.rankedClock.setVisible(closing);
    if (closing) this.rankedClock.setText(`${formatClock(left)} LEFT`).setColor(left <= 10 ? '#ff6464' : COLORS.hint);
    this.rankedNotice.setVisible(this.rankedExpired && !this.runOver);
    this.rankedLabel.setText(this.rankedExpired ? 'UNRANKED' : 'RANKED').setColor(this.rankedExpired ? '#ffa050' : COLORS.heading);
  }

  /** A paused or idle tab can outlast the challenge. Notice it as soon as it happens, not at game over. */
  private checkRankedExpiry(): void {
    if (!this.rankedChallenge || this.rankedExpired || this.runOver) return;
    if (Date.now() >= this.rankedExpiresAt) this.rankedExpired = true;
  }

  /** The note on the pause page's red line. */
  private pauseNote(): string {
    if (this.padNote) return this.padNote;
    return this.rankedExpired && !this.runOver ? 'RANKED RUN EXPIRED: THIS SCORE CAN NOT BE SUBMITTED' : '';
  }

  private createResultMenu(): void {
    this.scoresModel = new ScoresModel(getApiBase());
    this.resultDim = this.add.rectangle(CENTER_X, CENTER_Y, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, 0.86).setDepth(20).setVisible(false);
    const nav: PageNav = {
      open: (id) => {
        if (id === 'scores') {
          void this.scoresModel.load();
          this.refreshBest();
        }
        this.resultMenu?.controller.open(id);
      },
      back: () => void this.resultMenu?.controller.back(),
    };
    const scoresCtx: ScoresContext = {
      inputMode: getInputMode(this),
      model: this.scoresModel,
      highlightIds: () => new Set(readLocalScores().map((s) => s.id)),
      best: () => this.personalBest,
    };
    const builders: Record<string, PageBuilder> = {
      result: (kit) => buildRankedResultPage(kit, this.resultContext(nav), nav),
      scores: (kit) => buildScoresPage(kit, scoresCtx, nav),
    };
    this.resultMenu = new MenuView(this, 22, builders, 'result');
  }

  private resultContext(nav: PageNav): RankedResultContext {
    const flow = this.rankedFlow as SubmissionFlow;
    const input = this.nicknameInput as NicknameInput;
    const challenge = this.rankedChallenge as RankedChallenge;
    const bestBeforeRun = () => this.priorBest;
    return {
      inputMode: getInputMode(this),
      flow,
      input,
      runScore: this.sim.totalScore,
      endReason: this.timeUp ? 'time_limit' : 'game_over',
      timeLimitLabel: formatClock(challenge.timeLimitTicks / FIXED_TICK_RATE),
      priorBest: this.priorBest?.score ?? null,
      get priorBestRulesVersion() { return bestBeforeRun()?.rulesVersion; },
      actions: {
        playAgain: () => this.playAgain(),
        toMenu: () => this.toMenu(),
        openScores: () => nav.open('scores'),
      },
    };
  }

  private refreshBest(): void {
    void refreshPersonalBest(getApiBase()).then((best) => {
      this.personalBest = best;
      if (best && this.priorBest && best.best.id === this.priorBest.id) {
        this.priorBest = { ...this.priorBest, rulesVersion: best.best.rulesVersion };
      }
    });
  }

  /**
   * Ranked only, once, when the run ends: freezes the recording, creates the submission flow, and shows the result page. NOTHING is sent
   * yet: the player first gets to name the score (or skip). The game never posts a score of its own; the server replays the recording.
   */
  private beginRankedResult(): void {
    const challenge = this.rankedChallenge;
    const recorder = this.replayRecorder;
    const menu = this.resultMenu;
    if (!challenge || !recorder || !menu || this.rankedFlow) return;
    this.rankedFlow = new SubmissionFlow({
      base: getApiBase(),
      challenge,
      replay: recorder.exportReplay(),
      controls: this.controlTracker.scheme(),
      expired: () => this.rankedExpired || Date.now() >= this.rankedExpiresAt,
    });
    rankedSession.attach(challenge.runId, this.rankedFlow);
    this.priorBest = localBest();
    this.refreshBest();
    const search = typeof window !== 'undefined' ? window.location.search : '';
    this.nicknameInput = new NicknameInput(
      this.game,
      startingNickname(search),
      () => void this.rankedFlow?.submit(this.nicknameInput?.value ?? ''),
      document,
      !this.touchUi,
    );
    this.resultOpenedAt = this.time.now;
    this.resultDim?.setVisible(true);
    this.setHudHidden(true); // the page has its own heading and score; the HUD would only show through the dim
    menu.show(this.touchUi ? 'touch' : 'keys');
  }

  private get resultOpen(): boolean {
    return this.resultMenu?.isOpen === true && this.rankedFlow !== null;
  }

  /** Keys and buttons that arrive in the instant after the run ends belong to the game that just stopped (the cannon, a held key), not to the page. */
  private get resultSettled(): boolean {
    return this.time.now - this.resultOpenedAt > 600;
  }

  /** Escape / BACK on the result page: closes the high scores, or leaves once there is nothing left to submit. Never throws a score away. */
  private resultBack(): void {
    const menu = this.resultMenu;
    const flow = this.rankedFlow;
    if (!menu || !flow) return;
    if (!menu.controller.atRoot) void menu.controller.back();
    else if (flow.finished) this.toMenu();
  }

  /** Another ranked run: the title screen asks the server for a new challenge (a spent one is never reused). */
  private playAgain(): void {
    this.scene.start(SCENE_START, { rankedAgain: true });
  }

  /** Leaving a ranked run before it ends: its challenge is simply never submitted. */
  private abandonRanked(): void {
    if (this.runOver) return;
    if (this.rankedChallenge) rankedSession.set('abandoned');
    this.replayRecorder?.abandon();
  }

  /** One input per player: that player's own keys, merged with the controller assigned to them (if any). */
  private readInputs(): PlayerInput[] {
    return this.readInputsUnguarded().map((input, i) => {
      if (!this.shotGuard[i]) return input;
      if (input.shoot) return { ...input, shoot: false };
      this.shotGuard[i] = false;
      return input;
    });
  }

  private readInputsUnguarded(): PlayerInput[] {
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
          if (this.pauseMenuOpen) this.pauseMenu.controller.pad('a');
          else if (this.resultOpen) {
            if (this.resultSettled) this.resultMenu?.controller.pad('a');
          } else this.retry();
          break;
        case 'b':
          // B is Boost while playing; it is the menu's cancel button only on the pause menu and on the ranked result page.
          if (this.pauseMenuOpen || (this.resultOpen && this.resultSettled)) this.goBack();
          break;
        case 'back':
          this.goBack();
          break;
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          if (this.pauseMenuOpen) this.pauseMenu.controller.pad(press.button);
          else if (this.resultOpen && this.resultSettled) this.resultMenu?.controller.pad(press.button);
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
      createKeyPressRouter((code) => this.onKey(code)),
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
    if (this.runOver) return;
    this.paused = !this.paused;
    this.fixedRunner?.setPaused(this.paused);
    // Touch is different from keys: a finger that was steering has no state to resume, so every touch is let go on pause.
    if (this.paused) this.touch.releaseAll();
    // Held movement keys are deliberately NOT reset: the keyboard has not released them, so play resumes with them held.
    if (!this.paused) {
      this.padNote = '';
      this.ignoreHeldAbilityKeys();
    }
  }

  /**
   * Escape and the controller's BACK button (B too, but only on the pause menu, where it is not Boost): see `handleBack`. They pause a
   * run, close an open pause page, resume from the pause menu itself, and after Game Over leave for the title screen. They never
   * abandon a run in progress; RETURN TO MENU does that.
   */
  private goBack(): void {
    if (this.resultOpen) return this.resultBack();
    handleBack({
      gameOver: this.sim.isGameOver,
      paused: this.paused,
      menuShown: this.pauseMenu.isOpen,
      menuBack: () => this.pauseMenu.controller.back(),
      pause: () => this.togglePause(),
      resume: () => this.resumeFromMenu(),
      leaveFinishedRun: () => this.toMenu(),
    });
  }

  /**
   * One-shot keys. P pauses / resumes and M mutes the music anywhere. While the pause menu is open it also takes the arrow keys (which
   * steer the ship the rest of the time), Enter and Space. Escape goes back (see `goBack`). After Game Over, R (and Enter in a
   * one-player game) retries.
   */
  private onKey(code: string): void {
    if (code === 'KeyP' && !this.resultOpen) return this.togglePause();
    if (code === 'KeyM') return void this.audio.music.toggleMuted();
    if (code === 'Escape') return void this.goBack();
    if (this.resultOpen) {
      // The ranked result page takes the keys (typing in its name field never gets here: see NicknameInput). The first moments are the
      // game that just stopped: a cannon key still held must not press a button.
      if (this.resultSettled) this.resultMenu?.controller.key(code);
      return;
    }
    if (this.pauseMenuOpen) {
      this.pauseMenu.controller.key(code);
      return;
    }
    if (code === 'KeyR') this.retry();
    // Enter is Player 2's cannon in a two-player game, so it only retries a one-player run.
    else if (code === 'Enter' && this.sim.players.length === 1) this.retry();
  }

  /** AUDIO and CONTROLS are full-width pages: the score and ability lines behind them would only be clutter, so they step aside. */
  private setHudHidden(hidden: boolean): void {
    if (hidden === (this.hudHidden.length > 0)) return;
    if (hidden) {
      this.hudHidden = this.hudObjects.filter((o) => (o as unknown as { visible: boolean }).visible);
      for (const o of this.hudHidden) (o as unknown as { setVisible(v: boolean): void }).setVisible(false);
    } else {
      for (const o of this.hudHidden) (o as unknown as { setVisible(v: boolean): void }).setVisible(true);
      this.hudHidden = [];
    }
  }

  /** For browser tests: where every pause-menu button is and which page is open. */
  pauseMenuSnapshot(): MenuSnapshot {
    return this.pauseMenu.controller.snapshot();
  }

  /** For browser tests: where every button of the ranked result page is (null until a ranked run has ended). */
  resultMenuSnapshot(): MenuSnapshot | null {
    return this.resultOpen ? (this.resultMenu as MenuView).controller.snapshot() : null;
  }

  private get pauseMenuOpen(): boolean {
    return this.paused && !this.runOver;
  }

  private createPauseMenu(): MenuView {
    const setup = () => getSetup(this.registry);
    const nav: PageNav = { open: (id) => this.pauseMenu.controller.open(id), back: () => void this.pauseMenu.controller.back() };
    const ctx: MenuContext = {
      where: 'pause',
      audio: this.audio,
      haptics: this.haptics,
      inputMode: getInputMode(this),
      movement: getMovement(this),
      pads: getGamepadHub(this),
      setup,
      patchSetup: () => undefined, // the run's rules were fixed when it started
      setPlayers: () => undefined,
      now: () => this.time.now,
      actions: { play: () => undefined, resume: () => this.resumeFromMenu(), toMenu: () => this.toMenu(), switchInputMode: () => undefined },
    };
    const builders: Record<string, PageBuilder> = {
      pause: (kit) => buildPausePage(kit, ctx, nav, () => this.pauseNote()),
      audio: (kit) => buildAudioPage(kit, ctx, nav),
      controls: (kit) => buildControlsPage(kit, ctx, nav),
      padlayout: (kit) => buildPadLayoutPage(kit, ctx, nav),
    };
    return new MenuView(this, 22, builders, 'pause');
  }

  /**
   * RESUME pressed on the menu. The key or button that pressed it may also be a cannon (Space, Enter, the pad's A): it must not fire a
   * shot the moment play resumes, so every cannon that is down now stays quiet until it has been released once.
   */
  private resumeFromMenu(): void {
    if (!this.paused) return;
    this.guardNextFrame = true;
    this.pads.disarmAll('resumed from the menu');
    this.togglePause();
  }

  private toMenu(): void {
    this.abandonRanked();
    if (this.paused || this.runOver) this.scene.start(SCENE_START);
  }

  private retry(): void {
    // A ranked run ends on its own result page; RETRY is the casual game's. A ranked challenge is single-use and is never silently
    // reused or downgraded to a casual restart (PLAY AGAIN on the result page asks the server for a new one).
    if (this.rankedChallenge) return;
    this.abandonRanked();
    if (this.sim.isGameOver && this.sim.retryDelay <= 0) this.scene.restart();
  }

  // --- browser lifecycle -----------------------------------------------------

  /** Pauses automatically when the tab is hidden or the window loses focus, and cleans up on shutdown. */
  private setupLifecycle(): void {
    const autoPause = (): void => {
      if (this.runOver) return;
      // Keys released while the window was unfocused never send a keyup; HeldKeys forgets them itself on blur / hide.
      this.paused = true;
      this.fixedRunner?.setPaused(true);
    };
    // A controller that drives a ship in this run disappearing pauses the game at once (its commands are already neutral),
    // so nobody plays on with a dead ship; reconnecting it hands the ship back, and START resumes.
    const stopPadEvents = this.pads.onEvent((event) => {
      if (event.type === 'connected') this.keyDiag?.note(`controller connected: #${event.pad.index} ${event.pad.name}`);
      else if (event.type === 'disconnected') this.keyDiag?.note(`controller DISCONNECTED: #${event.pad.index} ${event.pad.name}`);
      else if (event.type === 'disarmed') this.keyDiag?.note(`controllers neutral: ${event.reason}`);
      if (event.type !== 'disconnected' || this.runOver) return;
      const slot = this.playerCount === 2 ? event.slot : event.soloSlot;
      if (slot === null) return;
      this.paused = true;
      this.fixedRunner?.setPaused(true);
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
      this.haptics.reset();
      this.audio.music.setGamePaused(false);
      this.audio.music.setMegaPowerActive(false);

      this.abandonRanked();
      this.nicknameInput?.destroy();
      this.nicknameInput = null;
      if (this.isVerifiedMode && typeof window !== 'undefined') {
        delete (window as unknown as { __ASTEROIDS_REPLAY__?: unknown }).__ASTEROIDS_REPLAY__;
      }
    });
  }

  // --- presentation ----------------------------------------------------------

  private applyShake(): void {
    const s = this.runOver ? 0 : this.sim.screenShake;
    if (s > 0) this.worldGfx.setPosition(Phaser.Math.FloatBetween(-s, s), Phaser.Math.FloatBetween(-s, s));
    else this.worldGfx.setPosition(0, 0);
  }

  private updateOverlays(): void {
    const runOver = this.runOver;
    // The casual game-over screen is not used for a ranked run: its result page (see `beginRankedResult`) replaces it.
    const over = runOver && !this.rankedChallenge;
    this.resultMenu?.update(this.time.now);
    const showPause = this.paused && !runOver;
    this.pauseDim.setVisible(showPause);
    // Controller hints appear only while a controller is actually driving a ship in this run.
    const padActive = over && this.padActive();
    if (showPause !== this.pauseMenu.isOpen) {
      if (showPause) this.pauseMenu.show(this.touchUi ? 'touch' : 'keys');
      else {
        this.pauseMenu.hide();
        this.setHudHidden(false);
      }
    }
    this.pauseMenu.update(this.time.now);
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
    this.gameOverOverlay.setLine(
      3,
      coop ? `Player 2: ${sim.player2?.score ?? 0}` : '',
      CENTER_Y - 150,
      coop ? COLORS.player2 : COLORS.heading,
      coop ? 30 : 22,
    );
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
