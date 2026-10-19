import {
  COMBO_MULTIPLIERS,
  COMBO_TIMEOUT,
  KILL_STREAK_MILESTONES,
  KILL_STREAK_NOTIFICATION_DURATION,
  type KillStreakMilestone,
} from './constants';

/**
 * Combo and kill-streak bookkeeping, ported from the Python `collisions.py` / `gamestate.py` / `killstreak.py`.
 *
 * What counts as a kill (each one advances the combo by exactly one and is scored at the new multiplier):
 * an asteroid that is actually destroyed by a player shot, a Laser Beam hit, a boost ram, or a UFO shot.
 * It does NOT count: a non-lethal armored hit, an asteroid that crashes into the ship (shielded or not), or a UFO
 * (UFOs pay a flat 200 / 500). The combo is only reset by its 3 s timer or a new game, never by losing a life.
 */

export interface ComboState {
  /** Kills in the current combo; this is also the kill-streak counter. */
  count: number;
  /** Seconds until the combo expires; 0 when no combo is running. */
  timer: number;
  /** Highest kill-streak milestone already announced in this combo. */
  lastMilestone: number;
}

export function createCombo(): ComboState {
  return { count: 0, timer: 0, lastMilestone: 0 };
}

/** Python `COMBO_MULTIPLIERS.get(count, COMBO_MULTIPLIERS[5])`. */
export function comboMultiplier(count: number): number {
  return COMBO_MULTIPLIERS[count] ?? COMBO_MULTIPLIERS[5] ?? 1;
}

/** Python `int(base_points * multiplier)`. */
export function scaledPoints(basePoints: number, multiplier: number): number {
  return Math.trunc(basePoints * multiplier);
}

export interface KillCredit {
  /** Combo count including this kill (1 for the first). */
  count: number;
  /** Score multiplier for this kill. */
  multiplier: number;
  /** Set when this kill reached a new kill-streak milestone. */
  milestone: KillStreakMilestone | null;
}

/** Python `check_kill_streak_milestone`: the highest milestone reached that is above the last announced one. */
export function milestoneFor(count: number, lastMilestone: number): KillStreakMilestone | null {
  for (let i = KILL_STREAK_MILESTONES.length - 1; i >= 0; i--) {
    const m = KILL_STREAK_MILESTONES[i];
    if (m && count >= m.kills && m.kills > lastMilestone) return m;
  }
  return null;
}

/** Python `increment_combo_and_check_streak`: one kill. Restarts the 3 s window. */
export function registerKill(combo: ComboState): KillCredit {
  combo.count += 1;
  combo.timer = COMBO_TIMEOUT;
  const milestone = milestoneFor(combo.count, combo.lastMilestone);
  if (milestone) combo.lastMilestone = milestone.kills;
  return { count: combo.count, multiplier: comboMultiplier(combo.count), milestone };
}

/** Counts the window down. @returns true on the step in which the combo expired and was cleared. */
export function tickCombo(combo: ComboState, dt: number): boolean {
  if (combo.timer <= 0) return false;
  combo.timer -= dt;
  if (combo.timer > 0) return false;
  resetCombo(combo);
  return true;
}

export function resetCombo(combo: ComboState): void {
  combo.count = 0;
  combo.timer = 0;
  combo.lastMilestone = 0;
}

/** The big banner for a milestone. A newer milestone replaces the one on screen (there is no queue). */
export interface StreakBanner {
  kills: number;
  name: string;
  color: number;
  /** Seconds left. */
  timer: number;
  duration: number;
}

export function createBanner(milestone: KillStreakMilestone): StreakBanner {
  return {
    kills: milestone.kills,
    name: milestone.name,
    color: milestone.color,
    timer: KILL_STREAK_NOTIFICATION_DURATION,
    duration: KILL_STREAK_NOTIFICATION_DURATION,
  };
}

/** @returns false once the banner has run out. */
export function tickBanner(banner: StreakBanner, dt: number): boolean {
  banner.timer -= dt;
  return banner.timer > 0;
}

export interface BannerPose {
  /** 0..1: fades in over the first 15 % of the banner's life and out over the last 15 %. */
  alpha: number;
  /** Pixels above its resting place: slides down from -100 during the first 20 %. */
  yOffset: number;
  /** 1..1.075 pulse, two beats per second. */
  scale: number;
}

/** The Python `KillStreakNotification.draw` animation curves. */
export function bannerPose(timer: number, duration: number): BannerPose {
  const progress = 1 - timer / duration;
  const alpha = progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
  const yOffset = progress < 0.2 ? -100 * (1 - progress / 0.2) : 0;
  const scale = 1 + 0.15 * Math.abs(((timer * 2) % 1) - 0.5);
  return { alpha: Math.min(1, Math.max(0, alpha)), yOffset, scale };
}
