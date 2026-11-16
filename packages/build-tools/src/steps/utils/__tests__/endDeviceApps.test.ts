import { createLogger } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { endDeviceAppsAsync } from '../endDeviceApps';

jest.mock('@expo/turtle-spawn');

const env = {} as BuildStepEnv;
const logger = createLogger({ name: 'test', level: 'fatal' });
const UDID = '4F15B69B-95F9-450D-BAF1-6B7985797355';

function fakeSpawn(answers: Record<string, string | Error>): void {
  jest.mocked(spawn).mockImplementation(((command: string, args: string[]) => {
    const answer = answers[[command, ...args].join(' ')] ?? '';
    return (
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ stdout: answer })
    ) as never;
  }) as never);
}

function commands(): string[] {
  return jest.mocked(spawn).mock.calls.map(([command, args]) => [command, ...args].join(' '));
}

describe(endDeviceAppsAsync, () => {
  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  it('terminates every running app that is not a system app on each booted Simulator', async () => {
    fakeSpawn({
      'xcrun simctl list devices booted --json': JSON.stringify({
        devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: UDID }] },
      }),
      [`xcrun simctl spawn ${UDID} launchctl list`]: [
        'PID\tStatus\tLabel',
        '80297\t0\tUIKitApplication:com.apple.Spotlight[9ec9][rb-legacy]',
        '80300\t0\tUIKitApplication:dev.expo.easexample[ca71][rb-legacy]',
        '80301\t0\tUIKitApplication:host.exp.Exponent[a1b2][rb-legacy]',
        '-\t0\tcom.apple.mobilesafari.webcontent',
      ].join('\n'),
      // Exited between the list and the terminate.
      [`xcrun simctl terminate ${UDID} host.exp.Exponent`]: new Error('found nothing to terminate'),
    });

    await expect(
      endDeviceAppsAsync({ runtimePlatform: BuildRuntimePlatform.DARWIN, env, logger })
    ).resolves.toBeUndefined();

    expect(commands().filter(command => command.includes('terminate'))).toEqual([
      `xcrun simctl terminate ${UDID} dev.expo.easexample`,
      `xcrun simctl terminate ${UDID} host.exp.Exponent`,
    ]);
  });

  it('force-stops the installed apps on each attached emulator', async () => {
    fakeSpawn({
      'adb devices -l': [
        'List of devices attached',
        'emulator-5554          device product:sdk_gphone64_x86_64',
        'emulator-5556          offline',
        '',
      ].join('\n'),
    });

    await endDeviceAppsAsync({ runtimePlatform: BuildRuntimePlatform.LINUX, env, logger });

    expect(commands().filter(command => command.includes('force-stop'))).toEqual([
      'adb -s emulator-5554 shell for p in $(pm list packages -3 | cut -d: -f2); do am force-stop "$p"; done',
    ]);
  });
});
