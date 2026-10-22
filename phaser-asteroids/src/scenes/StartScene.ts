import Phaser from 'phaser';
import { getAudio, type AudioDirector } from '../audio/phaserAudio';
import { defaultRng } from '../core/rng';
import { Starfield } from '../core/starfield';
import { getSetup, setSetup, type GameSetup } from '../gameSetup';
import { getHaptics } from '../haptics/gameHaptics';
import type { HapticManager } from '../haptics/hapticManager';
import { getGamepadHub } from '../input/gameGamepads';
import { getInputMode, getMovement, getTouchControls } from '../input/gameTouch';
import type { GamepadHub } from '../input/gamepadHub';
import type { InputModeController } from '../input/inputMode';
import { createKeyPressRouter } from '../input/keyPress';
import { rankedInputAvailable } from '../input/rankedInput';
import { getApiBase, RANKED_MAX_TICKS, RankedApiError, rankedRequested, requestChallenge } from '../ranked/api';
import { readLocalScores } from '../ranked/localScores';
import { refreshPersonalBest, type PersonalBest } from '../ranked/personalBest';
import { ScoresModel } from '../ranked/scoresModel';
import { rankedSession } from '../ranked/session';
import { FIXED_TICK_RATE } from '../replay';
import { drawStarfield } from '../render/worldRenderer';
import type { MenuContext, PageNav } from '../ui/menu/context';
import type { MenuSnapshot } from '../ui/menu/menuController';
import { MenuView, type PageBuilder } from '../ui/menu/menuView';
import { buildAudioPage } from '../ui/menu/pages/audio';
import { buildControlsPage } from '../ui/menu/pages/controls';
import { buildCoopPage } from '../ui/menu/pages/coop';
import { buildPadLayoutPage } from '../ui/menu/pages/padLayout';
import { buildPowerupGuide } from '../ui/menu/pages/powerups';
import { buildRankedPage, type RankedMenuContext, type RankedRequestStatus } from '../ui/menu/pages/ranked';
import { buildScoresPage, type ScoresContext } from '../ui/menu/pages/scores';
import { buildTitlePage } from '../ui/menu/pages/title';
import { formatClock } from '../ui/text';
import { SCENE_GAME, SCENE_START } from './keys';

/** A second mode switch inside this window is the same touch landing twice (two fingers, a bouncing thumb), not a decision. */
const MODE_SWITCH_LOCK_MS = 700;

/**
 * The title screen. Everything on it is a page of the shared menu (`ui/menu/`): the title page itself (PLAY, the player count, how to
 * play, the power-up legend), and AUDIO, CONTROLS, TWO-PLAYER OPTIONS and the power-up guide one step away. This scene only owns what a
 * page cannot: the starfield, the choices kept in the registry for the next run, the keyboard and controller routing, and starting the game.
 * Starting from a key press or a click on PLAY also satisfies the browser's audio-unlock gesture.
 */
export class StartScene extends Phaser.Scene {
  private audio!: AudioDirector;
  private haptics!: HapticManager;
  private pads!: GamepadHub;
  private inputMode!: InputModeController;
  private setup!: GameSetup;
  private menu!: MenuView;
  private starting = false;
  private switchLockedUntil = 0;
  /** Where the request for a ranked challenge stands; the RANKED PLAY page draws it. */
  private rankedStatus: RankedRequestStatus = { kind: 'idle' };
  /** Identifies the latest request, so the answer to one the player cancelled (or replaced) is ignored. */
  private rankedRequest = 0;
  private scoresModel!: ScoresModel;
  /** This device's best verified score, refreshed from the server when the page opens. */
  private personalBest: PersonalBest | null = null;
  private autoStartRanked = false;
  /** Keyboard presence cannot be queried; remember a real key code received on this menu. Never saved as a preference. */
  private keyboardSeen = false;

  constructor() {
    super(SCENE_START);
  }

  /** `rankedAgain`: PLAY AGAIN on a ranked result screen, which goes straight on to ask for the next challenge. */
  init(data?: { rankedAgain?: boolean }): void {
    this.autoStartRanked = data?.rankedAgain === true;
  }

  /** For browser tests: where every button is and which page is open. */
  menuSnapshot(): MenuSnapshot {
    return this.menu.controller.snapshot();
  }

  create(): void {
    this.starting = false;
    this.switchLockedUntil = 0;
    this.rankedStatus = { kind: 'idle' };
    this.rankedRequest++;
    this.setup = getSetup(this.registry);
    this.audio = getAudio(this);
    this.audio.startMusicWhenUnlocked();
    this.haptics = getHaptics(this);
    this.pads = getGamepadHub(this);
    this.inputMode = getInputMode(this);

    drawStarfield(this.add.graphics().setDepth(0), new Starfield(defaultRng));

    // Touch play is one player: the simulation is told so, so a co-op choice made on the keyboard screen cannot leak into a run that
    // has no way to drive a second ship.
    if (this.inputMode.isTouch) this.forceOnePlayer();

    this.scoresModel = new ScoresModel(getApiBase());
    this.personalBest = null;
    const nav: PageNav = {
      open: (id) => {
        // The boards are fetched fresh each time the screen opens.
        if (id === 'scores') void this.scoresModel.load();
        if (id === 'ranked' || id === 'scores') this.refreshBest();
        this.menu.controller.open(id);
      },
      back: () => void this.menu.controller.back(),
    };
    const ctx = this.makeContext();
    const rankedCtx = this.makeRankedContext(nav);
    const scoresCtx: ScoresContext = {
      inputMode: this.inputMode,
      model: this.scoresModel,
      highlightIds: () => new Set(readLocalScores().map((s) => s.id)),
      best: () => this.personalBest,
    };
    const builders: Record<string, PageBuilder> = {
      title: (kit) => buildTitlePage(kit, ctx, nav),
      audio: (kit) => buildAudioPage(kit, ctx, nav),
      controls: (kit) => buildControlsPage(kit, ctx, nav),
      coop: (kit) => buildCoopPage(kit, ctx, nav),
      powerups: (kit) => buildPowerupGuide(kit, ctx, nav),
      padlayout: (kit) => buildPadLayoutPage(kit, ctx, nav),
      ranked: (kit) => buildRankedPage(kit, rankedCtx, nav),
      scores: (kit) => buildScoresPage(kit, scoresCtx, nav),
    };
    this.menu = new MenuView(this, 10, builders, 'title');

    // Presses meant for the scene we came from (the BACK that opened this menu, a RETRY that was refused) are not ours.
    this.pads.discardPresses();
    this.menu.show(this.inputMode.isTouch ? 'touch' : 'keys');
    this.refreshBest();
    // PLAY AGAIN after a ranked run: straight to the ranked page, which asks the server for the next challenge.
    if (this.autoStartRanked) {
      this.autoStartRanked = false;
      nav.open('ranked');
      this.requestRanked();
    }

    // The system controls (Fullscreen) belong to the touch screens; leaving the scene takes them away again.
    const touch = getTouchControls(this);
    touch.setLayer('menu');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => touch.setLayer('off'));

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
      keyboard.on(
        Phaser.Input.Keyboard.Events.ANY_KEY_DOWN,
        createKeyPressRouter((code) => {
          if (code && code !== 'Unidentified') this.keyboardSeen = true;
          if (this.menu.controller.key(code)) return;
          if (code === 'KeyM') this.audio.music.toggleMuted();
        }),
      );
    }
  }

  override update(time: number): void {
    getTouchControls(this).setLayer(this.starting ? 'off' : 'menu');
    this.handlePadPresses();
    this.menu.update(time);
  }

  private makeContext(): MenuContext {
    return {
      where: 'title',
      audio: this.audio,
      haptics: this.haptics,
      inputMode: this.inputMode,
      movement: getMovement(this),
      pads: this.pads,
      setup: () => this.setup,
      patchSetup: (change) => {
        this.setup = change(this.setup);
        setSetup(this.registry, this.setup);
      },
      setPlayers: (count) => this.setPlayers(count),
      now: () => this.time.now,
      actions: {
        play: () => this.start(),
        resume: () => undefined,
        toMenu: () => undefined,
        switchInputMode: () => this.switchInputMode(),
      },
    };
  }

  /**
   * Controller buttons on the title screen, one fresh press at a time. LB / RB give the pad to Player 1 / 2, A on an unassigned pad
   * joins the first free player, otherwise the D-pad moves the focus (or changes the focused setting), A presses it and B goes back.
   * START starts the game from the title page, X steps the music track and Y opens CONTROLS. Nothing here needs the keyboard.
   */
  private handlePadPresses(): void {
    const count = this.setup.game.playerCount;
    const controller = this.menu.controller;
    for (const press of this.pads.drainPresses()) {
      const assigned = this.pads.playerOf(press.padKey, count) !== null;
      switch (press.button) {
        case 'lb':
          this.pads.assign(press.padKey, 0, count);
          break;
        case 'rb':
          this.pads.assign(press.padKey, 1, count);
          break;
        case 'a':
          if (assigned) controller.pad('a');
          else this.pads.join(press.padKey, count);
          break;
        case 'start':
          if (assigned && controller.atRoot) this.start();
          else if (!assigned) this.pads.join(press.padKey, count);
          break;
        case 'b':
        case 'back':
          controller.pad('b');
          break;
        case 'x':
          this.audio.cycleMusicChoice(1);
          break;
        case 'y':
          if (controller.currentPage !== 'controls') {
            while (!controller.atRoot) controller.back();
            controller.open('controls');
          }
          break;
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          controller.pad(press.button);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Flips between touch and keyboard / controller controls. The page is rebuilt for the new mode (a phone gets its touch layout, a
   * keyboard gets its key map) without leaving the scene. Once per half second: a second finger landing on the button in the same
   * touch would otherwise flip it straight back. Turning touch off drops every touch that was held (`TouchControls.setActive`).
   */
  private switchInputMode(): void {
    if (this.starting || this.time.now < this.switchLockedUntil) return;
    this.switchLockedUntil = this.time.now + MODE_SWITCH_LOCK_MS;
    this.inputMode.toggle();
    if (this.inputMode.isTouch) this.forceOnePlayer();
    this.menu.controller.lockInput();
    this.menu.controller.rebuild();
  }

  private forceOnePlayer(): void {
    if (this.setup.game.playerCount === 1) return;
    this.pads.playerCountChanged(1);
    this.setup = { ...this.setup, game: { ...this.setup.game, playerCount: 1 } };
    setSetup(this.registry, this.setup);
  }

  private setPlayers(count: 1 | 2): void {
    if (this.setup.game.playerCount === count) return;
    this.pads.playerCountChanged(count);
    this.setup = { ...this.setup, game: { ...this.setup.game, playerCount: count } };
    setSetup(this.registry, this.setup);
  }

  private start(): void {
    if (this.starting) return;
    // `?ranked` (development and tests): PLAY goes through the same RANKED PLAY page a player reaches with the RANKED button.
    if (this.rankedWanted()) {
      if (this.menu.controller.currentPage !== 'ranked') this.menu.controller.open('ranked');
      this.requestRanked();
      return;
    }
    this.starting = true;
    this.scene.start(SCENE_GAME);
  }

  /** A normal game, whatever the ranked service is doing. */
  private playNormally(): void {
    if (this.starting) return;
    if (!this.rankedInputReady()) return;
    this.cancelRankedRequest();
    this.starting = true;
    this.scene.start(SCENE_GAME);
  }

  private refreshBest(): void {
    void refreshPersonalBest(getApiBase()).then((best) => {
      if (this.scene.isActive(SCENE_START)) this.personalBest = best;
    });
  }

  private makeRankedContext(nav: PageNav): RankedMenuContext {
    return {
      inputMode: this.inputMode,
      inputAvailable: () => this.rankedInputReady(),
      status: () => this.rankedStatus,
      best: () => this.personalBest,
      timeLimitLabel: formatClock(RANKED_MAX_TICKS / FIXED_TICK_RATE),
      actions: {
        start: () => this.requestRanked(),
        cancel: () => this.cancelRankedRequest(),
        playNormally: () => this.playNormally(),
        openScores: () => nav.open('scores'),
        enableTouch: () => {
          if (!this.inputMode.isTouch) this.switchInputMode();
        },
      },
    };
  }

  private cancelRankedRequest(): void {
    if (this.rankedStatus.kind === 'idle') return;
    this.rankedRequest++;
    this.rankedStatus = { kind: 'idle' };
    rankedSession.set('idle');
  }

  /**
   * Ranked play starts only after the server has issued a challenge (seed + configuration + time limit). If it cannot be issued the
   * player is told so on the RANKED PLAY page and can play normally or try again: a ranked run is never started without a challenge,
   * and a casual game is never started in its place without the player asking.
   */
  private requestRanked(): void {
    if (this.starting || this.rankedStatus.kind === 'connecting') return;
    if (!this.rankedInputReady()) return;
    const mine = ++this.rankedRequest;
    rankedSession.beginRequest();
    const base = getApiBase();
    if (!base) return this.failRanked('unconfigured', 'Ranked play is not available in this build');
    this.rankedStatus = { kind: 'connecting' };
    void requestChallenge(base)
      .then((challenge) => {
        if (mine !== this.rankedRequest || !this.scene.isActive(SCENE_START)) return; // cancelled, or the player left
        // A controller may have disconnected while the challenge was in flight. Do not enter an uncontrollable run.
        if (!this.rankedInputReady()) {
          this.cancelRankedRequest();
          return;
        }
        rankedSession.setChallenge(challenge);
        this.rankedStatus = { kind: 'idle' };
        this.starting = true;
        this.scene.start(SCENE_GAME);
      })
      .catch((e: unknown) => {
        if (mine !== this.rankedRequest) return;
        this.failRanked(e instanceof RankedApiError ? e.code : 'unavailable', e instanceof RankedApiError ? e.message : 'Unexpected error');
      });
  }

  private failRanked(code: string, message: string): void {
    this.rankedStatus = { kind: 'error', code };
    rankedSession.set('failed', message);
  }

  private rankedWanted(): boolean {
    return typeof window !== 'undefined' && rankedRequested(window.location.search);
  }

  private rankedInputReady(): boolean {
    return rankedInputAvailable(this.inputMode, this.pads, this.keyboardSeen);
  }

}
