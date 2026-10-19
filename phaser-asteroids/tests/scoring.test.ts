import { describe, expect, it } from 'vitest';
import { COMBO_TIMEOUT, KILL_STREAK_MILESTONES, KILL_STREAK_NOTIFICATION_DURATION } from '../src/core/constants';
import { GameSim } from '../src/core/game';
import {
  bannerPose,
  comboMultiplier,
  createCombo,
  milestoneFor,
  registerKill,
  scaledPoints,
  tickCombo,
} from '../src/core/scoring';
import { seededRng } from '../src/core/rng';
import { FRAME, collectEvents, eventsOfType, hold, killOne, queueKill, quietSim, rock, runFor, shotAt, ufoShotAt } from './helpers';

describe('combo multiplier table (Python COMBO_MULTIPLIERS)', () => {
  it.each([
    [1, 1.0],
    [2, 1.5],
    [3, 2.0],
    [4, 2.5],
    [5, 3.0],
    [6, 3.0],
    [50, 3.0],
    [200, 3.0],
  ])('kill %i pays x%f', (count, multiplier) => {
    expect(comboMultiplier(count)).toBe(multiplier);
  });

  it('truncates like int(): armored large (25) at x1.5 is 37, not 38', () => {
    expect(scaledPoints(25, 1.5)).toBe(37);
    expect(scaledPoints(50, 2.5)).toBe(125);
    expect(scaledPoints(10, 1.5)).toBe(15);
  });
});

describe('combo state', () => {
  it('every kill counts one and restarts the 3 s window', () => {
    const combo = createCombo();
    expect(registerKill(combo)).toMatchObject({ count: 1, multiplier: 1, milestone: null });
    tickCombo(combo, 2.5);
    expect(combo.timer).toBeCloseTo(0.5, 9);
    expect(registerKill(combo)).toMatchObject({ count: 2, multiplier: 1.5 });
    expect(combo.timer).toBe(COMBO_TIMEOUT);
  });

  it('expires after exactly 3 s without a kill, clearing the count and the announced milestone', () => {
    const combo = createCombo();
    for (let i = 0; i < 15; i++) registerKill(combo);
    expect(combo.lastMilestone).toBe(15);
    expect(tickCombo(combo, 2.99)).toBe(false);
    expect(combo.count).toBe(15);
    expect(tickCombo(combo, 0.01)).toBe(true);
    expect(combo).toEqual({ count: 0, timer: 0, lastMilestone: 0 });
    expect(tickCombo(combo, 1)).toBe(false); // nothing running: nothing to expire
  });

  it('after expiry the next kill is a fresh x1.0 and the same milestone can be announced again', () => {
    const combo = createCombo();
    for (let i = 0; i < 15; i++) registerKill(combo);
    tickCombo(combo, 3);
    let last = registerKill(combo);
    expect(last.multiplier).toBe(1);
    for (let i = 1; i < 15; i++) last = registerKill(combo);
    expect(last.milestone?.name).toBe('KILLING SPREE!');
  });
});

describe('kill-streak milestones (Python KILL_STREAK_MILESTONES)', () => {
  it('has the seven original thresholds, names and colours', () => {
    expect(KILL_STREAK_MILESTONES.map((m) => [m.kills, m.name])).toEqual([
      [15, 'KILLING SPREE!'],
      [30, 'RAMPAGE!'],
      [50, 'DOMINATING!'],
      [75, 'UNSTOPPABLE!'],
      [100, 'GODLIKE!'],
      [150, 'LEGENDARY!'],
      [200, 'BEYOND LEGENDARY!'],
    ]);
    expect(KILL_STREAK_MILESTONES.map((m) => m.color.toString(16).padStart(6, '0'))).toEqual([
      'ffc832',
      'ff9600',
      'ff64ff',
      'ff3232',
      'ff0000',
      'ffd700',
      '00ffff',
    ]);
    expect(KILL_STREAK_NOTIFICATION_DURATION).toBe(2.5);
  });

  it('fires once at each threshold and at no other kill', () => {
    const combo = createCombo();
    const hits: Array<[number, string]> = [];
    for (let kill = 1; kill <= 210; kill++) {
      const credit = registerKill(combo);
      if (credit.milestone) hits.push([kill, credit.milestone.name]);
    }
    expect(hits).toEqual(KILL_STREAK_MILESTONES.map((m) => [m.kills, m.name]));
  });

  it('milestoneFor picks the highest unannounced milestone at or below the count', () => {
    expect(milestoneFor(14, 0)).toBeNull();
    expect(milestoneFor(15, 0)?.kills).toBe(15);
    expect(milestoneFor(15, 15)).toBeNull();
    expect(milestoneFor(29, 15)).toBeNull();
    expect(milestoneFor(30, 15)?.kills).toBe(30);
    expect(milestoneFor(60, 15)?.kills).toBe(50); // would skip 30 only if a count ever jumped; the highest wins, as in Python
  });
});

describe('kill-streak banner animation (Python KillStreakNotification.draw)', () => {
  const D = KILL_STREAK_NOTIFICATION_DURATION;

  it('slides in from 100 px above, fades in over the first 15 % and out over the last 15 %', () => {
    const start = bannerPose(D, D);
    expect(start.alpha).toBeCloseTo(0, 9);
    expect(start.yOffset).toBeCloseTo(-100, 9);

    const early = bannerPose(D * 0.9, D); // 10 % in
    expect(early.alpha).toBeCloseTo(0.1 / 0.15, 9);
    expect(early.yOffset).toBeCloseTo(-50, 9);

    const settled = bannerPose(D * 0.5, D);
    expect(settled.alpha).toBe(1);
    expect(settled.yOffset).toBe(0);

    const fading = bannerPose(D * 0.075, D); // 92.5 % in
    expect(fading.alpha).toBeCloseTo(0.5, 9);
    expect(bannerPose(0.0001, D).alpha).toBeLessThan(0.01);
  });

  it('pulses between 1.0 and 1.075 twice a second', () => {
    for (let t = 0.01; t < D; t += 0.013) {
      const { scale } = bannerPose(t, D);
      expect(scale).toBeGreaterThanOrEqual(1);
      expect(scale).toBeLessThanOrEqual(1.0751);
    }
    expect(bannerPose(1.5, D).scale).toBeCloseTo(1.075, 9); // (3 % 1) - 0.5 -> |-0.5|
    expect(bannerPose(1.25, D).scale).toBeCloseTo(1.0, 9);
  });
});

describe('combo scoring in the simulation', () => {
  it('pays each tier of the table on consecutive kills (small rocks: 50 x 1, 1.5, 2, 2.5, 3, 3)', () => {
    const sim = quietSim();
    const paid: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = sim.player.score;
      const events = killOne(sim, i);
      expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
      paid.push(sim.player.score - before);
    }
    expect(paid).toEqual([50, 75, 100, 125, 150, 150, 150]);
    expect(sim.combo.count).toBe(7);
  });

  it('reports the combo and multiplier on each kill event', () => {
    const sim = quietSim();
    const seen = [0, 1, 2].map((i) => eventsOfType(killOne(sim, i), 'asteroid_destroyed')[0]);
    expect(seen.map((e) => [e?.combo, e?.multiplier, e?.points])).toEqual([
      [1, 1, 50],
      [2, 1.5, 75],
      [3, 2, 100],
    ]);
  });

  it('the window is measured from the last kill, restarts on every kill, and closes at 3 s', () => {
    const sim = quietSim();
    killOne(sim, 0);
    runFor(sim, 2.5);
    expect(sim.combo.count).toBe(1);
    killOne(sim, 1); // 2.5 s after the first: still inside its window
    expect(sim.combo.count).toBe(2);
    runFor(sim, 2.9);
    expect(sim.combo.count).toBe(2); // the second kill restarted the window
    runFor(sim, 0.2);
    expect(sim.combo.count).toBe(0);

    const before = sim.player.score;
    killOne(sim, 2);
    expect(sim.player.score - before).toBe(50); // back to x1.0
  });

  it('the window runs on real time, not on Slow Motion time', () => {
    const sim = quietSim();
    killOne(sim, 0);
    sim.slowMotion = { active: true, timer: 6 };
    runFor(sim, 3.05);
    expect(sim.combo.count).toBe(0);
  });

  it('two kills in the same frame are paid in order at consecutive multipliers', () => {
    const sim = quietSim();
    queueKill(sim, 0);
    queueKill(sim, 1);
    const events = sim.step(FRAME);
    const kills = eventsOfType(events, 'asteroid_destroyed');
    expect(kills.map((e) => [e.combo, e.points])).toEqual([
      [1, 50],
      [2, 75],
    ]);
    expect(sim.player.score).toBe(125);
  });

  it('a split pays for the parent only; the children are separate kills later', () => {
    const sim = quietSim();
    const parent = rock(300, 300, 60);
    sim.asteroids.push(parent);
    sim.shots.push(shotAt(300, 300));
    sim.step(FRAME);
    expect(sim.player.score).toBe(10);
    expect(sim.combo.count).toBe(1);

    runFor(sim, 0.3);
    const children = sim.asteroids.filter((a) => !a.dying && a.alive);
    expect(children).toHaveLength(2);
    expect(sim.combo.count).toBe(1); // splitting is not a kill

    const child = children[0];
    sim.shots.push(shotAt(child?.position.x ?? 0, child?.position.y ?? 0));
    sim.step(FRAME);
    expect(sim.combo.count).toBe(2);
    expect(sim.player.score).toBe(10 + 30); // medium 20 x 1.5
  });

  it('a non-lethal armored hit is not a kill: no combo, no points, no window reset; the second hit pays x multiplier', () => {
    const sim = quietSim();
    killOne(sim, 0); // combo 1
    runFor(sim, 1);
    const timerBefore = sim.combo.timer;

    const armored = rock(500, 200, 20, 'armored');
    sim.asteroids.push(armored);
    sim.shots.push(shotAt(500, 200));
    const events = sim.step(FRAME);
    expect(armored.dying).toBe(false);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(0);
    expect(eventsOfType(events, 'asteroid_hit')).toHaveLength(1);
    expect(sim.combo.count).toBe(1);
    expect(sim.combo.timer).toBeLessThan(timerBefore); // not refreshed
    expect(sim.player.score).toBe(50);

    sim.shots.push(shotAt(500, 200));
    sim.step(FRAME);
    expect(armored.dying).toBe(true);
    expect(sim.combo.count).toBe(2);
    expect(sim.player.score).toBe(50 + Math.trunc(85 * 1.5)); // small armored = int(50 x 1.5 + 10) = 85, paid at x1.5
  });

  it('armored points follow int(base x archetype multiplier + bonus) before the combo multiplier', () => {
    const sim = quietSim();
    const armored = rock(500, 200, 20, 'armored');
    armored.hitPoints = 1;
    sim.asteroids.push(armored);
    sim.shots.push(shotAt(500, 200));
    sim.step(FRAME);
    // small armored = int(50 x 1.5 + 10) = 85, first kill x1.0
    expect(sim.player.score).toBe(85);
  });

  it('a shot cannot kill the same rock twice in one frame (the second shot flies on)', () => {
    const sim = quietSim();
    const target = rock(300, 300, 20);
    sim.asteroids.push(target);
    sim.shots.push(shotAt(300, 300), shotAt(301, 300));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'asteroid_destroyed')).toHaveLength(1);
    expect(sim.player.score).toBe(50);
    expect(sim.combo.count).toBe(1);
    expect(sim.shots.filter((s) => s.alive)).toHaveLength(1);
  });

  it('an asteroid that crashes into the ship is not a kill, with or without a shield', () => {
    for (const shield of [false, true]) {
      const sim = quietSim();
      sim.player.shieldActive = shield;
      sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
      const events = sim.step(FRAME);
      const destroyed = eventsOfType(events, 'asteroid_destroyed');
      expect(destroyed).toHaveLength(1);
      expect(destroyed[0]?.points).toBe(0);
      expect(destroyed[0]?.combo).toBeUndefined();
      expect(sim.combo.count).toBe(0);
      expect(sim.player.score).toBe(0);
    }
  });

  it('losing a life does not reset the combo (only the timer or a new game does)', () => {
    const sim = quietSim();
    for (let i = 0; i < 3; i++) killOne(sim, i);
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    sim.step(FRAME);
    expect(sim.player.lives).toBe(2);
    expect(sim.combo.count).toBe(3);
    const before = sim.player.score;
    killOne(sim, 3);
    expect(sim.player.score - before).toBe(125); // x2.5 continues
  });

  it('a new run starts with no combo, no banner and the window closed', () => {
    const sim = quietSim();
    for (let i = 0; i < 15; i++) killOne(sim, i);
    expect(sim.streakBanner).not.toBeNull();
    const fresh = new GameSim({ rng: seededRng(2), ufos: false });
    expect(fresh.combo).toEqual({ count: 0, timer: 0, lastMilestone: 0 });
    expect(fresh.streakBanner).toBeNull();
  });
});

describe('kill streaks in the simulation', () => {
  it('announce each milestone exactly once, in order, with the original names, over a 210-kill chain', () => {
    const sim = quietSim();
    const announced: Array<[number, string, number]> = [];
    let destroyed = 0;
    for (let i = 0; i < 210; i++) {
      const events = killOne(sim, i);
      destroyed += eventsOfType(events, 'asteroid_destroyed').length;
      for (const e of eventsOfType(events, 'kill_streak')) announced.push([sim.combo.count, e.name, e.kills]);
    }
    expect(destroyed).toBe(210);
    expect(announced).toEqual(KILL_STREAK_MILESTONES.map((m) => [m.kills, m.name, m.kills]));
  });

  it('puts the banner on screen for 2.5 s, replaces it with the next milestone, and clears it afterwards', () => {
    const sim = quietSim();
    for (let i = 0; i < 15; i++) killOne(sim, i);
    expect(sim.streakBanner).toMatchObject({ kills: 15, name: 'KILLING SPREE!', color: 0xffc832 });
    runFor(sim, 1);
    expect(sim.streakBanner).not.toBeNull();
    runFor(sim, 1.6);
    expect(sim.streakBanner).toBeNull();

    // Keep chaining: kill 30 replaces whatever is showing.
    const sim2 = quietSim();
    for (let i = 0; i < 30; i++) killOne(sim2, i);
    expect(sim2.streakBanner?.name).toBe('RAMPAGE!');
    expect(sim2.streakBanner?.timer).toBeCloseTo(KILL_STREAK_NOTIFICATION_DURATION, 1);
  });

  it('three kills in one frame that cross a milestone announce it once, on the kill that reached it', () => {
    const sim = quietSim();
    for (let i = 0; i < 13; i++) killOne(sim, i);
    expect(sim.combo.count).toBe(13);
    queueKill(sim, 13);
    queueKill(sim, 14);
    queueKill(sim, 15);
    const events = sim.step(FRAME);
    const ordered = events.filter((e) => e.type === 'asteroid_destroyed' || e.type === 'kill_streak').map((e) => e.type === 'kill_streak' ? `streak:${e.kills}` : `kill:${e.combo}`);
    expect(ordered).toEqual(['kill:14', 'kill:15', 'streak:15', 'kill:16']);
  });

  it('a lost combo can announce the same milestone again, and the banner never outlives game over', () => {
    const sim = quietSim();
    for (let i = 0; i < 15; i++) killOne(sim, i);
    runFor(sim, 3.1);
    expect(sim.combo.count).toBe(0);
    let again = 0;
    for (let i = 0; i < 15; i++) again += eventsOfType(killOne(sim, i + 20), 'kill_streak').length;
    expect(again).toBe(1);
    expect(sim.streakBanner).not.toBeNull();

    sim.player.lives = 1;
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    expect(sim.streakBanner).toBeNull();
  });

  it('the combo clock stands still on the game-over screen', () => {
    const sim = quietSim();
    for (let i = 0; i < 3; i++) killOne(sim, i);
    sim.player.lives = 1;
    sim.asteroids.push(rock(sim.player.position.x, sim.player.position.y, 40));
    sim.step(FRAME);
    expect(sim.isGameOver).toBe(true);
    const timer = sim.combo.timer;
    runFor(sim, 2);
    expect(sim.combo.timer).toBe(timer);
  });
});

describe('combo credit by weapon', () => {
  function laserSim() {
    const sim = quietSim();
    sim.player.rotation = 270;
    sim.player.position = { x: 100, y: 360 };
    return sim;
  }

  it('a laser through four rocks pays them in array order at 1, 1.5, 2, 2.5 and scores each once', () => {
    const sim = laserSim();
    for (let i = 0; i < 4; i++) sim.asteroids.push(rock(300 + i * 150, 360, 20));
    const events = sim.step(FRAME, hold({ laser: true }));
    const kills = eventsOfType(events, 'asteroid_destroyed');
    expect(kills.map((e) => e.combo)).toEqual([1, 2, 3, 4]);
    expect(sim.player.score).toBe(50 + 75 + 100 + 125);
    const scoreAfter = sim.player.score;
    runFor(sim, 0.35); // the rest of the beam's life: no one is hit twice
    expect(sim.player.score).toBe(scoreAfter);
    expect(sim.combo.count).toBe(4);
  });

  it('children that spawn into the live beam are separate kills; total kills match the combo exactly', () => {
    const sim = laserSim();
    sim.asteroids.push(rock(500, 360, 60));
    const events = [...sim.step(FRAME, hold({ laser: true })), ...collectEvents(sim, 0.6)];
    const kills = eventsOfType(events, 'asteroid_destroyed');
    // Parent (large, x1.0), then its two mediums caught by the beam (x1.5, x2.0); grandchildren appear after the beam ends.
    expect(kills.map((e) => [e.combo, e.points])).toEqual([
      [1, 10],
      [2, 30],
      [3, 40],
    ]);
    expect(sim.combo.count).toBe(3);
    expect(sim.player.score).toBe(80);
  });

  it('an armored rock in a laser takes one hit per beam: no kill, no combo', () => {
    const sim = laserSim();
    const armored = rock(500, 360, 20, 'armored');
    sim.asteroids.push(armored);
    sim.step(FRAME, hold({ laser: true }));
    runFor(sim, 0.4);
    expect(armored.dying).toBe(false);
    expect(armored.hitPoints).toBe(1);
    expect(sim.combo.count).toBe(0);
    expect(sim.player.score).toBe(0);
  });

  it('boost ramming through a cluster is one kill per rock, scored on the combo', () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    const { x, y } = sim.player.position;
    sim.asteroids.push(rock(x + 30, y, 20), rock(x - 30, y, 20), rock(x, y + 30, 20));
    const events = sim.step(FRAME);
    expect(eventsOfType(events, 'asteroid_destroyed').map((e) => e.combo)).toEqual([1, 2, 3]);
    expect(sim.player.score).toBe(50 + 75 + 100);
    expect(sim.player.lives).toBe(3);
  });

  it('a boost ram on armored plating: first contact frame is no kill, the next one is', () => {
    const sim = quietSim();
    sim.player.boost = { active: true, timer: 3, cooldown: 8, keyHeld: false };
    const { x, y } = sim.player.position;
    const armored = rock(x + 20, y, 20, 'armored');
    sim.asteroids.push(armored);
    sim.step(FRAME);
    expect(sim.combo.count).toBe(0);
    sim.step(FRAME);
    expect(sim.combo.count).toBe(1);
    expect(sim.player.score).toBe(85);
  });

  it("a UFO's shot that destroys a rock pays nobody but still advances the combo (a Python quirk, kept)", () => {
    const sim = quietSim();
    sim.asteroids.push(rock(400, 200, 20));
    sim.ufoShots.push(ufoShotAt(400, 200));
    const events = sim.step(FRAME);
    const kills = eventsOfType(events, 'asteroid_destroyed');
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ points: 0, combo: 1 });
    expect(sim.player.score).toBe(0);
    expect(sim.combo.count).toBe(1);
    expect(sim.combo.timer).toBe(COMBO_TIMEOUT - 0); // window opened
    // ...and the next player kill is paid at the next tier.
    const events2 = killOne(sim, 5);
    expect(eventsOfType(events2, 'asteroid_destroyed')[0]?.points).toBe(75);
  });
});
