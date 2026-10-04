import { parentPort } from 'node:worker_threads';
import { planPreview } from './preview-planner';
import type { PlanPreviewInput } from './preview-planner';

// One task per worker: main terminates the worker on timeout or when a newer preview supersedes it.
parentPort?.once('message', (input: PlanPreviewInput) => {
  try {
    parentPort?.postMessage({ ok: true, result: planPreview(input) });
  } catch (error) {
    parentPort?.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
