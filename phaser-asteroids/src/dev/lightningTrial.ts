import type Phaser from 'phaser';
import { createAsteroid } from '../core/asteroid';
import type { GameSim } from '../core/game';
import { createPowerUp } from '../core/powerup';
import { respawnPlayer } from '../core/player';
import { seededRng } from '../core/rng';
import { addText } from '../ui/text';

/** Only dynamically imported by a DEV, casual GameScene. Reset uses a fresh isolated trial RNG for pickups. */
export function installLightningTrial(scene: Phaser.Scene, sim: GameSim): void {
  const reset = (): void => {
    sim.phase = 'playing';
    sim.gameOverReason = null;
    sim.spawner.spawnTimer = -1e9;
    sim.ufoSpawner.enabled = false;
    sim.asteroids = [];
    sim.shots = [];
    sim.ufoShots = [];
    sim.ufos = [];
    sim.powerups = [];
    sim.lasers = [];
    sim.lightningFlashes = [];
    sim.volatileFlashes = [];
    sim.pickupFlashes = [];
    sim.combo.count = 0;
    sim.combo.timer = 0;
    sim.streakBanner = null;
    sim.startCooldown = 0;
    sim.slowMotion = { active: false, timer: 0 };
    sim.players.forEach((player, index) => {
      const y = index === 0 ? 300 : 540;
      player.lives = 3;
      player.score = 0;
      respawnPlayer(player, 220, y);
      player.isRespawning = false;
      player.rotation = 270; // point toward the trial rocks
      player.shootTimer = 0;
      const pickup = createPowerUp(220, y, 'chain_lightning', seededRng(7));
      pickup.velocity = { x: 0, y: 0 };
      sim.powerups.push(pickup);
      sim.asteroids.push(
        createAsteroid(400, y, 20),
        createAsteroid(530, y - 25, 20, 'armored'),
        createAsteroid(675, y, 20, 'volatile'),
        createAsteroid(775, y, 20, 'volatile'),
        createAsteroid(875, y, 20),
      );
    });
  };
  reset();
  const button = addText(scene, 640, 165, 'RESET LIGHTNING TRIAL', { size: 24, originX: 0.5, color: '#39cfff' })
    .setDepth(12).setPadding(14, 10).setBackgroundColor('#102331').setInteractive({ useHandCursor: true });
  button.on('pointerdown', reset);
  addText(scene, 640, 220, 'Hold FIRE: armour takes a hit, then orange rocks chain-react.\nTap RESET to repeat the 7-second pickup.', {
    size: 18, originX: 0.5, color: '#a7dfff',
  }).setDepth(12);
}
