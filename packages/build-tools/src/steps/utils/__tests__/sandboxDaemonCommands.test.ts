jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

import { type SandboxDaemonCommandResult, SandboxDaemonErrorCode } from '@expo/eas-build-job';
import { readFileSync, statSync } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import {
  type SandboxDaemonCommandImplementations,
  createSandboxCommandImplementations,
} from '../sandboxCommandImplementations';

const READ_FILE_LIMITS = { maxTextBytes: 40_000, maxImageBytes: 3_000_000 };
const FIXTURES_DIRECTORY = path.join(__dirname, 'fixtures');

describe('sandbox daemon commands', () => {
  let commandImplementations: SandboxDaemonCommandImplementations;
  let stopAsync: () => Promise<void>;
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-command-executor-'));
    const controller = new AbortController();
    const commands = createSandboxCommandImplementations({
      workingDirectory,
      env: process.env,
      signal: controller.signal,
    });
    commandImplementations = commands.commandImplementations;
    stopAsync = async () => {
      controller.abort();
      await commands.stoppedPromise;
    };
  });

  afterEach(async () => {
    await stopAsync();
    await fs.chmod(workingDirectory, 0o700);
    await fs.rm(workingDirectory, { recursive: true, force: true });
  });

  it('returns output and the exit code for a completed command', async () => {
    const result = await commandImplementations.execCommand({ cmd: 'printf hello' });

    expect(result).toMatchObject({ output: 'hello', exitCode: 0 });
    expect('sessionId' in result).toBe(false);
  });

  it('rejects a command canceled during directory validation', async () => {
    const controller = new AbortController();
    const commands = createSandboxCommandImplementations({
      workingDirectory,
      env: process.env,
      signal: controller.signal,
    });
    const command = commands.commandImplementations.execCommand({ cmd: 'printf should-not-run' });
    controller.abort();
    await commands.stoppedPromise;
    await expect(command).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      commands.commandImplementations.writeStdin({ sessionId: 1 })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('returns a session id and accepts stdin for a running command', async () => {
    const started = await commandImplementations.execCommand({
      cmd: `node -e "process.stdin.once('data', data => process.stdout.write(data.toString().toUpperCase(), () => process.exit(0)))"`,
      yieldTimeMs: 10,
    });
    const sessionId = getSessionId(started);

    const completed = await commandImplementations.writeStdin({
      sessionId,
      chars: 'hello',
      yieldTimeMs: 1_000,
    });

    expect(completed).toMatchObject({ output: 'HELLO', exitCode: 0 });
    expect('sessionId' in completed).toBe(false);
  });

  it('returns only output produced since the previous call', async () => {
    const started = await commandImplementations.execCommand({
      cmd: `node -e "process.stdin.once('data', () => process.stdout.write('second\\n', () => process.exit(0))); console.log('first')"`,
      yieldTimeMs: 50,
    });
    const sessionId = getSessionId(started);

    expect(await readUntilAsync(started, output => output.includes('first\n'))).toMatchObject({
      output: 'first\n',
    });
    const completed = await readUntilAsync(
      await commandImplementations.writeStdin({ sessionId, chars: 'continue', yieldTimeMs: 100 }),
      (_, result) => !('sessionId' in result)
    );

    expect(completed).toMatchObject({ output: 'second\n', exitCode: 0 });
  });

  it('provides a TTY when requested', async () => {
    const result = await commandImplementations.execCommand({
      cmd: 'test -t 0 && test -t 1 && test -t 2',
      tty: true,
    });

    expect(result).toMatchObject({ exitCode: 0 });
  });

  it('uses pipes by default', async () => {
    const result = await commandImplementations.execCommand({ cmd: 'test -t 0' });

    expect(result).toMatchObject({ exitCode: 1 });
  });

  it('sends Ctrl+C to the foreground PTY process', async () => {
    const started = await commandImplementations.execCommand({
      cmd: `exec node -e "process.on('SIGINT', () => process.stdout.write('interrupted\\n', () => process.exit(0))); console.log('ready'); setInterval(() => {}, 1000)"`,
      tty: true,
      yieldTimeMs: 50,
    });

    await readUntilAsync(started, output => output.includes('ready'));
    const completed = await readUntilAsync(
      await commandImplementations.writeStdin({
        sessionId: getSessionId(started),
        chars: '\u0003',
        yieldTimeMs: 1_000,
      }),
      (_, result) => !('sessionId' in result)
    );

    expect(completed.output).toContain('interrupted');
    expect(completed).toMatchObject({ exitCode: 0 });
  });

  it('writes U+0003 as literal input in pipe mode', async () => {
    const started = await commandImplementations.execCommand({
      cmd: `node -e "process.stdin.once('data', data => process.stdout.write(data[0] + '\\n', () => process.exit(0)))"`,
      yieldTimeMs: 10,
    });

    const completed = await readUntilAsync(
      await commandImplementations.writeStdin({
        sessionId: getSessionId(started),
        chars: '\u0003',
        yieldTimeMs: 1_000,
      }),
      (_, result) => !('sessionId' in result)
    );

    expect(completed).toMatchObject({ output: '3\n', exitCode: 0 });
  });

  it('reports a termination signal without an exit code', async () => {
    const result = await commandImplementations.execCommand({ cmd: 'kill -TERM $$' });

    expect(result).toMatchObject({ terminationSignal: 'SIGTERM' });
    expect('exitCode' in result).toBe(false);
  });

  it('measures each call separately', async () => {
    const now = jest.spyOn(performance, 'now');
    try {
      now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);
      const started = await commandImplementations.execCommand({
        cmd: 'read value',
        yieldTimeMs: 0,
      });
      expect(started.wallTimeSeconds).toBe(0.25);

      now.mockReturnValueOnce(5_000).mockReturnValueOnce(5_100);
      const polled = await commandImplementations.writeStdin({
        sessionId: getSessionId(started),
        yieldTimeMs: 0,
      });
      expect(polled.wallTimeSeconds).toBe(0.1);
    } finally {
      now.mockRestore();
    }
  });

  it('uses the requested working directory', async () => {
    const childDirectory = path.join(workingDirectory, 'child');
    await fs.mkdir(childDirectory);

    const result = await commandImplementations.execCommand({ cmd: 'pwd', workdir: 'child' });

    expect(result).toMatchObject({ output: `${await fs.realpath(childDirectory)}\n`, exitCode: 0 });
  });

  it('reports a missing working directory', async () => {
    await expect(
      commandImplementations.execCommand({ cmd: 'true', workdir: 'missing' })
    ).rejects.toMatchObject({
      code: SandboxDaemonErrorCode.BAD_REQUEST,
      message: `Working directory does not exist: ${path.join(workingDirectory, 'missing')}`,
    });
  });

  it('reports a working directory that is not a directory', async () => {
    const file = path.join(workingDirectory, 'file');
    await fs.writeFile(file, 'content');

    await expect(
      commandImplementations.execCommand({ cmd: 'true', workdir: 'file' })
    ).rejects.toMatchObject({
      code: SandboxDaemonErrorCode.BAD_REQUEST,
      message: `Working directory is not a directory: ${file}`,
    });
  });

  it('reports an inaccessible working directory', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const directory = path.join(workingDirectory, 'inaccessible');
    await fs.mkdir(directory, 0o000);

    await expect(
      commandImplementations.execCommand({ cmd: 'true', workdir: 'inaccessible' })
    ).rejects.toMatchObject({
      code: SandboxDaemonErrorCode.BAD_REQUEST,
      message: `Working directory is not accessible: ${directory}`,
    });

    await fs.chmod(directory, 0o700);
  });

  it.each([false, true])('stops command descendants when tty is %s', async tty => {
    const started = await commandImplementations.execCommand({
      cmd: `node -e "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(String(child.pid) + '\\n'); setInterval(() => {}, 1000)"`,
      tty,
      yieldTimeMs: 100,
    });
    const ready = await readUntilAsync(started, output => /\d+\r?\n/.test(output));
    const childPid = Number(/\d+/.exec(ready.output)?.[0]);
    expect(childPid).toBeGreaterThan(0);

    await stopAsync();
    await setTimeoutAsync(50);

    expect(isProcessRunning(childPid)).toBe(false);
  });
  describe('readFile', () => {
    let readLengths: number[];

    beforeEach(() => {
      readLengths = [];
      const open = fs.open;
      jest.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const file = await open(...args);
        const read = file.read.bind(file);
        file.read = ((buffer: Buffer, offset: number, length: number, position: number) => {
          readLengths.push(length);
          return read(buffer, offset, length, position);
        }) as FileHandle['read'];
        return file;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function readAsync(
      contents: Buffer | string,
      limits: Partial<typeof READ_FILE_LIMITS> = {}
    ) {
      await fs.writeFile(path.join(workingDirectory, 'file'), contents);
      return await commandImplementations.readFile({
        path: 'file',
        ...READ_FILE_LIMITS,
        ...limits,
      });
    }

    async function readFixtureAsync(name: string, limits: Partial<typeof READ_FILE_LIMITS> = {}) {
      return await commandImplementations.readFile({
        path: path.join(FIXTURES_DIRECTORY, name),
        ...READ_FILE_LIMITS,
        ...limits,
      });
    }

    it.each([
      ['leiothrix.png', 'image/png'],
      ['sparrow.jpg', 'image/jpeg'],
      ['robin.gif', 'image/gif'],
      ['chat.webp', 'image/webp'],
    ])('returns %s as an %s image with its data', async (name, mimeType) => {
      const contents = readFileSync(path.join(FIXTURES_DIRECTORY, name));

      expect(await readFixtureAsync(name)).toEqual({
        kind: 'image',
        mimeType,
        data: contents.toString('base64'),
      });
      expect(readLengths).toEqual([12, contents.length]);
    });

    it('detects an image by its content instead of its extension', async () => {
      await fs.copyFile(
        path.join(FIXTURES_DIRECTORY, 'leiothrix.png'),
        path.join(workingDirectory, 'screenshot.txt')
      );

      expect(
        await commandImplementations.readFile({ path: 'screenshot.txt', ...READ_FILE_LIMITS })
      ).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    });

    it('reports an image over the byte limit after reading only its header', async () => {
      const { size } = statSync(path.join(FIXTURES_DIRECTORY, 'leiothrix.png'));

      expect(await readFixtureAsync('leiothrix.png', { maxImageBytes: size - 1 })).toEqual({
        kind: 'image',
        mimeType: 'image/png',
        size,
        error: 'tooLarge',
      });
      expect(readLengths).toEqual([12]);
    });

    it('returns a text file within the limit in full', async () => {
      expect(await readFixtureAsync('birds.txt')).toEqual({
        kind: 'text',
        text: 'Robin, sparrow, leiothrix and chat\nZażółć gęślą jaźń\n€ 🐦\n',
        truncated: false,
        size: 71,
      });
    });

    it('reads no more text than the limit without splitting a character', async () => {
      expect(await readFixtureAsync('birds.txt', { maxTextBytes: 38 })).toEqual({
        kind: 'text',
        text: 'Robin, sparrow, leiothrix and chat\nZa',
        truncated: true,
        size: 71,
      });
      expect(readLengths).toEqual([12, 38]);
    });

    it.each([
      ['invalid UTF-8', Buffer.from([0x61, 0x80, 0x62])],
      ['an incomplete final character', Buffer.from([0x61, 0xe2, 0x82])],
    ])('reports a file with %s as binary', async (_, contents) => {
      expect(await readAsync(contents)).toEqual({ kind: 'binary', size: 3 });
    });

    it('reports a missing file', async () => {
      await expect(
        commandImplementations.readFile({ path: 'missing', ...READ_FILE_LIMITS })
      ).rejects.toMatchObject({
        code: SandboxDaemonErrorCode.BAD_REQUEST,
        message: `File does not exist: ${path.join(workingDirectory, 'missing')}`,
      });
    });

    it('reports an inaccessible file', async () => {
      const file = path.join(workingDirectory, 'inaccessible');
      await fs.writeFile(file, 'content', { mode: 0o000 });

      await expect(
        commandImplementations.readFile({ path: 'inaccessible', ...READ_FILE_LIMITS })
      ).rejects.toMatchObject({
        code: SandboxDaemonErrorCode.BAD_REQUEST,
        message: `File is not accessible: ${file}`,
      });
    });

    it('rejects a directory', async () => {
      const directory = path.join(workingDirectory, 'directory');
      await fs.mkdir(directory);

      await expect(
        commandImplementations.readFile({ path: 'directory', ...READ_FILE_LIMITS })
      ).rejects.toMatchObject({
        code: SandboxDaemonErrorCode.BAD_REQUEST,
        message: `${directory} is not a regular file.`,
      });
    });

    it('rejects a FIFO without waiting for a writer', async () => {
      const fifo = path.join(workingDirectory, 'fifo');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);

      await expect(
        commandImplementations.readFile({ path: 'fifo', ...READ_FILE_LIMITS })
      ).rejects.toMatchObject({
        code: SandboxDaemonErrorCode.BAD_REQUEST,
        message: `${fifo} is not a regular file.`,
      });
    });
  });

  async function readUntilAsync(
    initial: SandboxDaemonCommandResult<'execCommand' | 'writeStdin'>,
    isReady: (
      output: string,
      result: SandboxDaemonCommandResult<'execCommand' | 'writeStdin'>
    ) => boolean
  ): Promise<SandboxDaemonCommandResult<'execCommand' | 'writeStdin'>> {
    let result = initial;
    let output = result.output;
    const deadline = Date.now() + 10_000;
    while (!isReady(output, result)) {
      if (!('sessionId' in result) || Date.now() >= deadline) {
        throw new Error(
          `Command did not reach the expected state: ${JSON.stringify({ ...result, output })}`
        );
      }
      result = await commandImplementations.writeStdin({
        sessionId: result.sessionId,
        yieldTimeMs: 100,
      });
      output += result.output;
    }
    return { ...result, output };
  }
});

function getSessionId(result: unknown): number {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('sessionId' in result) ||
    typeof result.sessionId !== 'number'
  ) {
    throw new Error('Expected the command to still be running.');
  }
  return result.sessionId;
}

function isProcessRunning(pid: number): boolean {
  const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status === 1 && !result.stdout.trim()) {
    return false;
  }
  expect(result.status).toBe(0);
  // A zombie has exited, but its parent has not yet collected its exit status.
  return !result.stdout.trim().startsWith('Z');
}
