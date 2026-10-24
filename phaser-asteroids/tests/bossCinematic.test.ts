import { describe, expect, it } from 'vitest';
import { MUSIC_TRACK_STORAGE_KEY, SFX_GAIN } from '../src/audio/audioConfig';
import { createAudioParts } from '../src/audio/audioSetup';
import { MusicController } from '../src/audio/musicController';
import { SfxPlayer, type SfxBackend } from '../src/audio/sfxPlayer';
import { BOSS_CINEMATIC as C } from '../src/dev/bossCinematic';
import { BossEncounterAudio } from '../src/dev/bossTrialAudio';
import { BossTrialSim } from '../src/dev/bossTrialSim';
import { drawMothership } from '../src/dev/bossTrialRenderer';
import { seededRng } from '../src/core/rng';
import { FakeBackend, FakeStorage, FakeTrack } from './audioFakes';
import { FRAME, hold, pickupAtShip, rock, runFor, shotAt, ufoShotAt } from './helpers';

function setup(volume = 0.8) {
  const track = new FakeTrack();
  const backend = new FakeBackend();
  const music = new MusicController(track, { choice: 'random', track: 'megapop', rng: seededRng(3) });
  const sfx = new SfxPlayer(backend, seededRng(3), { volume });
  const audio = { music, sfx };
  music.start();
  music.beginRun();
  const encounter = new BossEncounterAudio(audio);
  const sim = new BossTrialSim();
  return { track, backend, ...audio, encounter, sim };
}

describe('cinematic audio lifecycle', () => {
  it('plays the alarm once, freezes on pause, transitions to Gatekeeper and restores the same Random pick', () => {
    const { track, backend, music, sfx, encounter, sim } = setup();
    runFor(sim, C.alarmStart + FRAME);
    encounter.update(sim.boss, false);
    expect(backend.count('boss_alarm')).toBe(1);
    expect(music.gain).toBe(0);
    for (let i = 0; i < 100; i++) encounter.update(sim.boss, true);
    encounter.update(sim.boss, false);
    expect(backend.count('boss_alarm')).toBe(1);
    runFor(sim, C.combatStart - sim.boss.age - FRAME * 2);
    encounter.update(sim.boss, false);
    expect(sim.boss.phase).toBe('entering');
    expect(sfx.playingCount('boss_alarm')).toBe(1);
    runFor(sim, FRAME * 3);
    encounter.update(sim.boss, false);
    expect(music.currentTrack).toBe('gatekeeper');
    expect(music.choice).toBe('random');
    expect(sfx.playingCount('boss_alarm')).toBe(0);
    expect(backend.stopped).toBe(1);
    sim.boss.phase = 'destroyed';
    encounter.update(sim.boss, false);
    encounter.dispose();
    expect(music.currentTrack).toBe('megapop');
    expect(track.sources).toEqual(['megapop', 'gatekeeper', 'megapop']);
    expect(music.gain).toBeGreaterThan(0);
  });

  it.each([30, 60, 120])('fades over the final 0.4s and hands off at 11s without changing the descent, at %sHz', (fps) => {
    const track = new FakeTrack();
    const music = new MusicController(track, { choice: 'megapop' });
    music.start();
    let level = 0;
    let plays = 0;
    let paused = false;
    const sfx = new SfxPlayer({ play: (_key, volume, finished) => {
      plays++;
      level = volume;
      return { setVolume: gain => { level = gain; }, pause: () => { paused = true; },
        resume: () => { paused = false; }, stop: finished };
    } }, seededRng(1), { volume: 0.8 });
    const encounter = new BossEncounterAudio({ music, sfx });
    const sim = new BossTrialSim();
    runFor(sim, 10.6, undefined, fps);
    encounter.update(sim.boss, false);
    expect(level).toBeCloseTo(SFX_GAIN.boss_alarm * 0.8);
    runFor(sim, 0.2, undefined, fps);
    encounter.update(sim.boss, false);
    expect(level).toBeCloseTo(SFX_GAIN.boss_alarm * 0.8 / 2);
    const age = sim.boss.age;
    for (let i = 0; i < fps; i++) encounter.update(sim.boss, true);
    expect(paused).toBe(true);
    expect(sim.boss.age).toBe(age);
    sfx.setVolume(0);
    expect(level).toBe(0);
    sfx.setVolume(0.4);
    expect(level).toBeCloseTo(SFX_GAIN.boss_alarm * 0.4 / 2);
    encounter.update(sim.boss, false);
    expect(paused).toBe(false);
    let previous = level;
    while (sim.boss.phase === 'entering') {
      expect(music.currentTrack).toBe('megapop');
      expect(sim.boss.position.y).toBeLessThan(235);
      sim.step(1 / fps);
      encounter.update(sim.boss, false);
      expect(level).toBeLessThanOrEqual(previous);
      if (sim.boss.phase === 'entering') {
        expect(level).toBeCloseTo(SFX_GAIN.boss_alarm * 0.4 * (11 - sim.boss.age) / 0.4, 8);
      }
      previous = level;
    }
    expect(sim.boss.age).toBeGreaterThanOrEqual(11 - 1e-9);
    expect(sim.boss.age).toBeLessThan(11 + 1 / fps + FRAME);
    expect(sim.boss.position.y).toBeCloseTo(-120 + 355 * (1 - (1 - (sim.boss.age - 1.1) / 12.9) ** 3), 8);
    expect(sfx.playingCount('boss_alarm')).toBe(0);
    expect(plays).toBe(1);
    expect(track.sources).toEqual(['megapop', 'gatekeeper']);
    encounter.dispose();
  });

  it.each(['skip', 'reset'] as const)('cleans up a paused mid-fade alarm on %s and starts the next entrance at full gain', (action) => {
    const levels: number[] = [];
    const s = setup();
    const sfx = new SfxPlayer({ play: (_key, volume, finished) => {
      levels.push(volume);
      return { setVolume: gain => { levels.push(gain); }, stop: finished };
    } }, seededRng(1));
    const encounter = new BossEncounterAudio({ music: s.music, sfx });
    runFor(s.sim, 10.8);
    encounter.update(s.sim.boss, false);
    encounter.update(s.sim.boss, true);
    expect(levels.at(-1)).toBeCloseTo(SFX_GAIN.boss_alarm * 0.8 / 2);
    if (action === 'skip') {
      s.sim.skipEntrance();
      s.sim.step(FRAME);
      encounter.update(s.sim.boss, false);
      expect(s.music.currentTrack).toBe('gatekeeper');
    }
    encounter.dispose();
    expect(sfx.playingCount()).toBe(0);
    expect(s.music.currentTrack).toBe('megapop');
    const next = new BossEncounterAudio({ music: s.music, sfx });
    const sim = new BossTrialSim();
    runFor(sim, 1);
    next.update(sim.boss, false);
    expect(levels.at(-1)).toBeCloseTo(SFX_GAIN.boss_alarm * 0.8);
    expect(sfx.playingCount('boss_alarm')).toBe(1);
    encounter.update(s.sim.boss, false);
    expect(sfx.playingCount('boss_alarm')).toBe(1);
    next.dispose();
    expect(sfx.playingCount()).toBe(0);
  });

  it.each([0, 0.8])('continues on the fixed clock with SFX volume %s, including interrupted entrances', (volume) => {
    const { encounter, music, backend, sfx, sim } = setup(volume);
    runFor(sim, 5.1);
    encounter.update(sim.boss, false);
    expect(backend.count('boss_alarm')).toBe(volume ? 1 : 0);
    sim.skipEntrance();
    sim.step(FRAME);
    encounter.update(sim.boss, false);
    expect(sim.boss.phase).toBe('fighting');
    expect(music.currentTrack).toBe('gatekeeper');
    encounter.dispose();
    expect(sfx.playingCount('boss_alarm')).toBe(0);
    expect(music.currentTrack).toBe('megapop');
    expect(music.choice).toBe('random');
  });

  it('stops the old alarm before a replacement encounter and restores intro gain on early exit', () => {
    const s = setup();
    runFor(s.sim, 1);
    s.encounter.update(s.sim.boss, false);
    const next = new BossEncounterAudio(s);
    expect(s.sfx.playingCount('boss_alarm')).toBe(0);
    next.update(s.sim.boss, false);
    expect(s.sfx.playingCount('boss_alarm')).toBe(1);
    next.dispose();
    expect(s.sfx.playingCount()).toBe(0);
    expect(s.music.gain).toBeGreaterThan(0);
  });

  it('applies live SFX volume changes, pauses/resumes and limits alarm voices without restarting', () => {
    const calls: Array<string | number> = [];
    const backend: SfxBackend = { play: (_key, volume, finished) => {
      calls.push(volume);
      return { stop: () => { calls.push('stop'); finished(); }, pause: () => { calls.push('pause'); },
        resume: () => { calls.push('resume'); }, setVolume: (gain) => { calls.push(gain); } };
    } };
    const sfx = new SfxPlayer(backend, seededRng(1));
    const alarm = { key: 'boss_alarm' as const, volume: SFX_GAIN.boss_alarm };
    sfx.playCue(alarm);
    sfx.playCue(alarm);
    expect(sfx.played).toBe(1);
    sfx.pauseCue('boss_alarm', true);
    sfx.setVolume(0);
    sfx.setVolume(0.4);
    sfx.pauseCue('boss_alarm', false);
    sfx.stopAll();
    expect(calls).toEqual([SFX_GAIN.boss_alarm * 0.8, 'pause', 0, SFX_GAIN.boss_alarm * 0.4, 'resume', 'stop']);
    expect(sfx.playingCount()).toBe(0);
  });

  it('handles unavailable alarms without retry loops', () => {
    const s = setup();
    const sfx = new SfxPlayer({ play: () => null }, seededRng(1));
    const encounter = new BossEncounterAudio({ music: s.music, sfx });
    runFor(s.sim, 1);
    encounter.update(s.sim.boss, false);
    runFor(s.sim, C.combatStart);
    encounter.update(s.sim.boss, false);
    expect(sfx.played).toBe(0);
    expect(s.music.currentTrack).toBe('gatekeeper');
  });
});

describe('temporary music override', () => {
  it('never persists the override and honors pause, focus, mute and volume during it', () => {
    const storage = new FakeStorage();
    storage.setItem(MUSIC_TRACK_STORAGE_KEY, 'random');
    const track = new FakeTrack();
    const { music } = createAudioParts(storage, track, new FakeBackend(), seededRng(1), { choice: 'random', track: 'megapop' });
    music.start();
    music.beginRun();
    music.setTemporaryTrack('gatekeeper');
    music.setVolume(0.3);
    expect(track.volumes.at(-1)).toBeCloseTo(0.3 * 0.7 * 1.55);
    music.setGamePaused(true);
    music.setWindowActive(false);
    music.setGamePaused(false);
    expect(music.currentState).toBe('paused');
    music.setWindowActive(true);
    expect(music.currentState).toBe('playing');
    music.setMuted(true);
    music.setTemporaryTrack(null);
    expect(music.currentState).toBe('stopped');
    music.setMuted(false);
    expect(music.currentTrack).toBe('megapop');
    expect(music.choice).toBe('random');
    expect(storage.getItem(MUSIC_TRACK_STORAGE_KEY)).toBe('random');
    expect(track.volumes.at(-1)).toBeCloseTo(0.3 * 0.7 * 1.65);
  });

  it('keeps a playing Gatekeeper instance and respects settings changed during combat', () => {
    const track = new FakeTrack();
    const music = new MusicController(track, { choice: 'gatekeeper' });
    music.start();
    music.setTemporaryTrack('gatekeeper');
    music.setTemporaryTrack('gatekeeper');
    expect(track.count('play')).toBe(1);
    expect(track.count('stop')).toBe(0);
    music.setChoice('original');
    expect(music.currentTrack).toBe('gatekeeper');
    music.setTemporaryTrack(null);
    expect(music.currentTrack).toBe('original');
  });

  it('falls back without changing Random and clears transient state for a fresh run', () => {
    const s = setup();
    s.music.setTemporaryTrack('gatekeeper');
    s.music.reportUnavailable('gatekeeper');
    expect(s.music.currentTrack).toBe('megapop');
    expect(s.music.choice).toBe('random');
    s.music.setPresentationGain(0);
    s.music.beginRun();
    expect(s.music.gain).toBeGreaterThan(0);
    expect(s.music.currentTrack).not.toBe('megapop');
    const selected = s.music.currentTrack;
    s.music.setTemporaryTrack(null);
    expect(s.music.currentTrack).toBe(selected);
  });
});

describe('cinematic simulation boundaries', () => {
  it('preserves the original descent before and after the 11s handoff and settles on skip', () => {
    const sim = new BossTrialSim();
    sim.player.isRespawning = true;
    sim.player.respawnTimer = 1000;
    for (let frame = 1; frame <= 14 * 60; frame++) {
      sim.step(FRAME);
      if (frame < 66) continue;
      const t = Math.min(1, (sim.boss.age - 1.1) / 12.9);
      expect(sim.boss.position.y).toBeCloseTo(-120 + 355 * (1 - (1 - t) ** 3), 8);
      expect(sim.boss.phase).toBe(frame < 11 * 60 ? 'entering' : 'fighting');
    }
    expect(sim.boss.position.y).toBeCloseTo(235, 8);
    const skipped = new BossTrialSim();
    runFor(skipped, 5.1);
    skipped.skipEntrance();
    skipped.step(FRAME);
    expect(skipped.boss.phase).toBe('fighting');
    expect(skipped.boss.position.y).toBe(235);
  });

  it('leaves ordinary UFO projectile rendering to the normal renderer after returning to gameplay', () => {
    const sim = new BossTrialSim();
    sim.boss.phase = 'destroyed';
    sim.ordinaryPlay = true;
    sim.ufoShots.push(ufoShotAt(200, 300));
    const operations: string[] = [];
    const graphics = new Proxy({}, { get: (_target, name: string) => () => { operations.push(name); return graphics; } });
    drawMothership(graphics as Parameters<typeof drawMothership>[0], sim);
    expect(operations).toEqual(['clear']);
  });
  it('protects and positions the ship throughout the intro, freezes power-ups and rejects early skipping', () => {
    const sim = new BossTrialSim();
    sim.player.rapidFire.active = true;
    sim.player.rapidFire.timer = 8;
    pickupAtShip(sim, 'shield');
    sim.asteroids.push(rock(640, 540));
    sim.ufoShots.push(ufoShotAt(640, 540));
    sim.skipEntrance();
    expect(sim.boss.age).toBe(0);
    runFor(sim, C.combatStart - FRAME * 2, hold({ shoot: true, move: 1 }));
    expect(sim.player.position).toEqual({ x: 640, y: 540 });
    expect(sim.player.lives).toBe(3);
    expect(sim.player.rapidFire.timer).toBe(8);
    expect(sim.powerups).toHaveLength(1);
    expect(sim.boss.hp).toBe(76);
    expect(sim.boss.charge).toBeNull();
    expect(sim.ufoShots).toHaveLength(0);
    expect(sim.boss.phase).toBe('entering');
  });

  it('stages destruction once, preserves state and resumes the same ordinary run after the victory hold', () => {
    const sim = new BossTrialSim({}, { exposedCore: true });
    sim.player.score = 123;
    sim.player.lives = 2;
    sim.player.rapidFire.active = true;
    sim.player.rapidFire.timer = 8;
    sim.boss.core.hp = 1;
    sim.shots.push(shotAt(sim.boss.core.position.x, sim.boss.core.position.y));
    sim.step(FRAME);
    expect(sim.boss.phase).toBe('dying');
    const timer = sim.player.rapidFire.timer;
    runFor(sim, C.detonation + FRAME);
    expect(sim.boss.detonated).toBe(true);
    expect(sim.totalScore).toBe(123);
    runFor(sim, C.victory - sim.boss.deathTime + FRAME);
    expect(sim.totalScore).toBe(2123);
    expect(sim.ordinaryPlay).toBe(false);
    runFor(sim, C.aftermath - sim.boss.deathTime + FRAME);
    expect(sim.ordinaryPlay).toBe(true);
    expect(sim.player.rapidFire.timer).toBe(timer);
    expect(sim.bossFlashes).toHaveLength(0);
    expect(sim.bossProjectiles.size).toBe(0);
    expect(sim.player.lives).toBe(2);
    const events = sim.drainBossEvents();
    expect(events.filter((e) => e.type === 'detonation')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'destroyed')).toHaveLength(1);
    runFor(sim, 2);
    expect(sim.spawner.gameplayTimer).toBeGreaterThan(1);
    expect(sim.player.rapidFire.timer).toBeLessThan(timer);
    expect(sim.totalScore).toBe(2123);
    expect(sim.drainBossEvents()).toHaveLength(0);
  });
});
