import assert from 'assert';

import Log from '../log';

let stdoutWrite: NodeJS.WriteStream['write'] | undefined;

export function enableJsonOutput() {
  if (stdoutWrite) {
    return;
  }
  stdoutWrite = process.stdout.write;
  process.stdout.write = (...args: any) => {
    return process.stderr.write.call(null, args);
  };
}

export function printJsonOnlyOutput(value: object): void {
  assert(stdoutWrite, 'this should only be called with --json flag');
  try {
    process.stdout.write = stdoutWrite;
    Log.log(JSON.stringify(value, null, 2));
  } finally {
    process.stdout.write = (...args: any) => {
      return process.stderr.write.call(null, args);
    };
  }
}
