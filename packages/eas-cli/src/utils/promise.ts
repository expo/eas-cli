/**
 * Returns a promise that will be resolved after given ms milliseconds.
 *
 * @param ms A number of milliseconds to sleep.
 * @param signal An optional signal that resolves the sleep early when aborted.
 * @returns A promise that resolves after the provided number of milliseconds or when aborted.
 */
export async function sleepAsync(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }

  await new Promise<void>(resolve => {
    const onAbort = (): void => {
      clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
