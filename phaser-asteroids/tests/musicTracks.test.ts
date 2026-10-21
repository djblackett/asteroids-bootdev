import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_ASSETS,
  DEFAULT_MUSIC_CHOICE,
  DEFAULT_MUSIC_TRACK,
  DEFAULT_MUSIC_VOLUME,
  LEGACY_MUSIC_TRACK_IDS,
  MUSIC_KEY,
  MUSIC_MAX_GAIN,
  MUSIC_TRACKS,
  MUSIC_TRACK_STORAGE_KEY,
  SFX_ASSETS,
  SFX_GAIN,
  type MusicChoice,
} from '../src/audio/audioConfig';
import { createAudioParts } from '../src/audio/audioSetup';
import { musicGain, trackMusicGain } from '../src/audio/audioSettings';
import { MusicController } from '../src/audio/musicController';
import {
  choiceLabel,
  cycleChoice,
  isMusicChoice,
  loadMusicChoice,
  MUSIC_CHOICES,
  pickRandomTrack,
  resolveStartupMusic,
  saveMusicChoice,
  trackDef,
} from '../src/audio/musicTracks';
import { seededRng } from '../src/core/rng';
import { FakeBackend, FakeStorage, FakeTrack } from './audioFakes';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
const ROOT = resolve(import.meta.dirname, '..');

/** Every file below `dir` (relative to the project root), for the stale-reference scan. */
function filesUnder(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(resolve(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('track definitions', () => {
  it('lists the three tracks with their display names and files, Original first', () => {
    expect(MUSIC_TRACKS.map((t) => [t.id, t.label, t.file])).toEqual([
      ['original', 'Original', 'audio/music/retro-bgmusic.ogg'],
      ['megapop', 'MegaPop', 'audio/music/megapop.mp3'],
      ['gatekeeper', 'Gatekeeper', 'audio/music/gatekeeper.mp3'],
    ]);
  });

  it('offers Original, MegaPop, Gatekeeper, Random, in that order', () => {
    expect(MUSIC_CHOICES).toEqual(['original', 'megapop', 'gatekeeper', 'random']);
    expect(MUSIC_CHOICES.map(choiceLabel)).toEqual(['Original', 'MegaPop', 'Gatekeeper', 'Random']);
  });

  it('every file exists in public/ and is a relative path (works from a GitHub Pages project URL)', () => {
    for (const track of MUSIC_TRACKS) {
      expect(track.file.startsWith('/')).toBe(false);
      expect(track.file.startsWith('audio/music/')).toBe(true);
      expect(statSync(resolve(PUBLIC, track.file)).size).toBeGreaterThan(100_000);
    }
  });

  it('the new tracks are real MP3 files and the original is still the unchanged Ogg', () => {
    const head = (file: string): Uint8Array => readFileSync(resolve(PUBLIC, file)).subarray(0, 4);
    const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes);
    for (const file of ['audio/music/megapop.mp3', 'audio/music/gatekeeper.mp3']) {
      const bytes = head(file);
      const id3 = text(bytes.subarray(0, 3)) === 'ID3';
      const frameSync = bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
      expect(id3 || frameSync).toBe(true);
    }
    expect(text(head('audio/music/retro-bgmusic.ogg'))).toBe('OggS');
  });

  it('keys are unique, the original keeps the key it always had, and every track is a known asset', () => {
    expect(new Set(MUSIC_TRACKS.map((t) => t.key)).size).toBe(MUSIC_TRACKS.length);
    expect(trackDef('original').key).toBe(MUSIC_KEY);
    for (const t of MUSIC_TRACKS) expect(AUDIO_ASSETS).toContainEqual([t.key, t.file]);
  });

  it('the renamed MP3 is the only MegaPop file: the old megaman.mp3 is gone and no source mentions it', () => {
    expect(existsSync(resolve(PUBLIC, 'audio/music/megaman.mp3'))).toBe(false);
    expect(readdirSync(resolve(PUBLIC, 'audio/music')).sort()).toEqual(['gatekeeper.mp3', 'megapop.mp3', 'retro-bgmusic.ogg']);
    expect(trackDef('megapop').file).toBe('audio/music/megapop.mp3');
    expect(trackDef('megapop').key).toBe('music-megapop');
    for (const file of [...filesUnder('src'), 'index.html']) {
      const text = String.fromCharCode(...readFileSync(resolve(ROOT, file)).subarray(0, 200_000));
      expect(text, file).not.toMatch(/megaman\.mp3|music-megaman|mega man/i);
    }
  });

  it('the effects list holds no music, so the boot screen can load effects plus one track', () => {
    expect(SFX_ASSETS.some(([key]) => key.startsWith('music'))).toBe(false);
    expect(SFX_ASSETS.length + MUSIC_TRACKS.length).toBe(AUDIO_ASSETS.length);
  });
});

describe('per-track gain', () => {
  it('the original is exactly 1, so its level is the approved one; the others are within a sensible range', () => {
    expect(trackDef('original').gain).toBe(1);
    for (const id of ['megapop', 'gatekeeper'] as const) {
      expect(trackDef(id).gain).toBeGreaterThan(1);
      expect(trackDef(id).gain).toBeLessThan(2);
    }
  });

  it('does not change the master music gain or the original track level', () => {
    expect(MUSIC_MAX_GAIN).toBe(0.7);
    expect(musicGain(DEFAULT_MUSIC_VOLUME)).toBeCloseTo(0.56, 12);
    expect(trackMusicGain(DEFAULT_MUSIC_VOLUME, 'original')).toBe(musicGain(DEFAULT_MUSIC_VOLUME));
  });

  it('multiplies the master gain by the track level, at every Music setting', () => {
    for (const setting of [0, 0.3, 0.8, 1]) {
      for (const t of MUSIC_TRACKS) expect(trackMusicGain(setting, t.id)).toBeCloseTo(musicGain(setting) * t.gain, 12);
    }
    expect(trackMusicGain(0, 'megapop')).toBe(0);
  });

  it('leaves the sound-effect gains as approved', () => {
    expect(SFX_GAIN.shoot_low).toBe(0.28);
    expect(SFX_GAIN.explosion_large).toBe(0.8);
    expect(SFX_GAIN.laser).toBe(0.5);
    expect(SFX_GAIN.player_death).toBe(0.7);
  });
});

describe('validation, stepping and persistence', () => {
  it('accepts exactly the four choices', () => {
    for (const c of MUSIC_CHOICES) expect(isMusicChoice(c)).toBe(true);
    for (const bad of ['', 'Original', 'RANDOM', 'mega man', 'MegaPop', 'shuffle', null, undefined, 3, {}]) expect(isMusicChoice(bad)).toBe(false);
  });

  it('defaults to MegaPop for a new player; Original stays the fall-back track when a file cannot be loaded', () => {
    expect(DEFAULT_MUSIC_CHOICE).toBe('megapop');
    expect(DEFAULT_MUSIC_TRACK).toBe('original');
    expect(loadMusicChoice(new FakeStorage())).toBe('megapop');
    expect(loadMusicChoice(null)).toBe('megapop');
  });

  it('a fresh profile starts the music controller on MegaPop, at the unchanged MegaPop level', () => {
    const track = new FakeTrack();
    const { music } = createAudioParts(new FakeStorage(), track, new FakeBackend(), seededRng(1));
    expect(music.choice).toBe('megapop');
    expect(music.currentTrack).toBe('megapop');
    expect(track.sources).toEqual(['megapop']);
    expect(track.volumes).toEqual([trackMusicGain(DEFAULT_MUSIC_VOLUME, 'megapop')]);
    expect(trackDef('megapop').gain).toBe(1.65);
  });

  it('an existing saved Mega Man selection (the old id `megaman`) is read as MegaPop, and is not rewritten', () => {
    expect(LEGACY_MUSIC_TRACK_IDS).toEqual({ megaman: 'megapop' });
    const storage = new FakeStorage();
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'megaman');
    expect(loadMusicChoice(storage)).toBe('megapop');
    expect(storage.data.get(MUSIC_TRACK_STORAGE_KEY)).toBe('megaman');
    const track = new FakeTrack();
    const { music } = createAudioParts(storage, track, new FakeBackend(), seededRng(1));
    expect(music.choice).toBe('megapop');
    expect(track.sources).toEqual(['megapop']);
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'megapop', track: 'megapop' });
    // The next explicit pick replaces it with the new id.
    music.setChoice('gatekeeper');
    expect(storage.data.get(MUSIC_TRACK_STORAGE_KEY)).toBe('gatekeeper');
  });

  it('the old id is only an alias for reading: it is not a choice the menus or the controller accept', () => {
    expect(isMusicChoice('megaman')).toBe(false);
    expect(MUSIC_CHOICES).not.toContain('megaman');
    const { music } = createAudioParts(new FakeStorage(), new FakeTrack(), new FakeBackend(), seededRng(1));
    music.setChoice('megaman' as MusicChoice);
    expect(music.choice).toBe('megapop');
  });

  it('keeps every saved choice (Original, Gatekeeper, Random, MegaPop): none is overridden by the MegaPop default', () => {
    for (const choice of ['original', 'gatekeeper', 'random', 'megapop'] as const) {
      const storage = new FakeStorage();
      saveMusicChoice(storage, choice);
      expect(loadMusicChoice(storage)).toBe(choice);
    }
  });

  it('cycles forward and backward through the choices and wraps', () => {
    expect(cycleChoice('original', 1)).toBe('megapop');
    expect(cycleChoice('megapop', 1)).toBe('gatekeeper');
    expect(cycleChoice('gatekeeper', 1)).toBe('random');
    expect(cycleChoice('random', 1)).toBe('original');
    expect(cycleChoice('original', -1)).toBe('random');
    expect(cycleChoice('random', -1)).toBe('gatekeeper');
  });

  it('saves and restores every choice, including Random (the mode, not a file name)', () => {
    for (const choice of MUSIC_CHOICES) {
      const storage = new FakeStorage();
      saveMusicChoice(storage, choice);
      expect(storage.data.get(MUSIC_TRACK_STORAGE_KEY)).toBe(choice);
      expect(loadMusicChoice(storage)).toBe(choice);
    }
  });

  it('ignores invalid or stale stored values and falls back to the default (MegaPop)', () => {
    const stales = ['', 'retro-bgmusic.ogg', 'music', 'megapop.mp3', 'megaman.mp3', 'music-megaman', 'Megaman', 'MEGAMAN', ' megaman', 'true', '2', 'Random', '{"track":"megapop"}', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];
    for (const stale of stales) {
      const storage = new FakeStorage();
      storage.data.set(MUSIC_TRACK_STORAGE_KEY, stale);
      expect(loadMusicChoice(storage)).toBe(DEFAULT_MUSIC_CHOICE);
    }
  });

  it('survives blocked storage in both directions', () => {
    const storage = new FakeStorage();
    storage.broken = true;
    expect(loadMusicChoice(storage)).toBe(DEFAULT_MUSIC_CHOICE);
    expect(() => saveMusicChoice(storage, 'megapop')).not.toThrow();
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'megapop', track: 'megapop' });
  });

  it('keeps the other saved settings when the soundtrack changes', () => {
    const storage = new FakeStorage();
    storage.data.set('asteroids.musicVolume', '0.6');
    storage.data.set('asteroids.sfxVolume', '0.7');
    storage.data.set('asteroids.musicMuted', '1');
    const { music } = createAudioParts(storage, new FakeTrack(), new FakeBackend(), seededRng(1));
    music.setChoice('gatekeeper');
    expect(storage.data.get(MUSIC_TRACK_STORAGE_KEY)).toBe('gatekeeper');
    expect(storage.data.get('asteroids.musicVolume')).toBe('0.6');
    expect(storage.data.get('asteroids.sfxVolume')).toBe('0.7');
    expect(storage.data.get('asteroids.musicMuted')).toBe('1');
    expect(music.musicVolume).toBe(0.6);
    expect(music.isMuted).toBe(true);
  });

  it('a controller built from storage starts on the saved choice', () => {
    const storage = new FakeStorage();
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'megapop');
    const track = new FakeTrack();
    const { music } = createAudioParts(storage, track, new FakeBackend(), seededRng(1));
    expect(music.choice).toBe('megapop');
    expect(music.currentTrack).toBe('megapop');
    expect(track.sources).toEqual(['megapop']);
    expect(track.volumes).toEqual([trackMusicGain(DEFAULT_MUSIC_VOLUME, 'megapop')]);
  });
});

describe('Random selection', () => {
  it('never repeats the previous track while others exist, and covers all of them', () => {
    const rng = seededRng(42);
    const seen = new Set<string>();
    let previous = pickRandomTrack(rng);
    for (let i = 0; i < 500; i++) {
      const next = pickRandomTrack(rng, previous);
      expect(next).not.toBe(previous);
      seen.add(next);
      previous = next;
    }
    expect(seen.size).toBe(MUSIC_TRACKS.length);
  });

  it('picks every track with roughly equal frequency when there is no previous track', () => {
    const rng = seededRng(7);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const id = pickRandomTrack(rng);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    for (const t of MUSIC_TRACKS) expect(counts[t.id]).toBeGreaterThan(850);
  });

  it('is deterministic for a given generator, and safe for an rng that returns 0 or almost 1', () => {
    expect(pickRandomTrack(seededRng(3), 'original')).toBe(pickRandomTrack(seededRng(3), 'original'));
    expect(pickRandomTrack(() => 0, 'original')).toBe('megapop');
    expect(pickRandomTrack(() => 0.999999, 'original')).toBe('gatekeeper');
    expect(pickRandomTrack(() => 1, 'original')).toBe('gatekeeper');
  });

  it('start-up resolves a fresh profile to MegaPop, Random to a real track and an explicit choice to itself', () => {
    const storage = new FakeStorage();
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'megapop', track: 'megapop' });
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'original');
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'original', track: 'original' });
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'gatekeeper');
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'gatekeeper', track: 'gatekeeper' });
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'random');
    const startup = resolveStartupMusic(storage, seededRng(1));
    expect(startup.choice).toBe('random');
    expect(MUSIC_TRACKS.map((t) => t.id)).toContain(startup.track);
  });
});

describe('the AUDIO menu music track names', () => {
  it('lists every soundtrack and Random, in the order the arrows step through them, short enough for the track box', () => {
    const names = MUSIC_CHOICES.map((c) => choiceLabel(c).toUpperCase());
    expect(names).toEqual(['ORIGINAL', 'MEGAPOP', 'GATEKEEPER', 'RANDOM']);
    // The stepper's name box is about 380 game px wide and draws 32 px Courier (19 px a character).
    for (const name of names) expect(name.length * 19).toBeLessThan(380);
  });
});

describe('MusicController soundtrack', () => {
  function setup(options: ConstructorParameters<typeof MusicController>[1] = {}) {
    const track = new FakeTrack();
    const saved: MusicChoice[] = [];
    const warnings: string[] = [];
    const music = new MusicController(track, { onChoiceChanged: (c) => saved.push(c), warn: (m) => warnings.push(m), rng: seededRng(11), ...options });
    return { track, music, saved, warnings };
  }

  it('starts on Original and plays it at the unchanged level', () => {
    const { track, music } = setup();
    expect(music.choice).toBe('original');
    expect(music.currentTrack).toBe('original');
    music.start();
    expect(track.calls).toEqual(['play']);
    expect(track.sources).toEqual(['original']);
    expect(track.volumes).toEqual([musicGain(DEFAULT_MUSIC_VOLUME)]);
  });

  it('an explicit choice switches at once: the old sound is stopped first, then the new source plays from the start', () => {
    const { track, music, saved } = setup();
    music.start();
    music.setChoice('megapop');
    expect(track.calls).toEqual(['play', 'stop', 'play']);
    expect(track.sources).toEqual(['original', 'megapop']);
    expect(music.currentState).toBe('playing');
    expect(saved).toEqual(['megapop']);
  });

  it('applies the per-track gain on every switch and keeps volume changes relative to the playing track', () => {
    const { track, music } = setup({ volume: 0.5 });
    music.start();
    music.setChoice('megapop');
    music.setVolume(0.6);
    music.setChoice('gatekeeper');
    music.setChoice('original');
    expect(track.volumes).toEqual([
      trackMusicGain(0.5, 'original'),
      trackMusicGain(0.5, 'megapop'),
      trackMusicGain(0.6, 'megapop'),
      trackMusicGain(0.6, 'gatekeeper'),
      trackMusicGain(0.6, 'original'),
    ]);
    expect(music.gain).toBe(musicGain(0.6));
  });

  it('choosing the same entry again does nothing (no restart, nothing saved)', () => {
    const { track, music, saved } = setup({ choice: 'megapop' });
    music.start();
    music.setChoice('megapop');
    expect(track.calls).toEqual(['play']);
    expect(saved).toEqual([]);
  });

  it('rejects values that are not choices', () => {
    const { track, music, saved } = setup();
    music.start();
    music.setChoice('techno' as MusicChoice);
    music.setChoice(undefined as unknown as MusicChoice);
    expect(music.choice).toBe('original');
    expect(track.calls).toEqual(['play']);
    expect(saved).toEqual([]);
  });

  it('an invalid initial choice becomes Original', () => {
    const { music } = setup({ choice: 'bogus' as MusicChoice });
    expect(music.choice).toBe('original');
    expect(music.currentTrack).toBe('original');
  });

  it('switching while paused, muted or unfocused starts nothing; the new track plays when the music is next audible', () => {
    const { track, music } = setup();
    music.start();
    music.setGamePaused(true);
    music.setChoice('gatekeeper');
    expect(track.calls).toEqual(['play', 'pause', 'stop']);
    expect(music.currentState).toBe('stopped');
    music.setGamePaused(false);
    expect(track.calls).toEqual(['play', 'pause', 'stop', 'play']);
    expect(track.sources.at(-1)).toBe('gatekeeper');

    music.setMuted(true);
    music.setChoice('megapop');
    expect(track.count('play')).toBe(2);
    music.setMuted(false);
    expect(track.count('play')).toBe(3);

    music.setWindowActive(false);
    music.setChoice('original');
    expect(track.count('play')).toBe(3);
    music.setWindowActive(true);
    expect(track.count('play')).toBe(4);
    expect(track.sources.at(-1)).toBe('original');
  });

  it('before the browser unlocks audio nothing plays, and the chosen track plays after start()', () => {
    const { track, music } = setup({ choice: 'megapop' });
    music.setChoice('gatekeeper');
    expect(track.calls).toEqual(['stop']);
    music.start();
    expect(track.calls).toEqual(['stop', 'play']);
    expect(track.sources).toEqual(['megapop', 'gatekeeper']);
  });

  it('pause, resume, mute and volume never switch tracks or restart them', () => {
    const { track, music } = setup({ choice: 'gatekeeper' });
    music.start();
    for (let i = 0; i < 12; i++) {
      music.setGamePaused(i % 2 === 0);
      music.setWindowActive(i % 3 !== 0);
      music.setMuted(i % 4 === 0);
      music.setVolume((i % 10) / 10);
    }
    expect(track.count('play')).toBe(1);
    expect(track.count('stop')).toBe(0);
    expect(track.sources).toEqual(['gatekeeper']);
    expect(music.currentTrack).toBe('gatekeeper');
  });

  it('the Mega Power speed-up applies to a track started after a switch', () => {
    const { track, music } = setup({ megaPowerSpeedup: true });
    music.start();
    music.setMegaPowerActive(true);
    music.setChoice('megapop');
    expect(track.rates).toEqual([1.26, 1.26]);
    expect(music.playbackRate).toBe(1.26);
  });

  it('cycleChoice steps through the four entries and saves each', () => {
    const { music, saved } = setup();
    expect(music.cycleChoice(1)).toBe('megapop');
    expect(music.cycleChoice(1)).toBe('gatekeeper');
    expect(music.cycleChoice(1)).toBe('random');
    expect(music.cycleChoice(1)).toBe('original');
    expect(music.cycleChoice(-1)).toBe('random');
    expect(saved).toEqual(['megapop', 'gatekeeper', 'random', 'original', 'random']);
  });

  describe('Random', () => {
    it('is saved as a mode, and the first run keeps the track picked at start-up (the title music carries on)', () => {
      const { track, music } = setup({ choice: 'random' });
      const first = music.currentTrack;
      expect(music.choice).toBe('random');
      music.start();
      music.beginRun();
      expect(music.currentTrack).toBe(first);
      expect(track.calls).toEqual(['play']);
    });

    it('uses the track that boot already picked (so the file boot loaded is the one that plays)', () => {
      const { music, track } = setup({ choice: 'random', track: 'gatekeeper' });
      expect(music.currentTrack).toBe('gatekeeper');
      expect(track.sources).toEqual(['gatekeeper']);
    });

    it('picks a new track for every new run, never the previous one', () => {
      const { music } = setup({ choice: 'random', track: 'original' });
      music.start();
      music.beginRun(); // first run keeps the start-up pick
      let previous = music.currentTrack;
      const seen = new Set<string>([previous]);
      for (let i = 0; i < 60; i++) {
        music.beginRun();
        expect(music.currentTrack).not.toBe(previous);
        previous = music.currentTrack;
        seen.add(previous);
      }
      expect(seen.size).toBe(3);
    });

    it('keeps one track for the whole run: pause, resume, focus, mute and volume never re-roll', () => {
      const { track, music } = setup({ choice: 'random', track: 'megapop' });
      music.start();
      music.beginRun();
      music.beginRun(); // a retry: new pick, which then must hold
      const pick = music.currentTrack;
      const stops = track.count('stop');
      for (let i = 0; i < 40; i++) {
        music.setGamePaused(i % 2 === 0);
        music.setWindowActive(i % 3 !== 0);
        music.setMuted(i % 5 === 0);
        music.setVolume((i % 10) / 10);
        music.setMegaPowerActive(i % 7 === 0);
      }
      expect(music.currentTrack).toBe(pick);
      expect(track.count('stop')).toBe(stops);
      expect(track.sources.at(-1)).toBe(pick);
    });

    it('choosing Random mid-run keeps the playing track; the next run picks a different one', () => {
      const { track, music } = setup({ choice: 'megapop' });
      music.start();
      music.setChoice('random');
      expect(music.currentTrack).toBe('megapop');
      expect(track.calls).toEqual(['play']);
      music.beginRun();
      expect(music.currentTrack).not.toBe('megapop');
      expect(track.calls).toEqual(['play', 'stop', 'play']);
    });

    it('switching from Random to an explicit track plays that track at once, and it stays for later runs', () => {
      const { music } = setup({ choice: 'random', track: 'original' });
      music.start();
      music.setChoice('gatekeeper');
      expect(music.currentTrack).toBe('gatekeeper');
      music.beginRun();
      music.beginRun();
      expect(music.currentTrack).toBe('gatekeeper');
    });

    it('an explicit choice does not restart the music on each new run', () => {
      const { track, music } = setup({ choice: 'megapop' });
      music.start();
      music.beginRun();
      music.beginRun();
      expect(track.calls).toEqual(['play']);
    });
  });

  describe('a track that cannot be loaded', () => {
    it('falls back to Original with a diagnostic, and keeps the saved choice', () => {
      const { track, music, warnings, saved } = setup({ choice: 'megapop' });
      music.start();
      music.reportUnavailable('megapop');
      expect(music.currentTrack).toBe('original');
      expect(music.choice).toBe('megapop');
      expect(saved).toEqual([]);
      expect(track.sources).toEqual(['megapop', 'original']);
      expect(track.calls).toEqual(['play', 'stop', 'play']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/MegaPop/);
      expect(warnings[0]).toMatch(/Original/);
    });

    it('applies the Original level after the fall-back', () => {
      const { track, music } = setup({ choice: 'gatekeeper' });
      music.start();
      music.reportUnavailable('gatekeeper');
      expect(track.volumes.at(-1)).toBe(musicGain(DEFAULT_MUSIC_VOLUME));
    });

    it('the next run tries the chosen track again', () => {
      const { music } = setup({ choice: 'megapop' });
      music.start();
      music.reportUnavailable('megapop');
      music.beginRun();
      expect(music.currentTrack).toBe('megapop');
    });

    it('a failure of the original is reported and leaves the game running without music', () => {
      const { music, warnings, track } = setup();
      music.start();
      music.reportUnavailable('original');
      expect(warnings).toHaveLength(1);
      expect(track.count('stop')).toBe(0);
      expect(music.currentTrack).toBe('original');
    });

    it('ignores a late report about a track that is no longer in use', () => {
      const { music, warnings, track } = setup({ choice: 'megapop' });
      music.start();
      music.setChoice('gatekeeper');
      music.reportUnavailable('megapop');
      expect(music.currentTrack).toBe('gatekeeper');
      expect(warnings).toEqual([]);
      expect(track.sources).toEqual(['megapop', 'gatekeeper']);
    });
  });
});
