import type { PreviewResult } from '@fastrenamer/rename-engine';
import type { PlanPreviewInput } from './preview-planner';
import type { PreviewPlanner } from './rename-service';
import { runWorkerTask } from './worker-task';

export const PREVIEW_TIMEOUT_MS = 5_000;

/**
 * Planner that runs rename planning (user regexes, custom rules, existence checks) in a worker
 * thread that is killed after `timeoutMs`, so a pathological rule cannot freeze the main process.
 */
export function createWorkerPlanner(workerPath: string, timeoutMs = PREVIEW_TIMEOUT_MS): PreviewPlanner {
  return (input, signal) =>
    runWorkerTask<PlanPreviewInput, PreviewResult>(workerPath, input, {
      timeoutMs,
      signal,
      timeoutMessage:
        `Generating the preview took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. ` +
        'A rule (for example a regular expression or custom rule) is probably too expensive; simplify it and try again.',
    });
}
