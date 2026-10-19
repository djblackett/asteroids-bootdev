import { describe, expect, it } from 'vitest';
import { SFX_GAIN, UFO_EXPLOSION_GAIN_SCALE } from '../src/audio/audioConfig';
import { cueForEvent, SfxPlayer } from '../src/audio/sfxPlayer';
import type { SimEvent } from '../src/core/game';
import { seededRng } from '../src/core/rng';
import { FakeBackend } from './audioFakes';
import { FRAME, parkedUfoFor, quietSim, runFor, shotAt } from './helpers';

describe('UFO sounds', () => {
  const rng = seededRng(5);

  it('a destroyed UFO reuses the explosion samples: large = medium, small = small, at the UFO gain scale', () => {
    const large: SimEvent = { type: 'ufo_destroyed', ufoType: 'large', points: 200, radius: 30, position: { x: 0, y: 0 } };
    const small: SimEvent = { type: 'ufo_destroyed', ufoType: 'small', points: 500, radius: 20, position: { x: 0, y: 0 } };
    expect(cueForEvent(large, rng)).toEqual({ key: 'explosion_medium', volume: SFX_GAIN.explosion_medium * UFO_EXPLOSION_GAIN_SCALE });
    expect(cueForEvent(small, rng)).toEqual({ key: 'explosion_small', volume: SFX_GAIN.explosion_small * UFO_EXPLOSION_GAIN_SCALE });
  });

  it('the UFO gain scale starts neutral, so the approved explosion level is what a UFO kill gets', () => {
    expect(UFO_EXPLOSION_GAIN_SCALE).toBe(1);
  });

  it('spawning, firing and the kill-streak banner make no sound (silent in Python)', () => {
    const silent: SimEvent[] = [
      { type: 'ufo_spawned', ufoType: 'large' },
      { type: 'ufo_fired', ufoType: 'small' },
      { type: 'kill_streak', kills: 15, name: 'KILLING SPREE!', color: 0xffc832 },
    ];
    for (const e of silent) expect(cueForEvent(e, rng)).toBeNull();
  });

  it('being hit by a UFO or its shot plays the normal death sound, once; absorbed hits are silent', () => {
    const hit = (source: 'ufo' | 'ufo_shot'): SimEvent => ({ type: 'player_hit', livesLeft: 2, source });
    expect(cueForEvent(hit('ufo'), rng)?.key).toBe('player_death');
    expect(cueForEvent(hit('ufo_shot'), rng)?.key).toBe('player_death');

    const sim = quietSim();
    sim.player.shieldActive = true;
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    const ufo = parkedUfoFor(sim, 'large', sim.player.position.x + 20, sim.player.position.y);
    player.handle(sim.step(FRAME)); // shield absorbs
    expect(backend.requests).toHaveLength(0);
    expect(ufo.alive).toBe(true);
    player.handle(sim.step(FRAME)); // next frame of contact costs the life
    expect(backend.count('player_death')).toBe(1);
  });

  it('one UFO kill is exactly one explosion cue, even with several shots and a ram on top of it', () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    parkedUfoFor(sim, 'large', sim.player.position.x + 45, sim.player.position.y);
    sim.shots.push(shotAt(sim.player.position.x + 45, sim.player.position.y), shotAt(sim.player.position.x + 44, sim.player.position.y));
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    for (let i = 0; i < 20; i++) player.handle(sim.step(FRAME));
    expect(backend.count('explosion')).toBe(1);
  });

  it('a long UFO fight stays inside the explosion limiter (<= 4 explosions inside the overlap window)', () => {
    const sim = quietSim(3);
    sim.player.lives = 999;
    const backend = new FakeBackend();
    let now = 0;
    const player = new SfxPlayer(backend, seededRng(1), { clock: () => now });
    for (let i = 0; i < 10; i++) {
      parkedUfoFor(sim, 'large', 300 + i * 80, 200);
      sim.shots.push(shotAt(300 + i * 80, 200));
    }
    for (let i = 0; i < 30; i++) {
      now += FRAME;
      player.handle(sim.step(FRAME));
    }
    runFor(sim, 0.1);
    expect(backend.count('explosion')).toBeLessThanOrEqual(4);
    expect(backend.count('explosion')).toBeGreaterThan(0);
  });
});
