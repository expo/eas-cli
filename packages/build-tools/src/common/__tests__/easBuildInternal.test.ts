import { BuildJob } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

import { resolveEnvFromBuildProfileAsync, runEasBuildInternalAsync } from '../easBuildInternal';
import { resolveEasCommandPrefixAndEnvAsync } from '../../utils/easCli';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../utils/easCli', () => ({
  ...jest.requireActual('../../utils/easCli'),
  resolveEasCommandPrefixAndEnvAsync: jest.fn(),
}));

describe('easBuildInternal', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(resolveEasCommandPrefixAndEnvAsync).mockResolvedValue({
      cmd: 'npx',
      args: ['-y', 'eas-cli@latest'],
      extraEnv: {},
    });
  });

  it('calls resolveEasCommandPrefixAndEnvAsync in runEasBuildInternalAsync', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    } as any;

    const job = {
      platform: 'android',
      secrets: { robotAccessToken: 'token' },
    } as unknown as BuildJob;

    await expect(
      runEasBuildInternalAsync({
        job,
        logger,
        env: {},
        cwd: '/tmp/project',
      })
    ).rejects.toThrow('build profile is missing in a build from git-based integration.');

    expect(resolveEasCommandPrefixAndEnvAsync).toHaveBeenCalledWith();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('calls resolveEasCommandPrefixAndEnvAsync in resolveEnvFromBuildProfileAsync', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    } as any;
    const ctx = {
      logger,
      env: {},
      job: { platform: 'ios' },
    } as any;

    await expect(resolveEnvFromBuildProfileAsync(ctx, { cwd: '/tmp/project' })).rejects.toThrow(
      'build profile is missing in a build from git-based integration.'
    );

    expect(resolveEasCommandPrefixAndEnvAsync).toHaveBeenCalledWith();
    expect(spawn).not.toHaveBeenCalled();
  });
});
