import { EasCliNpmTags } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

import { resolveEasCommandPrefixAndEnvAsync, runEasCliCommand } from '../easCli';
import { isAtLeastNpm7Async } from '../packageManager';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../packageManager', () => ({
  ...jest.requireActual('../packageManager'),
  isAtLeastNpm7Async: jest.fn(async () => true),
}));

describe(resolveEasCommandPrefixAndEnvAsync, () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  afterEach(() => {
    process.env.ENVIRONMENT = originalEnvironment;
  });

  it('resolves easd in development when easd --help succeeds', async () => {
    process.env.ENVIRONMENT = 'development';
    jest.mocked(spawn).mockResolvedValueOnce({ status: 0 } as any);

    const result = await resolveEasCommandPrefixAndEnvAsync();

    expect(result).toEqual({
      cmd: 'easd',
      args: [],
      extraEnv: {},
    });
    expect(spawn).toHaveBeenCalledWith(
      'easd',
      ['--help'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    );
  });

  it('resolves staging tag in development when easd --help fails', async () => {
    process.env.ENVIRONMENT = 'development';
    jest.mocked(spawn).mockResolvedValueOnce({ status: 1 } as any);

    const result = await resolveEasCommandPrefixAndEnvAsync();

    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${EasCliNpmTags.STAGING}`],
      extraEnv: {},
    });
  });

  it('resolves staging tag in development when easd probe throws', async () => {
    process.env.ENVIRONMENT = 'development';
    jest.mocked(spawn).mockRejectedValueOnce(new Error('easd not installed') as any);

    const result = await resolveEasCommandPrefixAndEnvAsync();

    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${EasCliNpmTags.STAGING}`],
      extraEnv: {},
    });
  });

  it('resolves staging tag and EXPO_STAGING env in staging environment', async () => {
    process.env.ENVIRONMENT = 'staging';
    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${EasCliNpmTags.STAGING}`],
      extraEnv: { EXPO_STAGING: '1' },
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('resolves production tag by default', async () => {
    process.env.ENVIRONMENT = 'production';
    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${EasCliNpmTags.PRODUCTION}`],
      extraEnv: {},
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('omits -y when npm is older than v7', async () => {
    jest.mocked(isAtLeastNpm7Async).mockResolvedValueOnce(false);
    process.env.ENVIRONMENT = 'production';
    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result).toEqual({
      cmd: 'npx',
      args: [`eas-cli@${EasCliNpmTags.PRODUCTION}`],
      extraEnv: {},
    });
  });
});

describe(runEasCliCommand, () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  afterEach(() => {
    process.env.ENVIRONMENT = originalEnvironment;
  });

  it('merges caller env with resolved extra env', async () => {
    process.env.ENVIRONMENT = 'staging';

    await runEasCliCommand({
      args: ['deploy', '--json'],
      options: {
        cwd: '/tmp/project',
        env: { FOO: 'bar' },
      },
    });

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining([`eas-cli@${EasCliNpmTags.STAGING}`, 'deploy', '--json']),
      expect.objectContaining({
        cwd: '/tmp/project',
        env: expect.objectContaining({
          FOO: 'bar',
          EXPO_STAGING: '1',
        }),
      })
    );
  });
});
