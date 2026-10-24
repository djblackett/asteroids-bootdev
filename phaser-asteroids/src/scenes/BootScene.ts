import Phaser from 'phaser';
import { SFX_ASSETS } from '../audio/audioConfig';
import { browserStorage } from '../audio/audioSettings';
import { resolveStartupMusic, trackDef, type StartupMusic } from '../audio/musicTracks';
import { AUDIO_REGISTRY_KEY, AudioDirector } from '../audio/phaserAudio';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../core/constants';
import { defaultRng } from '../core/rng';
import { installGamepadHub } from '../input/gameGamepads';
import { installHaptics } from '../haptics/gameHaptics';
import { installHeldKeys } from '../input/gameKeys';
import { installTouchControls } from '../input/gameTouch';
import { addText, COLORS } from '../ui/text';
import { SCENE_BOOT, SCENE_START } from './keys';

/**
 * Loads audio, then hands over to the start screen. A failed asset never blocks the game. Only the effects and the one
 * music track that plays first are loaded here; the other tracks are downloaded when somebody picks them (see PhaserMusicTrack).
 */
export class BootScene extends Phaser.Scene {
  private startup!: StartupMusic;

  constructor() {
    super(SCENE_BOOT);
  }

  preload(): void {
    const label = addText(this, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 'LOADING 0%', {
      size: 28,
      color: COLORS.hint,
      originX: 0.5,
      originY: 0.5,
    });
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      label.setText(`LOADING ${Math.round(value * 100)}%`);
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[asteroids] failed to load ${file.key}; continuing without it`);
    });
    this.startup = resolveStartupMusic(browserStorage(), defaultRng);
    const music = trackDef(this.startup.track);
    const bossTrial = import.meta.env.DEV && new URLSearchParams(window.location.search).get('bosstrial') === '1';
    for (const [key, file] of [[music.key, music.file] as const, ...SFX_ASSETS]) {
      // The experimental recording should not add download/decode work to ordinary or production boots.
      if (key === 'boss_alarm' && !bossTrial) continue;
      this.load.audio(key, file);
    }
  }

  create(): void {
    // One audio director for the whole game: music survives scene changes and restarts.
    this.registry.set(AUDIO_REGISTRY_KEY, new AudioDirector(this.game, this.startup));
    // One held-key tracker for the whole game: held keys survive pause, retry and scene changes.
    installHeldKeys(this.game);
    // One gamepad hub for the whole game: assignments survive pause, retry and scene changes (see gamepadHub.ts).
    installGamepadHub(this.game);
    // One input-mode choice and one touch-control layer for the whole game; inert and invisible unless touch mode is on.
    installTouchControls(this.game);
    // One haptic manager (and its saved HAPTICS setting) for the whole game; only the touch screens use it, and it is OFF until the player turns it on.
    installHaptics(this.game);
    this.scene.start(SCENE_START);
  }
}
