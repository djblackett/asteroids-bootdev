import type Phaser from 'phaser';
import { LASER_BEAM_MAX_SHOTS, SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import type { GameSim } from '../core/game';
import { bannerPose, comboMultiplier, type StreakBanner } from '../core/scoring';
import { rainbowColor, scaleColor, toCss } from '../render/colors';
import { addText, COLORS, formatClock } from './text';

/**
 * Changing a Text object's string, colour or size re-rasterises it, so everything here only
 * touches a Text when its value actually changes.
 */
export class CachedText {
  private content = '';
  private visible = true;
  private color: string;
  private size: number;

  constructor(readonly text: Phaser.GameObjects.Text, color: string, size: number) {
    this.color = color;
    this.size = size;
  }

  set(content: string, color: string = this.color, size: number = this.size): void {
    if (content !== this.content) {
      this.content = content;
      this.text.setText(content);
    }
    if (color !== this.color) {
      this.color = color;
      this.text.setColor(color);
    }
    if (size !== this.size) {
      this.size = size;
      this.text.setFontSize(size);
    }
  }

  setY(y: number): void {
    if (this.text.y !== y) this.text.setY(y);
  }

  setVisible(visible: boolean): void {
    if (visible !== this.visible) {
      this.visible = visible;
      this.text.setVisible(visible);
    }
  }
}

/**
 * Touch mode draws the top-left readouts larger: on a phone the 1280x720 canvas is shown at about half size, which would make
 * the default 20 px text about 10 CSS px. Desktop passes no scale (1) and is unchanged.
 */
export const TOUCH_HUD_SCALE = 1.4;

const PLAYER_COLORS: readonly string[] = [COLORS.player1, COLORS.player2];
export const playerColor = (index: number): string => PLAYER_COLORS[index] ?? COLORS.white;

/**
 * Score / lives / clock. One player: top left, exactly as before. Two players: Player 1 top left, Player 2 top right
 * (as in Python), the clock stays in the middle. In a shared-lives game the per-player lives are replaced by the team's
 * `SHARED LIVES` line (see `TeamHud`). A ship that is out of lives shows `OUT` in grey.
 */
export class Hud {
  private readonly scores: CachedText[];
  private readonly lives: CachedText[];
  private readonly clock: CachedText;

  constructor(scene: Phaser.Scene, playerCount = 1, scale = 1) {
    const make = (x: number, y: number, size: number, color: string, originX = 0): CachedText =>
      new CachedText(addText(scene, x, y, '', { size: Math.round(size * scale), color, originX }).setDepth(10), color, Math.round(size * scale));
    this.scores = [];
    this.lives = [];
    for (let i = 0; i < playerCount; i++) {
      const right = i === 1;
      const x = right ? SCREEN_WIDTH - 10 : 10;
      const color = playerColor(i);
      this.scores.push(make(x, 10, 20, color, right ? 1 : 0));
      this.lives.push(make(x, 45 * scale, 20, color, right ? 1 : 0));
    }
    this.clock = make(SCREEN_WIDTH / 2, 10, 34, COLORS.white, 0.5);
  }

  update(sim: GameSim): void {
    const shared = sim.sharedLives !== null;
    sim.players.forEach((player, i) => {
      const out = player.lives <= 0;
      const color = out ? COLORS.dead : playerColor(i);
      this.scores[i]?.set(`P${player.playerNumber}: ${player.score}`, color);
      const lives = this.lives[i];
      if (!lives) return;
      lives.setVisible(!shared);
      lives.set(out && sim.players.length > 1 && !sim.isGameOver ? 'OUT' : `Lives: ${Math.max(player.lives, 0)}`, color);
    });
    this.clock.set(formatClock(sim.time));
  }
}

const COMBO_X = SCREEN_WIDTH - 250;
const COMBO_Y = 100;
/** In a two-player game the upper right belongs to Player 2's readouts, so the combo sits at the bottom centre. */
const COMBO_X_COOP = SCREEN_WIDTH / 2;
const COMBO_Y_COOP = SCREEN_HEIGHT - 120;

/**
 * Python `draw_combo`: from the second kill of a combo, "Nx COMBO" and the multiplier in the upper right, yellow, then
 * orange from 3 and purple from 5 kills. Hidden at game over (the original does not draw it there).
 */
export class ComboHud {
  private readonly count: CachedText;
  private readonly multiplier: CachedText;

  constructor(scene: Phaser.Scene, twoPlayers = false) {
    const x = twoPlayers ? COMBO_X_COOP : COMBO_X;
    const y = twoPlayers ? COMBO_Y_COOP : COMBO_Y;
    const make = (textY: number, size: number): CachedText =>
      new CachedText(addText(scene, x, textY, '', { size, color: '#ffff00', originX: 0.5, originY: 0.5 }).setDepth(10), '#ffff00', size);
    this.count = make(y, 44);
    this.multiplier = make(y + 46, 20);
  }

  update(sim: GameSim): void {
    const kills = sim.combo.count;
    const show = kills > 1 && !sim.isGameOver;
    this.count.setVisible(show);
    this.multiplier.setVisible(show);
    if (!show) return;
    const color = kills >= 5 ? '#ff64ff' : kills >= 3 ? '#ffa500' : '#ffff00';
    this.count.set(`${kills}x COMBO`, color);
    this.multiplier.set(`${comboMultiplier(kills).toFixed(1)}x Points!`, color);
  }
}

const BANNER_X = SCREEN_WIDTH / 2;
const BANNER_Y = 80;

/**
 * Python `KillStreakNotification`: "N KILLS" over the milestone's name at the top centre, slid in from above, faded in
 * and out and pulsing, in the milestone's colour with a dimmer glow. It is only decoration: it never takes input or
 * blocks anything, and a newer milestone simply replaces it. The two Text objects are reused; their style is only
 * rewritten when a new banner starts, and each frame only moves, scales and fades them.
 */
export class KillStreakBanner {
  private readonly count: Phaser.GameObjects.Text;
  private readonly name: Phaser.GameObjects.Text;
  private shown: StreakBanner | null = null;

  constructor(scene: Phaser.Scene) {
    this.count = addText(scene, BANNER_X, BANNER_Y, '', { size: 28, originX: 0.5, originY: 0.5 }).setDepth(11).setVisible(false);
    this.name = addText(scene, BANNER_X, BANNER_Y, '', { size: 46, originX: 0.5, originY: 0.5 }).setDepth(11).setVisible(false);
  }

  update(sim: GameSim): void {
    const banner = sim.streakBanner;
    if (!banner || sim.isGameOver) {
      if (this.shown !== null || this.count.visible) {
        this.shown = null;
        this.count.setVisible(false);
        this.name.setVisible(false);
      }
      return;
    }
    if (banner !== this.shown) {
      this.shown = banner;
      const color = toCss(banner.color);
      const glow = toCss(scaleColor(banner.color, 0.5));
      this.count.setText(`${banner.kills} KILLS`).setColor(color).setStroke(glow, 4).setVisible(true);
      this.name.setText(banner.name).setColor(color).setStroke(glow, 6).setVisible(true);
    }
    const pose = bannerPose(banner.timer, banner.duration);
    const y = BANNER_Y + pose.yOffset;
    this.count.setPosition(BANNER_X, y - 25).setScale(pose.scale).setAlpha(pose.alpha);
    this.name.setPosition(BANNER_X, y + 20).setScale(pose.scale).setAlpha(pose.alpha);
  }
}

const HUD_BLUE = '#64c8ff';
const HUD_GREY = '#646464';
const HUD_COOLDOWN = '#969696';
const HUD_GREEN = '#64ff64';
const HUD_BOOST = '#ff64ff';
const HUD_RAPID = '#ffff00';
const HUD_MULTI = '#ffa500';
const HUD_SHIELD = '#00ffff';
const HUD_SLOW = '#ff00ff';

/** Seconds shown on a countdown: Python's `int(timer) + 1`. */
const secondsLeft = (timer: number): number => Math.trunc(Math.max(timer, 0)) + 1;

interface Line {
  text: string;
  color: string;
  size: number;
  gap: number;
}

/**
 * Laser charges, boost state and active power-ups, stacked under the lives counter (Python
 * `draw_powerup_indicator`). While MEGA POWER is on it replaces the individual power-up lines. One per ship: Player 1's
 * on the left, Player 2's right-aligned on the right. In a one-player game Slow Motion is listed here; with two players
 * it is a world effect and shown by the `TeamHud` instead. A ship that is out of lives shows its way back instead.
 */
export class AbilityHud {
  private readonly lines: CachedText[];

  constructor(
    scene: Phaser.Scene,
    private readonly index = 0,
    private readonly scale = 1,
  ) {
    const right = index === 1;
    const x = right ? SCREEN_WIDTH - 10 : 10;
    const size = Math.round(20 * scale);
    this.lines = Array.from({ length: 7 }, () => {
      const text = addText(scene, x, 80 * scale, '', { size, originX: right ? 1 : 0 }).setDepth(10);
      return new CachedText(text, COLORS.white, size);
    });
  }

  update(sim: GameSim, timeMs: number): void {
    const p = sim.players[this.index];
    const rows: Line[] = [];
    const row = (text: string, color: string, size = 20, gap = 30): number => rows.push({ text, color, size, gap });
    const single = sim.players.length === 1;

    if (p && p.lives <= 0 && !single) {
      if (!sim.isGameOver) {
        if (sim.reviveOnField) row('REVIVE ON FIELD!', HUD_REVIVE);
        else if (sim.config.livesMode === 'independent') row('NEEDS A REVIVE', COLORS.dead);
      }
    } else if (p) {
      row(`LASER: ${p.laser.shotsRemaining}/${LASER_BEAM_MAX_SHOTS}`, p.laser.shotsRemaining > 0 ? HUD_BLUE : HUD_GREY);

      if (p.boost.active) row(`BOOST: ${secondsLeft(p.boost.timer)}s`, HUD_BOOST);
      else if (p.boost.cooldown > 0) row(`BOOST: ${secondsLeft(p.boost.cooldown)}s CD`, HUD_COOLDOWN);
      else row('BOOST: READY', HUD_GREEN);

      if (p.megaPower.active) {
        // Rainbow text; the hue only moves 10 degrees per second so this re-renders ~10x a second.
        row(`*** MEGA POWER: ${secondsLeft(p.megaPower.timer)}s ***`, toCss(rainbowColor(timeMs)), 29, 45);
      } else {
        if (p.rapidFire.active) row(`RAPID FIRE: ${secondsLeft(p.rapidFire.timer)}s`, HUD_RAPID);
        if (p.multiShot.active) row(`MULTI-SHOT: ${secondsLeft(p.multiShot.timer)}s`, HUD_MULTI);
        if (p.shieldActive) row('SHIELD: ACTIVE', HUD_SHIELD);
        if (single && sim.slowMotion.active) row(`SLOW MOTION: ${secondsLeft(sim.slowMotion.timer)}s`, HUD_SLOW);
      }
      // Independent of Mega Power: it neither grants nor hides Lightning.
      if (p.chainLightning.active) row(`LIGHTNING: ${Math.ceil(p.chainLightning.timer)}s`, '#39cfff');
    }

    const k = this.scale;
    let y = 80 * k;
    this.lines.forEach((line, i) => {
      const r = rows[i];
      line.setVisible(r !== undefined);
      if (!r) return;
      line.set(r.text, r.color, Math.round(r.size * k));
      line.setY(y);
      y += r.gap * k;
    });
  }
}

const HUD_REVIVE = '#00ff64';
const TOAST_MS = 2200;

/**
 * Two-player only: what belongs to the whole team. Slow Motion (a world effect) in the top centre, `SHARED LIVES: n` at
 * the bottom centre in a shared-lives game, and a short "PLAYER n IS BACK!" toast when a Revive works.
 */
export class TeamHud {
  private readonly slow: CachedText;
  private readonly shared: CachedText;
  private readonly toast: CachedText;
  private toastUntil = 0;

  constructor(scene: Phaser.Scene) {
    const make = (y: number, size: number, color: string): CachedText =>
      new CachedText(addText(scene, SCREEN_WIDTH / 2, y, '', { size, color, originX: 0.5, originY: 0.5 }).setDepth(10), color, size);
    // Below the kill-streak banner (which owns y = 40-126 at the top centre) and clear of the bottom-centre combo readout.
    this.slow = make(150, 20, HUD_SLOW);
    this.shared = make(SCREEN_HEIGHT - 30, 24, '#64ffff');
    this.toast = make(184, 30, HUD_REVIVE);
  }

  /** Shows `text` for a couple of seconds (a newer toast replaces it). */
  flash(text: string, color: string, nowMs: number): void {
    this.toast.set(text, color);
    this.toastUntil = nowMs + TOAST_MS;
  }

  update(sim: GameSim, nowMs: number): void {
    const slow = sim.slowMotion.active && !sim.isGameOver;
    this.slow.setVisible(slow);
    if (slow) this.slow.set(`SLOW MOTION: ${secondsLeft(sim.slowMotion.timer)}s`);
    const pool = sim.sharedLives;
    this.shared.setVisible(pool !== null);
    if (pool !== null) this.shared.set(`SHARED LIVES: ${Math.max(pool, 0)}`);
    this.toast.setVisible(nowMs < this.toastUntil && !sim.isGameOver);
  }
}

/** Dimmed full-screen panel with a big title and a few lines of text; used for pause and game over. */
export class Overlay {
  private readonly container: Phaser.GameObjects.Container;
  private readonly title: CachedText;
  private readonly lines: CachedText[];

  constructor(scene: Phaser.Scene, dimAlpha: number, titleSize: number, titleY: number, lineCount: number) {
    const dim = scene.add.rectangle(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, SCREEN_WIDTH, SCREEN_HEIGHT, 0x000000, dimAlpha);
    const titleText = addText(scene, SCREEN_WIDTH / 2, titleY, '', { size: titleSize, originX: 0.5, originY: 0.5 });
    const lineTexts = Array.from({ length: lineCount }, () =>
      addText(scene, SCREEN_WIDTH / 2, 0, '', { size: 22, originX: 0.5, originY: 0.5 }),
    );
    this.title = new CachedText(titleText, COLORS.white, titleSize);
    this.lines = lineTexts.map((t) => new CachedText(t, COLORS.white, 22));
    this.container = scene.add.container(0, 0, [dim, titleText, ...lineTexts]).setDepth(20).setVisible(false);
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible);
  }

  setTitle(text: string): void {
    this.title.set(text);
  }

  setLine(index: number, text: string, y: number, color: string = COLORS.hint, size = 22): void {
    const line = this.lines[index];
    if (!line) return;
    line.set(text, color, size);
    if (line.text.y !== y) line.text.setY(y);
  }
}
