import { SFX_GAIN } from '../audio/audioConfig';
import { getAudio } from '../audio/phaserAudio';
import { getTouchControls } from '../input/gameTouch';
import type { GameScene } from '../scenes/GameScene';
import { CachedText } from '../ui/hud';
import { addText } from '../ui/text';
import { drawMothership } from './bossTrialRenderer';
import { bossAttackCue } from './bossTrialAudio';
import { BOSS_BONUS, BOSS_TOTAL_HP, BossTrialSim } from './bossTrialSim';

/** Invoked only by the DEV && casual && !recorded branch. No production bundle imports these files. */
export function installBossTrial(scene: GameScene, isPaused: () => boolean): void {
  const exposedCore = new URLSearchParams(window.location.search).get('bosscore') === '1';
  const sim = new BossTrialSim(scene.sim.config, { exposedCore });
  scene.sim = sim;
  const audio = getAudio(scene);
  const mobile = getTouchControls(scene).isActive;
  const size = mobile ? 27 : 23;
  const world = scene.add.graphics().setDepth(2);
  const bar = scene.add.graphics().setDepth(10);
  const label = new CachedText(addText(scene, 640, 66, '', { size, originX: 0.5, color: '#f3b3ee' }).setDepth(11), '#f3b3ee', size);
  const message = new CachedText(addText(scene, 640, 330, '', { size: mobile ? 29 : 30, originX: 0.5, color: '#ff88b5' }).setDepth(11), '#ff88b5', mobile ? 29 : 30);
  const hintSize = mobile ? 23 : 18;
  const hint = new CachedText(addText(scene, 640, 140, '', { size: hintSize, originX: 0.5, color: '#a4bed6' }).setDepth(11), '#a4bed6', hintSize);
  const reset = addText(scene, 640, 640, 'RESET BOSS TRIAL', { size: mobile ? 28 : 23, originX: 0.5, originY: 0.5, color: '#8ce9ff' })
    .setPadding(24, mobile ? 32 : 14).setBackgroundColor('#142338').setDepth(23).setInteractive({ useHandCursor: true });
  reset.on('pointerdown', () => scene.scene.restart());
  let lastHitSound = -Infinity;
  const update = (): void => {
    const b = sim.boss;
    drawMothership(world, sim);
    bar.clear();
    const showBar = b.phase !== 'warning' && b.phase !== 'destroyed';
    label.setVisible(showBar);
    hint.set(b.exposed ? 'CORE EXPOSED  /  DESTROY THE REACTOR' : 'BREAK BOTH TURRETS  /  EXPOSE THE CORE');
    hint.setVisible(!sim.isGameOver && b.phase !== 'destroyed');
    if (showBar) {
      label.set('MOTHERSHIP — THE DREADNAUGHT');
      bar.fillStyle(0x111225, 0.95).fillRect(390, 105, 500, 22);
      bar.fillStyle(b.hitFlash > 0 ? 0xffd3f2 : 0xdc3579, 1).fillRect(393, 108, 494 * b.hp / BOSS_TOTAL_HP, 16);
      bar.lineStyle(2, b.hitFlash > 0 ? 0xffffff : 0xe09ce9, 1).strokeRect(390, 105, 500, 22);
    }
    const warning = b.age < 2.5;
    const exposed = b.exposedAt !== null && b.age - b.exposedAt < 2.4 && b.phase === 'fighting';
    const won = b.phase === 'destroyed';
    message.setVisible((warning || exposed || won) && !sim.isGameOver);
    if (warning) message.set('WARNING — MOTHERSHIP APPROACHING');
    else if (won) message.set(`MOTHERSHIP DESTROYED!\n+${BOSS_BONUS} POINTS`);
    else if (exposed) message.set('CORE EXPOSED!');
    // The normal pause overlay covers trial HUD. Reset remains reachable at game over.
    const paused = isPaused();
    if (paused) {
      bar.clear();
      label.setVisible(false);
      message.setVisible(false);
      hint.setVisible(false);
    }
    reset.setVisible(!paused);
    for (const event of sim.drainBossEvents()) {
      const cue = bossAttackCue(event);
      if (cue) audio.sfx.playCue(cue);
      else if (event.type === 'hit' && b.age - lastHitSound > 0.085) {
        lastHitSound = b.age;
        audio.sfx.playCue({ key: 'shoot_high', volume: SFX_GAIN.shoot_high * 0.45, rate: 1.6 });
      } else if (event.type === 'turret_destroyed') audio.sfx.playCue({ key: 'explosion_medium', volume: SFX_GAIN.explosion_medium });
      else if (event.type === 'core_destroyed' || event.type === 'destroyed') audio.sfx.playCue({ key: 'explosion_large', volume: SFX_GAIN.explosion_large, rate: event.type === 'destroyed' ? 0.7 : 0.9 });
      else if (event.type === 'explosion') audio.sfx.playCue({ key: 'explosion_small', volume: SFX_GAIN.explosion_small * 0.7 });
    }
  };
  scene.events.on('postupdate', update);
  scene.events.once('shutdown', () => scene.events.off('postupdate', update));
  update();
}
