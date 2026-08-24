import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createLaunchApplicationFunction, launchApplicationAsync } from '../launchApplication';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

describe(launchApplicationAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  it('launches an iOS Simulator application by bundle identifier', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'launch', 'booted', 'com.example.app'],
      { env: {}, logger }
    );
  });

  it('passes launch arguments and opens a URL on iOS', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'host.exp.Exponent',
      launchArgs: ['--uitesting', 'true'],
      openUrl: 'exp://example.test',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'xcrun',
      ['simctl', 'launch', 'booted', 'host.exp.Exponent', '--uitesting', 'true'],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'xcrun',
      [
        'simctl',
        'spawn',
        'booted',
        'defaults',
        'write',
        'com.apple.launchservices.schemeapproval',
        'com.apple.CoreSimulator.CoreSimulatorBridge-->exp',
        '-string',
        'host.exp.Exponent',
      ],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      3,
      'xcrun',
      ['simctl', 'openurl', 'booted', 'exp://example.test'],
      { env: {}, logger }
    );
  });

  it('opens a web URL on iOS without preapproving its scheme', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      openUrl: 'https://example.test',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'xcrun',
      ['simctl', 'launch', 'booted', 'com.example.app'],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'xcrun',
      ['simctl', 'openurl', 'booted', 'https://example.test'],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('launches an Android Emulator application by package and activity', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      ['shell', 'am', 'start', '-n', 'com.example.app/com.example.app.MainActivity'],
      { env: {}, logger }
    );
  });

  it('passes launch arguments and opens a URL on Android', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'host.exp.exponent',
      activityName: 'host.exp.exponent.MainActivity',
      launchArgs: ['--ez', 'isTest', 'true'],
      openUrl: 'exp://example.test',
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'adb',
      [
        'shell',
        'am',
        'start',
        '--ez',
        'isTest',
        'true',
        '-n',
        'host.exp.exponent/host.exp.exponent.MainActivity',
      ],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'adb',
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'exp://example.test',
        '-n',
        'host.exp.exponent/host.exp.exponent.MainActivity',
      ],
      { env: {}, logger }
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      'Launching host.exp.exponent with arguments ["--ez","isTest","true"].'
    );
  });

  it('requires an activity when launching an Android application', async () => {
    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_LAUNCH_APPLICATION_MISSING_ACTIVITY' });

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('launches using application metadata passed to the build step', async () => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          activity_name: 'com.example.app.MainActivity',
          launch_args: ['--ez', 'isTest', 'true'],
          open_url: 'exp://example.test',
        },
      }
    );
    await buildStep.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      [
        'shell',
        'am',
        'start',
        '--ez',
        'isTest',
        'true',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
      expect.any(Object)
    );
    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'exp://example.test',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
      expect.any(Object)
    );
  });

  it.each([{}, ['valid', 42]])('rejects invalid launch arguments (%j)', async launchArgs => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          launch_args: launchArgs,
        },
      }
    );

    await expect(buildStep.executeAsync()).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      message: 'Input "launch_args" must be an array of strings.',
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL to open', async () => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          open_url: 'not a URL',
        },
      }
    );

    await expect(buildStep.executeAsync()).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      message: 'Input "open_url" must be a valid URL.',
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it.each(['application_identifier', 'activity_name'])(
    'reports an empty %s input as a user error',
    async inputName => {
      const launchApplication = createLaunchApplicationFunction();
      const buildStep = launchApplication.createBuildStepFromFunctionCall(
        createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
        {
          callInputs: {
            application_identifier: 'com.example.app',
            activity_name: 'com.example.app.MainActivity',
            [inputName]: '',
          },
        }
      );

      await expect(buildStep.executeAsync()).rejects.toMatchObject({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        message: `Input "${inputName}" must be a non-empty string. Pass the "${inputName}" output from eas/install_build.`,
      });
      expect(mockedSpawn).not.toHaveBeenCalled();
    }
  );
});
