import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_ASSETS,
  DEFAULT_MUSIC_CHOICE,
  DEFAULT_MUSIC_VOLUME,
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
import { trackRowText } from '../src/ui/volumePanel';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');

describe('track definitions', () => {
  it('lists the three tracks with their display names and files, Original first', () => {
    expect(MUSIC_TRACKS.map((t) => [t.id, t.label, t.file])).toEqual([
      ['original', 'Original', 'audio/music/retro-bgmusic.ogg'],
      ['megaman', 'Mega Man', 'audio/music/megaman.mp3'],
      ['gatekeeper', 'Gatekeeper', 'audio/music/gatekeeper.mp3'],
    ]);
  });

  it('offers Original, Mega Man, Gatekeeper, Random, in that order', () => {
    expect(MUSIC_CHOICES).toEqual(['original', 'megaman', 'gatekeeper', 'random']);
    expect(MUSIC_CHOICES.map(choiceLabel)).toEqual(['Original', 'Mega Man', 'Gatekeeper', 'Random']);
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
    for (const file of ['audio/music/megaman.mp3', 'audio/music/gatekeeper.mp3']) {
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

  it('the effects list holds no music, so the boot screen can load effects plus one track', () => {
    expect(SFX_ASSETS.some(([key]) => key.startsWith('music'))).toBe(false);
    expect(SFX_ASSETS.length + MUSIC_TRACKS.length).toBe(AUDIO_ASSETS.length);
  });
});

describe('per-track gain', () => {
  it('the original is exactly 1, so its level is the approved one; the others are within a sensible range', () => {
    expect(trackDef('original').gain).toBe(1);
    for (const id of ['megaman', 'gatekeeper'] as const) {
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
    expect(trackMusicGain(0, 'megaman')).toBe(0);
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
    for (const bad of ['', 'Original', 'RANDOM', 'mega man', 'shuffle', null, undefined, 3, {}]) expect(isMusicChoice(bad)).toBe(false);
  });

  it('defaults to Original for a new player', () => {
    expect(DEFAULT_MUSIC_CHOICE).toBe('original');
    expect(loadMusicChoice(new FakeStorage())).toBe('original');
    expect(loadMusicChoice(null)).toBe('original');
  });

  it('cycles forward and backward through the choices and wraps', () => {
    expect(cycleChoice('original', 1)).toBe('megaman');
    expect(cycleChoice('megaman', 1)).toBe('gatekeeper');
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

  it('ignores invalid or stale stored values and falls back to Original', () => {
    for (const stale of ['', 'retro-bgmusic.ogg', 'music', 'megaman.mp3', 'true', '2', 'Random', '{"track":"megaman"}']) {
      const storage = new FakeStorage();
      storage.data.set(MUSIC_TRACK_STORAGE_KEY, stale);
      expect(loadMusicChoice(storage)).toBe('original');
    }
  });

  it('survives blocked storage in both directions', () => {
    const storage = new FakeStorage();
    storage.broken = true;
    expect(loadMusicChoice(storage)).toBe('original');
    expect(() => saveMusicChoice(storage, 'megaman')).not.toThrow();
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
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'megaman');
    const track = new FakeTrack();
    const { music } = createAudioParts(storage, track, new FakeBackend(), seededRng(1));
    expect(music.choice).toBe('megaman');
    expect(music.currentTrack).toBe('megaman');
    expect(track.sources).toEqual(['megaman']);
    expect(track.volumes).toEqual([trackMusicGain(DEFAULT_MUSIC_VOLUME, 'megaman')]);
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
    expect(pickRandomTrack(() => 0, 'original')).toBe('megaman');
    expect(pickRandomTrack(() => 0.999999, 'original')).toBe('gatekeeper');
    expect(pickRandomTrack(() => 1, 'original')).toBe('gatekeeper');
  });

  it('start-up resolves Random to a real track and an explicit choice to itself', () => {
    const storage = new FakeStorage();
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'original', track: 'original' });
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'gatekeeper');
    expect(resolveStartupMusic(storage, seededRng(1))).toEqual({ choice: 'gatekeeper', track: 'gatekeeper' });
    storage.data.set(MUSIC_TRACK_STORAGE_KEY, 'random');
    const startup = resolveStartupMusic(storage, seededRng(1));
    expect(startup.choice).toBe('random');
    expect(MUSIC_TRACKS.map((t) => t.id)).toContain(startup.track);
  });
});

describe('Track row text', () => {
  it('has the same width for every choice and marks the selected row', () => {
    const widths = new Set(MUSIC_CHOICES.map((c) => trackRowText(c, false).length));
    expect(widths.size).toBe(1);
    expect(trackRowText('megaman', true)).toBe('> Track <  Mega Man  >');
    expect(trackRowText('random', false)).toBe('  Track <   Random   >');
    expect(trackRowText('gatekeeper', false)).toBe('  Track < Gatekeeper >');
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
    music.setChoice('megaman');
    expect(track.calls).toEqual(['play', 'stop', 'play']);
    expect(track.sources).toEqual(['original', 'megaman']);
    expect(music.currentState).toBe('playing');
    expect(saved).toEqual(['megaman']);
  });

  it('applies the per-track gain on every switch and keeps volume changes relative to the playing track', () => {
    const { track, music } = setup({ volume: 0.5 });
    music.start();
    music.setChoice('megaman');
    music.setVolume(0.6);
    music.setChoice('gatekeeper');
    music.setChoice('original');
    expect(track.volumes).toEqual([
      trackMusicGain(0.5, 'original'),
      trackMusicGain(0.5, 'megaman'),
      trackMusicGain(0.6, 'megaman'),
      trackMusicGain(0.6, 'gatekeeper'),
      trackMusicGain(0.6, 'original'),
    ]);
    expect(music.gain).toBe(musicGain(0.6));
  });

  it('choosing the same entry again does nothing (no restart, nothing saved)', () => {
    const { track, music, saved } = setup({ choice: 'megaman' });
    music.start();
    music.setChoice('megaman');
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
    music.setChoice('megaman');
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
    const { track, music } = setup({ choice: 'megaman' });
    music.setChoice('gatekeeper');
    expect(track.calls).toEqual(['stop']);
    music.start();
    expect(track.calls).toEqual(['stop', 'play']);
    expect(track.sources).toEqual(['megaman', 'gatekeeper']);
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
    music.setChoice('megaman');
    expect(track.rates).toEqual([1.26, 1.26]);
    expect(music.playbackRate).toBe(1.26);
  });

  it('cycleChoice steps through the four entries and saves each', () => {
    const { music, saved } = setup();
    expect(music.cycleChoice(1)).toBe('megaman');
    expect(music.cycleChoice(1)).toBe('gatekeeper');
    expect(music.cycleChoice(1)).toBe('random');
    expect(music.cycleChoice(1)).toBe('original');
    expect(music.cycleChoice(-1)).toBe('random');
    expect(saved).toEqual(['megaman', 'gatekeeper', 'random', 'original', 'random']);
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
      const { track, music } = setup({ choice: 'random', track: 'megaman' });
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
      const { track, music } = setup({ choice: 'megaman' });
      music.start();
      music.setChoice('random');
      expect(music.currentTrack).toBe('megaman');
      expect(track.calls).toEqual(['play']);
      music.beginRun();
      expect(music.currentTrack).not.toBe('megaman');
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
      const { track, music } = setup({ choice: 'megaman' });
      music.start();
      music.beginRun();
      music.beginRun();
      expect(track.calls).toEqual(['play']);
    });
  });

  describe('a track that cannot be loaded', () => {
    it('falls back to Original with a diagnostic, and keeps the saved choice', () => {
      const { track, music, warnings, saved } = setup({ choice: 'megaman' });
      music.start();
      music.reportUnavailable('megaman');
      expect(music.currentTrack).toBe('original');
      expect(music.choice).toBe('megaman');
      expect(saved).toEqual([]);
      expect(track.sources).toEqual(['megaman', 'original']);
      expect(track.calls).toEqual(['play', 'stop', 'play']);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Mega Man/);
      expect(warnings[0]).toMatch(/Original/);
    });

    it('applies the Original level after the fall-back', () => {
      const { track, music } = setup({ choice: 'gatekeeper' });
      music.start();
      music.reportUnavailable('gatekeeper');
      expect(track.volumes.at(-1)).toBe(musicGain(DEFAULT_MUSIC_VOLUME));
    });

    it('the next run tries the chosen track again', () => {
      const { music } = setup({ choice: 'megaman' });
      music.start();
      music.reportUnavailable('megaman');
      music.beginRun();
      expect(music.currentTrack).toBe('megaman');
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
      const { music, warnings, track } = setup({ choice: 'megaman' });
      music.start();
      music.setChoice('gatekeeper');
      music.reportUnavailable('megaman');
      expect(music.currentTrack).toBe('gatekeeper');
      expect(warnings).toEqual([]);
      expect(track.sources).toEqual(['megaman', 'gatekeeper']);
    });
  });
});
