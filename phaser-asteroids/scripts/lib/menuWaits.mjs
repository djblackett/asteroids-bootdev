// Observe the real input lock; never advance the scene clock or unlock the menu.
export function waitTitleReady(page) {
  return page.waitForFunction(() => {
    const game = window.__game;
    if (!game) return false;
    if (game.scene.isActive('GameScene')) return true;
    if (!game.scene.isActive('StartScene')) return false;
    const controller = game.scene.getScene('StartScene').menu?.controller;
    return controller?.snapshot().items.length > 0 && controller.clock() >= controller.lockUntil;
  }, null, { timeout: 15000 });
}

export async function settleTitleInput(page) {
  // Phaser consumes pointer/gamepad input on a frame, after the CDP command returns.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await waitTitleReady(page);
}
