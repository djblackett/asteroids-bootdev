import {
  CHAIN_LIGHTNING_DURATION,
  CHAIN_LIGHTNING_MAX_TARGETS,
  CHAIN_LIGHTNING_RANGE,
  MEGA_POWER_DURATION,
  MULTI_SHOT_DURATION,
  PLAYER_SHOOT_COOLDOWN,
  RAPID_FIRE_COOLDOWN,
  RAPID_FIRE_DURATION,
  REVIVE_LIVES,
  SLOW_MOTION_DURATION,
  SLOW_MOTION_FACTOR,
} from '../../core/constants';
import type { PowerUpType } from '../../core/powerup';
import { toCss } from '../../render/colors';
import { POWERUP_COLOR } from '../../render/powerupIcons';

/**
 * What the menus say about each power-up. The numbers in the sentences are the simulation's own constants (never retyped), so the text
 * cannot drift from the rules; the colours are the ones the pick-ups are drawn in. Pure data: no Phaser.
 */
export interface PowerUpInfo {
  type: PowerUpType;
  /** As printed on the title screen legend and the guide. */
  name: string;
  /** A few words for the compact legend (at most `SHORT_MAX` characters: the legend cell is that narrow). */
  short: string;
  /** The plain-English sentence for the guide. */
  detail: string;
  /** Only ever appears in a two-player game. */
  coopOnly: boolean;
  /** The label colour: the pick-up's own colour (MEGA POWER is drawn in rainbow, its label in the pink the old title screen used). */
  color: string;
}

export const SHORT_MAX = 14;

const seconds = (s: number): string => `${s} second${s === 1 ? '' : 's'}`;

const color = (type: PowerUpType): string => toCss(POWERUP_COLOR[type]);

/** The six one-player power-ups, then Revive. */
export const POWERUP_INFO: readonly PowerUpInfo[] = [
  {
    type: 'rapid_fire',
    name: 'RAPID FIRE',
    short: 'Shoot faster',
    detail: `Shoots ${Math.round(PLAYER_SHOOT_COOLDOWN / RAPID_FIRE_COOLDOWN)}x faster for ${seconds(RAPID_FIRE_DURATION)}.`,
    coopOnly: false,
    color: color('rapid_fire'),
  },
  {
    type: 'multi_shot',
    name: 'MULTI-SHOT',
    short: 'Triple shot',
    detail: `Fires 3 bullets at once, in a fan, for ${seconds(MULTI_SHOT_DURATION)}.`,
    coopOnly: false,
    color: color('multi_shot'),
  },
  {
    type: 'shield',
    name: 'SHIELD',
    short: 'Blocks 1 hit',
    detail: 'Absorbs the next hit. It lasts until it is used.',
    coopOnly: false,
    color: color('shield'),
  },
  {
    type: 'slow_motion',
    name: 'SLOW MOTION',
    short: 'Slow asteroids',
    detail: `Asteroids move at ${Math.round(SLOW_MOTION_FACTOR * 100)}% speed for ${seconds(SLOW_MOTION_DURATION)}.`,
    coopOnly: false,
    color: color('slow_motion'),
  },
  {
    type: 'chain_lightning',
    name: 'LIGHTNING',
    short: 'Chain hits',
    detail: `Charged bullets jump to ${CHAIN_LIGHTNING_MAX_TARGETS} more asteroids within ${CHAIN_LIGHTNING_RANGE} px per jump, for ${seconds(CHAIN_LIGHTNING_DURATION)}.`,
    coopOnly: false,
    color: color('chain_lightning'),
  },
  {
    type: 'mega_power',
    name: 'MEGA POWER',
    short: '4 powers!',
    detail: `Rapid Fire + Multi-Shot + Shield + Slow Motion at once, for ${seconds(MEGA_POWER_DURATION)}. The shield stays until hit.`,
    coopOnly: false,
    color: color('mega_power'),
  },
  {
    type: 'revive',
    name: 'REVIVE',
    short: 'Revive partner',
    detail: `Brings back a teammate who is out of lives, with ${REVIVE_LIVES} lives. Two-player games with separate lives only.`,
    coopOnly: true,
    color: color('revive'),
  },
];

/** What the compact legend on the title screen lists: the one-player six, plus Revive when two players are on. */
export function legendFor(playerCount: 1 | 2): readonly PowerUpInfo[] {
  return playerCount === 2 ? POWERUP_INFO : POWERUP_INFO.filter((p) => !p.coopOnly);
}
