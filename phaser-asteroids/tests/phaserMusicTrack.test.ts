import Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DECODED_MUSIC_TRACKS, MUSIC_FADE_SECONDS, type MusicTrackId } from '../src/audio/audioConfig';
import { trackMusicGain } from '../src/audio/audioSettings';
import { MusicController } from '../src/audio/musicController';
import { trackDef } from '../src/audio/musicTracks';
import { PhaserMusicTrack } from '../src/audio/phaserAudio';

// A stand-in for Phaser (the real one needs a browser): just enough of the sound manager for the music player.
vi.mock('phaser', () => {
  class WebAudioSoundManager {}
  return { default: { Sound: { Events: { COMPLETE: 'complete', UNLOCKED: 'unlocked' }, WebAudioSoundManager }, Core: { Events: {} } } };
});

class FakeGain {
  value = 1;
  ramps: Array<[number, number]> = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push([value, time]);
  }
}

class FakeSound {
  isPlaying = false;
  isPaused = false;
  destroyed = false;
  rate: number;
  volume: number;
  readonly volumeNode = { gain: new FakeGain() };
  constructor(
    readonly key: string,
    readonly config: { loop?: boolean; volume?: number; rate?: number },
    private readonly manager: FakeManager,
  ) {
    this.rate = config.rate ?? 1;
    this.volume = config.volume ?? 1;
  }
  play(): boolean {
    this.isPlaying = true;
    this.isPaused = false;
    return true;
  }
  pause(): void {
    this.isPlaying = false;
    this.isPaused = true;
  }
  resume(): void {
    this.isPlaying = true;
    this.isPaused = false;
  }
  setVolume(v: number): void {
    this.volume = v;
  }
  setRate(r: number): void {
    this.rate = r;
  }
  destroy(): void {
    this.destroyed = true;
    this.isPlaying = false;
    this.manager.sounds.splice(this.manager.sounds.indexOf(this), 1);
  }
}

class FakeManager {
  locked = false;
  sounds: FakeSound[] = [];
  cached = new Map<string, unknown>();
  unlockListeners: Array<() => void> = [];
  decode: () => Promise<unknown> = async () => ({ fake: 'buffer' });
  context = { currentTime: 10, decodeAudioData: (_data: ArrayBuffer) => this.decode() };
  game = {
    cache: {
      audio: {
        exists: (key: string) => this.cached.has(key),
        add: (key: string, value: unknown) => void this.cached.set(key, value),
        remove: (key: string) => void this.cached.delete(key),
      },
    },
  };
  add(key: string, config: { loop?: boolean; volume?: number; rate?: number }): FakeSound {
    const sound = new FakeSound(key, config, this);
    this.sounds.push(sound);
    return sound;
  }
  once(_event: string, fn: () => void): void {
    this.unlockListeners.push(fn);
  }
  unlock(): void {
    this.locked = false;
    for (const fn of this.unlockListeners.splice(0)) fn();
  }
}

// `manager instanceof Phaser.Sound.WebAudioSoundManager` is how the player recognises Web Audio.
Object.setPrototypeOf(FakeManager.prototype, Phaser.Sound.WebAudioSoundManager.prototype);

/** A download the test settles by hand. */
interface Download {
  url: string;
  signal: AbortSignal | undefined;
  finish(response: { ok: boolean; status?: number } | 'network-error'): void;
}

let downloads: Download[];

function stubFetch(): void {
  downloads = [];
  vi.stubGlobal(
    'fetch',
    (url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const download: Download = {
          url,
          signal: init?.signal,
          finish: (response) => {
            if (response === 'network-error') reject(new Error('network error'));
            else resolve({ ok: response.ok, status: response.status ?? (response.ok ? 200 : 404), arrayBuffer: async () => new ArrayBuffer(8) });
          },
        };
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        downloads.push(download);
      }),
  );
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup() {
  const manager = new FakeManager();
  const unavailable: MusicTrackId[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const track = new PhaserMusicTrack(manager as unknown as Phaser.Sound.BaseSoundManager, (id) => unavailable.push(id));
  const cache = (id: MusicTrackId): void => void manager.cached.set(trackDef(id).key, { fake: id });
  return { manager, track, unavailable, cache, warn };
}

beforeEach(() => {
  vi.useFakeTimers();
  stubFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PhaserMusicTrack: a loaded track', () => {
  it('creates one looping sound at the requested level and never a second one', () => {
    const { manager, track, cache } = setup();
    cache('original');
    track.setVolume(0.42);
    track.setSource('original');
    track.play();
    track.play();
    track.resume();
    expect(manager.sounds).toHaveLength(1);
    expect(manager.sounds[0]?.key).toBe('music');
    expect(manager.sounds[0]?.config).toMatchObject({ loop: true, volume: 0.42, rate: 1 });
    expect(manager.sounds[0]?.isPlaying).toBe(true);
    expect(downloads).toHaveLength(0);
  });

  it('pause and resume use the same sound; volume and rate changes reach it without a restart', () => {
    const { manager, track, cache } = setup();
    cache('megaman');
    track.setSource('megaman');
    track.play();
    const sound = manager.sounds[0] as FakeSound;
    track.pause();
    expect(sound.isPaused).toBe(true);
    track.setVolume(0.3);
    track.setRate(1.26);
    track.resume();
    expect(manager.sounds).toEqual([sound]);
    expect(sound).toMatchObject({ isPlaying: true, volume: 0.3, rate: 1.26 });
  });

  it('a volume or rate set before the sound exists is applied when it is created', () => {
    const { manager, track, cache } = setup();
    cache('gatekeeper');
    track.setSource('gatekeeper');
    track.setVolume(trackMusicGain(0.5, 'gatekeeper'));
    track.setRate(1.26);
    track.play();
    expect(manager.sounds[0]?.config).toMatchObject({ volume: trackMusicGain(0.5, 'gatekeeper'), rate: 1.26 });
  });

  it('does not start a sound while the browser still blocks audio, and starts exactly one after unlocking', () => {
    const { manager, track, cache } = setup();
    manager.locked = true;
    cache('original');
    track.play();
    track.play();
    expect(manager.sounds).toHaveLength(0);
    manager.unlock();
    expect(manager.sounds).toHaveLength(1);
    expect(manager.unlockListeners).toHaveLength(0);
  });

  it('a refused play is reported as unavailable instead of leaving a dead sound behind', () => {
    const { manager, track, cache, unavailable } = setup();
    cache('original');
    vi.spyOn(FakeSound.prototype, 'play').mockReturnValue(false);
    track.play();
    expect(manager.sounds).toHaveLength(0);
    expect(track.instance).toBeNull();
    expect(unavailable).toEqual(['original']);
  });
});

describe('PhaserMusicTrack: switching tracks', () => {
  it('fades the old sound out, then destroys it; the new track plays and only one sound is live', () => {
    const { manager, track, cache } = setup();
    cache('original');
    cache('megaman');
    track.setSource('original');
    track.play();
    const old = manager.sounds[0] as FakeSound;

    track.stop();
    track.setSource('megaman');
    track.play();

    expect(old.volumeNode.gain.ramps).toEqual([[0, 10 + MUSIC_FADE_SECONDS]]);
    expect(old.destroyed).toBe(false);
    expect(track.fadingCount).toBe(1);
    expect(track.instance?.key).toBe('music-megaman');
    vi.advanceTimersByTime(MUSIC_FADE_SECONDS * 1000 + 25);
    expect(old.destroyed).toBe(true);
    expect(track.fadingCount).toBe(0);
    expect(manager.sounds.map((s) => s.key)).toEqual(['music-megaman']);
  });

  it('a paused sound is destroyed straight away (nothing audible to fade)', () => {
    const { manager, track, cache } = setup();
    cache('original');
    track.play();
    track.pause();
    track.stop();
    expect(manager.sounds).toHaveLength(0);
    expect(track.fadingCount).toBe(0);
  });

  it('stop() with nothing playing is harmless, and a later play starts the source from the top', () => {
    const { manager, track, cache } = setup();
    cache('original');
    track.stop();
    track.play();
    track.stop();
    track.play();
    vi.advanceTimersByTime(100);
    expect(manager.sounds).toHaveLength(1);
    expect(manager.sounds[0]?.isPlaying).toBe(true);
  });

  it('many quick switches leave exactly one sound once the fades are over', () => {
    const { manager, track, cache } = setup();
    track.play();
    for (let i = 0; i < 30; i++) {
      const id = (['megaman', 'gatekeeper', 'original'] as const)[i % 3] as MusicTrackId;
      cache(id); // (the player drops decoded tracks beyond two; here every track is always at hand)
      track.stop();
      track.setSource(id);
      track.play();
    }
    vi.advanceTimersByTime(500);
    expect(manager.sounds).toHaveLength(1);
    expect(manager.sounds[0]?.isPlaying).toBe(true);
    expect(track.fadingCount).toBe(0);
  });

  it('stop() releases the playing sound completely', () => {
    const { manager, track, cache } = setup();
    cache('original');
    track.play();
    track.stop();
    vi.advanceTimersByTime(100);
    expect(manager.sounds).toHaveLength(0);
  });
});

describe('PhaserMusicTrack: tracks that are not loaded yet', () => {
  it('downloads the file at its relative path once, caches the decoded audio under its key, then plays it', async () => {
    const { manager, track } = setup();
    track.setSource('megaman');
    track.play();
    track.play();
    track.resume();
    expect(downloads.map((d) => d.url)).toEqual(['audio/music/megaman.mp3']);
    expect(track.loading).toBe(true);
    expect(manager.sounds).toHaveLength(0);

    downloads[0]?.finish({ ok: true });
    await flush();
    expect(manager.cached.has('music-megaman')).toBe(true);
    expect(manager.sounds.map((s) => s.key)).toEqual(['music-megaman']);
    expect(track.loading).toBe(false);
    expect(downloads).toHaveLength(1);
  });

  it('reuses audio that is already decoded: switching back to a track does not download it again', async () => {
    const { manager, track } = setup();
    track.setSource('megaman');
    track.play();
    downloads[0]?.finish({ ok: true });
    await flush();
    track.stop();
    track.setSource('original');
    manager.cached.set('music', {});
    track.play();
    track.stop();
    track.setSource('megaman');
    track.play();
    vi.advanceTimersByTime(100);
    expect(downloads).toHaveLength(1);
    expect(manager.sounds.map((s) => s.key)).toEqual(['music-megaman']);
  });

  it('abandons the download of a track that was replaced before it arrived, without a sound or a failure report', async () => {
    const { manager, track, cache, unavailable } = setup();
    cache('original');
    track.setSource('megaman');
    track.play();
    track.stop();
    track.setSource('original');
    track.play();

    expect(downloads[0]?.signal?.aborted).toBe(true);
    downloads[0]?.finish({ ok: true });
    await flush();
    expect(manager.cached.has('music-megaman')).toBe(false);
    expect(manager.sounds.map((s) => s.key)).toEqual(['music']);
    expect(unavailable).toEqual([]);
    expect(track.loading).toBe(false);
  });

  it('picking the same track again while it is loading shares the one download', async () => {
    const { manager, track } = setup();
    track.setSource('gatekeeper');
    track.play();
    track.stop();
    track.setSource('gatekeeper');
    track.play();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.signal?.aborted).toBe(false);
    downloads[0]?.finish({ ok: true });
    await flush();
    expect(manager.sounds).toHaveLength(1);
  });

  it('paused while downloading: nothing plays on arrival, and resuming then plays it', async () => {
    const { manager, track } = setup();
    track.setSource('megaman');
    track.play();
    track.pause();
    downloads[0]?.finish({ ok: true });
    await flush();
    expect(manager.sounds).toHaveLength(0);
    expect(manager.cached.has('music-megaman')).toBe(true);
    track.resume();
    expect(manager.sounds).toHaveLength(1);
    expect(downloads).toHaveLength(1);
  });

  it('muted/stopped while downloading: nothing plays on arrival', async () => {
    const { manager, track } = setup();
    track.setSource('megaman');
    track.play();
    track.stop();
    downloads[0]?.finish({ ok: true });
    await flush();
    expect(manager.sounds).toHaveLength(0);
  });
});

describe('PhaserMusicTrack: failures', () => {
  it('a missing file (404) is reported once, and pausing / resuming does not download it again', async () => {
    const { manager, track, unavailable } = setup();
    track.setSource('megaman');
    track.play();
    downloads[0]?.finish({ ok: false, status: 404 });
    await flush();
    expect(unavailable).toEqual(['megaman']);
    expect(manager.sounds).toHaveLength(0);
    track.pause();
    track.resume();
    track.play();
    await flush();
    expect(downloads).toHaveLength(1);
    expect(unavailable).toEqual(['megaman']);
  });

  it('choosing the broken track again tries again', async () => {
    const { track, unavailable } = setup();
    track.setSource('megaman');
    track.play();
    downloads[0]?.finish('network-error');
    await flush();
    track.stop();
    track.setSource('original');
    track.setSource('megaman');
    track.play();
    expect(downloads).toHaveLength(2);
    downloads[1]?.finish({ ok: true });
    await flush();
    expect(unavailable).toEqual(['megaman']);
    expect(track.instance?.key).toBe('music-megaman');
  });

  it('a file that cannot be decoded is reported and leaves nothing in the cache', async () => {
    const { manager, track, unavailable } = setup();
    manager.decode = async () => {
      throw new Error('EncodingError');
    };
    track.setSource('gatekeeper');
    track.play();
    downloads[0]?.finish({ ok: true });
    await flush();
    expect(unavailable).toEqual(['gatekeeper']);
    expect(manager.cached.size).toBe(0);
    expect(manager.sounds).toHaveLength(0);
  });

  it('a manager without Web Audio cannot download tracks: reported, not thrown', async () => {
    const { track, unavailable } = setup();
    const plain = { game: { cache: { audio: { exists: () => false, add: () => undefined, remove: () => undefined } } }, locked: false };
    const noWebAudio = new PhaserMusicTrack(plain as unknown as Phaser.Sound.BaseSoundManager, (id) => unavailable.push(id));
    noWebAudio.setSource('megaman');
    noWebAudio.play();
    await flush();
    expect(unavailable).toEqual(['megaman']);
    expect(downloads).toHaveLength(0);
    expect(track.instance).toBeNull();
  });
});

describe('PhaserMusicTrack: memory', () => {
  it(`keeps at most ${MAX_DECODED_MUSIC_TRACKS} decoded tracks, always including the playing one`, () => {
    const { manager, track, cache } = setup();
    for (const id of ['original', 'megaman', 'gatekeeper'] as const) cache(id);
    for (const id of ['original', 'megaman', 'gatekeeper'] as const) {
      track.stop();
      track.setSource(id);
      track.play();
    }
    expect([...manager.cached.keys()].sort()).toEqual(['music-gatekeeper', 'music-megaman']);
    expect(track.instance?.key).toBe('music-gatekeeper');
  });
});

describe('MusicController + PhaserMusicTrack', () => {
  it('a chosen track that fails to download falls back to Original, plays one sound, and keeps the saved choice', async () => {
    const { manager, track, cache } = setup();
    cache('original');
    const warnings: string[] = [];
    const music = new MusicController(track, { choice: 'megaman', warn: (m) => warnings.push(m) });
    // The player's callback is wired like in AudioDirector.
    (track as unknown as { onUnavailable: (id: MusicTrackId) => void }).onUnavailable = (id) => music.reportUnavailable(id);

    music.start();
    expect(downloads.map((d) => d.url)).toEqual(['audio/music/megaman.mp3']);
    downloads[0]?.finish({ ok: false, status: 404 });
    await flush();
    vi.advanceTimersByTime(100);

    expect(music.currentTrack).toBe('original');
    expect(music.choice).toBe('megaman');
    expect(manager.sounds.map((s) => s.key)).toEqual(['music']);
    expect(manager.sounds[0]?.config.volume).toBe(trackMusicGain(0.8, 'original'));
    expect(warnings[0]).toMatch(/Mega Man/);
  });

  it('switching tracks through the controller ends with a single sound at the new track level', async () => {
    const { manager, track, cache } = setup();
    cache('original');
    const music = new MusicController(track, { volume: 0.5 });
    music.start();
    music.setChoice('gatekeeper');
    expect(downloads.map((d) => d.url)).toEqual(['audio/music/gatekeeper.mp3']);
    downloads[0]?.finish({ ok: true });
    await flush();
    vi.advanceTimersByTime(100);
    expect(manager.sounds.map((s) => s.key)).toEqual(['music-gatekeeper']);
    expect(manager.sounds[0]?.config.volume).toBe(trackMusicGain(0.5, 'gatekeeper'));
    music.setVolume(0.7);
    expect(manager.sounds[0]?.volume).toBe(trackMusicGain(0.7, 'gatekeeper'));
    expect(manager.sounds).toHaveLength(1);
  });

  it('Random picks per run; the sound stays the same through pause / resume of that run', async () => {
    const { manager, track, cache } = setup();
    for (const id of ['original', 'megaman', 'gatekeeper'] as const) cache(id);
    const music = new MusicController(track, { choice: 'random', track: 'original', rng: () => 0.7 });
    music.start();
    music.beginRun(); // keeps the start-up pick
    const first = manager.sounds[0];
    for (let i = 0; i < 5; i++) {
      music.setGamePaused(true);
      music.setGamePaused(false);
    }
    expect(manager.sounds).toEqual([first]);
    music.beginRun(); // a retry: a different track
    vi.advanceTimersByTime(100);
    expect(manager.sounds).toHaveLength(1);
    expect(manager.sounds[0]).not.toBe(first);
    expect(manager.sounds[0]?.key).not.toBe('music');
  });
});
