import Phaser from 'phaser';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './core/constants';
import { installNativeApp } from './platform/nativeApp';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { StartScene } from './scenes/StartScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  title: 'Hull & Havoc',
  parent: 'game',
  backgroundColor: '#000000',
  scale: {
    // Gameplay always runs in a fixed 1280x720 logical space; only the CSS size of the canvas changes.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  // Phaser's default is one touch pointer. Menus on a phone must still work while a thumb from the last run is resting on the
  // screen, so allow several simultaneous touches (gameplay touches are handled by the DOM overlay, see src/ui/touchOverlay.ts).
  input: { activePointers: 3 },
  scene: [BootScene, StartScene, GameScene],
});

// Android app only (a no-op in every browser): system Back, app pause / resume and the system bars. See src/platform/nativeApp.ts.
installNativeApp();

// `?debug` exposes the game instance for manual inspection and browser automation.
if (new URLSearchParams(window.location.search).has('debug')) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
