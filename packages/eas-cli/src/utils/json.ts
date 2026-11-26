import assert from 'assert';

import Log from '../log';

let stdoutWrite: NodeJS.WriteStream['write'] | undefined;

export function enableJsonOutput(): void {
  if (stdoutWrite) {
    return;
  }
  stdoutWrite = process.stdout.write;
  process.stdout.write = process.stderr.write.bind(process.stderr);
}

export function printJsonOnlyOutput(value: object): void {
  assert(stdoutWrite, 'this should only be called with --json flag');
  try {
    process.stdout.write = stdoutWrite;
    Log.log(JSON.stringify(sanitizeValue(value), null, 2));
  } finally {
    process.stdout.write = process.stderr.write.bind(process.stderr);
  }
}

/**
 * Like `printJsonOnlyOutput`, but resolves only when stdout accepted the output, and rejects when the
 * write fails, for example because the reading end of a pipe closed. Use it when the output hands
 * off something that must be cleaned up if the caller never receives it.
 */
export async function printJsonOnlyOutputAsync(value: object): Promise<void> {
  assert(stdoutWrite, 'this should only be called with --json flag');
  const write = stdoutWrite;
  const text = `${JSON.stringify(sanitizeValue(value), null, 2)}\n`;
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
    write.call(process.stdout, text, 'utf8', settle);
  });
}

function sanitizeValue(value: any): unknown {
  if (Array.isArray(value)) {
    return value.map(val => sanitizeValue(val));
  } else if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    Object.keys(value).forEach(key => {
      if (key !== '__typename' && value[key] !== null) {
        result[key] = sanitizeValue(value[key]);
      }
    });
    return result;
  } else {
    return value;
  }
}
