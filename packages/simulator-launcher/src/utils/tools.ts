import { type ClaimInput } from './state';

/** A tool the warm session can hand to one job. */
export type WarmTool = {
  name: Exclude<ClaimInput['engine'], 'serve-sim'>;
  /** Work without Simulator access, such as configuration; runs as soon as the tool starts. */
  prepareAsync?(signal: AbortSignal): Promise<void>;
  /**
   * Runs once serve-sim is ready, since it spawns into the Simulator; resolves when ready. It must
   * settle promptly once `signal` aborts: claim-time stops wait for it.
   */
  startAsync(udid: string, signal: AbortSignal): Promise<void>;
  /**
   * Stops the tool and its native state after its startup settled. A handle whose stop failed stays
   * owned and is never restarted, so a later stop retries it.
   */
  stopAsync(): Promise<void>;
};

export type StartedTool = {
  ready: Promise<void>;
  /** Cancels a startup that is still running, without stopping the tool. */
  cancelAsync(): Promise<void>;
  stopAsync(): Promise<void>;
};

/** Starts `tool` once serve-sim is ready. A failure before cancellation goes to `onFailure`. */
export function startTool(
  tool: WarmTool,
  udid: string,
  serveSimReady: Promise<unknown>,
  signal: AbortSignal,
  onFailure: (error: unknown) => void
): StartedTool {
  const controller = new AbortController();
  const toolSignal = AbortSignal.any([signal, controller.signal]);
  // The executor catches a synchronous throw, so the caller's cleanup still runs.
  const prepared = new Promise<void>(resolve => resolve(tool.prepareAsync?.(toolSignal)));
  const ready = Promise.all([serveSimReady, prepared]).then(() =>
    tool.startAsync(udid, toolSignal)
  );
  void ready.catch(error => {
    if (!controller.signal.aborted) {
      onFailure(error);
    }
  });
  const cancelAsync = async (): Promise<void> => {
    controller.abort();
    // Readiness can reject before independent configuration has closed its child process.
    await Promise.allSettled([ready, prepared]);
  };
  return {
    ready,
    cancelAsync,
    async stopAsync() {
      await cancelAsync();
      await tool.stopAsync();
    },
  };
}

/** Rejects once `signal` aborts, so a stop never waits for `promise` to settle on its own. */
export async function untilAbortedAsync<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
