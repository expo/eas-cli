import chalk from 'chalk';

import {
  getMockEasJson,
  mockCommandContext,
  mockProjectId,
  mockTestCommand,
  withLocalVersionSource,
  withRemoteVersionSource,
} from './utils';
import BuildVersionGetView from '../../commands/build/version/get';
import { AppVersionQuery } from '../../graphql/queries/AppVersionQuery';
import Log from '../../log';
import { AppVersionSourceUpdateOption } from '../../project/remoteVersionSource';
import * as prompts from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

jest.mock('../../project/applicationIdentifier');
jest.mock('fs');
jest.mock('../../log');
jest.mock('../../utils/json');
jest.mock('../../graphql/queries/AppVersionQuery');
jest.mock('../../prompts');

describe(BuildVersionGetView, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  test('reading version for platform android', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));

    const cmd = mockTestCommand(BuildVersionGetView, ['--platform=android'], ctx);
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(Log.log).toHaveBeenCalledWith(`Android versionCode - ${chalk.bold('100')}`);
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });

  test('reading version for platform android when the appVersionSource is not specified and the user chooses to set it to REMOTE', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));
    const cmd = mockTestCommand(BuildVersionGetView, ['--platform=android'], ctx);
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_REMOTE);

    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(Log.log).toHaveBeenCalledWith(`Android versionCode - ${chalk.bold('100')}`);
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });

  test('reading version for platform android when no remote version is set', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

    const cmd = mockTestCommand(BuildVersionGetView, ['--platform=android'], ctx);
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(Log.log).toHaveBeenCalledWith(`No remote versions are configured for this project.`);
    expect(enableJsonOutput).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });

  test('reading version with --json flag for platform android', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));

    const cmd = mockTestCommand(
      BuildVersionGetView,
      ['--non-interactive', '--json', '--platform=android'],
      ctx
    );
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(enableJsonOutput).toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      versionCode: '100',
    });
  });

  test('reading version with --json flag for platform ios', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));

    const cmd = mockTestCommand(
      BuildVersionGetView,
      ['--non-interactive', '--json', '--platform=ios'],
      ctx
    );
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'IOS',
      'eas.test.com'
    );
    expect(enableJsonOutput).toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      buildNumber: '100',
    });
  });

  test('reading version with --json flag when no remote version is set', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {
      easJson: withRemoteVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => null);

    const cmd = mockTestCommand(
      BuildVersionGetView,
      ['--non-interactive', '--json', '--platform=android'],
      ctx
    );
    await cmd.run();
    expect(AppVersionQuery.latestVersionAsync).toHaveBeenCalledWith(
      ctx.loggedIn.graphqlClient,
      mockProjectId,
      'ANDROID',
      'eas.test.com'
    );
    expect(enableJsonOutput).toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({});
  });

  test('reading version when appVersionSource is set to local ', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {
      easJson: withLocalVersionSource(getMockEasJson()),
    });
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));

    const cmd = mockTestCommand(
      BuildVersionGetView,
      ['--non-interactive', '--json', '--platform=android'],
      ctx
    );
    await expect(cmd.run()).rejects.toThrowErrorMatchingSnapshot();
  });

  test('reading version aborts when the appVersionSource is not specified and the user chooses to set it to LOCAL', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.SET_TO_LOCAL);

    const cmd = mockTestCommand(BuildVersionGetView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowErrorMatchingSnapshot();
  });

  test('reading version aborts when the appVersionSource is not specified and the user chooses to configure it manually', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));
    jest
      .mocked(prompts.selectAsync)
      .mockImplementationOnce(async () => AppVersionSourceUpdateOption.ABORT);

    const cmd = mockTestCommand(BuildVersionGetView, ['--platform=android'], ctx);
    await expect(cmd.run()).rejects.toThrowError('Aborted.');
  });

  test('reading version sets appVersionSource to LOCAL and aborts when the appVersionSource is not specified and is run in non-interactive mode', async () => {
    const ctx = mockCommandContext(BuildVersionGetView, {});
    jest.mocked(AppVersionQuery.latestVersionAsync).mockImplementation(async () => ({
      buildVersion: '100',
      storeVersion: '1.0.0',
    }));

    const cmd = mockTestCommand(
      BuildVersionGetView,
      ['--non-interactive', '--json', '--platform=android'],
      ctx
    );
    await expect(cmd.run()).rejects.toThrowError(
      `This project is not configured for using remote version source. Add ${chalk.bold(
        '{"cli": { "appVersionSource": "remote" }}'
      )} in eas.json or re-run this command without "--non-interactive" flag.`
    );
  });
});
