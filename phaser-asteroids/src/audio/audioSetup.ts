import type { Rng } from '../core/rng';
import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  MUSIC_MUTE_STORAGE_KEY,
  MUSIC_VOLUME_STORAGE_KEY,
  SFX_VOLUME_STORAGE_KEY,
} from './audioConfig';
import { loadFlag, loadVolume, saveFlag, saveVolume, stepVolume, type StorageLike, type VolumeChannel } from './audioSettings';
import { MusicController, type MusicTrack } from './musicController';
import { SfxPlayer, type SfxBackend } from './sfxPlayer';

export interface AudioParts {
  music: MusicController;
  sfx: SfxPlayer;
}

/**
 * Builds the music controller and effect player with the saved mute / Music / SFX preferences, and makes every
 * later change save itself. Kept free of Phaser so the whole settings path can be unit tested.
 */
export function createAudioParts(storage: StorageLike | null, track: MusicTrack, backend: SfxBackend, rng: Rng): AudioParts {
  const music = new MusicController(track, {
    muted: loadFlag(storage, MUSIC_MUTE_STORAGE_KEY),
    volume: loadVolume(storage, MUSIC_VOLUME_STORAGE_KEY, DEFAULT_MUSIC_VOLUME),
    onMuteChanged: (muted) => saveFlag(storage, MUSIC_MUTE_STORAGE_KEY, muted),
    onVolumeChanged: (volume) => saveVolume(storage, MUSIC_VOLUME_STORAGE_KEY, volume),
  });
  const sfx = new SfxPlayer(backend, rng, {
    volume: loadVolume(storage, SFX_VOLUME_STORAGE_KEY, DEFAULT_SFX_VOLUME),
    onVolumeChanged: (volume) => saveVolume(storage, SFX_VOLUME_STORAGE_KEY, volume),
  });
  return { music, sfx };
}

export function volumeOf(parts: AudioParts, channel: VolumeChannel): number {
  return channel === 'music' ? parts.music.musicVolume : parts.sfx.sfxVolume;
}

/**
 * Moves one volume setting a step. The change applies at once and is saved; an SFX change also plays a sample shot
 * so it can be judged by ear (silent at 0 %). Returns the new setting.
 */
export function adjustVolume(parts: AudioParts, channel: VolumeChannel, direction: 1 | -1): number {
  const next = stepVolume(volumeOf(parts, channel), direction);
  if (channel === 'music') {
    parts.music.setVolume(next);
  } else {
    const before = parts.sfx.sfxVolume;
    parts.sfx.setVolume(next);
    if (next !== before) parts.sfx.preview();
  }
  return next;
}
