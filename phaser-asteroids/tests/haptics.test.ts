import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/core/game';
import { HapticManager, type LifecycleDocument } from '../src/haptics/hapticManager';
import {
  HAPTIC_ORDER,
  HAPTIC_PATTERNS,
  HAPTIC_PRIORITY,
  MEDIUM_PRIORITY_GAP_MS,
  TEST_PATTERN,
  hapticKindsOf,
  patternLength,
  type HapticKind,
} from '../src/haptics/hapticPatterns';
import { DEFAULT_HAPTICS_ENABLED, HAPTICS_STORAGE_KEY, HapticSettings, parseStoredHaptics } from '../src/haptics/hapticSettings';
import { NavigatorVibrationAdapter, type VibrationAdapter } from '../src/haptics/vibrationAdapter';
import { FRAME, crashInto, hitUnprotected, hold, quietCoop, quietSim } from './helpers';
import { CountingTarget } from './touchFakes';

// --- fakes -------------------------------------------------------------------

type Call = number | readonly number[] | 'cancel';

/** Records every request instead of vibrating anything. */
class FakeVibration implements VibrationAdapter {
  supported = true;
  accepts = true;
  throws = false;
  calls: Call[] = [];
  vibrate(pattern: number | readonly number[]): boolean {
    if (this.throws) throw new Error('NotAllowedError');
    if (!this.accepts) return false;
    this.calls.push(pattern);
    return true;
  }
  cancel(): void {
    this.calls.push('cancel');
  }
  get vibrations(): Array<number | readonly number[]> {
    return this.calls.filter((c): c is number | readonly number[] => c !== 'cancel');
  }
  get cancels(): number {
    return this.calls.filter((c) => c === 'cancel').length;
  }
}

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

class FakeDocument extends CountingTarget implements LifecycleDocument {
  hidden = false;
}

class Clock {
  now = 10_000;
  readonly read = (): number => this.now;
  advance(ms: number): void {
    this.now += ms;
  }
}

/** `enabled`: what the player saved (`'1'` / `'0'`). Pass `null` for a brand-new player, who has saved nothing and gets the default. */
function setup(enabled: boolean | null = true) {
  const adapter = new FakeVibration();
  const storage = new MemoryStorage();
  if (enabled !== null) storage.data.set(HAPTICS_STORAGE_KEY, enabled ? '1' : '0');
  const settings = new HapticSettings(storage);
  const clock = new Clock();
  const manager = new HapticManager({ adapter, settings, clock: clock.read });
  return { adapter, storage, settings, clock, manager };
}

const boost: SimEvent = { type: 'boost_started', player: 1 };
const laser: SimEvent = { type: 'laser_fired', player: 1 };
const hit: SimEvent = { type: 'player_hit', livesLeft: 2, source: 'asteroid', player: 1 };
const lastHit: SimEvent = { type: 'player_hit', livesLeft: 0, source: 'asteroid', player: 1 };
const gameOver: SimEvent = { type: 'game_over', score: 0, scores: [0], reason: 'all_eliminated' };
const eliminated: SimEvent = { type: 'player_eliminated', player: 2 };

// --- the table ---------------------------------------------------------------

describe('haptic effects: the configured table', () => {
  it('has the four effects with their initial durations and priorities', () => {
    expect(HAPTIC_PATTERNS.boost).toMatchObject({ pattern: 30, priority: HAPTIC_PRIORITY.medium });
    expect(HAPTIC_PATTERNS.laser).toMatchObject({ pattern: 55, priority: HAPTIC_PRIORITY.medium });
    expect(HAPTIC_PATTERNS.damage).toMatchObject({ pattern: 65, priority: HAPTIC_PRIORITY.high });
    expect(HAPTIC_PATTERNS.death).toMatchObject({ pattern: 110, priority: HAPTIC_PRIORITY.highest });
    expect(HAPTIC_PRIORITY.medium).toBeLessThan(HAPTIC_PRIORITY.high);
    expect(HAPTIC_PRIORITY.high).toBeLessThan(HAPTIC_PRIORITY.highest);
    expect([...HAPTIC_ORDER].sort()).toEqual(['boost', 'damage', 'death', 'laser']);
  });

  it('measures a pattern list by its total length', () => {
    expect(patternLength(65)).toBe(65);
    expect(patternLength([110, 40, 60])).toBe(210);
  });

  it('maps only the four sim events (ordinary shooting, kills, pickups and so on are silent)', () => {
    const silent: SimEvent[] = [
      { type: 'shot_fired', player: 1 },
      { type: 'asteroid_destroyed', radius: 40, points: 10 },
      { type: 'asteroid_hit', position: { x: 0, y: 0 } },
      { type: 'ufo_destroyed', ufoType: 'large', points: 200, radius: 30, position: { x: 0, y: 0 } },
      { type: 'powerup_collected', powerType: 'shield', player: 1 },
      { type: 'powerup_dropped', powerType: 'shield' },
      { type: 'kill_streak', kills: 5, name: 'x', color: 0 },
      { type: 'player_revived', player: 1, by: 2 },
      { type: 'wall_bounce' },
      { type: 'ufo_fired', ufoType: 'large' },
      { type: 'ufo_spawned', ufoType: 'large' },
    ];
    expect(hapticKindsOf(silent).size).toBe(0);
    expect([...hapticKindsOf([boost])]).toEqual(['boost']);
    expect([...hapticKindsOf([laser])]).toEqual(['laser']);
    expect([...hapticKindsOf([hit])]).toEqual(['damage']);
    expect([...hapticKindsOf([gameOver])]).toEqual(['death']);
    expect([...hapticKindsOf([eliminated])]).toEqual(['death']);
  });
});

// --- gameplay -> effect --------------------------------------------------------

describe('events produce their effects', () => {
  it.each<[string, SimEvent, number]>([
    ['Boost activation', boost, 30],
    ['Laser firing', laser, 55],
    ['actual damage', hit, 65],
    ['a game-ending death', gameOver, 110],
    ['a player being eliminated', eliminated, 110],
  ])('%s vibrates for %i ms', (_name, event, ms) => {
    const { adapter, manager } = setup();
    expect(manager.handle([event])).toBe('played');
    expect(adapter.calls).toEqual([ms]);
  });

  it('does nothing for a step with no haptic events', () => {
    const { adapter, manager } = setup();
    expect(manager.handle([])).toBeNull();
    expect(manager.handle([{ type: 'shot_fired', player: 1 }])).toBeNull();
    expect(adapter.calls).toEqual([]);
  });
});

describe('only successful gameplay events vibrate (real simulation)', () => {
  it('a successful Boost vibrates once; pressing Boost during its cooldown does not', () => {
    const { adapter, manager } = setup();
    const sim = quietSim();
    sim.player.rotation = 0;
    // Press, release, press again: the second press lands while Boost is running / cooling down.
    const first = sim.step(FRAME, hold({ boost: true }));
    manager.handle(first);
    expect(adapter.vibrations).toEqual([30]);
    sim.step(FRAME, hold({ boost: false }));
    for (let i = 0; i < 60; i++) manager.handle(sim.step(FRAME, hold({ boost: true })));
    for (let i = 0; i < 60; i++) manager.handle(sim.step(FRAME, hold({ boost: false })));
    for (let i = 0; i < 60; i++) manager.handle(sim.step(FRAME, hold({ boost: true })));
    expect(sim.player.boost.cooldown).toBeGreaterThan(0);
    expect(adapter.vibrations).toEqual([30]);
  });

  it('a Laser vibrates once for the beam, not every frame it lasts; pressing it with no charges does not vibrate', () => {
    const { adapter, manager, clock } = setup();
    const sim = quietSim();
    manager.handle(sim.step(FRAME, hold({ laser: true })));
    expect(adapter.vibrations).toEqual([55]);
    // The beam stays on screen for several frames; tapping again while it is up spends no charge and shows no new vibration either.
    let framesWithBeam = 0;
    for (let i = 0; i < 12; i++) {
      clock.advance(1000 * FRAME);
      manager.handle(sim.step(FRAME, hold({ laser: true })));
      if (sim.lasers.length > 0) framesWithBeam++;
    }
    expect(framesWithBeam).toBeGreaterThan(2);
    expect(adapter.vibrations).toEqual([55]);

    const empty = setup();
    const drySim = quietSim();
    drySim.player.laser.shotsRemaining = 0;
    for (let i = 0; i < 10; i++) {
      empty.manager.handle(drySim.step(FRAME, hold({ laser: true })));
      empty.manager.handle(drySim.step(FRAME, hold({ laser: false })));
    }
    expect(empty.adapter.calls).toEqual([]);
  });

  it('a hit that costs a life vibrates once; a hit absorbed by a Shield or respawn protection does not', () => {
    const { adapter, manager } = setup();
    const sim = quietSim();
    sim.player.shieldActive = true;
    manager.handle(crashInto(sim, sim.player));
    expect(sim.player.lives).toBe(3);
    expect(adapter.calls).toEqual([]);

    manager.handle(hitUnprotected(sim, sim.player));
    expect(sim.player.lives).toBe(2);
    expect(adapter.vibrations).toEqual([65]);

    manager.handle(crashInto(sim, sim.player)); // respawn protection is on now
    expect(sim.player.lives).toBe(2);
    expect(adapter.vibrations).toEqual([65]);
  });

  it('the fatal hit gives the sim a player_hit AND a game_over in one step, and exactly one death vibration', () => {
    const { adapter, manager } = setup();
    const sim = quietSim();
    sim.player.lives = 1;
    const events = hitUnprotected(sim, sim.player);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['player_hit', 'game_over']));
    expect(manager.handle(events)).toBe('played');
    expect(adapter.vibrations).toEqual([110]);
  });

  it('losing the last life of several: each non-final hit is damage, the final one is death', () => {
    const { adapter, manager, clock } = setup();
    const sim = quietSim();
    for (let i = 0; i < 3; i++) {
      manager.handle(hitUnprotected(sim, sim.player));
      clock.advance(2500);
    }
    expect(sim.isGameOver).toBe(true);
    expect(adapter.vibrations).toEqual([65, 65, 110]);
  });

  it('knocking a ship out while its partner plays on is a death too (player_eliminated, no game over)', () => {
    const { adapter, manager } = setup();
    const sim = quietCoop();
    const second = sim.player2;
    if (!second) throw new Error('expected a two-player sim');
    second.lives = 1;
    const events = hitUnprotected(sim, second);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['player_hit', 'player_eliminated']));
    expect(sim.isGameOver).toBe(false);
    manager.handle(events);
    expect(adapter.vibrations).toEqual([110]);
  });
});

// --- ordering and priority ---------------------------------------------------

describe('events in one simulation step', () => {
  it('damage + death in the same step play only the death effect, whichever order the events are in', () => {
    for (const events of [[hit, gameOver], [gameOver, hit], [lastHit, eliminated], [eliminated, lastHit]]) {
      const { adapter, manager } = setup();
      expect(manager.handle(events)).toBe('played');
      expect(adapter.calls).toEqual([110]);
    }
  });

  it('is deterministic: the same events in any order give the same single effect (death > damage > boost > laser)', () => {
    const all = [boost, laser, hit, gameOver];
    const permutations = [all, [...all].reverse(), [laser, gameOver, boost, hit], [hit, laser, boost, gameOver]];
    for (const events of permutations) {
      const { adapter, manager } = setup();
      manager.handle(events);
      expect(adapter.calls).toEqual([110]);
    }
    const lowerTiers: Array<[SimEvent[], number]> = [
      [[laser, boost, hit], 65],
      [[laser, boost], 30],
      [[boost, laser], 30],
    ];
    for (const [events, ms] of lowerTiers) {
      const { adapter, manager } = setup();
      manager.handle(events);
      expect(adapter.calls).toEqual([ms]);
    }
  });

  it('when the top-ranked effect is refused the step is silent: it does not fall back to a lesser one', () => {
    const { adapter, manager, clock } = setup();
    manager.handle([hit]);
    clock.advance(120); // damage is over but still in its cooldown
    expect(manager.handle([hit, laser])).toBe('cooldown');
    expect(adapter.vibrations).toEqual([65]);
  });
});

describe('priority', () => {
  it('a higher priority replaces a running lower one', () => {
    const { adapter, manager, clock } = setup();
    manager.handle([boost]);
    clock.advance(10); // Boost (30 ms) is still running
    expect(manager.handle([gameOver])).toBe('played');
    expect(adapter.vibrations).toEqual([30, 110]);
    // Damage replaces a running Laser too
    const other = setup();
    other.manager.handle([laser]);
    other.clock.advance(10);
    expect(other.manager.handle([hit])).toBe('played');
    expect(other.adapter.vibrations).toEqual([55, 65]);
  });

  it('a lower priority never interrupts a running higher one', () => {
    const { adapter, manager, clock } = setup();
    manager.handle([gameOver]);
    clock.advance(40); // death (110 ms) is still running
    expect(manager.handle([laser])).toBe('busy');
    expect(manager.handle([boost])).toBe('busy');
    expect(manager.handle([hit])).toBe('busy');
    expect(adapter.vibrations).toEqual([110]);
  });

  it('an equal priority does not interrupt a running effect either, and nothing is queued for later', () => {
    const { adapter, manager, clock } = setup();
    manager.handle([boost]);
    clock.advance(10);
    expect(manager.handle([laser])).toBe('busy');
    clock.advance(1000); // long after: the dropped Laser must not play late
    expect(adapter.vibrations).toEqual([30]);
    expect(manager.handle([])).toBeNull();
    expect(adapter.vibrations).toEqual([30]);
  });

  it('after the running effect ends a lower priority is allowed again (once the short medium-priority gap has passed)', () => {
    const { adapter, manager, clock } = setup();
    manager.handle([gameOver]);
    clock.advance(110 + 5);
    expect(manager.handle([laser])).toBe('busy'); // inside the gap that follows an effect
    clock.advance(MEDIUM_PRIORITY_GAP_MS);
    expect(manager.handle([laser])).toBe('played');
    expect(adapter.vibrations).toEqual([110, 55]);
  });

  it('damage and death ignore the medium-priority gap: a Laser buzz just before never swallows them', () => {
    const { adapter, manager, clock } = setup();
    manager.handle([laser]);
    clock.advance(55 + 5); // Laser has just ended, inside the gap
    expect(manager.handle([hit])).toBe('played');
    clock.advance(65 + 5);
    expect(manager.handle([gameOver])).toBe('played');
    expect(adapter.vibrations).toEqual([55, 65, 110]);
  });
});

// --- cooldowns ---------------------------------------------------------------

describe('cooldowns', () => {
  it.each<HapticKind>(['boost', 'laser', 'damage', 'death'])('%s is not repeated inside its cooldown, and is allowed again after it', (kind) => {
    const { adapter, manager, clock } = setup();
    expect(manager.request(kind)).toBe('played');
    const { cooldownMs } = HAPTIC_PATTERNS[kind];
    clock.advance(cooldownMs - 1);
    expect(manager.request(kind)).not.toBe('played');
    expect(adapter.vibrations).toHaveLength(1);
    clock.advance(1);
    expect(manager.request(kind)).toBe('played');
    expect(adapter.vibrations).toHaveLength(2);
  });

  it('a burst of repeated damage events buzzes once, not continuously', () => {
    const { adapter, manager, clock } = setup();
    for (let i = 0; i < 20; i++) {
      manager.handle([hit]);
      clock.advance(10);
    }
    expect(adapter.vibrations).toEqual([65]);
  });

  it('the same step delivered twice (a duplicate subscription) buzzes once', () => {
    const { adapter, manager } = setup();
    const events = [hit];
    manager.handle(events);
    manager.handle(events);
    expect(adapter.vibrations).toEqual([65]);
  });

  it('uses the injected clock only, so no test needs a real sleep', () => {
    const { manager, clock } = setup();
    manager.request('death');
    expect(manager.isVibrating).toBe(true);
    clock.advance(109);
    expect(manager.isVibrating).toBe(true);
    clock.advance(1);
    expect(manager.isVibrating).toBe(false);
  });
});

// --- settings ----------------------------------------------------------------

describe('HAPTICS ON / OFF', () => {
  it('is ON for a new player and nothing is written until they choose', () => {
    const { storage, settings, manager } = setup(null);
    expect(DEFAULT_HAPTICS_ENABLED).toBe(true);
    expect(settings.enabled).toBe(true);
    expect(manager.enabled).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('a saved OFF stays OFF: the new default never overrides an explicit choice, and nothing is rewritten', () => {
    const { storage, settings, manager } = setup(false);
    expect(storage.data.get(HAPTICS_STORAGE_KEY)).toBe('0');
    expect(settings.enabled).toBe(false);
    expect(manager.enabled).toBe(false);
    expect(manager.handle([gameOver])).toBe('disabled');
    expect(storage.data.get(HAPTICS_STORAGE_KEY)).toBe('0');
    expect(storage.data.size).toBe(1);
  });

  it('a saved ON stays ON', () => {
    const { settings } = setup(true);
    expect(settings.enabled).toBe(true);
  });

  it('opening a menu, or constructing the manager, never vibrates by itself', () => {
    const { adapter } = setup(null);
    expect(adapter.calls).toEqual([]);
  });

  it('a new player who turns it off is remembered as OFF', () => {
    const { storage, settings } = setup(null);
    settings.set(false);
    expect(storage.data.get(HAPTICS_STORAGE_KEY)).toBe('0');
    expect(new HapticSettings(storage).enabled).toBe(false);
  });

  it('OFF suppresses every gameplay effect', () => {
    const { adapter, manager } = setup(false);
    for (const events of [[boost], [laser], [hit], [gameOver]]) expect(manager.handle(events)).toBe('disabled');
    expect(adapter.calls).toEqual([]);
  });

  it('turning it off cancels the vibration that is running, and turning it on does not buzz', () => {
    const { adapter, manager, settings } = setup();
    manager.handle([gameOver]);
    settings.set(false);
    expect(adapter.calls).toEqual([110, 'cancel']);
    expect(manager.isVibrating).toBe(false);
    settings.set(true);
    expect(adapter.calls).toEqual([110, 'cancel']);
    manager.setEnabled(false); // the menu button goes through the manager
    expect(manager.enabled).toBe(false);
  });

  it('does not call cancel when nothing is running', () => {
    const { adapter, settings } = setup();
    settings.set(false);
    expect(adapter.calls).toEqual([]);
  });

  it('persists the choice and restores it', () => {
    const { storage, settings } = setup(false);
    settings.set(true);
    expect(storage.data.get(HAPTICS_STORAGE_KEY)).toBe('1');
    expect(new HapticSettings(storage).enabled).toBe(true);
    settings.set(false);
    expect(storage.data.get(HAPTICS_STORAGE_KEY)).toBe('0');
    expect(new HapticSettings(storage).enabled).toBe(false);
    expect(settings.toggle()).toBe(true);
  });

  it('ignores invalid stored values and falls back to the default (ON)', () => {
    expect(parseStoredHaptics('1')).toBe(true);
    expect(parseStoredHaptics('0')).toBe(false);
    for (const junk of ['true', 'ON', '2', '', ' 1', 'null', undefined, null]) {
      expect(parseStoredHaptics(junk)).toBeNull();
      const storage = new MemoryStorage();
      if (typeof junk === 'string') storage.data.set(HAPTICS_STORAGE_KEY, junk);
      expect(new HapticSettings(storage).enabled).toBe(DEFAULT_HAPTICS_ENABLED);
    }
  });

  it('survives blocked storage (private window): works for the visit, remembers nothing, never throws', () => {
    const boom = {
      getItem(): string | null {
        throw new Error('SecurityError');
      },
      setItem(): void {
        throw new Error('QuotaExceededError');
      },
    };
    const settings = new HapticSettings(boom);
    expect(settings.enabled).toBe(true);
    expect(() => settings.set(false)).not.toThrow();
    expect(settings.enabled).toBe(false);
    expect(new HapticSettings(null).enabled).toBe(true);
  });

  it('is independent of the audio settings: it reads and writes only its own key', () => {
    const { storage, settings } = setup(false);
    storage.data.set('asteroids.musicMuted', '1');
    storage.data.set('asteroids.musicVolume', '0.4');
    settings.set(true);
    settings.set(false);
    expect([...storage.data.keys()].sort()).toEqual(['asteroids.haptics', 'asteroids.musicMuted', 'asteroids.musicVolume']);
    expect(storage.data.get('asteroids.musicMuted')).toBe('1');
    expect(storage.data.get('asteroids.musicVolume')).toBe('0.4');
  });
});

// --- pause, focus, lifecycle -------------------------------------------------

describe('pause and browser lifecycle', () => {
  it('pausing cancels a running vibration and holds new ones until play resumes', () => {
    const { adapter, manager } = setup();
    manager.handle([gameOver]);
    manager.setPaused(true);
    expect(adapter.calls).toEqual([110, 'cancel']);
    expect(manager.handle([hit])).toBe('paused');
    manager.setPaused(false);
    expect(manager.handle([hit])).toBe('played');
  });

  it('repeating the same pause state does not cancel again', () => {
    const { adapter, manager } = setup();
    manager.handle([boost]);
    manager.setPaused(true);
    manager.setPaused(true);
    manager.setPaused(true);
    expect(adapter.cancels).toBe(1);
  });

  it('losing focus cancels, blocks until focus returns', () => {
    const { adapter, manager } = setup();
    const win = new CountingTarget();
    manager.attachLifecycle(win, new FakeDocument());
    manager.handle([gameOver]);
    win.dispatchEvent(new Event('blur'));
    expect(adapter.calls).toEqual([110, 'cancel']);
    expect(manager.handle([hit])).toBe('background');
    win.dispatchEvent(new Event('focus'));
    expect(manager.handle([hit])).toBe('played');
  });

  it('resuming the game clears a focus loss whose "focus" event never arrived', () => {
    const { manager } = setup();
    const win = new CountingTarget();
    manager.attachLifecycle(win, new FakeDocument());
    manager.setPaused(true);
    win.dispatchEvent(new Event('blur'));
    expect(manager.request('boost')).toBe('paused');
    manager.setPaused(false);
    expect(manager.request('boost')).toBe('played');
  });

  it('hiding the tab cancels, and a hidden tab never starts a vibration', () => {
    const { adapter, manager } = setup();
    const doc = new FakeDocument();
    manager.attachLifecycle(new CountingTarget(), doc);
    manager.handle([gameOver]);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(adapter.calls).toEqual([110, 'cancel']);
    expect(manager.handle([hit])).toBe('background');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(manager.handle([hit])).toBe('played');
  });

  it('leaving the page (pagehide) cancels', () => {
    const { adapter, manager } = setup();
    const win = new CountingTarget();
    manager.attachLifecycle(win, new FakeDocument());
    manager.handle([gameOver]);
    win.dispatchEvent(new Event('pagehide'));
    expect(adapter.cancels).toBe(1);
  });

  it('events that happened while backgrounded are not replayed when the player comes back', () => {
    const { adapter, manager } = setup();
    const win = new CountingTarget();
    manager.attachLifecycle(win, new FakeDocument());
    win.dispatchEvent(new Event('blur'));
    manager.handle([gameOver]);
    manager.handle([hit]);
    win.dispatchEvent(new Event('focus'));
    expect(adapter.calls).toEqual([]);
    expect(manager.handle([])).toBeNull();
    expect(adapter.calls).toEqual([]);
  });

  it('adds listeners once, removes every one on detach, and re-attaching does not double them', () => {
    const { manager } = setup();
    const win = new CountingTarget();
    const doc = new FakeDocument();
    const detach = manager.attachLifecycle(win, doc);
    expect(win.listenerTotal + doc.listenerTotal).toBe(4);
    manager.attachLifecycle(win, doc); // a second attach replaces the first
    expect(win.listenerTotal + doc.listenerTotal).toBe(4);
    detach();
    detach();
    expect(win.listenerTotal + doc.listenerTotal).toBe(4); // the stale detach did not remove the new listeners
    manager.dispose();
    expect(win.listenerTotal + doc.listenerTotal).toBe(0);
  });

  it('dispose cancels, removes the settings subscription and is safe to call twice', () => {
    const { adapter, manager, settings } = setup();
    manager.handle([gameOver]);
    expect(settings.listenerCount).toBe(1);
    manager.dispose();
    manager.dispose();
    expect(adapter.cancels).toBe(1);
    expect(settings.listenerCount).toBe(0);
  });
});

describe('scenes and restarts', () => {
  it('reset (scene shutdown) cancels, clears cooldowns and the pause state, so a new run starts clean', () => {
    const { adapter, manager } = setup();
    manager.handle([hit]);
    manager.setPaused(true);
    manager.reset();
    expect(adapter.calls).toEqual([65, 'cancel']);
    // Cooldown and pause from the previous run are gone: a hit right at the start of the next one buzzes.
    expect(manager.handle([hit])).toBe('played');
    expect(adapter.vibrations).toEqual([65, 65]);
  });

  it('many scene restarts never accumulate listeners on the one shared manager', () => {
    const { manager, settings } = setup();
    const win = new CountingTarget();
    const doc = new FakeDocument();
    manager.attachLifecycle(win, doc);
    for (let i = 0; i < 25; i++) {
      manager.reset(); // GameScene create + shutdown
      manager.setPaused(i % 2 === 0);
    }
    expect(win.listenerTotal + doc.listenerTotal).toBe(4);
    expect(settings.listenerCount).toBe(1);
  });

  it('a restarted run is a new simulation: nothing from the old run is replayed', () => {
    const { adapter, manager, clock } = setup();
    const first = quietSim();
    first.player.lives = 1;
    manager.handle(hitUnprotected(first, first.player));
    expect(adapter.vibrations).toEqual([110]);
    manager.reset();
    clock.advance(5);
    const second = quietSim();
    for (let i = 0; i < 120; i++) manager.handle(second.step(FRAME));
    expect(adapter.vibrations).toEqual([110]);
  });
});

// --- the browser side ---------------------------------------------------------

describe('unsupported browsers and failed requests', () => {
  it('an unsupported API (iPhone Safari) is accepted silently and gameplay events are no-ops', () => {
    const { adapter, manager } = setup();
    adapter.supported = false;
    for (const events of [[boost], [laser], [hit], [gameOver]]) expect(() => manager.handle(events)).not.toThrow();
    expect(manager.handle([gameOver])).toBe('unsupported');
    expect(adapter.calls).toEqual([]);
    expect(manager.supported).toBe(false);
    expect(() => manager.setPaused(true)).not.toThrow();
    expect(() => manager.reset()).not.toThrow();
    expect(() => manager.dispose()).not.toThrow();
  });

  it('a refused request (vibrate returned false) is reported, does not count as playing, and the next one is tried normally', () => {
    const { adapter, manager } = setup();
    adapter.accepts = false;
    expect(manager.handle([hit])).toBe('failed');
    expect(manager.isVibrating).toBe(false);
    expect(manager.played).toBe(0);
    adapter.accepts = true;
    expect(manager.handle([hit])).toBe('played'); // a refusal does not start a cooldown
  });

  it('a navigator that throws never reaches the game', () => {
    const nav = {
      vibrate(): boolean {
        throw new Error('NotAllowedError');
      },
    };
    const adapter = new NavigatorVibrationAdapter(nav);
    const settings = new HapticSettings(new MemoryStorage());
    settings.set(true);
    const manager = new HapticManager({ adapter, settings });
    expect(adapter.supported).toBe(true);
    expect(manager.handle([gameOver])).toBe('failed');
    expect(() => adapter.cancel()).not.toThrow();
    expect(manager.testVibration()).toBe('blocked');
  });
});

describe('the navigator adapter', () => {
  it('is unsupported without navigator.vibrate and everything still works', () => {
    for (const nav of [undefined, {}, { vibrate: 'nope' as unknown as () => boolean }]) {
      const adapter = new NavigatorVibrationAdapter(nav);
      expect(adapter.supported).toBe(false);
      expect(adapter.vibrate(50)).toBe(false);
      expect(() => adapter.cancel()).not.toThrow();
    }
  });

  it('calls navigator.vibrate with the duration, passes lists as arrays, and cancels with 0', () => {
    const seen: unknown[] = [];
    const nav = {
      vibrate(pattern: number | number[]): boolean {
        seen.push(pattern);
        return true;
      },
    };
    const adapter = new NavigatorVibrationAdapter(nav);
    expect(adapter.supported).toBe(true);
    expect(adapter.vibrate(65)).toBe(true);
    expect(adapter.vibrate([10, 20, 30])).toBe(true);
    adapter.cancel();
    expect(seen).toEqual([65, [10, 20, 30], 0]);
  });

  it('reports a browser refusal (false) as false', () => {
    const adapter = new NavigatorVibrationAdapter({ vibrate: () => false });
    expect(adapter.vibrate(65)).toBe(false);
  });

  it('keeps `this` so the real navigator.vibrate is not called "illegally"', () => {
    const nav = {
      tag: 'nav',
      vibrate(this: { tag: string }): boolean {
        return this.tag === 'nav';
      },
    };
    expect(new NavigatorVibrationAdapter(nav).vibrate(10)).toBe(true);
  });
});

describe('TEST VIBRATION', () => {
  it('buzzes a recognisable pattern on request, even while HAPTICS is OFF, and reports it was sent', () => {
    const { adapter, manager } = setup(false);
    expect(manager.testVibration()).toBe('sent');
    expect(adapter.calls).toEqual([TEST_PATTERN]);
    expect(TEST_PATTERN).not.toEqual([HAPTIC_PATTERNS.damage.pattern]);
  });

  it('reports unsupported and blocked honestly, without throwing', () => {
    const { adapter, manager } = setup();
    adapter.supported = false;
    expect(manager.testVibration()).toBe('unsupported');
    adapter.supported = true;
    adapter.accepts = false;
    expect(manager.testVibration()).toBe('blocked');
    expect(adapter.calls).toEqual([]);
  });

  it('tapped repeatedly it restarts the pattern each time (no cooldown on a deliberate tap)', () => {
    const { adapter, manager } = setup();
    manager.testVibration();
    manager.testVibration();
    expect(adapter.vibrations).toHaveLength(2);
  });

  it('turning HAPTICS off cancels a test that is still running', () => {
    const { adapter, manager } = setup();
    manager.testVibration();
    manager.setEnabled(false);
    expect(adapter.cancels).toBeGreaterThanOrEqual(1);
    expect(adapter.calls.at(-1)).toBe('cancel');
  });
});

describe('haptics are presentation only', () => {
  it('handling events never changes the simulation', () => {
    const run = (withHaptics: boolean): string => {
      const { manager } = setup();
      const sim = quietSim(7);
      for (let i = 0; i < 300; i++) {
        const events = sim.step(FRAME, hold({ move: 1, rotate: i % 40 < 20 ? 1 : -1, shoot: i % 5 === 0, laser: i % 97 === 0, boost: i % 150 === 0 }));
        if (withHaptics) manager.handle(events);
      }
      const p = sim.player;
      return JSON.stringify([p.position, p.rotation, p.lives, p.score, sim.asteroids.length, sim.time]);
    };
    expect(run(true)).toBe(run(false));
  });
});
