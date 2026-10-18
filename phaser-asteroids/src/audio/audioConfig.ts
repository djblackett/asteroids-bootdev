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

export const MUSIC_KEY = 'music';

export const AUDIO_ASSETS: ReadonlyArray<readonly [key: string, file: string]> = [
  [MUSIC_KEY, 'audio/music/retro-bgmusic.ogg'],
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

/** Python: `pygame.mixer.music.set_volume(0.5)`. */
export const MUSIC_VOLUME = 0.5;

/**
 * Python sets volumes per sound on desktop: shots 0.4, laser 0.7, boost and death 2 (pygame clamps to 1.0),
 * explosions untouched (1.0). The web build leaves the processed shot sounds at 1.0; the desktop tuning is
 * used here so shots do not drown out the music.
 */
export const SFX_VOLUME = {
  shoot: 0.4,
  explosion: 1.0,
  laser: 0.7,
  boost: 1.0,
  player_death: 1.0,
} as const;

/** Python skips an explosion when 3 copies of that exact sound are already playing (stops "mudding"). */
export const EXPLOSION_MAX_CONCURRENT = 3;

/**
 * Python `MEGA_POWER_MUSIC_SPEED = 1.26`: during MEGA POWER the music is sped up and pitched up 4 semitones
 * (it re-initialises the mixer at 22050 x 1.26 Hz, which changes speed and pitch together; a Web Audio
 * playback rate does exactly the same). Python ships this DISABLED (`MEGA_POWER_MUSIC_SPEEDUP_ENABLED = False`)
 * and never does it on the web, so it is off here too; flip the flag to enable it.
 */
export const MEGA_POWER_MUSIC_SPEED = 1.26;
export const MEGA_POWER_MUSIC_SPEEDUP_ENABLED = false;

export const MUSIC_MUTE_STORAGE_KEY = 'asteroids.musicMuted';
