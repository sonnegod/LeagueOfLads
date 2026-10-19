import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Heavy preview calculations run in a child, keeping the API responsive. Share
// concurrent requests for one preview and limit this API process to one worker.
export function createPreviewRebuilder({ launch = options => spawn(process.execPath,
  [fileURLToPath(new URL('../scripts/betting/preview.js', import.meta.url)), '--season-id', String(options.seasonId)], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, ANALYTICS_LEAGUE_DB: resolve(options.leaguePath),
      ANALYTICS_DB: resolve(options.analyticsPath), BETTING_DB: resolve(options.bettingPath) },
  }), timeoutMs = 120000 } = {}) {
  const pending = new Map();
  return async options => {
    const key = `${options.leaguePath}:${options.seasonId}`;
    if (pending.has(key)) return pending.get(key);
    if (pending.size) {
      const error = new Error('Another preseason preview is rebuilding. Try again when it finishes.');
      error.status = 409; throw error;
    }
    const task = new Promise((done, reject) => {
      let child, timer, finished = false;
      const finish = code => {
        if (finished) return; finished = true; clearTimeout(timer);
        if (code === 0) done({ rebuilt: true });
        else { const error = new Error('Preview rebuild failed. Check the source data and try again after any Analytics refresh finishes.');
          error.status = 503; reject(error); }
      };
      try {
        child = launch(options);
        child.once('error', () => finish(1)); child.once('close', finish);
        timer = setTimeout(() => { child.kill(); finish(1); }, timeoutMs); timer.unref?.();
      } catch { finish(1); }
    });
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}

export const rebuildPreseasonPreview = createPreviewRebuilder();
