import { Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import {
  getMockAppFragment,
  getMockEasJson,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
  withLocalVersionSource,
  withRemoteVersionSource,
} from './utils';
import { updateNativeVersionsAsync as updateAndroidNativeVersionsAsync } from '../../build/android/version';
import { updateNativeVersionsAsync as updateIosNativeVersionsAsync } from '../../build/ios/version';
import BuildVersionSyncView from '../../commands/build/version/sync';
import { Target } from '../../credentials/ios/types';
import { AppVersionMutation } from '../../graphql/mutations/AppVersionMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { AppVersionQuery } from '../../graphql/queries/AppVersionQuery';
import { getAppBuildGradleAsync } from '../../project/android/gradleUtils';
import { resolveTargetsAsync } from '../../project/ios/target';
import { AppVersionSourceUpdateOption } from '../../project/remoteVersionSource';
import { resolveWorkflowAsync } from '../../project/workflow';
import * as prompts from '../../prompts';

jest.mock('../../build/android/version');
jest.mock('../../build/ios/version');
jest.mock('../../project/applicationIdentifier');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../graphql/mutations/AppVersionMutation');
jest.mock('../../project/workflow');
jest.mock('../../project/android/gradleUtils');
jest.mock('../../project/ios/target');
jest.mock('../../project/ios/scheme');
jest.mock('fs');
jest.mock('../../log');
jest.mock('../../prompts');
jest.mock('../../utils/json');

describe(BuildVersionSyncView, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('syncing version for managed project on platform android', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '1000',
      storeVersion: '0.0.1',
    }));
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));
    jest.mocked(resolveWorkflowAsync).mockImplementation(async () => Workflow.MANAGED);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    const syncAndroidAsync = jest.spyOn(cmd, 'syncAndroidAsync' as any);

    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(syncAndroidAsync).not.toHaveBeenCalled();
  });

  test('syncing version for managed project on platform android when appVersionSource is not set and the user chooses to set it to REMOTE', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {});
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '1000',
      storeVersion: '0.0.1',
    }));
    jest.mocked(prompts.promptAsync).mockImplementationOnce(async () => ({
      version: '1000',
    }));
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_REMOTE);
    jest.mocked(resolveWorkflowAsync).mockImplementation(async () => Workflow.MANAGED);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    const syncAndroidAsync = jest.spyOn(cmd, 'syncAndroidAsync' as any);

    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(syncAndroidAsync).not.toHaveBeenCalled();
  });

  test('syncing version for bare project on platform android', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '1000',
      storeVersion: '0.0.1',
    }));
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));
    jest.mocked(resolveWorkflowAsync).mockImplementation(async () => Workflow.GENERIC);
    jest.mocked(getAppBuildGradleAsync).mockImplementation(async () => ({
      android: {},
    }));

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    const syncAndroidAsync = jest.spyOn(cmd, 'syncAndroidAsync' as any);

    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(syncAndroidAsync).toHaveBeenCalled();
    expect(updateAndroidNativeVersionsAsync).toHaveBeenCalledWith({
      projectDir: ctx.projectDir,
      versionCode: 1000,
    });
  });

  test('syncing version for managed project on platform ios', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '1000',
      storeVersion: '0.0.1',
    }));
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));
    jest.mocked(resolveWorkflowAsync).mockImplementation(async () => Workflow.MANAGED);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=ios'], ctx);
    const syncIosAsync = jest.spyOn(cmd, 'syncIosAsync' as any);

    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'IOS',
      'eas.test.com'
    );
    expect(syncIosAsync).not.toHaveBeenCalled();
  });

  test('syncing version for bare project on platform ios', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    const fakeTarget: Target = {
      targetName: 'testapp',
      bundleIdentifier: 'eas.test.com',
      entitlements: {},
    };
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '1000',
      storeVersion: '0.0.1',
    }));
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));
    jest.mocked(resolveWorkflowAsync).mockImplementation(async () => Workflow.GENERIC);
    jest.mocked(resolveTargetsAsync).mockImplementation(async () => [fakeTarget]);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=ios'], ctx);
    const syncIosAsync = jest.spyOn(cmd, 'syncIosAsync' as any);

    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'IOS',
      'eas.test.com'
    );
    expect(syncIosAsync).toHaveBeenCalled();
    expect(updateIosNativeVersionsAsync).toHaveBeenCalledWith({
      buildNumber: '1000',
      projectDir: ctx.projectDir,
      targets: [fakeTarget],
    });
  });

  test('syncing version aborts when appVersionSource is set to local and users refuse auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {
      easJson: withLocalVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(prompts.confirmAsync).mockImplementation(async () => false);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborting...');
    expect(AppVersionMutation.createAppVersionAsync).not.toHaveBeenCalledWith();
  });

  test('syncing version aborts when appVersionSource is not set and the user chooses to set it to LOCAL, and they refuse auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_LOCAL);
    jest.mocked(prompts.confirmAsync).mockImplementation(async () => false);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborting...');
    expect(AppVersionMutation.createAppVersionAsync).not.toHaveBeenCalledWith();
  });

  test('syncing version when appVersionSource is set to local and user allows auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {
      easJson: withLocalVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(prompts.confirmAsync).mockImplementation(async () => true);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    await cmd.run();

    const easJsonAfterCmd = await fs.readJson(path.join(ctx.projectDir, 'eas.json'));
    expect(easJsonAfterCmd.cli.appVersionSource).toBe('remote');
  });

  test('syncing version when appVersionSource is not set and the user chooses to set it to LOCAL and they allow auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_LOCAL);
    jest.mocked(prompts.confirmAsync).mockImplementation(async () => true);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    await cmd.run();

    const easJsonAfterCmd = await fs.readJson(path.join(ctx.projectDir, 'eas.json'));
    expect(easJsonAfterCmd.cli.appVersionSource).toBe('remote');
  });

  test('syncing version aborts when appVersionSource is not set and the user chooses to configure manually', async () => {
    const ctx = mockCommandContext(BuildVersionSyncView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.ABORT);

    const cmd = mockTestCommand(BuildVersionSyncView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborted.');
    expect(AppVersionMutation.createAppVersionAsync).not.toHaveBeenCalledWith();
  });
});
