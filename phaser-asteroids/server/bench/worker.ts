// Feasibility spike: runs the real verifyReplay() inside the Workers runtime (workerd) and reports timings.
// Not part of the product Worker. Used only by scripts/bench-workerd.mjs.
import { verifyReplay } from '../../src/replay/verifier';

export default {
  async fetch(request: Request): Promise<Response> {
    const t0 = performance.now();
    const d0 = Date.now();
    const text = await request.text();
    const parsed = JSON.parse(text);
    const result = verifyReplay(parsed, { requireGameOver: true });
    return Response.json({
      valid: result.valid,
      score: result.calculatedScore,
      ticks: result.totalTicks,
      error: result.error ?? null,
      // In production Workers these clocks only advance on I/O, so they read ~0 for pure CPU work; the harness
      // therefore measures wall time from outside.
      insidePerfMs: performance.now() - t0,
      insideDateMs: Date.now() - d0,
    });
  },
};
