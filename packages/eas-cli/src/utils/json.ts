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
  } else if (value && typeof value === 'string') {
    return JSON.stringify(value);
  } else {
    return value;
  }
}
