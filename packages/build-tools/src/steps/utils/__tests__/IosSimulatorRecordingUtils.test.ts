import spawn from '@expo/turtle-spawn';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../../utils/IosSimulatorUtils';
import { IosSimulatorRecordingUtils } from '../IosSimulatorRecordingUtils';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));
jest.mock('../../../sentry', () => ({ Sentry: { capture: jest.fn() } }));
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: { getAvailableDevicesAsync: jest.fn() },
}));

const SIMULATOR = {
  udid: '01234567-89AB-CDEF-0123-456789ABCDEF' as IosSimulatorUuid,
  name: 'iPhone 16',
  runtimeDisplayName: 'iOS 18.6',
};
const SECOND_SIMULATOR = {
  udid: 'FEDCBA98-7654-3210-FEDC-BA9876543210' as IosSimulatorUuid,
  name: 'iPhone 16 Pro',
  runtimeDisplayName: 'iOS 18.6',
};

type RecordSimAttempt = {
  udid: string;
  outputDirectory: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

async function waitForAsync(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000 && !condition(); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

describe('IosSimulatorRecordingUtils', () => {
  let attempts: RecordSimAttempt[];
  let pollSleeps: (() => void)[];
  let bootedDevices: (typeof SIMULATOR)[];

  // Ends the poller's current sleep and waits until it has polled and gone back to sleep.
  async function pollAgainAsync(): Promise<void> {
    const sleepCount = pollSleeps.length;
    pollSleeps[sleepCount - 1]();
    await waitForAsync(() => pollSleeps.length > sleepCount);
  }

  // A finished recorder is released after an async check of its output, so poll until it is.
  async function pollUntilAsync(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !condition(); i++) {
      await pollAgainAsync();
    }
    expect(condition()).toBe(true);
  }

  beforeEach(() => {
    attempts = [];
    pollSleeps = [];
    bootedDevices = [SIMULATOR];
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockImplementation(async () => bootedDevices as any);
    jest.mocked(setTimeout).mockImplementation(((
      _ms: number,
      _value: unknown,
      options?: { signal?: AbortSignal }
    ) => {
      const signal = options?.signal;
      if (!signal) {
        // finishAsync's stop deadlines; the recorder exits before these in the tests.
        return new Promise(() => {});
      }
      return new Promise<void>((resolve, reject) => {
        pollSleeps.push(resolve);
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    }) as any);
    jest.mocked(spawn).mockImplementation(((command: string, args: string[]) => {
      if (command === 'which') {
        return Promise.resolve({ stdout: '/usr/local/bin/record-sim' });
      }
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: jest.fn(),
      });
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      child.kill.mockImplementation(() => resolve());
      attempts.push({
        udid: args[args.indexOf('--udid') + 1],
        outputDirectory: args[args.indexOf('--output') + 1],
        resolve,
        reject,
      });
      return Object.assign(promise, { child });
    }) as any);
  });

  afterEach(async () => {
    await IosSimulatorRecordingUtils.finishAsync({ logger: createMockLogger() });
    const roots = new Set(attempts.map(attempt => path.dirname(attempt.outputDirectory)));
    await Promise.all([...roots].map(root => fs.rm(root, { recursive: true, force: true })));
  });

  it('records one video from one simulator per session', async () => {
    const logger = createMockLogger();
    await IosSimulatorRecordingUtils.startAsync({ env: {}, logger });
    await waitForAsync(() => attempts.length === 1 && pollSleeps.length === 1);

    // A second simulator is not recorded while the first one is.
    bootedDevices = [SIMULATOR, SECOND_SIMULATOR];
    await pollAgainAsync();
    await pollAgainAsync();
    expect(attempts).toHaveLength(1);

    // The first recorder fails before it saves a video, so the next poll retries.
    attempts[0].reject(new Error('record-sim crashed'));
    await pollUntilAsync(() => attempts.length === 2);

    // The second recorder saves a video and exits.
    await fs.writeFile(path.join(attempts[1].outputDirectory, 'session.json'), '{}');
    attempts[1].resolve();
    await pollAgainAsync();

    // Neither a later poll nor a reboot starts another recording on any simulator.
    bootedDevices = [];
    await pollAgainAsync();
    bootedDevices = [SECOND_SIMULATOR, SIMULATOR];
    await pollAgainAsync();
    await pollAgainAsync();
    expect(attempts.map(attempt => attempt.udid)).toEqual([SIMULATOR.udid, SIMULATOR.udid]);
    expect(
      jest
        .mocked(logger.warn)
        .mock.calls.filter(([message]) => String(message).startsWith('Not recording'))
    ).toEqual([
      [
        `Not recording ${SECOND_SIMULATOR.name}; a session records only one video from one simulator.`,
      ],
      [`Not recording ${SIMULATOR.name}; a session records only one video from one simulator.`],
    ]);

    await expect(IosSimulatorRecordingUtils.finishAsync({ logger })).resolves.toEqual([
      {
        udid: SIMULATOR.udid,
        deviceName: SIMULATOR.name,
        runtimeDisplayName: SIMULATOR.runtimeDisplayName,
        directory: attempts[1].outputDirectory,
      },
    ]);
  });
});
