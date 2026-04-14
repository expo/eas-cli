import { Config } from '@oclif/core';

import { ensureProjectConfiguredAsync } from '../../../build/configure';
import { evaluateConfigWithEnvVarsAsync } from '../../../build/evaluateConfigWithEnvVarsAsync';
import { downloadAndRunAsync } from '../../../build/runBuildAndSubmit';
import { ensureRepoIsCleanAsync } from '../../../build/utils/repository';
import { createFingerprintAsync } from '../../../fingerprint/cli';
import { BuildStatus, DistributionType } from '../../../graphql/generated';
import { resolveWorkflowAsync } from '../../../project/workflow';
import BuildDev from '../dev';

jest.mock('../../../build/configure', () => ({
  createBuildProfileAsync: jest.fn(),
  doesBuildProfileExistAsync: jest.fn(),
  ensureProjectConfiguredAsync: jest.fn(),
}));
jest.mock('../../../build/evaluateConfigWithEnvVarsAsync');
jest.mock('../../../build/runBuildAndSubmit', () => ({
  downloadAndRunAsync: jest.fn(),
  runBuildAndSubmitAsync: jest.fn(),
}));
jest.mock('../../../build/utils/repository');
jest.mock('../../../fingerprint/cli');
jest.mock('../../../project/workflow');
jest.mock('../../../log');

describe(BuildDev, () => {
  const commandConfig = new Config({ root: '/test-project' });
  const projectDir = '/test-project';

  commandConfig.runHook = async () => ({
    failures: [],
    successes: [],
  });

  const build = {
    id: 'build-id',
    status: BuildStatus.Finished,
    platform: 'IOS',
    isForIosSimulator: true,
    distribution: DistributionType.Internal,
    developmentClient: true,
    project: {
      id: 'project-id',
      name: 'app',
      slug: 'app',
      ownerAccount: {
        id: 'account-id',
        name: 'account',
      },
    },
    artifacts: {
      applicationArchiveUrl: 'https://example.com/app.tar.gz',
    },
  } as any;

  const context = {
    loggedIn: {
      actor: { id: 'actor-id' },
      graphqlClient: {} as any,
    },
    getDynamicPrivateProjectConfigAsync: jest.fn(async () => ({
      projectDir,
      exp: {},
      projectId: 'project-id',
    })),
    projectDir,
    analytics: {} as any,
    vcsClient: {
      ensureRepoExistsAsync: jest.fn(async () => undefined),
    },
    projectId: 'project-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ensureProjectConfiguredAsync).mockResolvedValue(false);
    jest.mocked(ensureRepoIsCleanAsync).mockResolvedValue(undefined);
    jest
      .mocked(evaluateConfigWithEnvVarsAsync)
      .mockResolvedValue({ projectId: 'project-id', env: {} });
    jest.mocked(resolveWorkflowAsync).mockResolvedValue('managed' as any);
    jest.mocked(createFingerprintAsync).mockResolvedValue({ hash: 'fingerprint-hash' } as any);
    jest.mocked(downloadAndRunAsync).mockResolvedValue(undefined);
  });

  function createCommand(argv: string[]): BuildDev {
    const command = new BuildDev(argv, commandConfig);
    (command as any).getContextAsync = jest.fn().mockResolvedValue(context);
    jest
      .spyOn(command as any, 'ensureValidBuildRunProfileExistsAsync')
      .mockResolvedValue({ profileName: 'development-simulator', profile: { env: {} } });
    jest.spyOn(command as any, 'getBuildsAsync').mockResolvedValue([build]);
    jest.spyOn(command as any, 'startDevServerAsync').mockResolvedValue(undefined);
    return command;
  }

  it('skips starting the bundler when --skip-bundler is passed', async () => {
    const command = createCommand(['--platform', 'ios', '--skip-bundler']);

    await (command as any).runAsync();

    expect(downloadAndRunAsync).toHaveBeenCalledWith(build);
    expect((command as any).startDevServerAsync).not.toHaveBeenCalled();
  });

  it('starts the bundler by default after installing the build', async () => {
    const command = createCommand(['--platform', 'ios']);

    await (command as any).runAsync();

    expect(downloadAndRunAsync).toHaveBeenCalledWith(build);
    expect((command as any).startDevServerAsync).toHaveBeenCalledWith({
      projectDir,
      platform: 'ios',
    });
  });
});
