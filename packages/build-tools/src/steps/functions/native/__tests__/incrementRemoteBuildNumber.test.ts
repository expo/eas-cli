import { BuildJob, Platform } from '@expo/eas-build-job';
import { Client } from '@urql/core';

import { createGlobalContextMock } from '../../../../__tests__/utils/context';
import { CustomBuildContext } from '../../../../customBuildContext';
import {
  readStoredBuildNumberAsync,
  storeBuildNumberAsync,
} from '../../../utils/buildNumber/storedBuildNumber';
import { createIncrementRemoteBuildNumberBuildFunction } from '../incrementRemoteBuildNumber';

jest.mock('../../../utils/buildNumber/storedBuildNumber');

const APP_ID = 'app-id';
const graphqlClient = {} as Client;
const IOS_KEY = {
  appId: APP_ID,
  platform: Platform.IOS,
  applicationIdentifier: 'dev.expo.nativeapp',
};

function createStep({
  platform = Platform.IOS,
  callInputs = { current_build_number: '7', app_version: '1.2.0' },
}: {
  platform?: Platform;
  callInputs?: Record<string, unknown>;
} = {}): ReturnType<
  ReturnType<
    typeof createIncrementRemoteBuildNumberBuildFunction
  >['createBuildStepFromFunctionCall']
> {
  const globalCtx = createGlobalContextMock({
    staticContextContent: { job: { appId: APP_ID, platform } },
  });
  return createIncrementRemoteBuildNumberBuildFunction({
    graphqlClient,
  } as CustomBuildContext<BuildJob>).createBuildStepFromFunctionCall(globalCtx, {
    callInputs: { application_identifier: 'dev.expo.nativeapp', ...callInputs },
  });
}

beforeEach(() => {
  jest.mocked(readStoredBuildNumberAsync).mockResolvedValue('42');
});

describe(createIncrementRemoteBuildNumberBuildFunction, () => {
  it('outputs and stores one more than the larger of the stored number and the number of the project', async () => {
    const step = createStep();

    await step.executeAsync();

    expect(readStoredBuildNumberAsync).toHaveBeenCalledWith(graphqlClient, IOS_KEY);
    expect(storeBuildNumberAsync).toHaveBeenCalledWith(graphqlClient, {
      ...IOS_KEY,
      buildNumber: '43',
      appVersion: '1.2.0',
    });
    expect(step.outputById.build_number.value).toBe('43');
    expect(step.ctx.logger.info).toHaveBeenCalledWith(
      'The next build number is 43. Build number of the project: 7. Build number that EAS stored for "dev.expo.nativeapp" before this build: 42. To build with the number of the project, set "auto_increment: false".'
    );
  });

  it('reads and stores the record of the platform of the job, and counts by the format of that platform', async () => {
    const step = createStep({
      platform: Platform.ANDROID,
      callInputs: { current_build_number: '100.1' },
    });

    await step.executeAsync();

    expect(readStoredBuildNumberAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ platform: Platform.ANDROID })
    );
    expect(storeBuildNumberAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ platform: Platform.ANDROID, buildNumber: '43' })
    );
    expect(step.ctx.logger.warn).toHaveBeenCalledWith(
      'EAS does not count from the build number of the project, "100.1", because it is not a whole number from 1 to 2100000000.'
    );
  });

  it('starts at the number of the project when EAS stores none, and stores "1.0.0" when it is given no version', async () => {
    jest.mocked(readStoredBuildNumberAsync).mockResolvedValue(undefined);
    const step = createStep({ callInputs: { current_build_number: '1' } });

    await step.executeAsync();

    expect(storeBuildNumberAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ buildNumber: '1', appVersion: '1.0.0' })
    );
    expect(step.ctx.logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'The next build number is 1. Build number of the project: 1. Build number that EAS stored for "dev.expo.nativeapp" before this build: none.'
      )
    );
  });

  it('counts from the stored number alone when it is given no number of the project', async () => {
    const step = createStep({ callInputs: {} });

    await step.executeAsync();

    expect(step.outputById.build_number.value).toBe('43');
    expect(step.ctx.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Build number of the project: none.')
    );
  });

  it('does not count from a number of the project that is not a build number, and says so', async () => {
    const step = createStep({ callInputs: { current_build_number: '$(BUILD_NUMBER)' } });

    await step.executeAsync();

    expect(step.outputById.build_number.value).toBe('43');
    expect(step.ctx.logger.warn).toHaveBeenCalledWith(
      'EAS does not count from the build number of the project, "$(BUILD_NUMBER)", because it is not one to three whole numbers separated by periods.'
    );
    expect(step.ctx.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Build number of the project: $(BUILD_NUMBER).')
    );
  });

  it('does not count from a stored number that is not a build number, and says so', async () => {
    jest.mocked(readStoredBuildNumberAsync).mockResolvedValue('2026.11.25.1');
    const step = createStep();

    await step.executeAsync();

    expect(step.outputById.build_number.value).toBe('8');
    expect(step.ctx.logger.warn).toHaveBeenCalledWith(
      'EAS does not count from the build number that EAS stores for "dev.expo.nativeapp", "2026.11.25.1", because it is not one to three whole numbers separated by periods.'
    );
  });

  it.each([
    ['EAS stores no number', undefined],
    ['the number that EAS stores is not a build number either', '2026.11.25.1'],
  ])(
    'fails and stores nothing when the number of the project is not a build number and %s',
    async (_description, storedBuildNumber) => {
      jest.mocked(readStoredBuildNumberAsync).mockResolvedValue(storedBuildNumber);
      const step = createStep({ callInputs: { current_build_number: '$(BUILD_NUMBER)' } });

      await expect(step.executeAsync()).rejects.toMatchObject({
        errorCode: 'NATIVE_BUILD_NUMBER_INVALID',
        message:
          'EAS cannot assign the next build number. The build number of the project, "$(BUILD_NUMBER)", is not one to three whole numbers separated by periods, and EAS stores no build number for "dev.expo.nativeapp" that it can count from. Set the build number of the project to one to three whole numbers separated by periods, for example the number of your latest uploaded build, or set "auto_increment: false" to build with the number of the project.',
      });
      expect(storeBuildNumberAsync).not.toHaveBeenCalled();
    }
  );

  it('fails and stores nothing when the next number is past the largest number of the platform', async () => {
    jest.mocked(readStoredBuildNumberAsync).mockResolvedValue('2100000000');
    const step = createStep({ platform: Platform.ANDROID, callInputs: {} });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_BUILD_NUMBER_INVALID',
      message:
        'EAS cannot assign the next build number: 2100000001 is not a whole number from 1 to 2100000000. Set "auto_increment: false" to build with the number of the project.',
    });
    expect(storeBuildNumberAsync).not.toHaveBeenCalled();
  });

  it('outputs no number when it cannot store the number', async () => {
    jest.mocked(storeBuildNumberAsync).mockRejectedValueOnce(new Error('Entity Not Authorized'));
    const step = createStep();

    await expect(step.executeAsync()).rejects.toThrow('Entity Not Authorized');
    expect(step.outputById.build_number.rawValue).toBeUndefined();
  });
});
