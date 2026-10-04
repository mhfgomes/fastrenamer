import { Worker } from 'node:worker_threads';

export class WorkerTaskTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerTaskTimeoutError';
  }
}

export class WorkerTaskAbortedError extends Error {
  constructor(message = 'The task was cancelled because a newer request replaced it.') {
    super(message);
    this.name = 'WorkerTaskAbortedError';
  }
}

export interface WorkerTaskOptions {
  timeoutMs: number;
  timeoutMessage?: string;
  signal?: AbortSignal;
}

/**
 * Runs a single request/response task in a fresh worker thread. The worker is terminated when the
 * task finishes, times out, or `signal` aborts, so runaway CPU work (e.g. catastrophic regex
 * backtracking) can never block or pile up in the main process.
 */
export function runWorkerTask<TInput, TResult>(
  workerPath: string | URL,
  input: TInput,
  options: WorkerTaskOptions,
): Promise<TResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new WorkerTaskAbortedError());
  }

  return new Promise<TResult>((resolve, reject) => {
    const worker = new Worker(workerPath);
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      callback();
    };

    const onAbort = () => finish(() => reject(new WorkerTaskAbortedError()));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new WorkerTaskTimeoutError(
              options.timeoutMessage ?? `The task did not finish within ${Math.round(options.timeoutMs / 1000)} seconds.`,
            ),
          ),
        ),
      options.timeoutMs,
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });

    worker.once('message', (message: { ok: true; result: TResult } | { ok: false; message: string }) => {
      finish(() => (message.ok ? resolve(message.result) : reject(new Error(message.message))));
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`Worker exited unexpectedly with code ${code}.`))),
    );
    worker.postMessage(input);
  });
}
