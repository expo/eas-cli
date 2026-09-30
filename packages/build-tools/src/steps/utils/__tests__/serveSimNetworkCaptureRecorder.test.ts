import { bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
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

function followerArgs(): string[][] {
  return jest.mocked(spawnDetached).mock.calls.map(([options]) => options.args);
}

async function waitForFollowersAsync(count: number): Promise<void> {
  for (let i = 0; i < 100 && jest.mocked(spawnDetached).mock.calls.length < count; i++) {
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
  expect(options.stopGracePeriodMs).toBe(15_000);
});

it('starts a new follower only when serve-sim restarts for the device', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    stateDir,
    pollIntervalMs: 10,
    serveSimCommand: ['bun', 'serve-sim.js'],
  });
  await waitForFollowersAsync(1);
  await delay(50);
  expect(spawnDetached).toHaveBeenCalledTimes(1);

  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-restarted' });
  await waitForFollowersAsync(2);
  expect(jest.mocked(spawnDetached).mock.calls[1][0].command).toBe('bun');
  expect(followerArgs()[1]).toEqual([
    'serve-sim.js',
    'capture',
    'har',
    '-o',
    expect.stringMatching(/SIM-A-2\.har$/),
    '-d',
    'SIM-A',
  ]);
});

it('stops every follower and returns only the HARs that hold a recording', async () => {
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await writeServerAsync('SIM-B', { url: 'http://127.0.0.1:4200', token: 'token-b' });
  await ServeSimNetworkCaptureRecorder.startAsync({ logger, env, stateDir, pollIntervalMs: 10 });
  await waitForFollowersAsync(2);
  const recorded = followerArgs().find(args => args.includes('SIM-A'))!;
  await writeFile(recorded[recorded.indexOf('-o') + 1], '{"log":{"entries":[{}]}}');

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
      restartIntervalMs: 30,
    });
    await waitForFollowersAsync(1);
    exits[0] = new Error('Process exited with code 1.');
    await waitForFollowersAsync(2);
    expect(outPath(1)).toMatch(/SIM-A-2\.har$/);
    await writeFile(outPath(1), '{"log":{"entries":[{}]}}');

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
    await writeFile(outPath(0), '{"log":{"entries":[{},{}]}}');
    exits[0] = new Error('Process exited with code 1.');
    await waitForFollowersAsync(2);
    await writeFile(outPath(1), '{"log":{"entries":[{}]}}');

    const { captures } = await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
    expect(captures).toEqual([
      { udid: 'SIM-A', filePath: outPath(0), size: 27 },
      { udid: 'SIM-A', filePath: outPath(1), size: 24 },
    ]);
  });

  it("keeps another device's follower when a device's restart fails to spawn", async () => {
    await writeServerAsync('SIM-B', { url: 'http://127.0.0.1:4200', token: 'token-b' });
    await ServeSimNetworkCaptureRecorder.startAsync({
      logger,
      env,
      stateDir,
      pollIntervalMs: 10,
      restartIntervalMs: 30,
    });
    await waitForFollowersAsync(1);
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await waitForFollowersAsync(2);
    const simA = followerArgs().findIndex(args => args.includes('SIM-A'));
    await writeFile(outPath(simA), '{"log":{"entries":[{}]}}');
    const simB = followerArgs().findIndex(args => args.includes('SIM-B'));
    const spawnFollower = jest.mocked(spawnDetached).getMockImplementation()!;
    jest.mocked(spawnDetached).mockImplementationOnce(() => {
      throw new Error('spawn EAGAIN');
    });
    exits[simB] = new Error('Process exited with code 1.');
    await waitForFollowersAsync(4);
    expect(jest.mocked(spawnDetached).getMockImplementation()).toBe(spawnFollower);

    const { captures } = await ServeSimNetworkCaptureRecorder.finishAsync({ logger });
    expect(captures).toEqual([{ udid: 'SIM-A', filePath: outPath(simA), size: 24 }]);
  });

  it('waits the restart interval before starting another follower', async () => {
    await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
    await ServeSimNetworkCaptureRecorder.startAsync({
      logger,
      env,
      stateDir,
      pollIntervalMs: 10,
      restartIntervalMs: 60_000,
    });
    await waitForFollowersAsync(1);
    exits[0] = new Error('Process exited with code 1.');
    await delay(100);
    expect(spawnDetached).toHaveBeenCalledTimes(1);
  });
});

it('keeps polling after a follower fails to start, and retries after the restart interval', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(() => {
    throw new Error('spawn EAGAIN');
  });
  await writeServerAsync('SIM-A', { url: 'http://127.0.0.1:4100', token: 'token-a' });
  await ServeSimNetworkCaptureRecorder.startAsync({
    logger,
    env,
    stateDir,
    pollIntervalMs: 10,
    restartIntervalMs: 50,
  });
  await waitForFollowersAsync(2);
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'spawn EAGAIN' }) },
    'Could not start the network capture follower for SIM-A; retrying.'
  );
  expect(followerArgs()[1]).toContainEqual(expect.stringMatching(/SIM-A-2\.har$/));
});
