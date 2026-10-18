import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  STARFIELD_PARALLAX_FACTORS,
  STARFIELD_PARALLAX_STRENGTH,
  STARFIELD_STAR_COUNT,
} from './constants';
import { wrap, type Vec2 } from './math';
import { randint, uniform, type Rng } from './rng';

export interface Star {
  x: number;
  y: number;
  size: number;
  /** 0-255 grey level. */
  brightness: number;
  layer: 0 | 1 | 2;
  parallax: number;
}

/** (share of stars, [min size, max size], [min brightness, max brightness]) per layer, far to near. */
const LAYERS: ReadonlyArray<readonly [number, readonly [number, number], readonly [number, number]]> = [
  [0.5, [1, 1], [80, 120]],
  [0.3, [1, 2], [140, 180]],
  [0.2, [2, 3], [200, 255]],
];

export class Starfield {
  readonly stars: Star[] = [];
  /** Accumulated camera movement in pixels. */
  readonly cameraOffset: Vec2 = { x: 0, y: 0 };

  constructor(rng: Rng, starCount: number = STARFIELD_STAR_COUNT) {
    LAYERS.forEach(([share, size, brightness], index) => {
      const layer = index as 0 | 1 | 2;
      const count = Math.trunc(starCount * share);
      for (let i = 0; i < count; i++) {
        this.stars.push({
          x: uniform(rng, 0, SCREEN_WIDTH),
          y: uniform(rng, 0, SCREEN_HEIGHT),
          size: randint(rng, size[0], size[1]),
          brightness: randint(rng, brightness[0], brightness[1]),
          layer,
          parallax: STARFIELD_PARALLAX_FACTORS[layer],
        });
      }
    });
    // Far layers first so near stars draw on top.
    this.stars.sort((a, b) => a.parallax - b.parallax);
  }

  /**
   * Feeds the camera with how far the ship actually moved this frame. (The Python version used the
   * ship's bounce velocity, which is zero during normal flight, so the parallax effect never worked.)
   */
  scroll(displacement: Vec2): void {
    this.cameraOffset.x += displacement.x * STARFIELD_PARALLAX_STRENGTH;
    this.cameraOffset.y += displacement.y * STARFIELD_PARALLAX_STRENGTH;
  }

  /** Screen position of a star: farther layers move less, and everything wraps. */
  project(star: Star): Vec2 {
    return {
      x: wrap(star.x - this.cameraOffset.x * star.parallax, SCREEN_WIDTH),
      y: wrap(star.y - this.cameraOffset.y * star.parallax, SCREEN_HEIGHT),
    };
  }
}
