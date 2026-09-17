import { type bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type Readable } from 'node:stream';

import { type CustomBuildContext } from '../../../customBuildContext';
import { startAgentDeviceAppLogCollectionAsync } from '../agentDeviceAppLogs';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

describe(startAgentDeviceAppLogCollectionAsync, () => {
  let stateDir: string;
  const logger = { warn: jest.fn() } as unknown as bunyan;
  const uploads: { name: string; contents: string }[] = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    uploads.length = 0;
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-app-logs-test-'));
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, args) => {
      const chunks: string[] = [];
      for await (const chunk of args.stream as Readable) {
        chunks.push(Buffer.from(chunk).toString());
      }
      uploads.push({ name: args.name, contents: chunks.join('') });
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  const start = () =>
    startAgentDeviceAppLogCollectionAsync({
      ctx: {} as CustomBuildContext,
      deviceRunSessionId: 'run-id',
      stateDir,
      logger,
    });

  async function writeLog(session: string, contents: string): Promise<string> {
    const directory = path.join(stateDir, 'sessions', session);
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, 'app.log');
    await fs.writeFile(filename, contents);
    return filename;
  }

  it('does not upload when no logs were captured', async () => {
    const collection = await start();
    await collection.stopAsync();
    expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads final contents once and attributes multiple logs to the run', async () => {
    const collection = await start();
    const filename = await writeLog('first', 'initial\n');
    await writeLog('second', 'other app');
    await fs.appendFile(filename, 'final\n');
    await Promise.all([collection.stopAsync(), collection.stopAsync()]);
    expect(uploads).toEqual([
      { name: 'App log (first)', contents: 'initial\nfinal\n' },
      { name: 'App log (second)', contents: 'other app' },
    ]);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceRunSessionId: 'run-id',
        kind: 'native-app-log',
        size: 14,
      })
    );
  });

  it('excludes preexisting session directories, empty logs and missing logs', async () => {
    await writeLog('old', 'previous run');
    const collection = await start();
    await writeLog('empty', '');
    await fs.mkdir(path.join(stateDir, 'sessions', 'missing'));
    await collection.stopAsync();
    expect(uploads).toEqual([]);
  });

  it('does not follow session or file symlinks', async () => {
    const collection = await start();
    const outside = path.join(stateDir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'app.log'), 'private');
    await fs.mkdir(path.join(stateDir, 'sessions', 'file-link'), { recursive: true });
    await fs.symlink(outside, path.join(stateDir, 'sessions', 'directory-link'));
    await fs.symlink(
      path.join(outside, 'app.log'),
      path.join(stateDir, 'sessions', 'file-link', 'app.log')
    );
    await collection.stopAsync();
    expect(uploads).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips oversized logs without failing shutdown', async () => {
    const collection = await start();
    const file = await writeLog('large', '');
    await fs.truncate(file, 10 * 1024 * 1024 + 1);
    await expect(collection.stopAsync()).resolves.toBeUndefined();
    expect(uploads).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('continues after one upload fails without allocating a retry', async () => {
    const collection = await start();
    await writeLog('first', 'first');
    await writeLog('second', 'second');
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValueOnce(new Error('offline'));
    await expect(collection.stopAsync()).resolves.toBeUndefined();
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(2);
    expect(uploads).toEqual([{ name: 'App log (second)', contents: 'second' }]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('aborts network work and returns when the shutdown budget expires', async () => {
    const collection = await start();
    await writeLog('first', 'first');
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    let signal: AbortSignal | undefined;
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementationOnce(async (_ctx, args) => {
      signal = args.signal;
      markStarted();
      await new Promise<void>((_resolve, reject) => {
        args.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    jest.useFakeTimers();
    const stopped = collection.stopAsync();
    await started;
    await jest.advanceTimersByTimeAsync(30_000);
    await stopped;
    expect(signal?.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });
});
