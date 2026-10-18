import { describe, expect, it } from 'vitest';
import {
  AUDIO_ASSETS,
  EXPLOSION_MAX_CONCURRENT,
  MEGA_POWER_MUSIC_SPEED,
  MEGA_POWER_MUSIC_SPEEDUP_ENABLED,
  SFX_VOLUME,
  type SfxKey,
} from '../src/audio/audioConfig';
import { MusicController, type MusicTrack } from '../src/audio/musicController';
import { cueForEvent, explosionKey, SfxPlayer, type PlayingSound, type SfxBackend } from '../src/audio/sfxPlayer';
import type { SimEvent } from '../src/core/game';
import { seededRng } from '../src/core/rng';
import { FRAME, hold, pickupAtShip, quietSim, rock, runFor } from './helpers';

/** Records every play request; sounds last until `finishAll` is called. */
class FakeBackend implements SfxBackend {
  readonly requests: Array<{ key: SfxKey; volume: number }> = [];
  private readonly live: Array<() => void> = [];
  stopped = 0;
  autoFinish = false;

  play(key: SfxKey, volume: number, onFinished: () => void): PlayingSound | null {
    this.requests.push({ key, volume });
    if (this.autoFinish) {
      onFinished();
      return { stop: () => undefined };
    }
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        onFinished();
      }
    };
    this.live.push(finish);
    return {
      stop: () => {
        this.stopped++;
        finish();
      },
    };
  }

  finishAll(): void {
    for (const f of this.live.splice(0)) f();
  }

  count(prefix: string): number {
    return this.requests.filter((r) => r.key.startsWith(prefix)).length;
  }
}

class FakeTrack implements MusicTrack {
  calls: string[] = [];
  rates: number[] = [];
  play(): void {
    this.calls.push('play');
  }
  pause(): void {
    this.calls.push('pause');
  }
  resume(): void {
    this.calls.push('resume');
  }
  setRate(rate: number): void {
    this.rates.push(rate);
  }
  count(call: string): number {
    return this.calls.filter((c) => c === call).length;
  }
}

describe('sound-event mapping (as in the Python play_* calls)', () => {
  const rng = seededRng(5);

  it('maps the events that make noise in Python to the right sounds and volumes', () => {
    expect(cueForEvent({ type: 'laser_fired' }, rng)).toEqual({ key: 'laser', volume: SFX_VOLUME.laser });
    expect(cueForEvent({ type: 'boost_started' }, rng)).toEqual({ key: 'boost', volume: SFX_VOLUME.boost });
    expect(cueForEvent({ type: 'player_hit', livesLeft: 1 }, rng)).toEqual({ key: 'player_death', volume: SFX_VOLUME.player_death });
    const shot = cueForEvent({ type: 'shot_fired' }, rng);
    expect(['shoot_low', 'shoot_mid', 'shoot_high']).toContain(shot?.key);
    expect(shot?.volume).toBe(SFX_VOLUME.shoot);
  });

  it.each([
    [60, 'explosion_large'],
    [50, 'explosion_large'],
    [40, 'explosion_medium'],
    [30, 'explosion_medium'],
    [20, 'explosion_small'],
  ])('a radius-%i asteroid sounds like %s', (radius, key) => {
    expect(explosionKey(radius)).toBe(key);
    expect(cueForEvent({ type: 'asteroid_destroyed', radius, points: 10 }, rng)?.key).toBe(key);
  });

  it('stays silent for wall hits, armored dings, pick-ups, drops and game over (silent in Python)', () => {
    const silent: SimEvent[] = [
      { type: 'wall_bounce' },
      { type: 'asteroid_hit', position: { x: 0, y: 0 } },
      { type: 'powerup_collected', powerType: 'shield' },
      { type: 'powerup_dropped', powerType: 'shield' },
      { type: 'game_over', score: 5 },
    ];
    for (const e of silent) expect(cueForEvent(e, rng)).toBeNull();
  });

  it('every sound it can ask for has a file in the asset list, and the music is listed', () => {
    const keys = new Set(AUDIO_ASSETS.map(([k]) => k));
    for (const k of ['shoot_low', 'shoot_mid', 'shoot_high', 'explosion_small', 'explosion_medium', 'explosion_large', 'laser', 'boost', 'player_death', 'music']) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it('uses the shoot variants evenly', () => {
    const counts: Record<string, number> = {};
    const r = seededRng(1);
    for (let i = 0; i < 3000; i++) {
      const key = cueForEvent({ type: 'shot_fired' }, r)?.key ?? '';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const k of ['shoot_low', 'shoot_mid', 'shoot_high']) expect(counts[k]).toBeGreaterThan(850);
  });
});

describe('SfxPlayer', () => {
  it('plays one sound per event and lets different sounds overlap freely', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    player.handle([{ type: 'shot_fired' }, { type: 'laser_fired' }, { type: 'boost_started' }, { type: 'player_hit', livesLeft: 2 }]);
    expect(backend.requests.map((r) => r.key.split('_')[0])).toEqual(['shoot', 'laser', 'boost', 'player']);
    expect(player.playingCount()).toBe(4);
  });

  it('skips an explosion when 3 of that size are already playing, and frees the slot when one ends', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    const boom: SimEvent = { type: 'asteroid_destroyed', radius: 60, points: 10 };
    player.handle(Array.from({ length: 6 }, () => boom));
    expect(backend.count('explosion_large')).toBe(EXPLOSION_MAX_CONCURRENT);
    expect(player.playingCount('explosion_large')).toBe(3);

    // A different size is not blocked.
    player.handle([{ type: 'asteroid_destroyed', radius: 20, points: 50 }]);
    expect(backend.count('explosion_small')).toBe(1);

    backend.finishAll();
    expect(player.playingCount()).toBe(0);
    player.handle([boom]);
    expect(backend.count('explosion_large')).toBe(4);
  });

  it('does not throttle shots (the original reserves channels so they are never cut off)', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    player.handle(Array.from({ length: 20 }, () => ({ type: 'shot_fired' }) as SimEvent));
    expect(backend.count('shoot')).toBe(20);
  });

  it('copes with a backend that cannot play (locked audio, missing file)', () => {
    const backend: SfxBackend = { play: () => null };
    const player = new SfxPlayer(backend, seededRng(1));
    expect(() => player.handle([{ type: 'laser_fired' }, { type: 'shot_fired' }])).not.toThrow();
    expect(player.played).toBe(0);
    expect(player.playingCount()).toBe(0);
  });

  it('handles sounds that finish immediately without leaking bookkeeping', () => {
    const backend = new FakeBackend();
    backend.autoFinish = true;
    const player = new SfxPlayer(backend, seededRng(1));
    for (let i = 0; i < 50; i++) player.handle([{ type: 'asteroid_destroyed', radius: 60, points: 1 }]);
    expect(backend.count('explosion_large')).toBe(50);
    expect(player.playingCount()).toBe(0);
  });

  it('stopAll silences and forgets everything (restart / scene teardown)', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    player.handle([{ type: 'laser_fired' }, { type: 'asteroid_destroyed', radius: 40, points: 5 }]);
    player.stopAll();
    expect(backend.stopped).toBe(2);
    expect(player.playingCount()).toBe(0);
  });
});

describe('sound frequency against real gameplay', () => {
  it('holding fire for a second makes four shot sounds, with or without Multi-Shot', () => {
    for (const multi of [false, true]) {
      const sim = quietSim();
      sim.player.multiShot = { active: multi, timer: 8 };
      const backend = new FakeBackend();
      const player = new SfxPlayer(backend, seededRng(2));
      for (let i = 0; i < 60; i++) player.handle(sim.step(FRAME, hold({ shoot: true })));
      expect(backend.count('shoot')).toBe(4);
    }
  });

  it('one laser press makes one laser sound however long the key is held', () => {
    const sim = quietSim();
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    for (let i = 0; i < 240; i++) player.handle(sim.step(FRAME, hold({ laser: true })));
    expect(backend.count('laser')).toBe(1);
  });

  it('one boost activation makes one boost sound', () => {
    const sim = quietSim();
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    for (let i = 0; i < 120; i++) player.handle(sim.step(FRAME, hold({ boost: true })));
    expect(backend.count('boost')).toBe(1);
  });

  it('a lost life makes one death sound; a shield-absorbed hit makes none', () => {
    const sim = quietSim();
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    sim.player.shieldActive = true;
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    player.handle(sim.step(FRAME));
    expect(backend.count('player_death')).toBe(0);
    runFor(sim, 2.5); // respawn protection is not active here: the shield was spent, no respawn happened
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    player.handle(sim.step(FRAME));
    expect(backend.count('player_death')).toBe(1);
  });

  it('a laser through six large asteroids queues six explosions but at most 3 sound at once', () => {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    for (let i = 0; i < 6; i++) sim.asteroids.push(rock(300 + i * 100, 360, 60));
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    player.handle(sim.step(FRAME, hold({ laser: true })));
    expect(backend.count('explosion_large')).toBe(3);
    expect(backend.count('laser')).toBe(1);
  });

  it('collecting a pick-up is silent (Python has no pick-up sound)', () => {
    const sim = quietSim();
    pickupAtShip(sim, 'mega_power');
    const backend = new FakeBackend();
    new SfxPlayer(backend, seededRng(2)).handle(sim.step(FRAME));
    expect(backend.requests).toHaveLength(0);
  });
});

describe('MusicController', () => {
  it('does nothing until started, then plays exactly once', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    music.setGamePaused(false);
    expect(track.calls).toEqual([]);
    music.start();
    music.start();
    music.setWindowActive(true);
    expect(track.calls).toEqual(['play']);
    expect(music.currentState).toBe('playing');
  });

  it('pauses and resumes with the game and with window focus / tab visibility', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    music.start();
    music.setGamePaused(true);
    music.setGamePaused(true);
    expect(track.calls).toEqual(['play', 'pause']);
    music.setGamePaused(false);
    music.setWindowActive(false);
    music.setWindowActive(true);
    expect(track.calls).toEqual(['play', 'pause', 'resume', 'pause', 'resume']);
  });

  it('a paused game stays silent when the window regains focus', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    music.start();
    music.setWindowActive(false);
    music.setGamePaused(true);
    music.setWindowActive(true);
    expect(music.currentState).toBe('paused');
    expect(track.count('resume')).toBe(0);
    music.setGamePaused(false);
    expect(music.currentState).toBe('playing');
  });

  it('mute pauses, unmute resumes, and the change is reported for persistence', () => {
    const seen: boolean[] = [];
    const track = new FakeTrack();
    const music = new MusicController(track, { onMuteChanged: (m) => seen.push(m) });
    music.start();
    expect(music.toggleMuted()).toBe(true);
    expect(music.currentState).toBe('paused');
    music.setGamePaused(true);
    music.setMuted(false); // unmuting while the game is paused must not start playback
    expect(music.currentState).toBe('paused');
    music.setGamePaused(false);
    expect(music.currentState).toBe('playing');
    expect(seen).toEqual([true, false]);
  });

  it('starting while muted does not play until unmuted', () => {
    const track = new FakeTrack();
    const music = new MusicController(track, { muted: true });
    music.start();
    expect(track.calls).toEqual([]);
    music.setMuted(false);
    expect(track.calls).toEqual(['play']);
  });

  it('never plays a second copy of the track, however much pausing and restarting happens', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    for (let i = 0; i < 20; i++) {
      music.start();
      music.setGamePaused(true);
      music.setGamePaused(false);
      music.setMegaPowerActive(true);
      music.setMegaPowerActive(false);
    }
    expect(track.count('play')).toBe(1);
  });

  describe('Mega Power speed-up', () => {
    it('ships disabled, like the Python game (MEGA_POWER_MUSIC_SPEEDUP_ENABLED = False)', () => {
      expect(MEGA_POWER_MUSIC_SPEEDUP_ENABLED).toBe(false);
      const track = new FakeTrack();
      const music = new MusicController(track);
      music.start();
      music.setMegaPowerActive(true);
      expect(track.rates).toEqual([]);
      expect(music.playbackRate).toBe(1);
    });

    it('when enabled, plays the same track 1.26x faster during Mega Power and restores it afterwards', () => {
      const track = new FakeTrack();
      const music = new MusicController(track, { megaPowerSpeedup: true });
      music.start();
      music.setMegaPowerActive(true);
      expect(music.playbackRate).toBe(MEGA_POWER_MUSIC_SPEED);
      expect(track.rates).toEqual([1.26]);
      music.setMegaPowerActive(false);
      expect(track.rates).toEqual([1.26, 1]);
      expect(track.count('play')).toBe(1);
    });

    it('re-collecting Mega Power does not re-apply the rate or restart the music', () => {
      const track = new FakeTrack();
      const music = new MusicController(track, { megaPowerSpeedup: true });
      music.start();
      for (let i = 0; i < 10; i++) music.setMegaPowerActive(true);
      expect(track.rates).toEqual([1.26]);
      expect(track.count('play')).toBe(1);
    });

    it('survives pausing mid-effect and a restart (scene teardown resets it)', () => {
      const track = new FakeTrack();
      const music = new MusicController(track, { megaPowerSpeedup: true });
      music.start();
      music.setMegaPowerActive(true);
      music.setGamePaused(true);
      expect(music.playbackRate).toBe(1.26); // pausing does not disturb the speed
      // What GameScene does when it shuts down for a restart:
      music.setGamePaused(false);
      music.setMegaPowerActive(false);
      expect(music.currentState).toBe('playing');
      expect(music.playbackRate).toBe(1);
      expect(track.count('play')).toBe(1);
    });

    it('is driven by a real Mega Power pick-up and expiry in the simulation', () => {
      const sim = quietSim();
      const track = new FakeTrack();
      const music = new MusicController(track, { megaPowerSpeedup: true });
      music.start();
      pickupAtShip(sim, 'mega_power');
      const seen: number[] = [];
      for (let i = 0; i < 60 * 7; i++) {
        sim.step(FRAME);
        music.setMegaPowerActive(sim.player.megaPower.active);
        if (seen[seen.length - 1] !== music.playbackRate) seen.push(music.playbackRate);
      }
      expect(seen).toEqual([1.26, 1]);
    });
  });
});
