import assert from 'assert';
import { stripVTControlCharacters } from 'util';

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

export interface JsonErrorOutput {
  message: string;
  requestId?: string;
}

let jsonErrorPrinted = false;

/**
 * Print `{ "error": { message, requestId? } }` on stdout for a command that failed with --json.
 *
 * Once per process: `update:rollback` runs other commands in-process, and the innermost error is the one
 * that says what went wrong.
 */
export function printJsonErrorOutput(error: JsonErrorOutput): void {
  if (jsonErrorPrinted) {
    return;
  }
  jsonErrorPrinted = true;
  // The command may have failed before it could enable JSON output.
  enableJsonOutput();
  printJsonOnlyOutput({ error: { ...error, message: stripVTControlCharacters(error.message) } });
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
