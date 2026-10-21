/**
 * Audio behaviour copied from the Python `soundeffects.py` / `constants.py`.
 *
 * Only these files are used by the Python game: retro-bgmusic.ogg, the three processed shoot sounds, the
 * three processed explosion sounds, laser.ogg, boost-woosh.ogg and player-death.ogg. enemy-ship*.ogg,
 * laser2.ogg, boost-woosh2.ogg, shoot_01.ogg and big-explosion.ogg are unused alternatives or source
 * material (the Python web build only falls back to the last two).
 */

export type SfxKey =
  | 'shoot_low'
  | 'shoot_mid'
  | 'shoot_high'
  | 'explosion_small'
  | 'explosion_medium'
  | 'explosion_large'
  | 'laser'
  | 'boost'
  | 'player_death';

/** Phaser audio-cache key of the original track (kept as it always was; the other tracks are `music-<id>`). */
export const MUSIC_KEY = 'music';

// --- Soundtracks -------------------------------------------------------------------------------------

export type MusicTrackId = 'original' | 'megapop' | 'gatekeeper';
/** What the player picks: one track, or `random` (a different track chosen at the start of every new game). */
export type MusicChoice = MusicTrackId | 'random';

export interface MusicTrackDef {
  readonly id: MusicTrackId;
  /** Shown in the menus. */
  readonly label: string;
  /** Path relative to the page (never root-absolute: the game is served from a GitHub Pages project URL). */
  readonly file: string;
  /** Phaser audio-cache key. */
  readonly key: string;
  /**
   * Level of this track relative to the original at the same Music setting (the original is 1 and must stay 1, it is the
   * approved mix). The music master gain (`MUSIC_MAX_GAIN`) is untouched; this only evens out how the files were mastered.
   * Measured with ffmpeg ebur128 (integrated loudness, K-weighted): Original -9.9 LUFS, MegaPop -14.3 LUFS, Gatekeeper
   * -13.8 LUFS, i.e. 4.4 and 3.9 LU quieter, which is x1.66 and x1.57. Rounded down a little (-0.1 dB) so a track is never
   * the louder one; true peaks stay below 0 dBFS even at a Music setting of 100 %. Subjective balance is for a listening test.
   */
  readonly gain: number;
}

export const MUSIC_TRACKS: readonly MusicTrackDef[] = [
  { id: 'original', label: 'Original', file: 'audio/music/retro-bgmusic.ogg', key: MUSIC_KEY, gain: 1 },
  { id: 'megapop', label: 'MegaPop', file: 'audio/music/megapop.mp3', key: 'music-megapop', gain: 1.65 },
  { id: 'gatekeeper', label: 'Gatekeeper', file: 'audio/music/gatekeeper.mp3', key: 'music-gatekeeper', gain: 1.55 },
];

/** The fall-back when a track cannot be loaded (and the music controller's own default). It is not what a new player gets, see `DEFAULT_MUSIC_CHOICE`. */
export const DEFAULT_MUSIC_TRACK: MusicTrackId = 'original';
/** What a player with no valid saved choice gets: MegaPop. */
export const DEFAULT_MUSIC_CHOICE: MusicChoice = 'megapop';

/** Decoded music is large (about 0.4 MB per second). Only this many decoded tracks stay in memory: the playing one and the last one. */
export const MAX_DECODED_MUSIC_TRACKS = 2;

/** Switching tracks fades the old one out over this long (seconds) instead of cutting it off mid-wave, which clicks. */
export const MUSIC_FADE_SECONDS = 0.04;

type SfxAsset = readonly [key: string, file: string];

export const SFX_ASSETS: ReadonlyArray<SfxAsset> = [
  ['shoot_low', 'audio/sfx/shoot_low.ogg'],
  ['shoot_mid', 'audio/sfx/shoot_mid.ogg'],
  ['shoot_high', 'audio/sfx/shoot_high.ogg'],
  ['explosion_small', 'audio/sfx/explosion_small.ogg'],
  ['explosion_medium', 'audio/sfx/explosion_medium.ogg'],
  ['explosion_large', 'audio/sfx/explosion_large.ogg'],
  ['laser', 'audio/sfx/laser.ogg'],
  ['boost', 'audio/sfx/boost-woosh.ogg'],
  ['player_death', 'audio/sfx/player-death.ogg'],
];

/** Every known audio file. The boot screen loads the effects and only the music track that is needed first; the others load on demand. */
export const AUDIO_ASSETS: ReadonlyArray<SfxAsset> = [...MUSIC_TRACKS.map((t): SfxAsset => [t.key, t.file]), ...SFX_ASSETS];

// --- Mix ---------------------------------------------------------------------------------------------
//
// The final level of every sound is:   user volume (0..1, the Music / SFX settings)  x  the gain below.
// The gains are the "mix": tune these when listening tests say the balance is off. The user settings are for
// taste and listening environment. Measured source levels (ffmpeg, whole file): the music is hot (about -12 dB
// RMS, peaks at 0 dBFS); the shots are the densest sounds (about -9 dB RMS for 0.3 s, peaks -0.3 dBFS);
// the explosions are quieter on average (-19 dB RMS) but peak at full scale or above.

/**
 * Music gain at a Music setting of 100 %. At the default setting this is 0.56 (Python used 0.5), which keeps the
 * hot music file around -17 dB RMS with its peaks at -5 dBFS, leaving about 5 dB of headroom for effects.
 */
export const MUSIC_MAX_GAIN = 0.7;

/** Default Music and SFX settings. Below 100 % so either can be raised from the pause screen. */
export const DEFAULT_MUSIC_VOLUME = 0.8;
export const DEFAULT_SFX_VOLUME = 0.8;

/** The pause-screen controls move a setting in steps of this size. */
export const VOLUME_STEP = 0.1;

export type SfxGroup = 'shoot' | 'explosion' | 'laser' | 'boost' | 'death';

export const SFX_GROUP: Readonly<Record<SfxKey, SfxGroup>> = {
  shoot_low: 'shoot',
  shoot_mid: 'shoot',
  shoot_high: 'shoot',
  explosion_small: 'explosion',
  explosion_medium: 'explosion',
  explosion_large: 'explosion',
  laser: 'laser',
  boost: 'boost',
  player_death: 'death',
};

/**
 * Gain of the explosion category at an SFX setting of 100 %: the gain of the biggest explosion. The sizes below
 * scale it, so this is the one number that moves all asteroid explosions against shots, laser and the rest.
 * Measured: the explosion files start as hot as a shot (about -8 dB RMS) and decay, so at 0.8 against 0.28 for a
 * shot a lone large explosion is about 9 dB above a shot, a small one about 6.6 dB.
 */
export const EXPLOSION_GAIN = 0.8;

/** Each explosion size as a fraction of `EXPLOSION_GAIN` (small -2.5 dB, medium -1.2 dB). Bigger is louder. */
export const EXPLOSION_SIZE_RATIO = { small: 0.75, medium: 0.875, large: 1 } as const;

const explosionGain = (size: keyof typeof EXPLOSION_SIZE_RATIO): number =>
  Math.round(EXPLOSION_GAIN * EXPLOSION_SIZE_RATIO[size] * 1000) / 1000;

/**
 * Gain of each effect at an SFX setting of 100 % (multiply by the setting for the real level; 80 % by default).
 * Python (desktop) used shots 0.4, laser 0.7, boost and death 2 (clamped to 1) and explosions 1.0, which puts
 * the gunfire at roughly the same loudness as the music and everything else clipping. Here gunfire sits well
 * under the music; explosions (bigger ones louder, see `EXPLOSION_GAIN`) are the strongest effects, with the laser
 * and the death sound close behind.
 */
export const SFX_GAIN: Readonly<Record<SfxKey, number>> = {
  shoot_low: 0.28,
  shoot_mid: 0.28,
  shoot_high: 0.28,
  explosion_small: explosionGain('small'),
  explosion_medium: explosionGain('medium'),
  explosion_large: explosionGain('large'),
  laser: 0.5,
  boost: 0.6,
  player_death: 0.7,
};

/**
 * UFOs are silent in Python (no sound for spawning, firing or being destroyed). A destroyed UFO reuses the existing
 * explosion samples (large UFO = medium, small UFO = small) through the normal explosion limiter and falloff; this
 * scales just those, so UFO kills can be made louder or quieter without touching the approved asteroid explosions.
 */
export const UFO_EXPLOSION_GAIN_SCALE = 1.0;

/**
 * Overlapping sounds of one group add up, so each new sound is quieter by this factor for every sound of its
 * group that is still playing (at most `OVERLAP_FALLOFF_MAX_STEPS` of them count). Rapid Fire starts a shot every
 * 0.1 s while each lasts 0.3 s: after the first two shots the stream settles at about 1.3 x the loudness of one
 * shot, instead of 3 x.
 */
export const OVERLAP_FALLOFF: Readonly<Record<SfxGroup, number>> = {
  shoot: 0.65,
  explosion: 0.65,
  laser: 0.7,
  boost: 1,
  death: 1,
};
export const OVERLAP_FALLOFF_MAX_STEPS = 3;

/**
 * For groups listed here only sounds that started less than this many seconds ago count as overlapping. Shots
 * decay fast and normal fire is one every 0.3 s (as long as the sound), so without this the ringing tail of the
 * previous shot would randomly quieten the next one. Rapid Fire (every 0.1 s) still counts the last two shots.
 */
export const OVERLAP_WINDOW_SECONDS: Readonly<Partial<Record<SfxGroup, number>>> = {
  shoot: 0.25,
  // The explosion files are 2.2 / 4.9 / 12.3 s long but only the first part is audible (above -40 dB: about 0.8 /
  // 1.3 / 3.5 s, the rest is a near-silent tail). Counting the whole file made most explosions in busy play quieter
  // by up to 11 dB or skipped them altogether. This also bounds the explosion limits below.
  explosion: 1.5,
};

/**
 * Python skips an explosion when 3 copies of that exact sound are already playing (stops "mudding"). Here only
 * explosions that started within `OVERLAP_WINDOW_SECONDS.explosion` count, so a silent tail never blocks a new one.
 */
export const EXPLOSION_MAX_CONCURRENT = 3;

/** On top of the Python rule: at most this many explosions of any size within the window (it allowed 9, up to 12 s long). */
export const EXPLOSION_MAX_TOTAL = 4;

/**
 * Python `MEGA_POWER_MUSIC_SPEED = 1.26`: during MEGA POWER the music is sped up and pitched up 4 semitones
 * (it re-initialises the mixer at 22050 x 1.26 Hz, which changes speed and pitch together; a Web Audio
 * playback rate does exactly the same). Python ships this DISABLED (`MEGA_POWER_MUSIC_SPEEDUP_ENABLED = False`)
 * and never does it on the web, so it is off here too; flip the flag to enable it.
 */
export const MEGA_POWER_MUSIC_SPEED = 1.26;
export const MEGA_POWER_MUSIC_SPEEDUP_ENABLED = false;

export const MUSIC_MUTE_STORAGE_KEY = 'asteroids.musicMuted';
export const MUSIC_VOLUME_STORAGE_KEY = 'asteroids.musicVolume';
export const SFX_VOLUME_STORAGE_KEY = 'asteroids.sfxVolume';
/**
 * `original`, `megapop`, `gatekeeper` or `random`; anything else is ignored (and means `DEFAULT_MUSIC_CHOICE`).
 * MegaPop used to be saved as `megaman` (see `LEGACY_MUSIC_TRACK_IDS`).
 */
export const MUSIC_TRACK_STORAGE_KEY = 'asteroids.musicTrack';

/** Track ids that were saved by earlier builds and now mean another id. A saved `megaman` is the track now called MegaPop. */
export const LEGACY_MUSIC_TRACK_IDS: Readonly<Record<string, MusicTrackId>> = { megaman: 'megapop' };
