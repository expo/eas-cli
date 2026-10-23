import { bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { spawnDetached } from '../remoteDeviceRunSession';
import { ServeSimNetworkCaptureRecorder } from '../serveSimNetworkCaptureRecorder';

jest.mock('../../../sentry');
jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  spawnDetached: jest.fn(),
}));

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as bunyan;
const env = {} as BuildStepEnv;
const stopFollower = jest.fn();
let stateDir: string;

async function writeServerAsync(udid: string, state: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(stateDir, `server-${udid}.json`),
    JSON.stringify({ device: udid, ...state })
  );
}

/** Writes what `capture har` leaves: a HAR, and its entry log with one line per request. */
function record(harPath: string, entries: number): void {
  writeFileSync(harPath, JSON.stringify({ log: { entries: Array(entries).fill({}) } }));
  writeFileSync(harPath.replace(/\.har$/, '.entries.ndjson'), '{}\n'.repeat(entries));
}

function followerArgs(): string[][] {
  return jest.mocked(spawnDetached).mock.calls.map(([options]) => options.args);
}

async function waitForFollowersAsync(count: number): Promise<void> {
  for (let i = 0; i < 300 && jest.mocked(spawnDetached).mock.calls.length < count; i++) {
    await delay(10);
  }
  expect(spawnDetached).toHaveBeenCalledTimes(count);
}

beforeEach(async () => {
  jest.clearAllMocks();
  stopFollower.mockResolvedValue(undefined);
  jest.mocked(spawnDetached).mockImplementation(() => ({
    pid: 1234,
    getOutput: () => 'Stopped before recording began.',
    getExitError: () => undefined,
    stopAsync: stopFollower,
  }));
  stateDir = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-network-capture-test-'));
  await mkdir(stateDir, { recursive: true });
});

afterEach(async () => {
  await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
  await rm(stateDir, { recursive: true, force: true });
});

it('starts one capture har follower per serve-sim that can serve capture routes', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await writeServerAsync('SIM-B', { url: 'http://127.0.0.1:4200' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    packageVersion: '0.5.0',
    stateDir,
    pollIntervalMs: 10,
  });
  await waitForFollowersAsync(1);
  await delay(50);

  expect(spawnDetached).toHaveBeenCalledTimes(1);
  const [options] = jest.mocked(spawnDetached).mock.calls[0];
  expect(options.command).toBe('npx');
  expect(options.args).toEqual([
    '--yes',
    '@expo/serve-sim@0.5.0',
    'capture',
    'har',
    '-o',
    expect.stringMatching(/SIM-A-1\.har$/),
    '-d',
    'SIM-A',
  ]);
  expect(options.stopGracePeriodMs).toBe(60_000);
});

it('starts a new follower only when serve-sim restarts for the device', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    stateDir,
    pollIntervalMs: 10,
    packageVersion: '0.5.0',
  });
  await waitForFollowersAsync(1);
  await delay(50);
  expect(spawnDetached).toHaveBeenCalledTimes(1);

  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-restarted' });
  await waitForFollowersAsync(2);
  expect(jest.mocked(spawnDetached).mock.calls[1][0].command).toBe('npx');
  expect(followerArgs()[1]).toEqual([
    '--yes',
    '@expo/serve-sim@0.5.0',
    'capture',
    'har',
    '-o',
    expect.stringMatching(/SIM-A-2\.har$/),
    '-d',
    'SIM-A',
  ]);
});

it('stops every follower and returns only the HARs that hold requests', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await writeServerAsync('SIM-B', { url: 'http://127.0.0.1:4200', token: 'token-b' });
  await ServeSimNetworkCaptureRecorder.startAsync({ logger, env, stateDir, pollIntervalMs: 10 });
  await waitForFollowersAsync(2);
  const recorded = followerArgs().find(args => args.includes('SIM-A'))!;
  record(recorded[recorded.indexOf('-o') + 1], 1);
  // serve-sim writes an empty HAR when recording begins, before any request.
  const empty = followerArgs().find(args => args.includes('SIM-B'))!;
  record(empty[empty.indexOf('-o') + 1], 0);

  const { outputDirectory, captures } = await ServeSimNetworkCaptureRecorder.finishAsync({
    logger,
  });

  expect(stopFollower).toHaveBeenCalledTimes(2);
  expect(captures).toEqual([
    { udid: 'SIM-A', filePath: recorded[recorded.indexOf('-o') + 1], size: 24 },
  ]);
  expect(outputDirectory).toBe(path.dirname(captures[0].filePath));
  expect(logger.info).toHaveBeenCalledWith(
    { output: 'Stopped before recording began.' },
    'No network capture was recorded for SIM-B.'
  );
});

it('stops followers in parallel', async () => {
  let stopping = 0;
  let mostAtOnce = 0;
  stopFollower.mockImplementation(async () => {
    stopping += 1;
    mostAtOnce = Math.max(mostAtOnce, stopping);
    await delay(20);
    stopping -= 1;
  });
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await writeServerAsync('SIM-B', { url: 'http://127.0.0.1:4200', token: 'token-b' });
  await ServeSimNetworkCaptureRecorder.startAsync({ logger, env, stateDir, pollIntervalMs: 10 });
  await waitForFollowersAsync(2);
  await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
  expect(mostAtOnce).toBe(2);
});

it('keeps collecting when a follower cannot be stopped', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({ logger, env, stateDir, pollIntervalMs: 10 });
  await waitForFollowersAsync(1);
  stopFollower.mockRejectedValueOnce(new Error('EPERM'));
  await expect(ServeSimNetworkCaptureRecorder.finishAsync({ logger })).resolves.toEqual({
    outputDirectory: expect.any(String),
    captures: [],
  });
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'EPERM' }) },
    'Could not stop the network capture follower for SIM-A.'
  );
});

it('returns nothing when the recorder never started', async () => {
  await expect(ServeSimNetworkCaptureRecorder.finishAsync({ logger })).resolves.toEqual({
    outputDirectory: null,
    captures: [],
  });
});

describe('restarting followers', () => {
  const exits: (Error | undefined)[] = [];

  beforeEach(() => {
    exits.length = 0;
    jest.mocked(spawnDetached).mockImplementation(() => {
      const index = exits.push(undefined) - 1;
      return {
        pid: 1234,
        getOutput: () => 'Network capture is not enabled on this device.',
        getExitError: () => exits[index],
        stopAsync: stopFollower,
      };
    });
  });

  function outPath(call: number): string {
    const args = followerArgs()[call];
    return args[args.indexOf('-o') + 1];
  }

  it('starts another follower when one exits before capture was on, and drops the empty one', async () => {
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await ServeSimNetworkCaptureRecorder.startAsync({
      logger,
      env,
      stateDir,
      pollIntervalMs: 10,
      idleRestartIntervalMs: 30,
    });
    await waitForFollowersAsync(1);
    exits[0] = new Error('Process exited with code 1.');
    await waitForFollowersAsync(2);
    expect(outPath(1)).toMatch(/SIM-A-2\.har$/);
    record(outPath(1), 1);

    const { captures } = await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
    expect(captures).toEqual([{ udid: 'SIM-A', filePath: outPath(1), size: 24 }]);
    expect(stopFollower).toHaveBeenCalledTimes(1);
  });

  it('keeps a recording when its stream drops and records the rest in a new part', async () => {
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await ServeSimNetworkCaptureRecorder.startAsync({
      logger,
      env,
      stateDir,
      pollIntervalMs: 10,
      restartIntervalMs: 30,
    });
    await waitForFollowersAsync(1);
    record(outPath(0), 2);
    exits[0] = new Error('Process exited with code 1.');
    await waitForFollowersAsync(2);
    record(outPath(1), 1);

    const { captures } = await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
    expect(captures).toEqual([
      { udid: 'SIM-A', filePath: outPath(0), size: 27 },
      { udid: 'SIM-A', filePath: outPath(1), size: 24 },
    ]);
  });

  it('waits longer to replace a follower that recorded nothing than one that recorded requests', async () => {
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await ServeSimNetworkCaptureRecorder.startAsync({
      logger,
      env,
      stateDir,
      pollIntervalMs: 10,
      restartIntervalMs: 30,
      idleRestartIntervalMs: 60_000,
    });
    await waitForFollowersAsync(1);
    exits[0] = new Error('Process exited with code 1.');
    await delay(100);
    expect(spawnDetached).toHaveBeenCalledTimes(1);

    record(outPath(0), 1);
    await waitForFollowersAsync(2);
  });

  it('drops an empty follower from an earlier serve-sim when serve-sim restarts', async () => {
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await ServeSimNetworkCaptureRecorder.startAsync({ logger, env, stateDir, pollIntervalMs: 10 });
    await waitForFollowersAsync(1);
    exits[0] = new Error('Process exited with code 1.');
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-restarted' });
    await waitForFollowersAsync(2);

    const { captures } = await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
    expect(captures).toEqual([]);
    // Only the new follower is left to stop, and the device is reported once.
    expect(stopFollower).toHaveBeenCalledTimes(1);
    expect(
      jest
        .mocked(logger.info)
        .mock.calls.filter(
          ([, message]) => message === 'No network capture was recorded for SIM-A.'
        )
    ).toHaveLength(1);
  });

  it('waits 30 s by default before replacing a follower that recorded nothing', async () => {
    const startedAt = Date.now();
    const now = jest.spyOn(Date, 'now');
    try {
      await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
      await ServeSimNetworkCaptureRecorder.startAsync({
        logger,
        env,
        stateDir,
        pollIntervalMs: 10,
        restartIntervalMs: 0,
      });
      await waitForFollowersAsync(1);
      exits[0] = new Error('Process exited with code 1.');
      now.mockReturnValue(startedAt + 29_000);
      await delay(50);
      expect(spawnDetached).toHaveBeenCalledTimes(1);
      now.mockReturnValue(startedAt + 31_000);
      await waitForFollowersAsync(2);
    } finally {
      now.mockRestore();
    }
  });

  it('stops starting followers once 20 HARs hold requests', async () => {
    jest.mocked(spawnDetached).mockImplementation(({ args }) => {
      record(args[args.indexOf('-o') + 1], 1);
      return {
        pid: 1234,
        getOutput: () => '',
        getExitError: () => new Error('Process exited with code 1.'),
        stopAsync: stopFollower,
      };
    });
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await ServeSimNetworkCaptureRecorder.startAsync({
      logger,
      env,
      stateDir,
      pollIntervalMs: 1,
      restartIntervalMs: 0,
    });
    await waitForFollowersAsync(20);
    await delay(50);
    expect(spawnDetached).toHaveBeenCalledTimes(20);
    const { captures } = await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
    expect(captures).toHaveLength(20);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Network capture reached its limit of 20 recordings; recorded captures will be retained.'
    );
  });
});

it('keeps polling after a follower fails to start, and retries on the next poll', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(() => {
    throw new Error('spawn EAGAIN');
  });
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    stateDir,
    pollIntervalMs: 10,
    restartIntervalMs: 60_000,
    idleRestartIntervalMs: 60_000,
  });
  await waitForFollowersAsync(2);
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'spawn EAGAIN' }) },
    'Could not start the network capture follower for SIM-A; retrying.'
  );
  expect(followerArgs()[1]).toContainEqual(expect.stringMatching(/SIM-A-2\.har$/));
});

it('bounds followers that record nothing, warns once, and retries a new server identity', async () => {
  jest.mocked(spawnDetached).mockImplementation(() => ({
    pid: 1234,
    getOutput: () => 'npm error: the requested serve-sim package was not found',
    getExitError: () => new Error('Process exited with code 1.'),
    stopAsync: stopFollower,
  }));
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    stateDir,
    pollIntervalMs: 1,
    idleRestartIntervalMs: 0,
  });
  // Runs that recorded nothing do not use up the 20 HARs that may hold requests.
  await waitForFollowersAsync(120);
  await delay(50);
  expect(spawnDetached).toHaveBeenCalledTimes(120);
  const warnings = jest
    .mocked(logger.warn)
    .mock.calls.filter(([, message]) =>
      String(message).startsWith('Stopped retrying network capture')
    );
  expect(warnings).toEqual([
    [
      { output: 'npm error: the requested serve-sim package was not found' },
      'Stopped retrying network capture for SIM-A after 120 attempts; recorded captures will be retained.',
    ],
  ]);

  jest.mocked(spawnDetached).mockImplementation(() => ({
    pid: 1234,
    getOutput: () => '',
    getExitError: () => undefined,
    stopAsync: stopFollower,
  }));
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'new-token' });
  await waitForFollowersAsync(121);
  await delay(50);
  expect(spawnDetached).toHaveBeenCalledTimes(121);
  expect(followerArgs()[120]).toContainEqual(expect.stringMatching(/SIM-A-121\.har$/));
});

it('keeps a running empty follower waiting without spending more attempts', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    stateDir,
    pollIntervalMs: 1,
    restartIntervalMs: 0,
    idleRestartIntervalMs: 0,
  });
  await waitForFollowersAsync(1);
  await delay(50);
  expect(spawnDetached).toHaveBeenCalledTimes(1);
  expect(logger.warn).not.toHaveBeenCalled();
});
