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
import BuildVersionSetView from '../../commands/build/version/set';
import { AppVersionMutation } from '../../graphql/mutations/AppVersionMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { AppVersionQuery } from '../../graphql/queries/AppVersionQuery';
import Log from '../../log';
import { AppVersionSourceUpdateOption } from '../../project/remoteVersionSource';
import * as prompts from '../../prompts';

jest.mock('../../project/applicationIdentifier');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../graphql/mutations/AppVersionMutation');
jest.mock('fs');
jest.mock('../../log');
jest.mock('../../prompts');
jest.mock('../../utils/json');

describe(BuildVersionSetView, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('setting version for platform android', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(AppVersionMutation.createAppVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      expect.objectContaining({
        buildVersion: '1000',
        storeVersion: '1.0.0',
      })
    );
  });

  test('setting version for platform android when the appVersionSource is not specified and the user chooses to set it to REMOTE', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {});
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(prompts.promptAsync).mockImplementationOnce(async () => ({
      version: '1000',
    }));
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_REMOTE);

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(AppVersionMutation.createAppVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      expect.objectContaining({
        buildVersion: '1000',
        storeVersion: '1.0.0',
      })
    );
  });

  test('printing current remote version before prompting for a new one', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await cmd.run();
    expect(Log.log).toHaveBeenCalledWith(expect.stringMatching('configured with versionCode 100'));
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
  });

  test('printing info that there is no remote version configured', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(prompts.promptAsync).mockImplementation(async () => ({
      version: '1000',
    }));

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await cmd.run();
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringMatching('does not have any versionCode configured')
    );
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
  });

  test('setting version aborts when appVersionSource is set to local and users refuse auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {
      easJson: withLocalVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(prompts.confirmAsync).mockImplementation(async () => false);

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborting...');
    expect(AppVersionMutation.createAppVersionAsync).not.toHaveBeenCalledWith();
  });

  test('setting version aborts when the appVersionSource is not specified and the user chooses to set it to LOCAL, and they refuse auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_LOCAL);
    jest.mocked(prompts.confirmAsync).mockImplementationOnce(async () => false);

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborting...');
    expect(AppVersionMutation.createAppVersionAsync).not.toHaveBeenCalledWith();
  });

  test('setting version when appVersionSource is set to local and user allows auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {
      easJson: withLocalVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest.mocked(prompts.confirmAsync).mockImplementation(async () => true);

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await cmd.run();

    const easJsonAfterCmd = await fs.readJson(path.join(ctx.projectDir, 'eas.json'));
    expect(easJsonAfterCmd.cli.appVersionSource).toBe('remote');
  });

  test('setting version when the appVersionSource is not specified and the user chooses to set it to LOCAL, and they allow auto configuration', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_LOCAL);
    jest.mocked(prompts.confirmAsync).mockImplementationOnce(async () => true);

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await cmd.run();

    const easJsonAfterCmd = await fs.readJson(path.join(ctx.projectDir, 'eas.json'));
    expect(easJsonAfterCmd.cli.appVersionSource).toBe('remote');
  });

  test('setting version aborts when the appVersionSource is not specified and the user chooses to configure manually', async () => {
    const ctx = mockCommandContext(BuildVersionSetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.ABORT);

    const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborted.');
    expect(AppVersionMutation.createAppVersionAsync).not.toHaveBeenCalledWith();
  });

  describe('non-interactive mode with --value flag', () => {
    test('setting version for android with --value flag', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
      jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

      const cmd = mockTestCommand(BuildVersionSetView, ['--platform=android', '--value=130'], ctx);
      await cmd.run();

      expect(prompts.promptAsync).not.toHaveBeenCalled();
      expect(AppVersionMutation.createAppVersionAsync).toHaveBeenCalledWith(
        ctx.loggedIn.graphqlClient,
        expect.objectContaining({
          buildVersion: '130',
        })
      );
    });

    test('setting version for ios with --value flag', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
      jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

      const cmd = mockTestCommand(BuildVersionSetView, ['--platform=ios', '--value=1.2.3'], ctx);
      await cmd.run();

      expect(prompts.promptAsync).not.toHaveBeenCalled();
      expect(AppVersionMutation.createAppVersionAsync).toHaveBeenCalledWith(
        ctx.loggedIn.graphqlClient,
        expect.objectContaining({
          buildVersion: '1.2.3',
        })
      );
    });

    test('throws error when --value provided without --platform', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());

      const cmd = mockTestCommand(BuildVersionSetView, ['--value=130'], ctx);

      await expect(cmd.run()).rejects.toThrowError(
        '--platform flag is required in non-interactive mode'
      );
    });

    test('throws error for invalid android versionCode', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
      jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

      const cmd = mockTestCommand(
        BuildVersionSetView,
        ['--platform=android', '--value=invalid'],
        ctx
      );

      await expect(cmd.run()).rejects.toThrowError('Invalid versionCode');
    });

    test('throws error for invalid ios buildNumber', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
      jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

      const cmd = mockTestCommand(
        BuildVersionSetView,
        ['--platform=ios', '--value=1.2.3.4'],
        ctx
      );

      await expect(cmd.run()).rejects.toThrowError('Invalid buildNumber');
    });

    test('throws error for android versionCode exceeding max', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
      jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

      const cmd = mockTestCommand(
        BuildVersionSetView,
        ['--platform=android', '--value=2100000001'],
        ctx
      );

      await expect(cmd.run()).rejects.toThrowError('Invalid versionCode');
    });

    test('--non-interactive flag without --value throws error', async () => {
      const ctx = mockCommandContext(BuildVersionSetView, {
        easJson: withRemoteVersionSource(getMockEasJson()),
      });
      jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());

      const cmd = mockTestCommand(
        BuildVersionSetView,
        ['--platform=android', '--non-interactive'],
        ctx
      );

      await expect(cmd.run()).rejects.toThrowError(
        '--value flag is required in non-interactive mode'
      );
    });
  });
});
