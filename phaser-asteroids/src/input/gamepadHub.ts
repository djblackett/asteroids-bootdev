import { NO_INPUT, type PlayerInput } from '../core/player';
import {
  anythingHeld,
  heldButtons,
  layoutOf,
  padToInput,
  shortPadName,
  type GamepadSnapshot,
  type PadButton,
  type PadLayout,
} from './gamepadMapping';

/** Returns the current state of every gamepad slot the browser has (null / missing for empty slots). */
export type GamepadReader = () => ReadonlyArray<GamepadSnapshot | null | undefined>;

/** Index of a player: 0 = Player 1, 1 = Player 2. */
export type PlayerSlot = 0 | 1;

export type PadEvent =
  | { type: 'connected'; pad: PadView; reclaimed: PlayerSlot | null }
  /** `slot` is the player it drove in a two-player game, `soloSlot` in a one-player game (null: it drove nobody). */
  | { type: 'disconnected'; pad: PadView; slot: PlayerSlot | null; soloSlot: PlayerSlot | null }
  | { type: 'assigned'; pad: PadView; slot: PlayerSlot }
  | { type: 'unassigned'; pad: PadView }
  | { type: 'disarmed'; reason: string };

/** A button that went from up to down since the previous poll. Menus and one-shot actions (pause, retry...) read these. */
export interface PadPress {
  padKey: number;
  button: PadButton;
}

/** What the rest of the game may know about one controller. */
export interface PadView {
  /** Unique per connection: a pad that is unplugged and plugged in again gets a new key (browser indices are reused). */
  key: number;
  index: number;
  id: string;
  name: string;
  layout: PadLayout;
  connected: boolean;
  /** False until the pad has been seen with every button released since it connected / since the last reset. */
  armed: boolean;
}

/** One line of the controller status shown on the title screen. */
export interface PadStatus {
  kind: 'none' | 'unassigned' | 'assigned' | 'disconnected';
  /** Player the line is about (assigned / disconnected). */
  slot: PlayerSlot | null;
  padKey: number | null;
  text: string;
}

interface PadRecord {
  view: PadView;
  snapshot: GamepadSnapshot;
  held: Set<PadButton>;
  input: PlayerInput;
}

/** A player's controller: remembered by device name so a reconnecting pad finds its owner, but only usable while `padKey` is set. */
interface Binding {
  id: string;
  lastIndex: number;
  padKey: number | null;
  /** Given by the "join" policy rather than chosen on purpose (LB / RB / cycle): such a pad follows the player count. */
  auto: boolean;
}

export const EVENT_LOG_MAX = 30;
const PRESS_QUEUE_MAX = 64;
/** How many controllers the hub tracks at once (browsers expose four slots). */
const MAX_PADS = 4;

const neutral = (): PlayerInput => ({ ...NO_INPUT });

/**
 * Every controller the page can see, and which player each one drives. It is one more *input source*: gameplay asks
 * `command(slot)` for a normalised `PlayerInput`, exactly what the keyboard produces, and never sees the Gamepad API.
 *
 * Rules that keep input trustworthy:
 *  - A pad produces commands only while it is connected AND armed. A pad is disarmed when it connects, when the window
 *    loses focus or the tab is hidden, and when a run starts or restarts, and re-armed once every one of its buttons has
 *    been released. So the press that woke the controller, a trigger still held from "RETRY", or a button held through a
 *    focus change can never fire a weapon or a boost on its own.
 *  - A disconnected pad is dropped at once, its commands are neutral, and the player keeps only a *reservation* by device
 *    name: the player is not "controller ready" until a pad with that name connects again, and then it takes over.
 *  - One pad per player and one player per pad: assigning moves, never duplicates.
 *  - A pad that is not assigned never controls anything (it can still navigate the title screen).
 *
 * The browser must be polled: call `poll()` once per frame. The reader is injected so tests need no hardware.
 */
export class GamepadHub {
  private readonly records = new Map<number, PadRecord>();
  private readonly bindings: [Binding | null, Binding | null] = [null, null];
  private readonly listeners = new Set<(event: PadEvent) => void>();
  private presses: PadPress[] = [];
  private nextKey = 1;
  private log: string[] = [];
  private supported = true;

  constructor(
    private readonly read: GamepadReader,
    private readonly now: () => number = () => 0,
  ) {}

  // --- polling ------------------------------------------------------------------------------------------------------

  /** Reads the pads once: detects connections / disconnections, updates commands, queues button presses. */
  poll(): void {
    let snapshots: ReturnType<GamepadReader>;
    try {
      snapshots = this.read();
      this.supported = true;
    } catch {
      this.supported = false;
      snapshots = [];
    }
    const seen = new Set<number>();
    for (const snap of snapshots) {
      if (!snap || !snap.connected || seen.size >= MAX_PADS) continue;
      seen.add(snap.index);
      this.observe(snap);
    }
    for (const record of [...this.records.values()]) {
      if (!seen.has(record.view.index)) this.drop(record);
    }
  }

  private observe(snap: GamepadSnapshot): void {
    let record = this.records.get(snap.index);
    if (record && record.view.id !== snap.id) {
      // A different device took the slot between two polls.
      this.drop(record);
      record = undefined;
    }
    if (!record) {
      this.connect(snap);
      return;
    }
    const held = heldButtons(snap);
    for (const button of held) if (!record.held.has(button)) this.queuePress(record.view.key, button);
    record.snapshot = snap;
    record.held = held;
    if (!record.view.armed && !anythingHeld(snap)) record.view.armed = true;
    record.input = record.view.armed ? padToInput(snap, held) : neutral();
  }

  private connect(snap: GamepadSnapshot): void {
    const view: PadView = {
      key: this.nextKey++,
      index: snap.index,
      id: snap.id,
      name: shortPadName(snap.id),
      layout: layoutOf(snap),
      connected: true,
      // The press that woke the pad is still down, so a pad is only trusted after it has been released once.
      armed: false,
    };
    // Whatever is held now is not a new press: the title screen needs a deliberate second press to assign.
    this.records.set(snap.index, { view, snapshot: snap, held: heldButtons(snap), input: neutral() });
    if (!anythingHeld(snap)) view.armed = true;
    const reclaimed = this.reclaim(view);
    this.addLog(`connected #${snap.index} "${view.name}" (${view.layout})${reclaimed === null ? '' : ` -> Player ${reclaimed + 1} (reconnected)`}`);
    this.emit({ type: 'connected', pad: { ...view }, reclaimed });
  }

  private drop(record: PadRecord): void {
    this.records.delete(record.view.index);
    record.view.connected = false;
    record.view.armed = false;
    const slot = this.slotOfPad(record.view.key);
    const soloSlot = this.playerOf(record.view.key, 1);
    if (slot !== null) (this.bindings[slot] as Binding).padKey = null;
    this.addLog(`disconnected #${record.view.index} "${record.view.name}"${slot === null ? '' : ` (was Player ${slot + 1})`}`);
    this.emit({ type: 'disconnected', pad: { ...record.view }, slot, soloSlot });
  }

  /** A pad whose name matches a player's reservation takes that player back (same index first, then the lowest player). */
  private reclaim(view: PadView): PlayerSlot | null {
    const candidates = ([0, 1] as const).filter((s) => {
      const b = this.bindings[s];
      return b !== null && b.padKey === null && b.id === view.id;
    });
    const slot = candidates.find((s) => (this.bindings[s] as Binding).lastIndex === view.index) ?? candidates[0];
    if (slot === undefined) return null;
    const binding = this.bindings[slot] as Binding;
    binding.padKey = view.key;
    binding.lastIndex = view.index;
    return slot;
  }

  private queuePress(padKey: number, button: PadButton): void {
    this.presses.push({ padKey, button });
    if (this.presses.length > PRESS_QUEUE_MAX) this.presses.splice(0, this.presses.length - PRESS_QUEUE_MAX);
  }

  // --- commands for gameplay ----------------------------------------------------------------------------------------

  /**
   * The controller that drives `slot` in a game of `playerCount` players, or null. With one player, the controller
   * assigned to either player drives the single ship (Player 1's wins), so a pad picked for "Player 2" is not silently dead.
   */
  padFor(slot: PlayerSlot, playerCount: 1 | 2): PadView | null {
    const binding = this.effective(playerCount)[slot];
    const record = binding && binding.padKey !== null ? this.recordByKey(binding.padKey) : undefined;
    return record ? { ...record.view } : null;
  }

  /** The normalised command of the pad driving `slot`: neutral unless that pad is connected, assigned and armed. */
  command(slot: PlayerSlot, playerCount: 1 | 2): PlayerInput {
    const binding = this.effective(playerCount)[slot];
    const record = binding && binding.padKey !== null ? this.recordByKey(binding.padKey) : undefined;
    if (!record || !record.view.armed) return neutral();
    return { ...record.input };
  }

  /** The bindings that apply in a game of `playerCount` players. */
  private effective(playerCount: 1 | 2): readonly [Binding | null, Binding | null] {
    if (playerCount === 2) return this.bindings;
    return [this.bindings[0] ?? this.bindings[1], null];
  }

  private recordByKey(key: number): PadRecord | undefined {
    for (const r of this.records.values()) if (r.view.key === key) return r;
    return undefined;
  }

  private slotOfPad(key: number): PlayerSlot | null {
    return this.bindings[0]?.padKey === key ? 0 : this.bindings[1]?.padKey === key ? 1 : null;
  }

  // --- button presses (menus, pause, retry) -------------------------------------------------------------------------

  /** Presses since the last drain, oldest first. */
  drainPresses(): PadPress[] {
    const out = this.presses;
    this.presses = [];
    return out;
  }

  /** Forgets queued presses (a scene calls this when it starts, so it never reacts to a press meant for the previous one). */
  discardPresses(): void {
    this.presses = [];
  }

  /** Which player (if any) the press's pad is driving in a game of `playerCount` players. */
  playerOf(padKey: number, playerCount: 1 | 2): PlayerSlot | null {
    const eff = this.effective(playerCount);
    return eff[0]?.padKey === padKey ? 0 : eff[1]?.padKey === padKey ? 1 : null;
  }

  // --- lifecycle ----------------------------------------------------------------------------------------------------

  /**
   * Makes every pad neutral until all of its buttons have been released: after the window lost focus, the tab was hidden, or
   * a run (re)started. Also forgets pending presses. Assignments stay, since the pads are still plugged in.
   */
  disarmAll(reason: string): void {
    for (const record of this.records.values()) {
      record.view.armed = false;
      record.input = neutral();
    }
    this.presses = [];
    this.addLog(`inputs neutral: ${reason}`);
    this.emit({ type: 'disarmed', reason });
  }

  // --- assignment ---------------------------------------------------------------------------------------------------

  /**
   * Gives the pad to `target` (null = unassign). Whatever pad that player had before becomes unassigned. `auto` marks a
   * choice made by the join policy, which `playerCountChanged` may move; a deliberate choice is never moved.
   */
  assign(padKey: number, target: PlayerSlot | null, playerCount: 1 | 2, auto = false): void {
    const record = this.recordByKey(padKey);
    if (!record) return;
    const slot = playerCount === 1 && target !== null ? 0 : target;
    const current = this.slotOfPad(padKey);
    if (current === slot) return;
    if (current !== null) this.bindings[current] = null;
    if (slot !== null) {
      const displaced = this.bindings[slot];
      const displacedRecord = displaced && displaced.padKey !== null ? this.recordByKey(displaced.padKey) : undefined;
      this.bindings[slot] = { id: record.view.id, lastIndex: record.view.index, padKey, auto };
      if (displacedRecord) this.emit({ type: 'unassigned', pad: { ...displacedRecord.view } });
      this.addLog(`#${record.view.index} -> Player ${slot + 1}`);
      this.emit({ type: 'assigned', pad: { ...record.view }, slot });
    } else {
      this.addLog(`#${record.view.index} unassigned`);
      this.emit({ type: 'unassigned', pad: { ...record.view } });
    }
  }

  /**
   * "Join": an unassigned pad takes the first free player. In a two-player game Player 2 comes first, because the usual
   * setup is Player 1 on the keyboard and a controller for Player 2; the next pad then takes Player 1. A reservation
   * whose pad is gone counts as free. Returns the slot taken, or null if both players already have a connected pad.
   */
  join(padKey: number, playerCount: 1 | 2): PlayerSlot | null {
    const already = this.playerOf(padKey, playerCount);
    if (already !== null) return already;
    const slot = this.freeSlot(playerCount);
    if (slot === null) return null;
    this.assign(padKey, slot, playerCount, true);
    return slot;
  }

  /**
   * The player a new pad would join, or null if every player already has a connected pad. Two players: Player 2 first. One
   * player: Player 1, but only if no connected pad already drives the single ship (whichever slot it was assigned to).
   */
  private freeSlot(playerCount: 1 | 2): PlayerSlot | null {
    const free = (b: Binding | null | undefined): boolean => !b || b.padKey === null;
    if (playerCount === 1) return free(this.effective(1)[0]) ? 0 : null;
    return free(this.bindings[1]) ? 1 : free(this.bindings[0]) ? 0 : null;
  }

  /**
   * The title screen switched between one and two players. A pad the join policy put on Player 1 for a one-player game moves
   * to Player 2 when a second player appears (keyboard Player 1, controller Player 2 is the usual setup), if Player 2 is free.
   * Deliberate assignments (LB / RB / cycle) stay where they are.
   */
  playerCountChanged(playerCount: 1 | 2): void {
    const first = this.bindings[0];
    if (playerCount === 2 && first && first.auto && first.padKey !== null && this.bindings[1] === null) {
      this.bindings[1] = first;
      this.bindings[0] = null;
      this.addLog(`#${this.recordByKey(first.padKey)?.view.index ?? '?'} -> Player 2 (two players)`);
    }
  }

  /** Cycles the pad through its choices (two players: Player 2, Player 1, none; one player: Player 1, none). */
  cycle(padKey: number, playerCount: 1 | 2): void {
    const order: ReadonlyArray<PlayerSlot | null> = playerCount === 1 ? [0, null] : [1, 0, null];
    const current = this.playerOf(padKey, playerCount);
    const next = order[(order.indexOf(current) + 1) % order.length] ?? null;
    this.assign(padKey, next, playerCount);
  }

  // --- reporting ----------------------------------------------------------------------------------------------------

  /** Connected controllers, in the order of their browser index. */
  pads(): PadView[] {
    return [...this.records.values()].map((r) => ({ ...r.view })).sort((a, b) => a.index - b.index);
  }

  get isSupported(): boolean {
    return this.supported;
  }

  /**
   * The controller lines for the title screen, one per situation worth telling the player about. Never reports a
   * controller as usable unless it is connected right now.
   */
  status(playerCount: 1 | 2): PadStatus[] {
    const lines: PadStatus[] = [];
    const eff = this.effective(playerCount);
    const who = (s: PlayerSlot): string => `PLAYER ${s + 1}`;
    for (const pad of this.pads()) {
      const slot = this.playerOf(pad.key, playerCount);
      const unusual = pad.layout === 'generic' ? ' (non-standard layout)' : '';
      if (slot !== null) lines.push({ kind: 'assigned', slot, padKey: pad.key, text: `Controller ${pad.index + 1}: ${pad.name}${unusual} -> ${who(slot)}` });
      else lines.push({ kind: 'unassigned', slot: null, padKey: pad.key, text: `Controller ${pad.index + 1}: ${pad.name}${unusual} -> ${this.freeSlot(playerCount) === null ? 'not used (every player has a controller)' : 'not assigned (press A to join)'}` });
    }
    for (const slot of [0, 1] as const) {
      const b = eff[slot];
      if (b && b.padKey === null) lines.push({ kind: 'disconnected', slot, padKey: null, text: `${who(slot)}: ${shortPadName(b.id)} DISCONNECTED - reconnect it` });
    }
    if (lines.length === 0) {
      lines.push({ kind: 'none', slot: null, padKey: null, text: this.supported ? 'No controller detected - press a button on it' : 'Gamepads unavailable (needs https or localhost)' });
    }
    return lines;
  }

  // --- events and diagnostics ---------------------------------------------------------------------------------------

  /** Listens for pad events. Returns the function that stops listening. */
  onEvent(listener: (event: PadEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  private emit(event: PadEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private addLog(text: string): void {
    this.log.push(`${this.now().toFixed(0).padStart(8)}ms  ${text}`);
    if (this.log.length > EVENT_LOG_MAX) this.log.splice(0, this.log.length - EVENT_LOG_MAX);
  }

  /** The most recent connection / assignment events, oldest first (bounded). */
  eventLog(): readonly string[] {
    return this.log;
  }

  /**
   * Bounded text for the `?keydebug` panel: per pad its mapping, the few raw values that matter, the normalised command
   * and the player it goes to. Never more than 4 pads and about 5 lines each.
   */
  diagnosticLines(playerCount: 1 | 2): string[] {
    const lines = [`gamepads: ${this.records.size} connected${this.supported ? '' : ' (Gamepad API unavailable)'}`];
    const fmt = (n: number | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '?');
    for (const r of [...this.records.values()].sort((a, b) => a.view.index - b.view.index)) {
      const slot = this.playerOf(r.view.key, playerCount);
      const axes = r.snapshot.axes.slice(0, 6).map((v, i) => `${i}:${fmt(v)}`).join(' ');
      const buttons = r.snapshot.buttons
        .map((b, i) => (b.pressed || b.value > 0.05 ? `${i}${b.pressed ? '' : '~'}(${fmt(b.value)})` : ''))
        .filter(Boolean)
        .slice(0, 12)
        .join(' ');
      const i = r.input;
      lines.push(
        `  #${r.view.index} ${r.view.name} mapping="${r.snapshot.mapping}" -> ${r.view.layout} layout, ${r.snapshot.axes.length} axes, ${r.snapshot.buttons.length} buttons`,
        `     raw axes ${axes || '-'}`,
        `     raw buttons down ${buttons || '-'}`,
        `     normalised rotate=${fmt(i.rotate)} move=${fmt(i.move)} shoot=${i.shoot ? 1 : 0} laser=${i.laser ? 1 : 0} boost=${i.boost ? 1 : 0}  armed=${r.view.armed ? 'yes' : 'NO'}`,
        `     goes to ${slot === null ? 'nobody (not assigned)' : `PLAYER ${slot + 1}`}`,
      );
    }
    for (const s of [0, 1] as const) {
      const b = this.effective(playerCount)[s];
      if (b && b.padKey === null) lines.push(`  PLAYER ${s + 1} reserved for "${shortPadName(b.id)}" - not connected`);
    }
    return lines;
  }
}

/**
 * Reads the browser's gamepads (copying them, since the live objects change under you). Throws where the API is missing
 * (Chrome hides it outside secure contexts: plain http on a LAN address), which the hub reports as "unavailable".
 */
export function browserGamepadReader(nav: Pick<Navigator, 'getGamepads'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): GamepadReader {
  return () => {
    if (!nav || typeof nav.getGamepads !== 'function') throw new Error('Gamepad API unavailable');
    return Array.from(nav.getGamepads(), (pad) =>
      pad
        ? {
            index: pad.index,
            id: pad.id,
            mapping: pad.mapping,
            connected: pad.connected,
            axes: Array.from(pad.axes),
            buttons: Array.from(pad.buttons, (b) => ({ pressed: b.pressed, value: b.value })),
          }
        : null,
    );
  };
}
