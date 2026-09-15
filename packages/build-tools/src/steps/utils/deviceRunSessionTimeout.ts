/** Bounds waiting and signals cancellation. Operations must check the signal before later effects. */
export async function withDeviceRunSessionTimeoutAsync<T>(
  { name, timeoutMs, signal: parent }: { name: string; timeoutMs: number; signal?: AbortSignal },
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`${name} timed out after ${timeoutMs}ms.`)),
    timeoutMs
  );
  try {
    const result = await Promise.race([operation(signal), aborted]);
    signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
