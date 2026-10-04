import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerTaskAbortedError, WorkerTaskTimeoutError, runWorkerTask } from './worker-task';

let dir: string;
let echoWorker: string;
let regexWorker: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-worker-'));
  echoWorker = path.join(dir, 'echo.mjs');
  regexWorker = path.join(dir, 'regex.mjs');
  await fs.writeFile(
    echoWorker,
    `import { parentPort } from 'node:worker_threads';
     parentPort.once('message', (input) => parentPort.postMessage({ ok: true, result: input.value * 2 }));`,
  );
  // Catastrophic backtracking: (a+)+$ against "aaaa...b" never finishes in practice.
  await fs.writeFile(
    regexWorker,
    `import { parentPort } from 'node:worker_threads';
     parentPort.once('message', () => {
       const matched = /^(a+)+$/.test('a'.repeat(40) + 'b');
       parentPort.postMessage({ ok: true, result: matched });
     });`,
  );
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('runWorkerTask', () => {
  it('returns the worker result', async () => {
    await expect(runWorkerTask(echoWorker, { value: 21 }, { timeoutMs: 5_000 })).resolves.toBe(42);
  });

  it('terminates a runaway worker on timeout with a clear error', async () => {
    const started = Date.now();
    await expect(
      runWorkerTask(regexWorker, {}, { timeoutMs: 300, timeoutMessage: 'Preview took too long.' }),
    ).rejects.toEqual(new WorkerTaskTimeoutError('Preview took too long.'));
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('terminates the worker when the caller aborts (newer request)', async () => {
    const controller = new AbortController();
    const task = runWorkerTask(regexWorker, {}, { timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(task).rejects.toBeInstanceOf(WorkerTaskAbortedError);
  });
});
