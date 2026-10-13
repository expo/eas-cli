export namespace AbortUtils {
  export type ResettableAbortSignal = {
    signal: AbortSignal;
    resetDeadline: () => void;
  };

  /**
   * Like AbortSignal.timeout, but resetDeadline restarts the timer, so the timeout bounds stalls
   * instead of total time.
   */
  export function resettableTimeout(timeoutMs: number): ResettableAbortSignal {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException(`The operation timed out after ${timeoutMs}ms.`, 'TimeoutError')
      );
    }, timeoutMs).unref();
    return {
      signal: controller.signal,
      resetDeadline: () => {
        if (!controller.signal.aborted) {
          timer.refresh();
        }
      },
    };
  }
}
