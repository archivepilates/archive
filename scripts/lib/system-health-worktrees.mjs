import { spawnSync } from 'node:child_process';

export function inspectHealthWorktrees(worktrees, { run = spawnSync, now = Date.now,
  budgetMs = 5000, timeoutMs = 750 } = {}) {
  const deadline = now() + budgetMs;
  return worktrees.filter(wt => wt.path).map(wt => {
    const remaining = deadline - now();
    if (remaining <= 0) return { ...wt, state: 'unavailable', reason: 'inventory_budget' };
    try {
      const result = run('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: wt.path, encoding: 'utf8',
        timeout: Math.min(timeoutMs, remaining), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'] });
      if (result.error || result.status !== 0 || typeof result.stdout !== 'string')
        return { ...wt, state: 'unavailable', reason: result.error?.code === 'ETIMEDOUT' ? 'timeout' : 'git_unavailable' };
      return { ...wt, state: result.stdout.trim() ? 'dirty' : 'clean' };
    } catch { return { ...wt, state: 'unavailable', reason: 'git_unavailable' }; }
  });
}
