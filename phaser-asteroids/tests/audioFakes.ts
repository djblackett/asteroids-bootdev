import type { SfxKey } from '../src/audio/audioConfig';
import type { MusicTrackId } from '../src/audio/audioConfig';
import type { StorageLike } from '../src/audio/audioSettings';
import type { MusicTrack } from '../src/audio/musicController';
import type { PlayingSound, SfxBackend } from '../src/audio/sfxPlayer';

/** Records every play request; sounds last until `finishAll` is called. */
export class FakeBackend implements SfxBackend {
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

export class FakeTrack implements MusicTrack {
  calls: string[] = [];
  rates: number[] = [];
  volumes: number[] = [];
  sources: MusicTrackId[] = [];
  play(): void {
    this.calls.push('play');
  }
  pause(): void {
    this.calls.push('pause');
  }
  resume(): void {
    this.calls.push('resume');
  }
  stop(): void {
    this.calls.push('stop');
  }
  setSource(track: MusicTrackId): void {
    this.sources.push(track);
  }
  setRate(rate: number): void {
    this.rates.push(rate);
  }
  setVolume(gain: number): void {
    this.volumes.push(gain);
  }
  count(call: string): number {
    return this.calls.filter((c) => c === call).length;
  }
}

/** In-memory `localStorage`. `broken` makes every access throw, like blocked site data. */
export class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  broken = false;
  getItem(key: string): string | null {
    if (this.broken) throw new Error('storage blocked');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.broken) throw new Error('storage blocked');
    this.data.set(key, value);
  }
}
