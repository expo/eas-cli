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

describe('closed output pipe', () => {
  async function runChildAsync(
    stream: 'stdout' | 'stderr',
    guard: 'guard' | 'no-guard'
  ): Promise<{ code: number | null; output: string }> {
    const child = spawn(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register/transpile-only'),
        path.join(__dirname, 'fixtures/stdout-closed-pipe.cjs'),
        stream,
        guard,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    // The reader of one stream exits before the child writes; the child reports on the other one.
    const [closed, open] =
      stream === 'stdout' ? [child.stdout, child.stderr] : [child.stderr, child.stdout];
    closed.destroy();
    let output = '';
    open.setEncoding('utf8');
    open.on('data', chunk => {
      output += chunk;
    });
    const code = await new Promise<number | null>(resolve => {
      child.on('close', resolve);
    });
    return { code, output };
  }

  it('reports a failed stdout write, and with ignoreOutputErrors later output does not crash', async () => {
    const { code, output } = await runChildAsync('stdout', 'guard');

    expect(output).toContain('result:EPIPE');
    expect(code).toBe(0);
  }, 20_000);

  it('crashes on later stdout output without ignoreOutputErrors', async () => {
    const { code, output } = await runChildAsync('stdout', 'no-guard');

    expect(output).toContain('EPIPE');
    expect(code).not.toBe(0);
  }, 20_000);

  it('does not crash on stderr output to a closed pipe with ignoreOutputErrors', async () => {
    const { code, output } = await runChildAsync('stderr', 'guard');

    expect(output).toContain('done');
    expect(code).toBe(0);
  }, 20_000);

  it('crashes on stderr output to a closed pipe without ignoreOutputErrors', async () => {
    const { code, output } = await runChildAsync('stderr', 'no-guard');

    expect(output).not.toContain('done');
    expect(code).not.toBe(0);
  }, 20_000);
});
