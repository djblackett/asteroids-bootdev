import { SFX_GAIN } from '../audio/audioConfig';
import { getAudio } from '../audio/phaserAudio';
import { getTouchControls } from '../input/gameTouch';
import type { GameScene } from '../scenes/GameScene';
import { CachedText } from '../ui/hud';
import { addText } from '../ui/text';
import { drawMothership } from './bossRenderer';
import { bossAttackCue, BossEncounterAudio } from './bossAudio';
import { BOSS_CINEMATIC as C } from './bossCinematic';
import { BOSS_BONUS, BOSS_TOTAL_HP } from './bossSim';

/** Presentation only. Simulation time controls all encounter transitions and scoring. */
export function installBossEncounter(scene: GameScene, isPaused: () => boolean, isEnded = () => scene.sim.isGameOver): void {
  const sim = scene.sim;
  const audio = getAudio(scene);
  let encounterAudio: BossEncounterAudio | null = null;
  let wasActive = false;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = getTouchControls(scene).isActive;
  const size = mobile ? 27 : 23;
  const world = scene.add.graphics().setDepth(2);
  const lighting = scene.add.graphics().setDepth(1);
  const bar = scene.add.graphics().setDepth(10);
  const label = new CachedText(addText(scene, 640, 66, '', { size, originX: 0.5, color: '#f3b3ee' }).setDepth(11), '#f3b3ee', size);
  const message = new CachedText(addText(scene, 640, 330, '', { size: mobile ? 29 : 30, originX: 0.5, color: '#ff88b5' }).setDepth(11), '#ff88b5', mobile ? 29 : 30);
  const hintSize = mobile ? 23 : 18;
  const hint = new CachedText(addText(scene, 640, 140, '', { size: hintSize, originX: 0.5, color: '#a4bed6' }).setDepth(11), '#a4bed6', hintSize);
  const pauseAlarm = (): void => audio.sfx.pauseCue('boss_alarm', true);
  scene.game.events.on('blur', pauseAlarm);
  scene.game.events.on('hidden', pauseAlarm);
  let lastHitSound = -Infinity;
  const update = (): void => {
    const b = sim.boss;
    const paused = isPaused();
    const reducedMotion = motionPreference.matches;
    if (!sim.encounterStarted || sim.ordinaryPlay || isEnded()) {
      encounterAudio?.dispose();
      world.clear(); lighting.clear(); bar.clear();
      label.setVisible(false); message.setVisible(false); hint.setVisible(false);
      if (wasActive) scene.cameras.main?.setScroll(0, 0);
      wasActive = false;
      sim.drainBossEvents();
      return;
    }
    wasActive = true;
    encounterAudio ??= new BossEncounterAudio(audio);
    encounterAudio.update(b, paused);
    const entering = b.phase === 'warning' || b.phase === 'entering';
    const aftermath = (b.phase === 'dying' || b.phase === 'destroyed') && !sim.ordinaryPlay;
    drawMothership(world, sim, reducedMotion);
    lighting.clear();
    if (entering) {
      const pulse = reducedMotion ? 0 : (Math.sin(b.age * 3) + 1) / 2;
      lighting.fillStyle(0x8b082b, 0.055 + pulse * 0.025).fillRect(0, 0, 1280, 720);
      lighting.fillStyle(0xff335b, 0.4 + pulse * 0.2).fillRect(0, 0, 1280, 4).fillRect(0, 716, 1280, 4);
    } else if (aftermath) {
      const t = b.deathTime - C.detonation;
      // One restrained detonation bloom, disabled by the OS motion preference.
      if (!reducedMotion && t >= 0 && t < 0.24) lighting.fillStyle(0xffe7dc, 0.22 * (1 - t / 0.24)).fillRect(0, 0, 1280, 720);
    }
    const rumble = reducedMotion || paused ? 0 : entering ? Math.min(1.1, b.age / 8) : aftermath ?
      Math.max(0, 1 - (b.deathTime - C.detonation) / 0.65) * (b.detonated ? 5 : 0.6) : 0;
    scene.cameras.main.setScroll(Math.sin(b.age * 31) * rumble, Math.cos(b.age * 27) * rumble * 0.6);
    bar.clear();
    const showBar = b.phase === 'fighting' || (b.phase === 'dying' && !b.detonated);
    label.setVisible(showBar);
    hint.set(b.exposed ? 'CORE EXPOSED  /  DESTROY THE REACTOR' : 'BREAK BOTH TURRETS  /  EXPOSE THE CORE');
    hint.setVisible(!sim.isGameOver && b.phase === 'fighting');
    if (showBar) {
      label.set('MOTHERSHIP — THE DREADNAUGHT');
      bar.fillStyle(0x111225, 0.95).fillRect(390, 105, 500, 22);
      const reveal = reducedMotion ? 1 : Math.min(1, Math.max(0, b.age - C.combatStart) / C.barFill);
      bar.fillStyle(0xdc3579, 0.13).fillRect(382, 99, 516, 34);
      bar.fillStyle(b.hitFlash > 0 ? 0xffd3f2 : 0xdc3579, 1).fillRect(393, 108, 494 * b.hp / BOSS_TOTAL_HP * reveal, 16);
      bar.lineStyle(2, b.hitFlash > 0 ? 0xffffff : 0xe09ce9, 1).strokeRect(390, 105, 500, 22);
    }
    const warning = entering;
    const exposed = b.exposedAt !== null && b.age - b.exposedAt < 2.4 && b.phase === 'fighting';
    const won = b.phase === 'destroyed' && !sim.ordinaryPlay;
    message.setVisible((warning || exposed || won) && !sim.isGameOver);
    if (warning) message.set('WARNING — HOSTILE CAPITAL SHIP DETECTED', '#ff5363');
    else if (won) message.set(`MOTHERSHIP DESTROYED!\n+${BOSS_BONUS} POINTS`, '#ffdf94');
    else if (exposed) message.set('CORE EXPOSED!', '#ff88b5');
    if (paused) {
      bar.clear();
      label.setVisible(false);
      message.setVisible(false);
      hint.setVisible(false);
    }
    for (const event of sim.drainBossEvents()) {
      const cue = bossAttackCue(event);
      if (cue) audio.sfx.playCue(cue);
      else if (event.type === 'hit' && b.age - lastHitSound > 0.085) {
        lastHitSound = b.age;
        audio.sfx.playCue({ key: 'shoot_high', volume: SFX_GAIN.shoot_high * 0.45, rate: 1.6 });
      } else if (event.type === 'turret_destroyed') audio.sfx.playCue({ key: 'explosion_medium', volume: SFX_GAIN.explosion_medium });
      else if (event.type === 'core_destroyed') audio.sfx.playCue({ key: 'explosion_medium', volume: SFX_GAIN.explosion_medium * 0.65, rate: 0.8 });
      else if (event.type === 'detonation') audio.sfx.playCue({ key: 'explosion_large', volume: SFX_GAIN.explosion_large, rate: 0.7 });
      else if (event.type === 'explosion') audio.sfx.playCue({ key: 'explosion_small', volume: SFX_GAIN.explosion_small * 0.7 });
    }
  };
  scene.events.on('postupdate', update);
  scene.events.once('shutdown', () => {
    scene.events.off('postupdate', update);
    scene.game.events.off('blur', pauseAlarm);
    scene.game.events.off('hidden', pauseAlarm);
    encounterAudio?.dispose();
    // Phaser's camera plugin can already have completed its shutdown.
    scene.cameras.main?.setScroll(0, 0);
  });
  update();
}
