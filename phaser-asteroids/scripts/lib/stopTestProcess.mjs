import { spawnSync } from 'node:child_process';

// Only call for a process spawned by this suite. Wrangler owns a workerd child.
export function stopTestProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Could not stop test process tree ${child.pid}`);
  } else child.kill();
}
