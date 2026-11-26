import { spawn } from 'child_process';
import path from 'path';

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

describe('closed stdout pipe', () => {
  async function runChildAsync(mode: string): Promise<{ code: number | null; stderr: string }> {
    const child = spawn(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register/transpile-only'),
        path.join(__dirname, 'fixtures/stdout-closed-pipe.cjs'),
        mode,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    // The reader exits before the child writes.
    child.stdout.destroy();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    const code = await new Promise<number | null>(resolve => {
      child.on('close', resolve);
    });
    return { code, stderr };
  }

  it('reports the failed write, and with ignoreStdoutErrors later output does not crash', async () => {
    const { code, stderr } = await runChildAsync('guard');

    expect(stderr).toContain('result:EPIPE');
    expect(code).toBe(0);
  }, 20_000);

  it('crashes on later output without ignoreStdoutErrors', async () => {
    const { code, stderr } = await runChildAsync('no-guard');

    expect(stderr).toContain('EPIPE');
    expect(code).not.toBe(0);
  }, 20_000);
});
