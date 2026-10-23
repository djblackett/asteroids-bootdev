// Plays a real game in Chromium through the keyboard: hunts asteroids and power-ups until it has scored, then flies into an asteroid
// to end the run naturally. Same approach as the Phase 1 nonzero-score browser test (scripts/replay-browser.mjs), reusable.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns the largest combo observed. The caller waits for game over (the ship is flying into an asteroid when this returns). */
export async function playUntilScoredThenDie(page, { maxSteps = 300 } = {}) {
  let seekSuicide = false;
  let rotating = null;
  let thrusting = false;
  let maxCombo = 0;

  for (let step = 0; step < maxSteps; step++) {
    const status = await page.evaluate(() => {
      const sim = window.__game.scene.getScene('GameScene').sim;
      if (sim.isGameOver) return { isOver: true };
      return {
        isOver: false,
        px: sim.player.position.x,
        py: sim.player.position.y,
        rot: sim.player.rotation,
        score: sim.totalScore,
        combo: sim.combo.count,
        lasers: sim.player.laser.shotsRemaining,
        powerups: sim.powerups.filter((p) => p.alive).map((p) => ({ x: p.position.x, y: p.position.y })),
        asteroids: sim.asteroids.filter((a) => a.alive && !a.dying).map((a) => ({ x: a.position.x, y: a.position.y })),
      };
    });
    if (status.isOver) break;
    maxCombo = Math.max(maxCombo, status.combo);
    if (!seekSuicide && ((status.score >= 60 && maxCombo >= 2) || status.score >= 150 || step >= 200)) seekSuicide = true;

    let target = null;
    let isPowerup = false;
    if (!seekSuicide && status.powerups.length > 0) {
      target = status.powerups[0];
      isPowerup = true;
    } else if (status.asteroids.length > 0) {
      let best = Infinity;
      for (const a of status.asteroids) {
        const d = Math.hypot(a.x - status.px, a.y - status.py);
        if (d < best) {
          best = d;
          target = a;
        }
      }
    }
    if (!target) {
      await sleep(50);
      continue;
    }

    const dx = target.x - status.px;
    const dy = target.y - status.py;
    const dist = Math.hypot(dx, dy);
    const heading = ((((Math.atan2(-dx, dy) * 180) / Math.PI) % 360) + 360) % 360;
    let diff = heading - status.rot;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;

    const want = diff < -12 ? 'KeyA' : diff > 12 ? 'KeyD' : null;
    if (want !== rotating) {
      if (rotating) await page.keyboard.up(rotating);
      if (want) await page.keyboard.down(want);
      rotating = want;
    }

    if (seekSuicide) {
      if (!thrusting) {
        await page.keyboard.down('KeyW');
        thrusting = true;
      }
    } else {
      if (Math.abs(diff) < 30) {
        await page.keyboard.press('Space');
        if (status.lasers > 0 && step % 12 === 0) await page.keyboard.press('KeyE');
      }
      if (step === 25 || step === 55) await page.keyboard.press('ShiftLeft');
      const shouldThrust = isPowerup || (dist > 350 && Math.abs(diff) < 20);
      if (shouldThrust !== thrusting) {
        await page.keyboard[shouldThrust ? 'down' : 'up']('KeyW');
        thrusting = shouldThrust;
      }
    }
    await sleep(60);
  }

  if (rotating) await page.keyboard.up(rotating);
  if (!thrusting) await page.keyboard.down('KeyW');
  return maxCombo;
}
