import { createLogger } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { endDeviceAppsAsync } from '../endDeviceApps';

jest.mock('@expo/turtle-spawn');

const env = {} as BuildStepEnv;
const logger = createLogger({ name: 'test', level: 'fatal' });
const A = '4F15B69B-95F9-450D-BAF1-6B7985797355';
const B = '9C0A3E1D-2B47-4F38-8E6A-1D5F0C2B7A64';

function fakeSpawn(answers: Record<string, string | Error>): void {
  jest.mocked(spawn).mockImplementation(((command: string, args: string[]) => {
    const answer = answers[[command, ...args].join(' ')] ?? '';
    return (
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ stdout: answer })
    ) as never;
  }) as never);
}

function deviceCommands(): { argv: string[]; signal: unknown }[] {
  return jest
    .mocked(spawn)
    .mock.calls.map(([command, args, options]) => ({
      argv: [command, ...args],
      signal: (options as { signal?: unknown }).signal,
    }))
    .filter(({ argv }) => argv.includes('terminate') || argv.includes('shell'));
}

const bootedList = JSON.stringify({
  devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: A }, { udid: B }] },
});

describe(endDeviceAppsAsync, () => {
  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  it('terminates every running app that is not a system app, past one that fails', async () => {
    fakeSpawn({
      'xcrun simctl list devices --json --no-escape-slashes booted': JSON.stringify({
        devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: A }] },
      }),
      [`xcrun simctl spawn ${A} launchctl list`]: [
        'PID\tStatus\tLabel',
        '80297\t0\tUIKitApplication:com.apple.Spotlight[9ec9][rb-legacy]',
        '80300\t0\tUIKitApplication:dev.expo.easexample[ca71][rb-legacy]',
        '80301\t0\tUIKitApplication:host.exp.Exponent[a1b2][rb-legacy]',
        '-\t0\tcom.apple.mobilesafari.webcontent',
      ].join('\n'),
      // Exited between the list and the terminate.
      [`xcrun simctl terminate ${A} dev.expo.easexample`]: new Error('found nothing to terminate'),
    });

    await endDeviceAppsAsync({ runtimePlatform: BuildRuntimePlatform.DARWIN, env, logger });

    expect(deviceCommands()).toEqual([
      {
        argv: ['xcrun', 'simctl', 'terminate', A, 'dev.expo.easexample'],
        signal: expect.any(AbortSignal),
      },
      {
        argv: ['xcrun', 'simctl', 'terminate', A, 'host.exp.Exponent'],
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it('ends the apps on the other Simulators when one does not answer, then fails', async () => {
    const wedged = new Error('timed out');
    fakeSpawn({
      'xcrun simctl list devices --json --no-escape-slashes booted': bootedList,
      [`xcrun simctl spawn ${A} launchctl list`]: wedged,
      [`xcrun simctl spawn ${B} launchctl list`]:
        '80300\t0\tUIKitApplication:dev.expo.easexample[ca71][rb-legacy]',
    });

    const error = await endDeviceAppsAsync({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
    }).catch((err: unknown) => err);

    expect(deviceCommands().map(({ argv }) => argv)).toEqual([
      ['xcrun', 'simctl', 'terminate', B, 'dev.expo.easexample'],
    ]);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((err: Error) => [err.message, err.cause])).toEqual([
      [`Could not end the apps on the Simulator ${A}.`, wedged],
    ]);
  });

  it('force-stops the installed apps on each attached emulator, past one that fails', async () => {
    const failing = new Error('adb: device offline');
    jest.mocked(spawn).mockImplementation(((command: string, args: string[]) => {
      if (args[0] === 'devices') {
        return Promise.resolve({
          stdout: [
            'List of devices attached',
            'emulator-5554          device product:sdk_gphone64_x86_64',
            'emulator-5556          offline',
            'emulator-5558          device product:sdk_gphone64_x86_64',
            '',
          ].join('\n'),
        });
      }
      return args[1] === 'emulator-5554'
        ? Promise.reject(failing)
        : Promise.resolve({ stdout: '' });
    }) as never);

    const error = await endDeviceAppsAsync({
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env,
      logger,
    }).catch((err: unknown) => err);

    expect(deviceCommands().map(({ argv }) => argv.slice(0, 4))).toEqual([
      ['adb', '-s', 'emulator-5554', 'shell'],
      ['adb', '-s', 'emulator-5558', 'shell'],
    ]);
    expect(deviceCommands().every(({ signal }) => signal instanceof AbortSignal)).toBe(true);
    expect((error as AggregateError).errors.map((err: Error) => err.cause)).toEqual([failing]);
  });
});
