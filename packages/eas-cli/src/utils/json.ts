import assert from 'assert';

import Log from '../log';
import { writeToStdoutAsync } from './stdout';

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
  await writeToStdoutAsync(`${JSON.stringify(sanitizeValue(value), null, 2)}\n`, stdoutWrite);
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
