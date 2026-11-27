import { enableJsonOutput, printJsonOnlyOutputAsync } from '../json';

describe(printJsonOnlyOutputAsync, () => {
  // `enableJsonOutput` keeps the first `process.stdout.write` it sees for the whole module, so this
  // fake stays in place and each test sets how the write finishes.
  let finishWrite: (callback: (error?: Error | null) => void) => void = callback => {
    callback();
  };
  const written: string[] = [];
  const originalWrite = process.stdout.write;

  beforeAll(() => {
    process.stdout.write = ((
      chunk: string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ) => {
      written.push(chunk);
      finishWrite(callback);
      return true;
    }) as typeof process.stdout.write;
    enableJsonOutput();
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
  });

  beforeEach(() => {
    written.length = 0;
  });

  it('resolves after stdout accepted the JSON', async () => {
    finishWrite = callback => {
      setImmediate(callback);
    };

    await printJsonOnlyOutputAsync({ id: 'session-123' });

    expect(written).toEqual([`${JSON.stringify({ id: 'session-123' }, null, 2)}\n`]);
  });

  it('rejects when stdout fails, for example because the pipe closed', async () => {
    const error = new Error('write EPIPE');
    finishWrite = callback => {
      setImmediate(() => {
        callback(error);
      });
    };

    await expect(printJsonOnlyOutputAsync({ id: 'session-123' })).rejects.toBe(error);
  });
});
