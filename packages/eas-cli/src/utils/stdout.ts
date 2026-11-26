/**
 * Writes `text` to stdout and resolves only when stdout accepted it. Rejects when the write fails, for
 * example because the reading end of a pipe closed. Writes are ordered, so an empty `text` waits for
 * the earlier stdout writes and rejects if one of them failed.
 *
 * Use it when the output hands off something that must be cleaned up if the caller never receives
 * it. `write` defaults to `process.stdout.write`; pass the original one when stdout is redirected.
 */
export async function writeToStdoutAsync(
  text: string,
  write: NodeJS.WriteStream['write'] = process.stdout.write
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      // The stream can emit the same error after the callback; keep a listener until then, so it
      // is not reported as an uncaught exception.
      setImmediate(() => process.stdout.removeListener('error', settle));
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    process.stdout.on('error', settle);
    try {
      write.call(process.stdout, text, 'utf8', settle);
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
