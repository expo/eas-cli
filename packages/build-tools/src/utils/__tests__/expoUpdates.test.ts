import { Platform, BuildJob } from '@expo/eas-build-job';

import { BuildContext } from '../../context';
import * as expoUpdates from '../expoUpdates';
import getExpoUpdatesPackageVersionIfInstalledAsync from '../getExpoUpdatesPackageVersionIfInstalledAsync';
import { iosSetChannelNativelyAsync } from '../../ios/expoUpdates';
import { androidSetChannelNativelyAsync } from '../../android/expoUpdates';

jest.mock('../getExpoUpdatesPackageVersionIfInstalledAsync');
jest.mock('../../ios/expoUpdates');
jest.mock('../../android/expoUpdates');
jest.mock('fs');

describe(expoUpdates.configureExpoUpdatesIfInstalledAsync, () => {
  beforeAll(() => {
    jest.restoreAllMocks();
  });

  it('aborts if expo-updates is not installed', async () => {
    jest.mocked(getExpoUpdatesPackageVersionIfInstalledAsync).mockResolvedValue(null);

    await expoUpdates.configureExpoUpdatesIfInstalledAsync(
      {
        job: { Platform: Platform.IOS },
        getReactNativeProjectDirectory: () => '/app',
      } as any,
      { resolvedRuntimeVersion: '1' }
    );

    expect(androidSetChannelNativelyAsync).not.toBeCalled();
    expect(iosSetChannelNativelyAsync).not.toBeCalled();
    expect(getExpoUpdatesPackageVersionIfInstalledAsync).toBeCalledTimes(1);
  });

  it('aborts if updates.url (app config) is set but updates.channel (eas.json) is not', async () => {
    jest.mocked(getExpoUpdatesPackageVersionIfInstalledAsync).mockResolvedValue('0.18.0');

    const managedCtx: BuildContext<BuildJob> = {
      appConfig: {
        updates: {
          url: 'https://u.expo.dev/blahblah',
        },
      },
      job: {
        platform: Platform.IOS,
      },
      logger: { info: () => {} },
      getReactNativeProjectDirectory: () => '/app',
    } as any;
    await expoUpdates.configureExpoUpdatesIfInstalledAsync(managedCtx, {
      resolvedRuntimeVersion: '1',
    });

    expect(androidSetChannelNativelyAsync).not.toBeCalled();
    expect(iosSetChannelNativelyAsync).not.toBeCalled();
    expect(getExpoUpdatesPackageVersionIfInstalledAsync).toBeCalledTimes(1);
  });

  it('configures for EAS if updates.channel (eas.json) and updates.url (app config) are set', async () => {
    jest.mocked(getExpoUpdatesPackageVersionIfInstalledAsync).mockResolvedValue('0.18.0');

    const managedCtx: BuildContext<BuildJob> = {
      appConfig: {
        updates: {
          url: 'https://u.expo.dev/blahblah',
        },
      },
      job: {
        updates: {
          channel: 'main',
        },
        platform: Platform.IOS,
      },
      logger: { info: () => {} },
      getReactNativeProjectDirectory: () => '/app',
    } as any;
    await expoUpdates.configureExpoUpdatesIfInstalledAsync(managedCtx, {
      resolvedRuntimeVersion: '1',
    });

    expect(androidSetChannelNativelyAsync).not.toBeCalled();
    expect(iosSetChannelNativelyAsync).toBeCalledTimes(1);
    expect(getExpoUpdatesPackageVersionIfInstalledAsync).toBeCalledTimes(1);
  });

  it('configures for EAS if the updates.channel is set', async () => {
    jest.mocked(getExpoUpdatesPackageVersionIfInstalledAsync).mockResolvedValue('0.18.0');

    const managedCtx: BuildContext<BuildJob> = {
      appConfig: {
        updates: {
          url: 'https://u.expo.dev/blahblah',
        },
      },
      job: { updates: { channel: 'main' }, platform: Platform.IOS },
      logger: { info: () => {} },
      getReactNativeProjectDirectory: () => '/app',
    } as any;
    await expoUpdates.configureExpoUpdatesIfInstalledAsync(managedCtx, {
      resolvedRuntimeVersion: '1',
    });

    expect(androidSetChannelNativelyAsync).not.toBeCalled();
    expect(iosSetChannelNativelyAsync).toBeCalledTimes(1);
    expect(getExpoUpdatesPackageVersionIfInstalledAsync).toBeCalledTimes(1);
  });
});
