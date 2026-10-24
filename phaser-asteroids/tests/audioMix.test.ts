import { describe, expect, it } from 'vitest';
import {
  AUDIO_ASSETS,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  EXPLOSION_GAIN,
  EXPLOSION_MAX_CONCURRENT,
  EXPLOSION_MAX_TOTAL,
  EXPLOSION_SIZE_RATIO,
  MUSIC_MAX_GAIN,
  MUSIC_MUTE_STORAGE_KEY,
  MUSIC_VOLUME_STORAGE_KEY,
  OVERLAP_FALLOFF,
  OVERLAP_FALLOFF_MAX_STEPS,
  OVERLAP_WINDOW_SECONDS,
  SFX_GAIN,
  SFX_GROUP,
  SFX_VOLUME_STORAGE_KEY,
  VOLUME_STEP,
  type SfxKey,
} from '../src/audio/audioConfig';
import { adjustVolume, createAudioParts, volumeOf } from '../src/audio/audioSetup';
import { clampVolume, formatPercent, loadFlag, loadVolume, musicGain, saveFlag, saveVolume, stepVolume } from '../src/audio/audioSettings';
import { MusicController } from '../src/audio/musicController';
import { SfxPlayer, type PlayingSound, type SfxBackend } from '../src/audio/sfxPlayer';
import type { SimEvent } from '../src/core/game';
import { seededRng } from '../src/core/rng';
import { FakeBackend, FakeStorage, FakeTrack } from './audioFakes';
import { FRAME, hold, quietSim } from './helpers';

const SHOT: SimEvent = { type: 'shot_fired' };
const boom = (radius: number): SimEvent => ({ type: 'asteroid_destroyed', radius, points: 10 });
const LARGE = boom(60);
const MEDIUM = boom(40);
const SMALL = boom(20);

/** Length in seconds of each sound file (measured with ffmpeg); only used to know when sounds overlap. */
const DURATION: Record<SfxKey, number> = {
  shoot_low: 0.3,
  shoot_mid: 0.29,
  shoot_high: 0.28,
  explosion_small: 2.24,
  explosion_medium: 4.94,
  explosion_large: 12.34,
  laser: 2.04,
  lightning: 0.11,
  boost: 0.77,
  player_death: 3.35,
};

/** A backend on a virtual clock: sounds end by themselves, so overlap works as in the browser. */
class TimedBackend implements SfxBackend {
  now = 0;
  /** The browser reports a sound as finished a little after its nominal length. */
  endLatency = 0;
  readonly started: Array<{ key: SfxKey; volume: number; at: number }> = [];
  private live: Array<{ end: number; volume: number; finish: () => void }> = [];

  play(key: SfxKey, volume: number, onFinished: () => void): PlayingSound | null {
    this.started.push({ key, volume, at: this.now });
    let done = false;
    const entry = {
      end: this.now + DURATION[key] + this.endLatency,
      volume,
      finish: () => {
        if (done) return;
        done = true;
        this.live = this.live.filter((e) => e !== entry);
        onFinished();
      },
    };
    this.live.push(entry);
    return { stop: entry.finish };
  }

  advanceTo(time: number): void {
    this.now = time;
    for (const entry of [...this.live]) if (entry.end <= time) entry.finish();
  }

  /** Sum of the gains of everything playing right now: what the speakers are asked to add up. */
  get liveGain(): number {
    return this.live.reduce((sum, e) => sum + e.volume, 0);
  }
}

function newParts(storage = new FakeStorage()) {
  const track = new FakeTrack();
  const backend = new FakeBackend();
  // These tests are about the volumes, so the soundtrack is pinned to Original (the level the volume maths below assumes);
  // the default soundtrack choice has its own tests in musicTracks.test.ts.
  const parts = createAudioParts(storage, track, backend, seededRng(3), { choice: 'original', track: 'original' });
  return { storage, track, backend, ...parts, parts };
}

describe('volume helpers', () => {
  it('clamps to 0..1, rounds to whole percents and replaces garbage with the fallback', () => {
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(-3)).toBe(0);
    expect(clampVolume(7)).toBe(1);
    expect(clampVolume(0.30000000000000004)).toBe(0.3);
    expect(clampVolume(Number.NaN, 0.8)).toBe(0.8);
    expect(clampVolume(Number.POSITIVE_INFINITY, 0.8)).toBe(0.8);
  });

  it('steps by exactly one VOLUME_STEP without float drift and stops at both ends', () => {
    let v = 0;
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) seen.push((v = stepVolume(v, 1)));
    expect(seen).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1]);
    for (let i = 0; i < 12; i++) v = stepVolume(v, -1);
    expect(v).toBe(0);
    expect(stepVolume(0.33, 1)).toBeCloseTo(0.4); // an off-grid value snaps first
    expect(VOLUME_STEP).toBe(0.1);
  });

  it('maps the Music setting to a gain with MUSIC_MAX_GAIN as the ceiling', () => {
    expect(musicGain(1)).toBeCloseTo(MUSIC_MAX_GAIN);
    expect(musicGain(0)).toBe(0);
    expect(musicGain(DEFAULT_MUSIC_VOLUME)).toBeCloseTo(0.56);
    expect(musicGain(9)).toBeCloseTo(MUSIC_MAX_GAIN); // out-of-range input cannot exceed the ceiling
  });

  it('formats percentages', () => {
    expect(formatPercent(0.8)).toBe('80%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
  });
});

describe('persistence', () => {
  it('saves and restores a volume', () => {
    const storage = new FakeStorage();
    saveVolume(storage, 'k', 0.6);
    expect(storage.data.get('k')).toBe('0.6');
    expect(loadVolume(storage, 'k', 0.8)).toBe(0.6);
  });

  it('uses the default when nothing, nonsense or an empty string is stored, and clamps out-of-range values', () => {
    const storage = new FakeStorage();
    expect(loadVolume(storage, 'k', 0.8)).toBe(0.8);
    for (const junk of ['abc', '', '   ', 'NaN', 'Infinity']) {
      storage.data.set('k', junk);
      expect(loadVolume(storage, 'k', 0.8)).toBe(0.8);
    }
    storage.data.set('k', '5');
    expect(loadVolume(storage, 'k', 0.8)).toBe(1);
    storage.data.set('k', '-2');
    expect(loadVolume(storage, 'k', 0.8)).toBe(0);
    storage.data.set('k', '0');
    expect(loadVolume(storage, 'k', 0.8)).toBe(0); // a saved 0 is a real setting, not "missing"
  });

  it('survives blocked or missing storage (reads give defaults, writes are ignored)', () => {
    const storage = new FakeStorage();
    storage.broken = true;
    expect(loadVolume(storage, 'k', 0.8)).toBe(0.8);
    expect(() => saveVolume(storage, 'k', 0.2)).not.toThrow();
    expect(loadFlag(storage, 'f')).toBe(false);
    expect(() => saveFlag(storage, 'f', true)).not.toThrow();
    expect(loadVolume(null, 'k', 0.8)).toBe(0.8);
    expect(() => saveVolume(null, 'k', 0.2)).not.toThrow();

    const { music, sfx } = newParts(storage);
    expect(music.musicVolume).toBe(DEFAULT_MUSIC_VOLUME);
    expect(() => music.setVolume(0.3)).not.toThrow();
    expect(() => sfx.setVolume(0.3)).not.toThrow();
    expect(music.musicVolume).toBe(0.3); // still applied for this session
  });

  it('starts at the defaults with an empty storage', () => {
    const { music, sfx, track } = newParts();
    expect(music.musicVolume).toBe(DEFAULT_MUSIC_VOLUME);
    expect(sfx.sfxVolume).toBe(DEFAULT_SFX_VOLUME);
    expect(track.volumes).toEqual([musicGain(DEFAULT_MUSIC_VOLUME)]);
  });

  it('keeps Music, SFX and mute separately under their own keys, next to each other', () => {
    const { storage, music, sfx } = newParts();
    music.setVolume(0.4);
    sfx.setVolume(0.7);
    music.setMuted(true);
    expect(storage.data.get(MUSIC_VOLUME_STORAGE_KEY)).toBe('0.4');
    expect(storage.data.get(SFX_VOLUME_STORAGE_KEY)).toBe('0.7');
    expect(storage.data.get(MUSIC_MUTE_STORAGE_KEY)).toBe('1');
    expect(new Set([MUSIC_VOLUME_STORAGE_KEY, SFX_VOLUME_STORAGE_KEY, MUSIC_MUTE_STORAGE_KEY]).size).toBe(3);
  });

  it('a "reload" (new parts, same storage) restores all three and starts the music at the saved level', () => {
    const first = newParts();
    first.music.setVolume(0.3);
    first.sfx.setVolume(0.5);
    first.music.setMuted(true);

    const second = newParts(first.storage);
    expect(second.music.musicVolume).toBe(0.3);
    expect(second.sfx.sfxVolume).toBe(0.5);
    expect(second.music.isMuted).toBe(true);
    expect(second.track.volumes).toEqual([musicGain(0.3)]);
    second.music.start();
    expect(second.track.calls).toEqual([]); // muted: still silent
    second.music.setMuted(false);
    expect(second.track.calls).toEqual(['play']);
    expect(second.track.volumes).toEqual([musicGain(0.3)]); // never played at a different level
  });

  it('writes only on a real change', () => {
    const { storage, music } = newParts();
    music.setVolume(DEFAULT_MUSIC_VOLUME);
    expect(storage.data.size).toBe(0);
    music.setVolume(0.9);
    music.setVolume(0.9);
    expect(storage.data.get(MUSIC_VOLUME_STORAGE_KEY)).toBe('0.9');
  });
});

describe('music volume', () => {
  it('reaches the track immediately and exactly, whatever state it is in, without touching playback', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    music.setVolume(0.5); // before start: no track yet
    music.start();
    music.setVolume(0.6); // playing
    music.setGamePaused(true);
    music.setVolume(0.7); // paused by the game
    music.setMuted(true);
    music.setVolume(0.2); // paused and muted
    expect(track.volumes).toEqual([0.8, 0.5, 0.6, 0.7, 0.2].map(musicGain));
    expect(track.calls).toEqual(['play', 'pause']);
    expect(track.count('play')).toBe(1);
  });

  it('ignores a repeat of the same value, clamps, and reports real changes', () => {
    const seen: number[] = [];
    const track = new FakeTrack();
    const music = new MusicController(track, { onVolumeChanged: (v) => seen.push(v) });
    music.setVolume(DEFAULT_MUSIC_VOLUME);
    music.setVolume(0.5);
    music.setVolume(0.5);
    music.setVolume(3);
    music.setVolume(-1);
    music.setVolume(Number.NaN);
    expect(seen).toEqual([0.5, 1, 0]);
    expect(track.volumes).toEqual([musicGain(DEFAULT_MUSIC_VOLUME), musicGain(0.5), musicGain(1), musicGain(0)]);
  });

  it('muting does not change the stored volume, and unmuting plays at the stored volume', () => {
    const track = new FakeTrack();
    const music = new MusicController(track, { volume: 0.4 });
    music.start();
    music.setMuted(true);
    expect(music.musicVolume).toBe(0.4);
    music.setVolume(0.9); // adjusted while muted
    expect(music.currentState).toBe('paused');
    music.setMuted(false);
    expect(music.currentState).toBe('playing');
    expect(music.musicVolume).toBe(0.9);
    expect(track.volumes.at(-1)).toBe(musicGain(0.9));
    expect(track.count('play')).toBe(1);
  });

  it('a Music volume of 0 keeps the track running silently (and unmuting is not a restart)', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    music.start();
    music.setVolume(0);
    expect(music.currentState).toBe('playing');
    expect(track.volumes.at(-1)).toBe(0);
    music.setVolume(0.1);
    expect(track.calls).toEqual(['play']);
  });

  it('is independent of the Mega Power speed-up in both directions', () => {
    const track = new FakeTrack();
    const music = new MusicController(track, { megaPowerSpeedup: true });
    music.start();
    music.setMegaPowerActive(true);
    music.setVolume(0.3);
    music.setVolume(0.6);
    expect(track.rates).toEqual([1.26]); // volume changes never re-send or reset the rate
    music.setMegaPowerActive(false);
    music.setVolume(0.2);
    expect(track.rates).toEqual([1.26, 1]);
    expect(track.volumes).toEqual([0.8, 0.3, 0.6, 0.2].map(musicGain)); // rate changes never touch the volume
    expect(track.count('play')).toBe(1);
  });

  it('keeps the same single track through pausing, window focus changes and many volume changes', () => {
    const track = new FakeTrack();
    const music = new MusicController(track);
    music.start();
    for (let i = 0; i < 30; i++) {
      music.setVolume((i % 11) / 10);
      music.setGamePaused(i % 2 === 0);
      music.setWindowActive(i % 3 !== 0);
    }
    expect(track.count('play')).toBe(1);
  });
});

describe('SFX volume', () => {
  it('scales each effect by the SFX setting', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1), { volume: 0.5 });
    player.handle([{ type: 'laser_fired' }, { type: 'boost_started' }, { type: 'player_hit', livesLeft: 1 }]);
    expect(backend.requests.map((r) => r.volume)).toEqual([SFX_GAIN.laser * 0.5, SFX_GAIN.boost * 0.5, SFX_GAIN.player_death * 0.5]);
  });

  it('defaults to DEFAULT_SFX_VOLUME', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1));
    player.handle([{ type: 'laser_fired' }]);
    expect(backend.requests[0]?.volume).toBeCloseTo(SFX_GAIN.laser * DEFAULT_SFX_VOLUME);
  });

  it('applies to the next effects only; sounds already started are not touched or restarted', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1), { volume: 1 });
    player.handle([{ type: 'laser_fired' }]);
    player.setVolume(0.2);
    player.handle([{ type: 'boost_started' }]);
    expect(backend.requests.map((r) => r.key)).toEqual(['laser', 'boost']);
    expect(backend.requests[0]?.volume).toBe(SFX_GAIN.laser);
    expect(backend.requests[1]?.volume).toBeCloseTo(SFX_GAIN.boost * 0.2);
    expect(player.playingCount()).toBe(2);
  });

  it('at 0 nothing is started, nothing is counted, and the sample is silent too', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1), { volume: 0 });
    player.handle([SHOT, LARGE, { type: 'laser_fired' }, { type: 'player_hit', livesLeft: 1 }]);
    player.preview();
    expect(backend.requests).toHaveLength(0);
    expect(player.played).toBe(0);
    expect(player.playingCount()).toBe(0);
    player.setVolume(0.1);
    player.handle([SHOT]);
    expect(backend.requests).toHaveLength(1);
  });

  it('clamps and reports only real changes', () => {
    const seen: number[] = [];
    const player = new SfxPlayer(new FakeBackend(), seededRng(1), { onVolumeChanged: (v) => seen.push(v) });
    player.setVolume(DEFAULT_SFX_VOLUME);
    player.setVolume(0.4);
    player.setVolume(0.4);
    player.setVolume(12);
    expect(seen).toEqual([0.4, 1]);
    expect(player.sfxVolume).toBe(1);
  });

  it('the sample is never attenuated by earlier shots or by repeated taps', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1), { volume: 0.6 });
    player.handle([SHOT, SHOT, SHOT]);
    player.preview();
    player.preview();
    const previews = backend.requests.slice(3);
    expect(previews).toEqual([
      { key: 'shoot_mid', volume: SFX_GAIN.shoot_mid * 0.6 },
      { key: 'shoot_mid', volume: SFX_GAIN.shoot_mid * 0.6 },
    ]);
  });

  it('the sample plays like a shot at the current level', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(1), { volume: 0.6 });
    player.preview();
    expect(backend.requests).toEqual([{ key: 'shoot_mid', volume: SFX_GAIN.shoot_mid * 0.6 }]);
  });
});

describe('adjusting from the pause screen', () => {
  it('moves Music and SFX independently, one step per press, applying and saving each', () => {
    const { storage, parts, track, backend } = newParts();
    expect(adjustVolume(parts, 'music', -1)).toBeCloseTo(0.7);
    expect(volumeOf(parts, 'music')).toBeCloseTo(0.7);
    expect(volumeOf(parts, 'sfx')).toBe(DEFAULT_SFX_VOLUME);
    expect(track.volumes.at(-1)).toBeCloseTo(musicGain(0.7));
    expect(backend.requests).toHaveLength(0); // no sample for the music

    expect(adjustVolume(parts, 'sfx', 1)).toBeCloseTo(0.9);
    expect(volumeOf(parts, 'music')).toBeCloseTo(0.7);
    expect(storage.data.get(MUSIC_VOLUME_STORAGE_KEY)).toBe('0.7');
    expect(storage.data.get(SFX_VOLUME_STORAGE_KEY)).toBe('0.9');
  });

  it('plays one sample shot when SFX changes (at the new level), none when it cannot change', () => {
    const { parts, backend } = newParts();
    adjustVolume(parts, 'sfx', 1); // 0.8 -> 0.9
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]?.volume).toBeCloseTo(SFX_GAIN.shoot_mid * 0.9);
    adjustVolume(parts, 'sfx', 1); // -> 1
    adjustVolume(parts, 'sfx', 1); // already at the top
    expect(backend.requests).toHaveLength(2);
  });

  it('can reach 0 and 100 % and stays there', () => {
    const { parts } = newParts();
    for (let i = 0; i < 15; i++) adjustVolume(parts, 'music', -1);
    expect(volumeOf(parts, 'music')).toBe(0);
    for (let i = 0; i < 15; i++) adjustVolume(parts, 'music', 1);
    expect(volumeOf(parts, 'music')).toBe(1);
  });

  it('works while muted without unmuting, and unmute then keeps the new level', () => {
    const { parts, track, storage } = newParts();
    parts.music.start();
    parts.music.setMuted(true);
    adjustVolume(parts, 'music', -1);
    expect(parts.music.isMuted).toBe(true);
    expect(parts.music.currentState).toBe('paused');
    expect(storage.data.get(MUSIC_MUTE_STORAGE_KEY)).toBe('1');
    expect(storage.data.get(MUSIC_VOLUME_STORAGE_KEY)).toBe('0.7');
    parts.music.setMuted(false);
    expect(track.volumes.at(-1)).toBeCloseTo(musicGain(0.7));
    expect(track.count('play')).toBe(1);
  });

  it('muting does not silence effects (M only ever muted the music)', () => {
    const { parts, backend } = newParts();
    parts.music.setMuted(true);
    parts.sfx.handle([SHOT]);
    expect(backend.requests).toHaveLength(1);
  });
});

describe('restarts and scene changes', () => {
  /** What GameScene does when it shuts down for a retry or a trip to the title screen. */
  function shutdownGameScene({ music, sfx }: { music: MusicController; sfx: SfxPlayer }): void {
    sfx.stopAll();
    music.setGamePaused(false);
    music.setMegaPowerActive(false);
  }

  it('keeps both volumes, the saved values and the single music track through repeated restarts', () => {
    const { parts, music, sfx, track, storage } = newParts();
    music.start();
    adjustVolume(parts, 'music', -1);
    adjustVolume(parts, 'sfx', -1);
    const gainBefore = track.volumes.at(-1);
    for (let i = 0; i < 10; i++) {
      sfx.handle([SHOT, LARGE]);
      music.setMegaPowerActive(true);
      music.setGamePaused(true);
      shutdownGameScene(parts);
    }
    expect(music.musicVolume).toBeCloseTo(0.7);
    expect(sfx.sfxVolume).toBeCloseTo(0.7);
    expect(track.volumes.at(-1)).toBe(gainBefore);
    expect(track.volumes).toHaveLength(2); // the initial level and the one adjustment: restarts never re-send it
    expect(track.count('play')).toBe(1);
    expect(music.currentState).toBe('playing');
    expect(storage.data.get(MUSIC_VOLUME_STORAGE_KEY)).toBe('0.7');
    expect(sfx.playingCount()).toBe(0);
  });

  it('effects started after a restart use the current SFX level at full, un-attenuated gain', () => {
    const { parts, sfx, backend } = newParts();
    adjustVolume(parts, 'sfx', -1);
    backend.requests.length = 0;
    sfx.handle([LARGE, LARGE, LARGE]); // the old run's explosions pile up...
    shutdownGameScene(parts); // ...and are stopped by the restart
    sfx.handle([LARGE]);
    expect(backend.requests.at(-1)?.volume).toBeCloseTo(SFX_GAIN.explosion_large * 0.7); // not 0.65^3 quieter
  });

  it('a new browser session after changes starts with the saved mix', () => {
    const run1 = newParts();
    adjustVolume(run1.parts, 'music', -1);
    adjustVolume(run1.parts, 'sfx', 1);
    shutdownGameScene(run1.parts);
    const run2 = newParts(run1.storage);
    expect(run2.music.musicVolume).toBeCloseTo(0.7);
    expect(run2.sfx.sfxVolume).toBeCloseTo(0.9);
  });
});

describe('the mix (guards for the default levels; the final judgement is by ear)', () => {
  const effective = (key: SfxKey): number => SFX_GAIN[key] * DEFAULT_SFX_VOLUME;
  const musicDefault = musicGain(DEFAULT_MUSIC_VOLUME);

  it('every sound has a file, a group, a gain in (0, 1] and a falloff in (0, 1]', () => {
    const files = new Set(AUDIO_ASSETS.map(([k]) => k));
    for (const key of Object.keys(SFX_GAIN) as SfxKey[]) {
      expect(SFX_GAIN[key]).toBeGreaterThan(0);
      expect(SFX_GAIN[key]).toBeLessThanOrEqual(1);
      expect(OVERLAP_FALLOFF[SFX_GROUP[key]]).toBeGreaterThan(0);
      expect(OVERLAP_FALLOFF[SFX_GROUP[key]]).toBeLessThanOrEqual(1);
      expect(files.has(key === 'boost' ? 'boost' : key)).toBe(true);
    }
    expect(DEFAULT_MUSIC_VOLUME).toBeGreaterThan(0);
    expect(DEFAULT_MUSIC_VOLUME).toBeLessThanOrEqual(1);
    expect(DEFAULT_SFX_VOLUME).toBeGreaterThan(0);
    expect(DEFAULT_SFX_VOLUME).toBeLessThanOrEqual(1);
  });

  it('music is at least as loud as it was in the Python game (0.5), and the SFX setting leaves room above its default', () => {
    expect(musicDefault).toBeGreaterThanOrEqual(0.5);
    expect(DEFAULT_MUSIC_VOLUME).toBeLessThan(1);
    expect(DEFAULT_SFX_VOLUME).toBeLessThan(1);
  });

  it('no effect is far louder than the music at default settings, and gunfire is at most half of it', () => {
    // Gains are not loudness: explosions may sit a little above the music's gain (the biggest by 15 %).
    // The death cue gets the same headroom so it remains audible when a life is lost.
    for (const key of Object.keys(SFX_GAIN) as SfxKey[]) {
      const group = SFX_GROUP[key];
      const limit = group === 'explosion' || group === 'death' ? musicDefault * 1.15 : musicDefault;
      expect(effective(key)).toBeLessThanOrEqual(limit + 1e-9);
    }
    for (const key of ['shoot_low', 'shoot_mid', 'shoot_high'] as const) expect(effective(key)).toBeLessThanOrEqual(musicDefault / 2);
  });

  it('gunfire is the quietest effect; bigger explosions are not quieter than smaller ones', () => {
    for (const key of Object.keys(SFX_GAIN) as SfxKey[]) {
      if (SFX_GROUP[key] !== 'shoot') expect(SFX_GAIN[key]).toBeGreaterThan(SFX_GAIN.shoot_mid);
    }
    expect(SFX_GAIN.explosion_small).toBeLessThanOrEqual(SFX_GAIN.explosion_medium);
    expect(SFX_GAIN.explosion_medium).toBeLessThanOrEqual(SFX_GAIN.explosion_large);
  });

  it('keeps the levels the user approved: music and shots are unchanged', () => {
    expect(MUSIC_MAX_GAIN).toBe(0.7);
    expect(DEFAULT_MUSIC_VOLUME).toBe(0.8);
    expect(DEFAULT_SFX_VOLUME).toBe(0.8);
    for (const key of ['shoot_low', 'shoot_mid', 'shoot_high'] as const) expect(SFX_GAIN[key]).toBe(0.28);
    expect(OVERLAP_FALLOFF.shoot).toBe(0.65);
    expect(OVERLAP_WINDOW_SECONDS.shoot).toBe(0.25);
  });

  it('explosions have their own category gain: clearly above a shot, scaled by size, one number moves all three', () => {
    const shot = SFX_GAIN.shoot_mid;
    expect(SFX_GAIN.explosion_large).toBeCloseTo(EXPLOSION_GAIN * EXPLOSION_SIZE_RATIO.large);
    expect(SFX_GAIN.explosion_medium).toBeCloseTo(EXPLOSION_GAIN * EXPLOSION_SIZE_RATIO.medium);
    expect(SFX_GAIN.explosion_small).toBeCloseTo(EXPLOSION_GAIN * EXPLOSION_SIZE_RATIO.small);
    expect(SFX_GAIN.explosion_small).toBeGreaterThanOrEqual(shot * 2); // at least 6 dB above a shot, even the smallest
    expect(SFX_GAIN.explosion_small).toBeLessThan(SFX_GAIN.explosion_medium);
    expect(SFX_GAIN.explosion_medium).toBeLessThan(SFX_GAIN.explosion_large);
    expect(SFX_GAIN.explosion_large).toBeLessThanOrEqual(1); // the biggest never asks for more than full scale
  });

  it('the three shot variants are equally loud (the variant is random, the level must not be)', () => {
    expect(SFX_GAIN.shoot_low).toBe(SFX_GAIN.shoot_mid);
    expect(SFX_GAIN.shoot_mid).toBe(SFX_GAIN.shoot_high);
  });
});

describe('simultaneous sounds', () => {
  const single = SFX_GAIN.shoot_mid * DEFAULT_SFX_VOLUME;

  /** Player with the virtual clock, so the overlap window sees the same times as the backend. */
  const timedPlayer = (backend: TimedBackend): SfxPlayer => new SfxPlayer(backend, seededRng(2), { clock: () => backend.now });

  it('Rapid Fire (a shot every 0.1 s, each 0.3 s long) adds far less than it would unattenuated', () => {
    const backend = new TimedBackend();
    const player = timedPlayer(backend);
    let peak = 0;
    let steadyPeak = 0;
    for (let i = 0; i < 50; i++) {
      backend.advanceTo(i * 0.1);
      player.handle([SHOT]);
      peak = Math.max(peak, backend.liveGain);
      if (i >= 10) steadyPeak = Math.max(steadyPeak, backend.liveGain);
    }
    expect(backend.started).toHaveLength(50); // every shot still sounds
    expect(peak).toBeLessThanOrEqual(single * 2.1); // 1 + falloff + falloff^2 while a burst builds; unattenuated: 3 x
    expect(steadyPeak).toBeLessThanOrEqual(single * 1.5); // sustained fire settles close to one shot
    const floor = single * OVERLAP_FALLOFF.shoot ** OVERLAP_FALLOFF_MAX_STEPS;
    expect(Math.min(...backend.started.map((s) => s.volume))).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(backend.started[0]?.volume).toBeCloseTo(single); // the first shot of a burst is at full level
  });

  it('normal fire (every 0.3 s, as long as the sound) keeps every shot at full level even though tails touch', () => {
    const backend = new TimedBackend();
    backend.endLatency = 0.02; // the previous shot is still "playing" when the next one starts
    const player = timedPlayer(backend);
    for (let i = 0; i < 20; i++) {
      backend.advanceTo(i * 0.3);
      player.handle([SHOT]);
    }
    expect(backend.started).toHaveLength(20);
    for (const s of backend.started) expect(s.volume).toBeCloseTo(single);
    expect(player.playingCount()).toBeGreaterThan(0);
  });

  it('Rapid Fire + Multi-Shot in the real simulation stays within the same loudness bounds', () => {
    const sim = quietSim();
    sim.player.rapidFire = { active: true, timer: 8 };
    sim.player.multiShot = { active: true, timer: 8 };
    const backend = new TimedBackend();
    const player = timedPlayer(backend);
    let peak = 0;
    let steadyPeak = 0;
    for (let i = 0; i < 60 * 4; i++) {
      backend.advanceTo(i * FRAME);
      player.handle(sim.step(FRAME, hold({ shoot: true })));
      peak = Math.max(peak, backend.liveGain);
      if (i >= 60) steadyPeak = Math.max(steadyPeak, backend.liveGain);
    }
    expect(backend.started.length).toBeGreaterThan(30); // 10 volleys a second, one sound each
    expect(peak).toBeLessThanOrEqual(single * 2.1);
    expect(steadyPeak).toBeLessThanOrEqual(single * 1.5);
  });

  it('a pile of explosions is capped, and each overlapping one is quieter', () => {
    const backend = new TimedBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    player.handle([LARGE, LARGE, LARGE, LARGE, MEDIUM, MEDIUM, MEDIUM, MEDIUM, SMALL, SMALL, SMALL, SMALL]);
    expect(backend.started).toHaveLength(EXPLOSION_MAX_TOTAL);
    expect(backend.started.filter((s) => s.key === 'explosion_large')).toHaveLength(EXPLOSION_MAX_CONCURRENT);
    const large = SFX_GAIN.explosion_large * DEFAULT_SFX_VOLUME;
    const falloff = OVERLAP_FALLOFF.explosion;
    expect(backend.started.map((s) => s.volume)).toEqual([
      large,
      large * falloff,
      large * falloff ** 2,
      SFX_GAIN.explosion_medium * DEFAULT_SFX_VOLUME * falloff ** 3,
    ]);
    // Four explosions together add up to well under 4 full-level explosions.
    expect(backend.liveGain).toBeLessThan(large * 3);
  });

  it('a silent tail does not quieten or block later explosions (only the audible start counts)', () => {
    const backend = new TimedBackend();
    const player = timedPlayer(backend);
    const window = OVERLAP_WINDOW_SECONDS.explosion!;
    player.handle([LARGE, LARGE, LARGE, MEDIUM]);
    expect(backend.started).toHaveLength(EXPLOSION_MAX_TOTAL);
    // Still inside the window: capped and attenuated, as before.
    backend.advanceTo(window - 0.1);
    player.handle([SMALL]);
    expect(backend.started).toHaveLength(EXPLOSION_MAX_TOTAL);
    // Past it the four earlier explosions are still "playing" (their files run for seconds) but no longer count.
    backend.advanceTo(window + 0.1);
    expect(player.playingCount()).toBe(4);
    player.handle([LARGE, SMALL]);
    expect(backend.started).toHaveLength(EXPLOSION_MAX_TOTAL + 2);
    expect(backend.started.at(-2)?.volume).toBeCloseTo(SFX_GAIN.explosion_large * DEFAULT_SFX_VOLUME);
    expect(backend.started.at(-1)?.volume).toBeCloseTo(SFX_GAIN.explosion_small * DEFAULT_SFX_VOLUME * OVERLAP_FALLOFF.explosion);
  });

  it('in a long fight most explosions sound near full level instead of being quartered or dropped', () => {
    const backend = new TimedBackend();
    const player = timedPlayer(backend);
    const requested = 40;
    for (let i = 0; i < requested; i++) {
      backend.advanceTo(i * 0.5); // two explosions a second of mixed sizes, for 20 s
      player.handle([[LARGE, MEDIUM, SMALL][i % 3]!]);
    }
    expect(backend.started.length).toBe(requested); // none dropped
    const levels = backend.started.map((s) => s.volume / (SFX_GAIN[s.key] * DEFAULT_SFX_VOLUME));
    levels.sort((a, b) => a - b);
    expect(levels[Math.floor(levels.length / 2)]).toBeGreaterThanOrEqual(OVERLAP_FALLOFF.explosion ** 2 - 1e-9); // median
    expect(Math.max(...levels)).toBeCloseTo(1);
  });

  it('the attenuation is lifted as soon as the earlier sounds have ended', () => {
    const backend = new TimedBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    player.handle([SMALL, SMALL, SMALL]);
    backend.advanceTo(DURATION.explosion_small + 0.01);
    expect(player.playingCount()).toBe(0);
    player.handle([SMALL]);
    expect(backend.started.at(-1)?.volume).toBeCloseTo(SFX_GAIN.explosion_small * DEFAULT_SFX_VOLUME);
  });

  it('different kinds of sound do not quieten each other', () => {
    const backend = new FakeBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    player.handle([SHOT, LARGE, { type: 'laser_fired' }, { type: 'boost_started' }, { type: 'player_hit', livesLeft: 1 }]);
    const byGroup = Object.fromEntries(backend.requests.map((r) => [SFX_GROUP[r.key], r.volume]));
    expect(byGroup['explosion']).toBeCloseTo(SFX_GAIN.explosion_large * DEFAULT_SFX_VOLUME);
    expect(byGroup['laser']).toBeCloseTo(SFX_GAIN.laser * DEFAULT_SFX_VOLUME);
    expect(byGroup['boost']).toBeCloseTo(SFX_GAIN.boost * DEFAULT_SFX_VOLUME);
    expect(byGroup['death']).toBeCloseTo(SFX_GAIN.player_death * DEFAULT_SFX_VOLUME);
    expect(byGroup['shoot']).toBeCloseTo(single);
  });

  it('a laser sweep through six big asteroids is three explosions, quieter each, plus the laser', () => {
    const backend = new TimedBackend();
    const player = new SfxPlayer(backend, seededRng(2));
    player.handle([{ type: 'laser_fired' }, LARGE, LARGE, LARGE, LARGE, LARGE, LARGE]);
    expect(backend.started.map((s) => s.key)).toEqual(['laser', 'explosion_large', 'explosion_large', 'explosion_large']);
    const [, a, b, c] = backend.started;
    expect(a!.volume).toBeGreaterThan(b!.volume);
    expect(b!.volume).toBeGreaterThan(c!.volume);
  });

  it('losing a life to a crash (death + explosion + shots) never asks any one sound for more than full scale', () => {
    const backend = new TimedBackend();
    const player = new SfxPlayer(backend, seededRng(2), { volume: 1 });
    player.handle([SHOT, { type: 'player_hit', livesLeft: 1 }, LARGE, { type: 'laser_fired' }]);
    for (const s of backend.started) expect(s.volume).toBeLessThanOrEqual(1);
  });
});
