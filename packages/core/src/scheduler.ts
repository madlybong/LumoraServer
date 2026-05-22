/**
 * LS-8: Scheduled Tasks DSL
 *
 * A thin declarative wrapper around Bun.cron(). Zero external dependencies.
 * Per AGENTS.md: this is NOT a job queue or worker pool — it is a cron scheduler only.
 */

import type { LumoraScheduledTask, SchedulerContext } from "./types";

/**
 * Parse a human-readable delay string into milliseconds.
 * Supports: s (seconds), m (minutes), h (hours).
 * Examples: "30s" → 30000, "2m" → 120000, "1h" → 3600000
 */
function parseDelayMs(delay: string): number {
  const match = delay.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|ms)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000
  };
  return Math.floor(value * (multipliers[unit] ?? 1000));
}

/**
 * Run a task with optional retry logic and exponential backoff.
 */
async function runWithRetry(
  task: LumoraScheduledTask,
  ctx: SchedulerContext
): Promise<void> {
  const maxRetries = task.retries ?? 0;
  const baseDelay = task.retryDelay ? parseDelayMs(task.retryDelay) : 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await task.handler(ctx);
      return;
    } catch (err) {
      ctx.logger.error(`scheduler:${task.name}`, err);
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // exponential backoff
        if (delay > 0) await Bun.sleep(delay);
      }
    }
  }
}

export interface SchedulerHandle {
  stop: () => void;
  readonly taskCount: number;
}

/**
 * Start all enabled scheduled tasks using Bun.cron.
 * Returns a handle with a stop() function for graceful shutdown.
 */
export function startScheduler(
  tasks: LumoraScheduledTask[],
  ctx: SchedulerContext
): SchedulerHandle {
  const activeTasks = tasks.filter((t) => t.enabled !== false);
  const cronJobs: { stop?: () => void }[] = [];

  for (const task of activeTasks) {
    ctx.logger.event("scheduler:start", `task "${task.name}" scheduled with cron "${task.cron}"`);

    // Use Bun.cron if available (Bun >= 1.1.x)
    const cronFn = (Bun as any).cron;
    if (typeof cronFn === "function") {
      const job = cronFn(task.cron, async () => {
        ctx.logger.event("scheduler:run", `task "${task.name}" running`);
        try {
          await runWithRetry(task, ctx);
          ctx.logger.event("scheduler:done", `task "${task.name}" completed`);
        } catch (err) {
          ctx.logger.error(`scheduler:${task.name}:failed`, err);
        }
      });
      // Bun.cron returns an object with a stop() method or unref()
      if (job && typeof job.stop === "function") {
        cronJobs.push(job);
      } else if (job && typeof job.unref === "function") {
        cronJobs.push({ stop: () => job.unref() });
      }
    } else {
      // Fallback: warn that Bun.cron is not available in this runtime
      ctx.logger.error("scheduler", `Bun.cron not available — task "${task.name}" will not run. Upgrade to Bun >= 1.1.x`);
    }
  }

  return {
    stop: () => {
      for (const job of cronJobs) {
        job.stop?.();
      }
      ctx.logger.event("scheduler:stop", `stopped ${cronJobs.length} scheduled task(s)`);
    },
    get taskCount() {
      return activeTasks.length;
    }
  };
}
