import { writeToStdoutAsync } from '../stdout';

describe(writeToStdoutAsync, () => {
  it('resolves after stdout accepted the text', async () => {
    const written: string[] = [];
    const write = jest.fn((chunk: string, _encoding: string, callback: () => void) => {
      written.push(chunk);
      setImmediate(callback);
      return true;
    });

    await writeToStdoutAsync('hello\n', write as unknown as typeof process.stdout.write);

    expect(written).toEqual(['hello\n']);
  });

  it('rejects when the write fails, for example because the pipe closed', async () => {
    const error = new Error('write EPIPE');
    const write = jest.fn((_chunk: string, _encoding: string, callback: (error: Error) => void) => {
      setImmediate(() => {
        callback(error);
      });
      return false;
    });

    await expect(
      writeToStdoutAsync('hello\n', write as unknown as typeof process.stdout.write)
    ).rejects.toBe(error);
  });

  it('rejects when the write throws', async () => {
    const error = new Error('write failed');
    const write = jest.fn(() => {
      throw error;
    });

    await expect(
      writeToStdoutAsync('hello\n', write as unknown as typeof process.stdout.write)
    ).rejects.toBe(error);
  });
});
