import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/core/game';
import { DEFAULT_GAME_CONFIG } from '../src/core/gameConfig';
import { NO_INPUT, type PlayerInput } from '../src/core/player';
import { seededRng } from '../src/core/rng';
import {
  captureSimSnapshot,
  compareSnapshots,
  FIXED_DT,
  FIXED_TICK_RATE,
  FixedStepRunner,
  ReplayRecorder,
  verifyReplay,
} from '../src/replay';

describe('Deterministic Replay — Core Invariants & Reproducibility', () => {
  it('runs identical simulation instances with identical states at multiple tick checkpoints', () => {
    const seed = 1234567;
    const simA = new GameSim({ rng: seededRng(seed), config: DEFAULT_GAME_CONFIG });
    const simB = new GameSim({ rng: seededRng(seed), config: DEFAULT_GAME_CONFIG });

    for (let tick = 0; tick < 300; tick++) {
      const input: PlayerInput = {
        rotate: tick % 40 < 20 ? 1 : -1,
        move: tick % 60 < 45 ? 1 : 0,
        shoot: tick % 10 === 0,
      };

      simA.step(FIXED_DT, input);
      simB.step(FIXED_DT, input);

      if (tick % 50 === 0 || tick === 299) {
        const snapA = captureSimSnapshot(simA, tick);
        const snapB = captureSimSnapshot(simB, tick);
        const diff = compareSnapshots(snapA, snapB);
        expect(diff.differences).toEqual([]);
        expect(diff.match).toBe(true);
      }
    }
  });

  it('Scenario 1: No-input run produces identical results and checkpoint states', () => {
    const seed = 42;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    for (let tick = 0; tick < 240; tick++) {
      simA.step(FIXED_DT, NO_INPUT);
      simB.step(FIXED_DT, NO_INPUT);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 240), captureSimSnapshot(simB, 240));
    expect(diff.differences).toEqual([]);
    expect(simA.player.position).toEqual(simB.player.position);
    expect(simA.asteroids.length).toBe(simB.asteroids.length);
  });

  it('Scenario 2: Continuous movement', () => {
    const seed = 99;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });
    const moveInput: PlayerInput = { rotate: 0, move: 1, shoot: false };

    for (let tick = 0; tick < 180; tick++) {
      simA.step(FIXED_DT, moveInput);
      simB.step(FIXED_DT, moveInput);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 180), captureSimSnapshot(simB, 180));
    expect(diff.differences).toEqual([]);
    expect(simA.player.position.y).toBeGreaterThan(360); // ship moved down
  });

  it('Scenario 3: Continuous firing', () => {
    const seed = 777;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });
    const fireInput: PlayerInput = { rotate: 0, move: 0, shoot: true };

    for (let tick = 0; tick < 200; tick++) {
      simA.step(FIXED_DT, fireInput);
      simB.step(FIXED_DT, fireInput);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 200), captureSimSnapshot(simB, 200));
    expect(diff.differences).toEqual([]);
    expect(simA.shots.length).toBe(simB.shots.length);
    expect(simA.shots.length).toBeGreaterThan(0);
  });

  it('Scenario 4: Turning while firing', () => {
    const seed = 888;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });
    const turnAndFire: PlayerInput = { rotate: 1, move: 0, shoot: true };

    for (let tick = 0; tick < 240; tick++) {
      simA.step(FIXED_DT, turnAndFire);
      simB.step(FIXED_DT, turnAndFire);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 240), captureSimSnapshot(simB, 240));
    expect(diff.differences).toEqual([]);
    expect(simA.player.rotation).toBe(simB.player.rotation);
  });

  it('Scenario 5: Boost activation and cooldown', () => {
    const seed = 55;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    // Tick 0: tap boost
    simA.step(FIXED_DT, { rotate: 0, move: 1, shoot: false, boost: true });
    simB.step(FIXED_DT, { rotate: 0, move: 1, shoot: false, boost: true });

    expect(simA.player.boost.active).toBe(true);
    expect(simB.player.boost.active).toBe(true);

    // Ticks 1-300: move without holding boost
    for (let tick = 1; tick < 300; tick++) {
      simA.step(FIXED_DT, { rotate: 0, move: 1, shoot: false, boost: false });
      simB.step(FIXED_DT, { rotate: 0, move: 1, shoot: false, boost: false });
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 300), captureSimSnapshot(simB, 300));
    expect(diff.differences).toEqual([]);
    expect(simA.player.boost.active).toBe(false);
  });

  it('Scenario 6: Laser firing', () => {
    const seed = 101;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    // Tap laser
    simA.step(FIXED_DT, { rotate: 0, move: 0, shoot: false, laser: true });
    simB.step(FIXED_DT, { rotate: 0, move: 0, shoot: false, laser: true });

    expect(simA.lasers.length).toBe(1);
    expect(simB.lasers.length).toBe(1);
    expect(simA.player.laser.shotsRemaining).toBe(14);
    expect(simB.player.laser.shotsRemaining).toBe(14);

    for (let tick = 1; tick < 60; tick++) {
      simA.step(FIXED_DT, { rotate: 0, move: 0, shoot: false, laser: false });
      simB.step(FIXED_DT, { rotate: 0, move: 0, shoot: false, laser: false });
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 60), captureSimSnapshot(simB, 60));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 7: Asteroid destruction and splitting', () => {
    const seed = 303;
    const simA = new GameSim({ rng: seededRng(seed), startCooldown: 0 });
    const simB = new GameSim({ rng: seededRng(seed), startCooldown: 0 });

    // Aim and fire at an asteroid
    for (let tick = 0; tick < 180; tick++) {
      const input: PlayerInput = { rotate: 0.5, move: 0, shoot: tick % 5 === 0 };
      simA.step(FIXED_DT, input);
      simB.step(FIXED_DT, input);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 180), captureSimSnapshot(simB, 180));
    expect(diff.differences).toEqual([]);
    expect(simA.totalScore).toBe(simB.totalScore);
  });

  it('Scenario 8: Power-up pickup and expiration', () => {
    const seed = 404;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    // Manually spawn a powerup right in front of the ship in both
    simA.powerups.push({
      position: { x: simA.player.position.x, y: simA.player.position.y + 20 },
      velocity: { x: 0, y: 0 },
      radius: 15,
      type: 'shield',
      alive: true,
      lifetime: 10,
    });
    simB.powerups.push({
      position: { x: simB.player.position.x, y: simB.player.position.y + 20 },
      velocity: { x: 0, y: 0 },
      radius: 15,
      type: 'shield',
      alive: true,
      lifetime: 10,
    });

    for (let tick = 0; tick < 60; tick++) {
      simA.step(FIXED_DT, { rotate: 0, move: 1, shoot: false });
      simB.step(FIXED_DT, { rotate: 0, move: 1, shoot: false });
    }

    expect(simA.player.shieldActive).toBe(true);
    expect(simB.player.shieldActive).toBe(true);
    const diff = compareSnapshots(captureSimSnapshot(simA, 60), captureSimSnapshot(simB, 60));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 9: UFO spawning and combat', () => {
    const seed = 505;
    const simA = new GameSim({ rng: seededRng(seed), startCooldown: 0 });
    const simB = new GameSim({ rng: seededRng(seed), startCooldown: 0 });

    simA.spawnUfo('large', 200, 200);
    simB.spawnUfo('large', 200, 200);

    for (let tick = 0; tick < 120; tick++) {
      const input: PlayerInput = { rotate: -0.2, move: 0.5, shoot: tick % 4 === 0 };
      simA.step(FIXED_DT, input);
      simB.step(FIXED_DT, input);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 120), captureSimSnapshot(simB, 120));
    expect(diff.differences).toEqual([]);
    expect(simA.ufos.length).toBe(simB.ufos.length);
    expect(simA.ufoShots.length).toBe(simB.ufoShots.length);
  });

  it('Scenario 10: Player death and respawn', () => {
    const seed = 606;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    // Spawn an asteroid directly on the player
    simA.asteroids.push({
      position: { x: simA.player.position.x, y: simA.player.position.y },
      velocity: { x: 0, y: 0 },
      radius: 40,
      archetype: 'standard',
      sizeCategory: 'medium',
      maxHitPoints: 1,
      hitPoints: 1,
      dying: false,
      deathTimer: 0,
      deathTimerReal: 0,
      hitFlashTimer: 0,
      shakeOffset: { x: 0, y: 0 },
      alive: true,
    });
    simB.asteroids.push({
      position: { x: simB.player.position.x, y: simB.player.position.y },
      velocity: { x: 0, y: 0 },
      radius: 40,
      archetype: 'standard',
      sizeCategory: 'medium',
      maxHitPoints: 1,
      hitPoints: 1,
      dying: false,
      deathTimer: 0,
      deathTimerReal: 0,
      hitFlashTimer: 0,
      shakeOffset: { x: 0, y: 0 },
      alive: true,
    });

    simA.step(FIXED_DT, NO_INPUT);
    simB.step(FIXED_DT, NO_INPUT);

    expect(simA.player.lives).toBe(2);
    expect(simB.player.lives).toBe(2);
    expect(simA.player.isRespawning).toBe(true);
    expect(simB.player.isRespawning).toBe(true);

    const diff = compareSnapshots(captureSimSnapshot(simA, 1), captureSimSnapshot(simB, 1));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 11: Slow Motion', () => {
    const seed = 707;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    simA.slowMotion = { active: true, timer: 6 };
    simB.slowMotion = { active: true, timer: 6 };

    for (let tick = 0; tick < 120; tick++) {
      simA.step(FIXED_DT, { rotate: 0.1, move: 0.5, shoot: false });
      simB.step(FIXED_DT, { rotate: 0.1, move: 0.5, shoot: false });
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 120), captureSimSnapshot(simB, 120));
    expect(diff.differences).toEqual([]);
    expect(simA.slowMotion.active).toBe(true);
  });

  it('Scenario 12: Increasing difficulty', () => {
    const seed = 808;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    // High lives so ships survive 30 seconds of asteroid impacts
    simA.player.lives = 9999;
    simB.player.lives = 9999;

    // Step across 30 seconds (1800 ticks)
    for (let tick = 0; tick < 1850; tick++) {
      simA.step(FIXED_DT, NO_INPUT);
      simB.step(FIXED_DT, NO_INPUT);
    }

    expect(simA.difficultyLevel).toBe(1);
    expect(simB.difficultyLevel).toBe(1);
    const diff = compareSnapshots(captureSimSnapshot(simA, 1850), captureSimSnapshot(simB, 1850));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 13: Assisted Flight steering and its travel-heading state', () => {
    const seed = 909;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    const assistInput: PlayerInput = {
      rotate: 0,
      move: 1,
      shoot: false,
      steer: { heading: 90, mode: 'assist' },
    };

    for (let tick = 0; tick < 60; tick++) {
      simA.step(FIXED_DT, assistInput);
      simB.step(FIXED_DT, assistInput);
    }

    expect(simA.player.travelHeading).not.toBeNull();
    expect(simA.player.travelHeading).toBe(simB.player.travelHeading);

    // Release stick
    simA.step(FIXED_DT, NO_INPUT);
    simB.step(FIXED_DT, NO_INPUT);
    expect(simA.player.travelHeading).toBeNull();
    expect(simB.player.travelHeading).toBeNull();

    const diff = compareSnapshots(captureSimSnapshot(simA, 61), captureSimSnapshot(simB, 61));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 14: Point-to-Fly', () => {
    const seed = 1111;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    const pointInput: PlayerInput = {
      rotate: 0,
      move: 1,
      shoot: false,
      steer: { heading: 180, mode: 'point' },
    };

    for (let tick = 0; tick < 60; tick++) {
      simA.step(FIXED_DT, pointInput);
      simB.step(FIXED_DT, pointInput);
    }

    expect(simA.player.rotation).toBe(simB.player.rotation);
    const diff = compareSnapshots(captureSimSnapshot(simA, 60), captureSimSnapshot(simB, 60));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 15: Classic steering', () => {
    const seed = 2222;
    const simA = new GameSim({ rng: seededRng(seed) });
    const simB = new GameSim({ rng: seededRng(seed) });

    const classicInput: PlayerInput = { rotate: -1, move: 1, shoot: false };
    for (let tick = 0; tick < 60; tick++) {
      simA.step(FIXED_DT, classicInput);
      simB.step(FIXED_DT, classicInput);
    }

    const diff = compareSnapshots(captureSimSnapshot(simA, 60), captureSimSnapshot(simB, 60));
    expect(diff.differences).toEqual([]);
  });

  it('Scenario 16: Pause/resume does not advance simulation time or alter reproducibility', () => {
    const seed = 3333;
    const sim = new GameSim({ rng: seededRng(seed) });
    const runner = new FixedStepRunner(FIXED_TICK_RATE, FIXED_DT);
    const recorder = new ReplayRecorder(seed, DEFAULT_GAME_CONFIG);

    // Run 30 ticks
    let ticksRan = 0;
    for (let f = 0; f < 30; f++) {
      runner.update(1 / 60, (t, dt) => {
        const inp = { rotate: 0.5, move: 1, shoot: false };
        recorder.recordTick(t, inp, sim);
        sim.step(dt, inp);
        ticksRan++;
      });
    }
    expect(ticksRan).toBe(30);

    // Pause for 10 simulated seconds of frame updates
    runner.setPaused(true);
    for (let f = 0; f < 600; f++) {
      runner.update(1 / 60, () => {
        ticksRan++;
      });
    }
    // No ticks executed while paused!
    expect(ticksRan).toBe(30);

    // Unpause and resume
    runner.setPaused(false);
    for (let f = 0; f < 30; f++) {
      runner.update(1 / 60, (t, dt) => {
        const inp = { rotate: 0.5, move: 1, shoot: false };
        recorder.recordTick(t, inp, sim);
        sim.step(dt, inp);
        ticksRan++;
      });
    }
    expect(ticksRan).toBe(60);
    expect(sim.time).toBeCloseTo(60 * FIXED_DT, 4);
  });

  it('Scenario 17: Complete game-over replay serializes and reproduces in Node', () => {
    const seed = 98765;
    const recorder = new ReplayRecorder(seed, DEFAULT_GAME_CONFIG);
    const sim = new GameSim({ rng: seededRng(seed), config: DEFAULT_GAME_CONFIG, startCooldown: 0 });

    let tick = 0;
    while (!sim.isGameOver && tick < 10000) {
      const input: PlayerInput = {
        rotate: (tick * 7) % 100 > 50 ? 0.8 : -0.8,
        move: tick % 15 < 10 ? 1 : 0,
        shoot: tick % 8 === 0,
        laser: tick === 60 || tick === 300,
        boost: tick === 120 || tick === 400,
      };

      recorder.recordTick(tick, input);
      sim.step(FIXED_DT, input);
      if (sim.isGameOver) {
        recorder.markGameOver(sim);
        break;
      }
      tick++;
    }

    expect(sim.isGameOver).toBe(true);
    expect(recorder.isFinalized).toBe(true);

    const replayJson = recorder.serialize();
    expect(typeof replayJson).toBe('string');

    // Independently verify in Node verifier
    const result = verifyReplay(replayJson);
    expect(result.valid).toBe(true);
    expect(result.calculatedScore).toBe(sim.totalScore);
    expect(result.totalTicks).toBe(recorder.ticks);
    expect(result.phase).toBe('gameOver');
    expect(result.gameOverReason).toBe(sim.gameOverReason);
    expect(result.error).toBeUndefined();
  });

  it('produces identical simulation ticks across different render refresh rates (60Hz vs 144Hz)', () => {
    const seed = 1212;

    // Run at simulated 60 Hz frame delta (16.67ms)
    const sim60 = new GameSim({ rng: seededRng(seed) });
    const runner60 = new FixedStepRunner(FIXED_TICK_RATE, FIXED_DT);
    for (let f = 0; f < 120; f++) {
      runner60.update(1 / 60, (_t, dt) => {
        sim60.step(dt, { rotate: 0.2, move: 1, shoot: true });
      });
    }

    // Run at simulated 144 Hz frame delta (6.94ms)
    const sim144 = new GameSim({ rng: seededRng(seed) });
    const runner144 = new FixedStepRunner(FIXED_TICK_RATE, FIXED_DT);
    for (let f = 0; f < 288; f++) {
      runner144.update(1 / 144, (_t, dt) => {
        sim144.step(dt, { rotate: 0.2, move: 1, shoot: true });
      });
    }

    expect(runner60.tick).toBe(runner144.tick);
    const diff = compareSnapshots(captureSimSnapshot(sim60, runner60.tick), captureSimSnapshot(sim144, runner144.tick));
    expect(diff.differences).toEqual([]);
    expect(sim60.player.position).toEqual(sim144.player.position);
    expect(sim60.player.rotation).toEqual(sim144.player.rotation);
  });
});
