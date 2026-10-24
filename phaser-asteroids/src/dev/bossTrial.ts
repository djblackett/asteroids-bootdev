import { getTouchControls } from '../input/gameTouch';
import type { GameScene } from '../scenes/GameScene';
import { addText } from '../ui/text';
import { installBossEncounter } from '../boss/bossPresentation';
import { BOSS_CINEMATIC as C } from '../boss/bossCinematic';
import { BossTrialSim } from './bossTrialSim';

/** Immediate start and repeat-play controls are imported only in DEV, unrecorded play. */
export function installBossTrial(scene: GameScene, isPaused: () => boolean): void {
  const sim = new BossTrialSim(scene.sim.config, {
    exposedCore: new URLSearchParams(window.location.search).get('bosscore') === '1',
  });
  scene.sim = sim;
  installBossEncounter(scene, isPaused);
  const mobile = getTouchControls(scene).isActive;
  const reset = addText(scene, 640, 640, 'RESET BOSS TRIAL', { size: mobile ? 28 : 23, originX: 0.5, originY: 0.5, color: '#8ce9ff' })
    .setPadding(24, mobile ? 32 : 14).setBackgroundColor('#142338').setDepth(23).setInteractive({ useHandCursor: true });
  reset.on('pointerdown', () => scene.scene.restart());
  const engage = addText(scene, 640, 412, 'ENGAGE NOW  [ENTER]', { size: mobile ? 27 : 21, originX: 0.5, color: '#aeeaff' })
    .setPadding(22, 16).setBackgroundColor('#142338').setDepth(12).setInteractive({ useHandCursor: true });
  const skip = (): void => { if (!isPaused() && !sim.isGameOver) sim.skipEntrance(); };
  engage.on('pointerdown', skip);
  scene.input.keyboard?.on('keydown-ENTER', skip);
  const update = (): void => {
    const entering = sim.boss.phase === 'warning' || sim.boss.phase === 'entering';
    engage.setVisible(entering && sim.boss.age >= C.skipAfter && !isPaused() && !sim.isGameOver);
    reset.setVisible(!isPaused());
  };
  scene.events.on('postupdate', update);
  scene.events.once('shutdown', () => {
    scene.events.off('postupdate', update);
    scene.input.keyboard?.off('keydown-ENTER', skip);
  });
  update();
}
