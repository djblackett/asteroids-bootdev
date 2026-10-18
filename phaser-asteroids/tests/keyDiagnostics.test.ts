import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../src/core/player';
import { keyDiagnosticsEnabled, KeyDiagnostics, type DiagnosticFrame, type RawKeyEvent } from '../src/input/keyDiagnostics';
import { SOLO_KEYS } from '../src/input/keyboardControls';

const ev = (type: RawKeyEvent['type'], code: string, repeat = false, timeStamp = 100): RawKeyEvent => ({
  type,
  code,
  repeat,
  timeStamp,
});

function frame(over: Partial<DiagnosticFrame> & { held?: string[] } = {}): DiagnosticFrame {
  const { held, ...rest } = over;
  return {
    phaserHeld: [],
    trackerHeld: new Set(held ?? []),
    input: NO_INPUT,
    sim: { rotation: 0, boostActive: false, canShoot: true, shootTimer: 0, shots: 0 },
    ...rest,
  };
}

describe('key diagnostics are opt-in', () => {
  it('are off for ordinary URLs and for ?debug alone', () => {
    expect(keyDiagnosticsEnabled('')).toBe(false);
    expect(keyDiagnosticsEnabled('?debug')).toBe(false);
    expect(keyDiagnosticsEnabled('?foo=keydebug')).toBe(false);
  });

  it('turn on only with ?keydebug', () => {
    expect(keyDiagnosticsEnabled('?keydebug')).toBe(true);
    expect(keyDiagnosticsEnabled('?debug&keydebug')).toBe(true);
  });
});

describe('KeyDiagnostics', () => {
  it('tracks raw held keys, repeats and the peak number held at once', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'KeyW'));
    d.record(ev('keydown', 'KeyA'));
    d.record(ev('keydown', 'KeyA', true));
    d.record(ev('keyup', 'KeyW'));
    expect([...d.rawHeld]).toEqual(['KeyA']);
    const text = d.report(frame({ held: ['KeyA'] }));
    expect(text).toContain('peak at once: 2');
    expect(text).toContain('repeat=yes');
  });

  it('keeps only the most recent events', () => {
    const d = new KeyDiagnostics(SOLO_KEYS, 3);
    for (const code of ['KeyA', 'KeyB', 'KeyC', 'KeyD']) d.record(ev('keydown', code));
    const text = d.report(frame({ held: ['KeyA', 'KeyB', 'KeyC', 'KeyD'] }));
    expect(text).not.toMatch(/v KeyA\s+repeat/);
    expect(text).toMatch(/v KeyD\s+repeat/);
  });

  it('says OK when every raw key reached the input', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'KeyW'));
    d.record(ev('keydown', 'KeyD'));
    const v = d.verdict(frame({ held: ['KeyW', 'KeyD'], phaserHeld: ['W', 'D'], input: { ...NO_INPUT, move: 1, rotate: 1 } }));
    expect(v).toMatch(/^OK/);
  });

  it('shows a key the browser never delivered as absent from stage 1 (hardware / OS limit)', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'KeyW'));
    d.record(ev('keydown', 'KeyA'));
    // The player is also holding Space, but the keyboard never reported it: it is simply not in the raw list.
    const text = d.report(frame({ held: ['KeyW', 'KeyA'], input: { ...NO_INPUT, move: 1, rotate: -1 } }));
    expect(text).toContain('1 raw browser held : KeyA KeyW');
    expect(text.split('\n').find((l) => l.startsWith('1 raw'))).not.toContain('Space');
  });

  it('flags the game losing a key the browser delivered (stage 2)', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'KeyW'));
    d.record(ev('keydown', 'Space'));
    const v = d.verdict(frame({ held: ['KeyW'], input: { ...NO_INPUT, move: 1 } }));
    expect(v).toMatch(/STAGE 2 PROBLEM.*missing: Space/);
  });

  it('flags a stuck key in the game that the browser released (stage 2)', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    expect(d.verdict(frame({ held: ['KeyW'], input: { ...NO_INPUT, move: 1 } }))).toMatch(/stuck: KeyW/);
  });

  it('flags a mapping that drops a held key (stage 3)', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'KeyW'));
    d.record(ev('keydown', 'Space'));
    const v = d.verdict(frame({ held: ['KeyW', 'Space'], input: { ...NO_INPUT, move: 1, shoot: false } }));
    expect(v).toMatch(/STAGE 3 PROBLEM.*shoot/);
  });

  it('explains the boost cannon lock-out instead of reporting a lost key (stage 4)', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'Space'));
    const v = d.verdict(
      frame({
        held: ['Space'],
        input: { ...NO_INPUT, shoot: true },
        sim: { rotation: 0, boostActive: true, canShoot: true, shootTimer: 0, shots: 0 },
      }),
    );
    expect(v).toMatch(/locked while boosting/);
  });

  it('forgets the raw keys on blur', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.record(ev('keydown', 'KeyW'));
    d.forgetHeld();
    expect(d.rawHeld.size).toBe(0);
  });
});

describe('rolling history and freeze', () => {
  const press = (d: KeyDiagnostics, code: string, t: number): void => d.record(ev('keydown', code, false, t));
  const release = (d: KeyDiagnostics, code: string, t: number): void => d.record(ev('keyup', code, false, t));

  it('records raw events with timestamps and the held set after each one', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    press(d, 'KeyW', 1000);
    press(d, 'KeyA', 1500);
    release(d, 'KeyW', 2000);
    const text = d.fullReport(frame({ held: ['KeyA'] }), 2500);
    expect(text).toMatch(/-1\.500s\s+v keydown KeyW\s+repeat=no\s+raw held=\[KeyW\]/);
    expect(text).toMatch(/-1\.000s\s+v keydown KeyA\s+repeat=no\s+raw held=\[KeyA KeyW\]/);
    expect(text).toMatch(/-0\.500s\s+\^ keyup\s+KeyW\s+repeat=no\s+raw held=\[KeyA\]/);
  });

  it('adds a state entry only when the held keys or the input change, not every frame', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    const idle = frame();
    const moving = frame({ held: ['KeyW'], input: { ...NO_INPUT, move: 1 } });
    for (let t = 0; t < 600; t += 16) d.observe(idle, t);
    expect(d.historyLength).toBe(1);
    press(d, 'KeyW', 700);
    for (let t = 700; t < 1300; t += 16) d.observe(moving, t);
    expect(d.historyLength).toBe(3); // idle state, keydown W, moving state
    const text = d.fullReport(moving, 1300);
    expect(text).toMatch(/INPUT\s+rotate=0 move=1 shoot=0 laser=0 boost=0\s+\| raw=\[KeyW\] game=\[KeyW\]/);
  });

  it('keeps only about the last 10 seconds', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    press(d, 'KeyA', 0);
    release(d, 'KeyA', 100);
    press(d, 'KeyD', 9_000);
    d.observe(frame({ held: ['KeyD'] }), 10_500);
    const text = d.fullReport(frame({ held: ['KeyD'] }), 10_500);
    expect(text).not.toContain('KeyA'); // older than 10 s before the latest entry
    expect(text).toContain('KeyD');
  });

  it('is bounded in memory however many events arrive', () => {
    const d = new KeyDiagnostics(SOLO_KEYS, 10, 10_000, 50);
    for (let i = 0; i < 5000; i++) d.record(ev(i % 2 ? 'keyup' : 'keydown', 'KeyW', false, 1000 + i * 0.1));
    expect(d.historyLength).toBe(50);
  });

  it('freezing preserves the history and state; releasing keys and later events change nothing', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    const held = frame({ held: ['KeyW', 'KeyA'], input: { ...NO_INPUT, move: 1, rotate: -1 } });
    press(d, 'KeyW', 1000);
    press(d, 'KeyA', 1100);
    d.observe(held, 1200);
    d.freeze(held, 1300);
    expect(d.frozen).toBe(true);
    const preserved = d.frozenReport;
    expect(preserved).toContain('1 raw browser held : KeyA KeyW');
    expect(preserved).toContain('rotate=-1 move=1');

    // The player now lets go, hits a screenshot shortcut and the window loses focus.
    release(d, 'KeyW', 1500);
    release(d, 'KeyA', 1510);
    press(d, 'MetaLeft', 1600);
    press(d, 'KeyS', 1610);
    d.note('window blur', 1700);
    d.forgetHeld();
    d.observe(frame(), 1800);
    expect(d.frozenReport).toBe(preserved);
    expect(d.reportForSharing(frame(), 5000)).toBe(preserved);
    expect(preserved).not.toContain('MetaLeft');
    // The live held set keeps following the real keyboard, so it is already correct when the capture is cleared.
    press(d, 'KeyD', 1900);
    expect([...d.rawHeld]).toEqual(['KeyD']);
    d.clearCapture();
    expect([...d.rawHeld]).toEqual(['KeyD']);
  });

  it('only an explicit clear discards the capture, then recording resumes', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    press(d, 'KeyW', 1000);
    d.freeze(frame({ held: ['KeyW'] }), 1100);
    d.clearCapture();
    expect(d.frozen).toBe(false);
    expect(d.historyLength).toBe(0);
    press(d, 'KeyE', 2000);
    expect(d.fullReport(frame(), 2100)).toMatch(/v keydown KeyE/);
  });

  it('notes window blur in the timeline', () => {
    const d = new KeyDiagnostics(SOLO_KEYS);
    d.note('window blur - held keys forgotten', 500);
    expect(d.fullReport(frame(), 900)).toMatch(/-0\.400s\s+! window blur/);
  });

  it('the shareable report names the sections and includes meta lines', () => {
    const d = new KeyDiagnostics(SOLO_KEYS, 10, 10_000, 1500, () => ['page: test', 'browser: test-agent']);
    const text = d.fullReport(frame(), 1000);
    expect(text).toContain('KEY DIAGNOSTIC REPORT');
    expect(text).toContain('browser: test-agent');
    expect(text).toContain('-- state at capture --');
    expect(text).toContain('-- timeline');
  });
});
