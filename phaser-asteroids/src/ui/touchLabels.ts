import { LASER_BEAM_MAX_SHOTS } from '../core/constants';
import type { PlayerState } from '../core/player';
import type { AbilityLabels } from '../input/touchControls';

/** Seconds shown on a countdown: the HUD's `int(timer) + 1`, so the button and the HUD text never disagree. */
const secondsLeft = (timer: number): number => Math.trunc(Math.max(timer, 0)) + 1;

/**
 * What the LASER and BOOST buttons print: the charges left and the boost state, read from the same fields the HUD text at the top
 * left reads. `Ready` flags only dim the buttons; pressing a dimmed button is still allowed (the simulation decides, as with a key).
 */
export function abilityLabels(player: Pick<PlayerState, 'laser' | 'boost'>): AbilityLabels {
  const { laser, boost } = player;
  return {
    laserCharges: Math.min(laser.shotsRemaining, LASER_BEAM_MAX_SHOTS),
    laserReady: laser.shotsRemaining > 0 && laser.cooldown <= 0,
    boostText: boost.active ? `${secondsLeft(boost.timer)}s` : boost.cooldown > 0 ? `${secondsLeft(boost.cooldown)}s` : 'READY',
    boostReady: !boost.active && boost.cooldown <= 0,
  };
}
