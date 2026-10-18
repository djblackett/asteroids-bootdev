import Phaser from 'phaser';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './core/constants';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { StartScene } from './scenes/StartScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  title: 'Asteroids',
  parent: 'game',
  backgroundColor: '#000000',
  scale: {
    // Gameplay always runs in a fixed 1280x720 logical space; only the CSS size of the canvas changes.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  scene: [BootScene, StartScene, GameScene],
});

// `?debug` exposes the game instance for manual inspection and browser automation.
if (new URLSearchParams(window.location.search).has('debug')) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
