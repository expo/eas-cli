import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../../utils/deviceRunSessionArtifacts';
import {
  createServeSimServerLogAsync,
  prepareServeSimServerLogAsync,
  takeServeSimServerLogs,
} from '../../utils/serveSimServerLogs';
import { createCollectServeSimServerLogsBuildFunction } from '../collectServeSimServerLogs';

jest.mock('../../../sentry');
jest.mock('../../utils/deviceRunSessionArtifacts');

const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const directories: string[] = [];
const uploaded: {
  text: string;
  options: Parameters<typeof uploadDeviceRunSessionArtifactAsync>[1];
}[] = [];
type Fn = (stepCtx: unknown, options: unknown) => Promise<void>;

async function recordAsync(session: string, text: string, secrets: string[] = []) {
  const log = await createServeSimServerLogAsync(session, secrets);
  directories.push(log.directory);
  log.output.append(Buffer.from(text));
  return log;
}

async function collectAsync(deviceRunSessionId?: string) {
  const { fn } = createCollectServeSimServerLogsBuildFunction(ctx) as unknown as { fn: Fn };
  await fn({ logger }, { env: { DEVICE_RUN_SESSION_ID: deviceRunSessionId } as BuildStepEnv });
}

beforeEach(() => {
  jest.clearAllMocks();
  uploaded.length = 0;
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, options) => {
    const chunks: Buffer[] = [];
    for await (const chunk of options.stream) {
      chunks.push(Buffer.from(chunk));
    }
    uploaded.push({ text: Buffer.concat(chunks).toString('utf8'), options });
  });
});

afterEach(async () => {
  takeServeSimServerLogs('session-a');
  takeServeSimServerLogs('session-b');
  await Promise.all(
    directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
});

it('uploads stdout and stderr after startup failure, redacts credentials, then removes the files', async () => {
  const log = await recordAsync(
    'session-a',
    'Starting\nhttp://localhost:8081/?token=unknown-startup-token\n{"token":"json-token"}\nAuthorization: Bearer bearer-token\nTURN known-credential\nstartup failed\n',
    ['known-credential']
  );
  await collectAsync('session-a');
  expect(uploaded[0].text).toBe(
    'Starting\nhttp://localhost:8081/?token=[REDACTED]\n{"token":"[REDACTED]"}\nAuthorization: Bearer [REDACTED]\nTURN [REDACTED]\nstartup failed\n'
  );
  expect(uploaded[0].options).toMatchObject({
    deviceRunSessionId: 'session-a',
    artifactId: 'serve-sim-server-log-1',
    filename: 'serve-sim.log',
    kind: 'serve-sim-log',
    size: Buffer.byteLength(uploaded[0].text),
    metadata: { source: 'stdout-stderr', truncated: false },
  });
  await expect(access(log.directory)).rejects.toThrow();
  await collectAsync('session-a');
  expect(uploaded).toHaveLength(1);
});

it('keeps logs isolated between sessions and uploads each launch as a separate part', async () => {
  await recordAsync('session-a', 'first launch\n');
  await recordAsync('session-b', 'other session\n');
  await recordAsync('session-a', 'second launch\n');
  await collectAsync('session-a');
  expect(uploaded.map(item => item.text)).toEqual(['first launch\n', 'second launch\n']);
  expect(uploaded.map(item => item.options.artifactId)).toEqual([
    'serve-sim-server-log-1',
    'serve-sim-server-log-2',
  ]);
  await collectAsync('session-b');
  expect(uploaded.at(-1)?.text).toBe('other session\n');
});

it('numbers nonempty launches without counting empty logs', async () => {
  await recordAsync('session-a', '');
  await recordAsync('session-a', 'ready\n');
  await collectAsync('session-a');
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0].options).toMatchObject({
    artifactId: 'serve-sim-server-log-1',
    name: 'serve-sim server logs',
    metadata: { part: 1 },
  });
});

it('retains a failed upload locally and continues uploading the next file', async () => {
  const failed = await recordAsync('session-a', 'failed upload token=local-secret\n', [
    'local-secret',
  ]);
  const next = await recordAsync('session-a', 'next upload\n');
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementationOnce(async (_ctx, options) => {
    options.stream.destroy();
    throw new Error('offline');
  });
  await expect(collectAsync('session-a')).resolves.toBeUndefined();
  expect(uploaded[0].text).toBe('next upload\n');
  await expect(access(failed.filePath)).rejects.toThrow();
  const retained = await readFile(path.join(failed.directory, 'serve-sim-upload.log'), 'utf8');
  expect(retained).toContain('[REDACTED]');
  expect(retained).not.toContain('local-secret');
  await expect(access(next.directory)).rejects.toThrow();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not upload serve-sim server logs',
    expect.any(Error),
    { level: 'warning' }
  );
});

it('aborts upload allocation when the log stream fails before the PUT starts', async () => {
  const log = await recordAsync('session-a', 'unreadable log\n');
  const error = new Error('read failed');
  let uploadSignal: AbortSignal | undefined;
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementationOnce(async (_ctx, options) => {
    uploadSignal = options.signal;
    options.stream.emit('error', error);
    throw error;
  });
  await expect(collectAsync('session-a')).resolves.toBeUndefined();
  expect(uploadSignal?.aborted).toBe(true);
  expect(uploadSignal?.reason).toBe(error);
  await expect(access(log.filePath)).rejects.toThrow();
  await expect(access(path.join(log.directory, 'serve-sim-upload.log'))).resolves.toBeUndefined();
});

it('removes the raw log even if preparing the redacted file fails', async () => {
  const log = await recordAsync('session-a', 'token=local-secret\n', ['local-secret']);
  const writing = jest
    .spyOn(jest.requireMock('node:fs/promises'), 'writeFile')
    .mockRejectedValueOnce(new Error('disk full'));
  try {
    await expect(collectAsync('session-a')).resolves.toBeUndefined();
    await expect(access(log.filePath)).rejects.toThrow();
    expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
  } finally {
    writing.mockRestore();
  }
});

it('reports cleanup failure separately after a successful upload', async () => {
  const log = await recordAsync('session-a', 'uploaded log\n');
  const error = new Error('cleanup failed');
  const remove = jest
    .spyOn(jest.requireMock('node:fs/promises'), 'rm')
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(error);
  try {
    await expect(collectAsync('session-a')).resolves.toBeUndefined();
    expect(uploaded).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error, logDirectory: log.directory },
      'Could not remove serve-sim server log files.'
    );
    expect(Sentry.capture).not.toHaveBeenCalled();
  } finally {
    remove.mockRestore();
  }
});

it('skips empty logs and does not fail without a session ID', async () => {
  const empty = await recordAsync('session-a', '');
  await collectAsync('session-a');
  await expect(access(empty.directory)).rejects.toThrow();
  await expect(collectAsync()).resolves.toBeUndefined();
  expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
});

it('bounds the uploaded log while preserving its final output', async () => {
  const log = await recordAsync(
    'session-a',
    'earlier output\n' + 'x\n'.repeat(6 * 1024 * 1024) + 'shutdown complete\n'
  );
  const prepared = await prepareServeSimServerLogAsync(log);
  const text = await readFile(prepared.filePath, 'utf8');
  expect(prepared.truncated).toBe(true);
  expect(prepared.size).toBeLessThan(10 * 1024 * 1024 + 1);
  expect(text).toContain('Earlier output omitted');
  expect(text).not.toContain('earlier output\n');
  expect(text.endsWith('shutdown complete\n')).toBe(true);
});

it.each(['x', '🙂'])(
  'preserves long output without newlines and bounds redaction expansion (%s)',
  async character => {
    const log = await recordAsync('session-a', character.repeat(2 * 1024 * 1024) + 'final-marker', [
      character,
    ]);
    const prepared = await prepareServeSimServerLogAsync(log);
    const text = await readFile(prepared.filePath, 'utf8');
    expect(prepared.size).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(text.endsWith('final-marker')).toBe(true);
    expect(prepared.truncated).toBe(true);
  }
);

it('preserves the final diagnostic when truncated output has only a trailing newline', async () => {
  const log = await recordAsync('session-a', 'x'.repeat(11 * 1024 * 1024) + 'fatal error\n');
  const prepared = await prepareServeSimServerLogAsync(log);
  const text = await readFile(prepared.filePath, 'utf8');
  expect(prepared.truncated).toBe(true);
  expect(prepared.size).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(text.endsWith('fatal error\n')).toBe(true);
});
