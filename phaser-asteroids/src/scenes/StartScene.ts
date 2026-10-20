import Phaser from 'phaser';
import { getAudio, type AudioDirector } from '../audio/phaserAudio';
import { POWERUP_RADIUS, SCREEN_HEIGHT, SCREEN_WIDTH, SPEED_OPTIONS } from '../core/constants';
import type { PowerUpType } from '../core/powerup';
import { defaultRng } from '../core/rng';
import { Starfield } from '../core/starfield';
import { getSetup, setSetup, type GameSetup } from '../gameSetup';
import { toCss } from '../render/colors';
import { drawPowerUpIcon, POWERUP_COLOR } from '../render/powerupIcons';
import { getGamepadHub } from '../input/gameGamepads';
import { getInputMode, getSteering, getTouchControls } from '../input/gameTouch';
import type { GamepadHub } from '../input/gamepadHub';
import type { InputModeController } from '../input/inputMode';
import { createKeyPressDispatcher } from '../input/keyPress';
import { ControllerPanel } from '../ui/controllerPanel';
import { drawStarfield } from '../render/worldRenderer';
import { CachedText } from '../ui/hud';
import { addText, COLORS } from '../ui/text';
import { TouchButton } from '../ui/touchMenus';
import { TouchStartMenu } from '../ui/touchStartMenu';
import { VolumePanel } from '../ui/volumePanel';
import { SCENE_GAME, SCENE_START } from './keys';

const CENTER_X = SCREEN_WIDTH / 2;

const CONTROLS = [
  'W / S  -  Move Forward / Backward',
  'A / D  -  Rotate Left / Right',
  'SPACE  -  Shoot',
  'E  -  Laser Beam',
  'SHIFT  -  Boost',
  'P  -  Pause',
];

const POWERUPS: ReadonlyArray<readonly [PowerUpType, string, string]> = [
  ['rapid_fire', 'Rapid Fire', 'Faster shooting'],
  ['multi_shot', 'Multi-Shot', 'Shoot 3 bullets'],
  ['shield', 'Shield', 'One-hit protection'],
  ['slow_motion', 'Slow Motion', 'Slows asteroids'],
  ['mega_power', 'MEGA POWER', 'ALL POWERS!'],
];
/** Two players: the same list plus the Revive. */
const COOP_POWERUPS: ReadonlyArray<readonly [PowerUpType, string, string]> = [
  ['rapid_fire', 'Rapid Fire', 'Faster shooting'],
  ['multi_shot', 'Multi-Shot', 'Shoot 3 bullets'],
  ['shield', 'Shield', 'One-hit protection'],
  ['revive', 'Revive', 'Brings back a downed partner'],
  ['slow_motion', 'Slow Motion', 'Slows asteroids'],
  ['mega_power', 'MEGA POWER', 'ALL POWERS!'],
];

const P1_CONTROLS = ['W / S  Forward / Back', 'A / D  Rotate', 'SPACE  Shoot', 'E  Laser Beam', 'L-SHIFT  Boost'];
const P2_CONTROLS = {
  arrows: ['UP / DOWN  Forward / Back', 'LEFT / RIGHT  Rotate', 'ENTER  Shoot', 'R-SHIFT  Laser Beam', '.  Boost'],
  ijkl: ['I / K  Forward / Back', 'J / L  Rotate', ';  Shoot', 'U  Laser Beam', 'O  Boost'],
} as const;

// One-player layout (the classic screen, moved down a little to make room for the mode selector).
const SOLO_POWERUP_ROW_Y = (i: number): number => 392 + i * 38;
const SOLO_ICON_X = CENTER_X - 230;
// Two-player layout: power-ups in two columns of three.
const COOP_POWERUP_POS = (i: number): { x: number; y: number } => ({ x: i < 3 ? 120 : 700, y: 514 + (i % 3) * 38 });

/** Seconds-free labels for the speed handicap: 0.5 -> "50%". */
const speedLabel = (speed: number): string => `${Math.round(speed * 100)}%`;

type Phase = 'solo' | 'coop';

/**
 * Title / controls screen. Starting from a key press or click also satisfies the browser's audio-unlock gesture.
 * `1` / `2` choose one or two players; with two players `L` (lives), `F` (friendly fire), `K` (Player 2's keys) and `S` / `D`
 * (the players' speed handicaps) change the options. The choice is kept in the registry for the next run.
 */
export class StartScene extends Phaser.Scene {
  private iconGfx!: Phaser.GameObjects.Graphics;
  private musicHint!: CachedText;
  private audio!: AudioDirector;
  private volumePanel!: VolumePanel;
  private starting = false;
  private setup!: GameSetup;
  private pads!: GamepadHub;
  private padPanel!: ControllerPanel;
  private prompt!: Phaser.GameObjects.Text;
  /** A tap / click on empty space starts the game, except where the primary pointer is a finger (see create). */
  private clickStarts = true;
  /** Only in touch mode: the touch title screen replaces everything the keyboard / controller screen builds. */
  private touchMenu: TouchStartMenu | null = null;

  private oneLabel!: Phaser.GameObjects.Text;
  private twoLabel!: Phaser.GameObjects.Text;
  private soloObjects: Phaser.GameObjects.GameObject[] = [];
  private coopObjects: Phaser.GameObjects.GameObject[] = [];
  private p2Controls: Phaser.GameObjects.Text[] = [];
  /** The headings that say which player a controller drives (the keys listed under them stay active). */
  private headings: { solo?: Phaser.GameObjects.Text; p1?: Phaser.GameObjects.Text; p2?: Phaser.GameObjects.Text } = {};
  private options!: { lives: CachedText; fire: CachedText; keys: CachedText; speeds: CachedText };

  constructor() {
    super(SCENE_START);
  }

  create(): void {
    this.starting = false;
    this.soloObjects = [];
    this.coopObjects = [];
    this.p2Controls = [];
    this.touchMenu = null;
    this.setup = getSetup(this.registry);
    this.audio = getAudio(this);
    this.audio.startMusicWhenUnlocked();
    this.pads = getGamepadHub(this);
    const inputMode = getInputMode(this);

    const stars = this.add.graphics().setDepth(0);
    drawStarfield(stars, new Starfield(defaultRng));

    addText(this, CENTER_X, 46, 'ASTEROIDS', { size: 60, originX: 0.5, originY: 0.5 });
    if (inputMode.isTouch) {
      this.createTouchMenu(inputMode);
      return;
    }
    this.iconGfx = this.add.graphics().setDepth(2);
    this.buildModeSelector();
    this.buildSoloPage();
    this.buildCoopPage();

    this.clickStarts = !inputMode.env.coarsePrimaryPointer;
    this.prompt = addText(this, CENTER_X, 630, this.clickStarts ? 'Press SPACE or click to start' : 'Press SPACE to start', { size: 32, originX: 0.5, originY: 0.5 });
    this.tweens.add({ targets: this.prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

    // Presses meant for the scene we came from (the BACK that opened this menu, a RETRY that was refused) are not ours.
    this.pads.discardPresses();
    this.padPanel = new ControllerPanel(
      this,
      this.pads,
      () => this.setup.game.playerCount,
      (padKey) => this.pads.cycle(padKey, this.setup.game.playerCount),
      () => this.toggleLayout(),
    );

    this.musicHint = new CachedText(
      addText(this, SCREEN_WIDTH - 12, SCREEN_HEIGHT - 10, '', { size: 18, color: COLORS.dim, originX: 1, originY: 1, bold: false }),
      COLORS.dim,
      18,
    );

    this.volumePanel = new VolumePanel(this, this.audio, CENTER_X, 664, 18, 22, 2);
    // A device that can touch gets a way to turn the touch controls on (desktops without a touch screen never see this). It is a big,
    // green, full-size button (at least 44 CSS px on a phone), not small text: on a phone in keyboard mode it is the only way back.
    if (inputMode.canToggle) {
      new TouchButton(this, SCREEN_WIDTH - 190, 48, 300, 90, 'TOUCH CONTROLS: OFF\nTAP TO TURN ON', () => this.switchInputMode(inputMode), {
        size: 21,
        fill: 0x1d6b3a,
        depth: 5,
      });
    }

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
      const panelKey = (code: string) => (): void => void this.volumePanel.handleKey(code);
      const when = (phase: Phase, action: () => void) => (): void => {
        if (this.phase === phase) action();
      };
      keyboard.on(
        Phaser.Input.Keyboard.Events.ANY_KEY_DOWN,
        createKeyPressDispatcher({
          Space: () => this.start(),
          KeyM: () => this.audio.music.toggleMuted(),
          KeyC: () => this.toggleLayout(),
          Escape: () => this.padPanel.setLayoutVisible(false),
          KeyG: () => {
            const key = this.padPanel.firstPadKey();
            if (key !== null) this.pads.cycle(key, this.setup.game.playerCount);
          },
          ArrowUp: panelKey('ArrowUp'),
          ArrowDown: panelKey('ArrowDown'),
          ArrowLeft: panelKey('ArrowLeft'),
          ArrowRight: panelKey('ArrowRight'),
          Digit1: () => this.setPlayers(1),
          Numpad1: () => this.setPlayers(1),
          Digit2: () => this.setPlayers(2),
          Numpad2: () => this.setPlayers(2),
          KeyL: when('coop', () => this.toggleLives()),
          KeyF: when('coop', () => this.toggleFriendlyFire()),
          KeyK: when('coop', () => this.toggleP2Keys()),
          KeyS: when('coop', () => this.cycleSpeed(0)),
          KeyD: when('coop', () => this.cycleSpeed(1)),
        }),
      );
    }
    // A click anywhere starts the game, except on the clickable options themselves. On a phone (primary pointer is a finger) a touch
    // does not: keyboard mode there has no touch controls, so a stray tap would start a run nobody can steer. Space or a controller still start it.
    const fingerFirst = inputMode.env.coarsePrimaryPointer;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0 && !(fingerFirst && pointer.wasTouch)) this.start();
    });
    this.refresh();
  }

  override update(time: number): void {
    if (this.touchMenu) {
      this.touchMenu.update(time);
      getTouchControls(this).setLayer(this.starting ? 'off' : 'menu');
      // Controller presses are not used on the touch screen; do not let them pile up for the next scene.
      this.pads.discardPresses();
      return;
    }
    this.iconGfx.clear();
    if (this.phase === 'solo') {
      POWERUPS.forEach(([type], i) => drawPowerUpIcon(this.iconGfx, type, SOLO_ICON_X, SOLO_POWERUP_ROW_Y(i), POWERUP_RADIUS, time));
    } else {
      COOP_POWERUPS.forEach(([type], i) => {
        const { x, y } = COOP_POWERUP_POS(i);
        drawPowerUpIcon(this.iconGfx, type, x, y, POWERUP_RADIUS, time);
      });
    }
    this.musicHint.set(`M: music ${this.audio.music.isMuted ? 'off' : 'on'}`);
    this.volumePanel.update();
    this.handlePadPresses();
    this.padPanel.update();
    const count = this.setup.game.playerCount;
    const withPad = (text: string, slot: 0 | 1): string => (this.pads.padFor(slot, count) ? `${text}  + CONTROLLER` : text);
    this.headings.solo?.setText(withPad('CONTROLS', 0));
    this.headings.p1?.setText(withPad('PLAYER 1', 0));
    this.headings.p2?.setText(withPad('PLAYER 2', 1));
    const padReady = this.pads.padFor(0, this.setup.game.playerCount) !== null || this.pads.padFor(1, this.setup.game.playerCount) !== null;
    const click = this.clickStarts ? ', click' : '';
    this.prompt.setText(padReady ? `Press SPACE${click} or A to start` : this.clickStarts ? 'Press SPACE or click to start' : 'Press SPACE to start');
  }

  /**
   * Controller buttons on the title screen, one fresh press at a time. LB / RB give the pad to Player 1 / 2, A (or START) on
   * an unassigned pad joins the first free player and on an assigned pad starts the game, D-pad left / right pick one or
   * two players, Y shows the layout and B / BACK closes it. Nothing here needs the keyboard.
   */
  private handlePadPresses(): void {
    const count = this.setup.game.playerCount;
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
        case 'start':
          if (this.padPanel.layoutVisible) this.padPanel.setLayoutVisible(false);
          else if (assigned) this.start();
          else this.pads.join(press.padKey, count);
          break;
        case 'y':
          this.toggleLayout();
          break;
        case 'b':
        case 'back':
          this.padPanel.setLayoutVisible(false);
          break;
        case 'left':
          this.setPlayers(1);
          break;
        case 'right':
          this.setPlayers(2);
          break;
        default:
          break;
      }
    }
  }

  /**
   * The touch title screen (one player). The simulation is told it is a one-player game so a co-op choice made on the keyboard
   * screen cannot leak into a run that has no way to drive a second ship. Space still starts and M still mutes for anyone with a keyboard.
   */
  private createTouchMenu(inputMode: InputModeController): void {
    if (this.setup.game.playerCount !== 1) {
      this.pads.playerCountChanged(1);
      this.setup = { ...this.setup, game: { ...this.setup.game, playerCount: 1 } };
      setSetup(this.registry, this.setup);
    }
    this.touchMenu = new TouchStartMenu(this, this.audio, inputMode, getSteering(this), {
      start: () => this.start(),
      switchMode: () => this.switchInputMode(inputMode),
    });
    // The title screen shows the system controls (Fullscreen) and none of the game controls; leaving the scene takes them away again.
    const touch = getTouchControls(this);
    touch.setLayer('menu');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => touch.setLayer('off'));
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('SPACE');
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, createKeyPressDispatcher({ Space: () => this.start(), KeyM: () => this.audio.music.toggleMuted() }));
    }
  }

  /**
   * Flips between touch and keyboard / controller controls and rebuilds this screen for the new mode. Once per screen: a second
   * finger landing on the button in the same touch would otherwise flip it straight back (and nothing else may start meanwhile).
   */
  private switchInputMode(inputMode: InputModeController): void {
    if (this.starting) return;
    this.starting = true;
    inputMode.toggle();
    this.scene.restart();
  }

  private toggleLayout(): void {
    this.padPanel.setLayoutVisible(!this.padPanel.layoutVisible);
  }

  private get phase(): Phase {
    return this.setup.game.playerCount === 2 ? 'coop' : 'solo';
  }

  // --- building the screen ---------------------------------------------------

  private buildModeSelector(): void {
    const make = (x: number, label: string, players: 1 | 2): Phaser.GameObjects.Text =>
      addText(this, x, 96, label, { size: 24, originX: 0.5, originY: 0.5 })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.setPlayers(players));
    this.oneLabel = make(CENTER_X - 170, '[1]  ONE PLAYER', 1);
    this.twoLabel = make(CENTER_X + 170, '[2]  TWO PLAYERS', 2);
  }

  private buildSoloPage(): void {
    const add = (o: Phaser.GameObjects.GameObject): void => void this.soloObjects.push(o);
    this.headings.solo = addText(this, CENTER_X, 146, 'CONTROLS', { size: 30, color: COLORS.heading, originX: 0.5, originY: 0.5 });
    add(this.headings.solo);
    CONTROLS.forEach((line, i) => {
      add(addText(this, CENTER_X, 184 + i * 27, line, { size: 20, color: COLORS.hint, originX: 0.5, originY: 0.5, bold: false }));
    });
    add(addText(this, CENTER_X, 357, 'POWER-UPS', { size: 30, color: COLORS.heading, originX: 0.5, originY: 0.5 }));
    POWERUPS.forEach(([type, name, description], i) => {
      const y = SOLO_POWERUP_ROW_Y(i);
      const color = type === 'mega_power' ? '#ff64ff' : toCss(POWERUP_COLOR[type]);
      add(addText(this, CENTER_X - 190, y, name, { size: 22, color, originY: 0.5 }));
      add(addText(this, CENTER_X + 10, y, description, { size: 20, color: COLORS.hint, originY: 0.5, bold: false }));
    });
  }

  private buildCoopPage(): void {
    const add = (o: Phaser.GameObjects.GameObject): void => void this.coopObjects.push(o);
    const column = (x: number, title: string, color: string, lines: readonly string[]): Phaser.GameObjects.Text[] => {
      const heading = addText(this, x, 138, title, { size: 28, color, originY: 0.5 });
      this.headings[title === 'PLAYER 1' ? 'p1' : 'p2'] = heading;
      add(heading);
      return lines.map((line, i) => {
        const text = addText(this, x, 172 + i * 25, line, { size: 19, color: COLORS.hint, originY: 0.5, bold: false });
        add(text);
        return text;
      });
    };
    column(150, 'PLAYER 1', COLORS.player1, P1_CONTROLS);
    this.p2Controls = column(720, 'PLAYER 2', COLORS.player2, P2_CONTROLS.arrows);
    add(addText(this, CENTER_X, 306, 'P  -  Pause        ESC  -  Menu        R  -  Retry', { size: 17, color: COLORS.dim, originX: 0.5, originY: 0.5, bold: false }));

    const option = (y: number, onClick: () => void): CachedText => {
      const text = addText(this, CENTER_X, y, '', { size: 21, color: COLORS.white, originX: 0.5, originY: 0.5 })
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', onClick);
      add(text);
      return new CachedText(text, COLORS.white, 21);
    };
    this.options = {
      lives: option(342, () => this.toggleLives()),
      fire: option(372, () => this.toggleFriendlyFire()),
      keys: option(402, () => this.toggleP2Keys()),
      speeds: option(432, () => this.cycleSpeed(0)),
    };

    add(addText(this, CENTER_X, 476, 'POWER-UPS', { size: 26, color: COLORS.heading, originX: 0.5, originY: 0.5 }));
    COOP_POWERUPS.forEach(([type, name, description], i) => {
      const { x, y } = COOP_POWERUP_POS(i);
      const color = type === 'mega_power' ? '#ff64ff' : toCss(POWERUP_COLOR[type]);
      add(addText(this, x + 32, y, name, { size: 19, color, originY: 0.5 }));
      add(addText(this, x + 190, y, description, { size: 17, color: COLORS.hint, originY: 0.5, bold: false }));
    });
  }

  // --- choices ---------------------------------------------------------------

  private save(): void {
    setSetup(this.registry, this.setup);
    this.refresh();
  }

  private setPlayers(count: 1 | 2): void {
    if (this.setup.game.playerCount === count) return;
    this.pads.playerCountChanged(count);
    this.setup = { ...this.setup, game: { ...this.setup.game, playerCount: count } };
    this.save();
  }

  private toggleLives(): void {
    const livesMode = this.setup.game.livesMode === 'shared' ? 'independent' : 'shared';
    this.setup = { ...this.setup, game: { ...this.setup.game, livesMode } };
    this.save();
  }

  private toggleFriendlyFire(): void {
    this.setup = { ...this.setup, game: { ...this.setup.game, friendlyFire: !this.setup.game.friendlyFire } };
    this.save();
  }

  private toggleP2Keys(): void {
    this.setup = { ...this.setup, p2Keys: this.setup.p2Keys === 'arrows' ? 'ijkl' : 'arrows' };
    this.save();
  }

  private cycleSpeed(player: 0 | 1): void {
    const speed: [number, number] = [this.setup.game.speed[0], this.setup.game.speed[1]];
    const at = SPEED_OPTIONS.indexOf(speed[player]);
    speed[player] = SPEED_OPTIONS[(at + 1) % SPEED_OPTIONS.length] ?? 1;
    this.setup = { ...this.setup, game: { ...this.setup.game, speed } };
    this.save();
  }

  /** Shows the page for the chosen player count and rewrites the option lines. */
  private refresh(): void {
    const coop = this.phase === 'coop';
    this.oneLabel.setColor(coop ? COLORS.dim : COLORS.heading).setAlpha(coop ? 0.7 : 1);
    this.twoLabel.setColor(coop ? COLORS.heading : COLORS.dim).setAlpha(coop ? 1 : 0.7);
    for (const o of this.soloObjects) (o as Phaser.GameObjects.Text).setVisible(!coop);
    for (const o of this.coopObjects) (o as Phaser.GameObjects.Text).setVisible(coop);

    const g = this.setup.game;
    this.options.lives.set(g.livesMode === 'shared' ? '[L]  LIVES:  SHARED  (6 for the team)' : '[L]  LIVES:  INDEPENDENT  (3 each)');
    this.options.fire.set(`[F]  FRIENDLY FIRE:  ${g.friendlyFire ? 'ON' : 'OFF'}`);
    this.options.keys.set(`[K]  PLAYER 2 KEYS:  ${this.setup.p2Keys === 'arrows' ? 'ARROWS + ENTER' : 'I J K L + ;'}`);
    this.options.speeds.set(`[S]  P1 SPEED:  ${speedLabel(g.speed[0])}        [D]  P2 SPEED:  ${speedLabel(g.speed[1])}`);
    P2_CONTROLS[this.setup.p2Keys].forEach((line, i) => this.p2Controls[i]?.setText(line));
  }

  private start(): void {
    if (this.starting) return;
    this.starting = true;
    this.scene.start(SCENE_GAME);
  }
}
