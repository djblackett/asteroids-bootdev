/** A source of uniform randomness in [0, 1). Injected so gameplay is deterministic under test. */
export type Rng = () => number;

export const defaultRng: Rng = Math.random;

/** Small, fast, seedable PRNG (mulberry32) for tests and replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Python `random.uniform(a, b)`. */
export const uniform = (rng: Rng, a: number, b: number): number => a + (b - a) * rng();

/** Python `random.randint(a, b)` (inclusive on both ends). */
export const randint = (rng: Rng, a: number, b: number): number => a + Math.floor(rng() * (b - a + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() from empty array');
  return item;
}
