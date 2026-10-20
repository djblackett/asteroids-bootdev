import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/core/player';
import { KeyDiagnostics, type DiagnosticFrame } from '../src/input/keyDiagnostics';
import { P1_KEYS, P2_KEYS_ARROWS } from '../src/input/keyboardControls';
import { B, makeHub, plugIn } from './padFakes';

/** The ?keydebug panel's gamepad section: bounded, mapped to a player, frozen with the rest of the capture. */

function frameWithPad(driven: [boolean, boolean], lines: readonly string[], over: Partial<DiagnosticFrame> = {}): DiagnosticFrame {
  return {
    phaserHeld: [],
    trackerHeld: new Set(),
    input: NO_INPUT,
    input2: NO_INPUT,
    sim: { rotation: 0, boostActive: false, canShoot: true, shootTimer: 0, shots: 0 },
    sim2: { rotation: 0, boostActive: false, canShoot: true, shootTimer: 0, shots: 0 },
    pad: { lines, driven },
    ...over,
  };
}

describe('gamepad section of the key diagnostics', () => {
  it('appears in the live report with the hub lines', () => {
    const rig = makeHub();
    rig.hub.assign(plugIn(rig), 1, 2);
    rig.pads.set({ axes: { 0: 0.9 }, buttons: { [B.RT]: 1 } }, 0);
    rig.hub.poll();
    const d = new KeyDiagnostics(P1_KEYS, 10, 10_000, 1500, () => [], P2_KEYS_ARROWS);
    const text = d.report(frameWithPad([false, true], rig.hub.diagnosticLines(2)));
    expect(text).toContain('gamepads: 1 connected');
    expect(text).toContain('goes to PLAYER 2');
    expect(text).toContain('shoot=1');
  });

  it('does not accuse the key mapping when a controller also drives that player', () => {
    const d = new KeyDiagnostics(P1_KEYS, 10, 10_000, 1500, () => [], P2_KEYS_ARROWS);
    const pad = { ...NO_INPUT, rotate: 0.5, shoot: true };
    const withPad = d.verdict(frameWithPad([false, true], [], { input2: pad }));
    expect(withPad).not.toMatch(/STAGE 3/);
    const withoutPad = d.verdict(frameWithPad([false, false], [], { input2: pad }));
    expect(withoutPad).toMatch(/STAGE 3 PROBLEM - P2 input mapping differs/);
  });

  it('records controller changes in the timeline and keeps them in a frozen report', () => {
    const d = new KeyDiagnostics(P1_KEYS, 10, 10_000, 1500, () => [], P2_KEYS_ARROWS);
    d.note('controller connected: #0 Xbox 360 Controller', 1000);
    d.note('controller DISCONNECTED: #0 Xbox 360 Controller', 2000);
    const frozen = d.fullReport(frameWithPad([false, true], ['gamepads: 0 connected']), 3000);
    expect(frozen).toContain('controller connected');
    expect(frozen).toContain('controller DISCONNECTED');
  });

  it('adds history entries only when the pad command changes, and the history stays bounded', () => {
    const d = new KeyDiagnostics(P1_KEYS, 10, 10_000, 50, () => [], P2_KEYS_ARROWS);
    const idle = frameWithPad([false, true], ['  normalised rotate=0.00', '     goes to PLAYER 2']);
    for (let t = 0; t < 100; t++) d.observe(idle, t);
    expect(d.historyLength).toBe(1);
    for (let t = 100; t < 1000; t++) d.observe(frameWithPad([false, true], [`  normalised rotate=${(t / 1000).toFixed(2)}`, '     goes to PLAYER 2']), t);
    expect(d.historyLength).toBeLessThanOrEqual(50);
  });
});
