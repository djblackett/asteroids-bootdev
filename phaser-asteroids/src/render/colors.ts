/** HSV (s = v = 1) to a packed 0xRRGGBB, truncating each channel like Python's `int(x * 255)`. */
export function hueToRgb(hueDegrees: number): number {
  const h = (((hueDegrees % 360) + 360) % 360) / 60;
  const sector = Math.floor(h);
  const f = h - sector;
  const channels: [number, number, number] =
    sector === 0 ? [1, f, 0] : sector === 1 ? [1 - f, 1, 0] : sector === 2 ? [0, 1, f] : sector === 3 ? [0, 1 - f, 1] : sector === 4 ? [f, 0, 1] : [1, 0, 1 - f];
  const [r, g, b] = channels.map((c) => Math.trunc(c * 255)) as [number, number, number];
  return (r << 16) | (g << 8) | b;
}

/**
 * Python `colorutils.get_rainbow_color(ticks, speed=100)`: the hue index is `int((ms / speed) % 360)`,
 * i.e. one full cycle every 36 s. `offset` is a hue offset in degrees.
 */
export function rainbowColor(timeMs: number, offset = 0, speed = 100): number {
  const index = Math.trunc((((timeMs / speed + offset) % 360) + 360) % 360);
  return hueToRgb(index);
}

export function scaleColor(color: number, factor: number): number {
  const r = Math.trunc(((color >> 16) & 0xff) * factor);
  const g = Math.trunc(((color >> 8) & 0xff) * factor);
  const b = Math.trunc((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
