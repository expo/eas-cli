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
        },
      }
    );
    await buildStep.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      ['shell', 'am', 'start', '-n', 'com.example.app/com.example.app.MainActivity'],
      expect.any(Object)
    );
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
