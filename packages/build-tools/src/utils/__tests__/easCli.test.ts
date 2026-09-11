import {
  EasCliNpmTags,
  EasCliVersionsFetchTimeoutError,
  fetchEasCliVersionsAsync,
} from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

import {
  resetCachedEasCliVersionsForTest,
  resolveEasCommandPrefixAndEnvAsync,
  runEasCliCommand,
} from '../easCli';
import { isAtLeastNpm7Async } from '../packageManager';
import { Sentry } from '../../sentry';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../packageManager', () => ({
  ...jest.requireActual('../packageManager'),
  isAtLeastNpm7Async: jest.fn(async () => true),
}));
jest.mock('@expo/eas-build-job', () => ({
  ...jest.requireActual('@expo/eas-build-job'),
  fetchEasCliVersionsAsync: jest.fn(),
}));
jest.mock('../../sentry', () => ({
  Sentry: { capture: jest.fn() },
}));

const STAGING_VERSION = 'staging-version';
const PRODUCTION_VERSION = 'production-version';

describe(resolveEasCommandPrefixAndEnvAsync, () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeEach(() => {
    resetCachedEasCliVersionsForTest();
    jest.mocked(spawn).mockReset();
    jest.mocked(Sentry.capture).mockReset();
    jest.mocked(fetchEasCliVersionsAsync).mockReset();
    jest.mocked(fetchEasCliVersionsAsync).mockResolvedValue({
      STAGING: STAGING_VERSION,
      PRODUCTION: PRODUCTION_VERSION,
    });
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
    expect(fetchEasCliVersionsAsync).not.toHaveBeenCalled();
  });

  it('resolves the staging version in development when easd --help fails', async () => {
    process.env.ENVIRONMENT = 'development';
    jest.mocked(spawn).mockResolvedValueOnce({ status: 1 } as any);

    const result = await resolveEasCommandPrefixAndEnvAsync();

    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${STAGING_VERSION}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0' },
    });
  });

  it('resolves the staging version in development when easd probe throws', async () => {
    process.env.ENVIRONMENT = 'development';
    jest.mocked(spawn).mockRejectedValueOnce(new Error('easd not installed') as any);

    const result = await resolveEasCommandPrefixAndEnvAsync();

    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${STAGING_VERSION}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0' },
    });
  });

  it('resolves the staging version and EXPO_STAGING env in staging environment', async () => {
    process.env.ENVIRONMENT = 'staging';
    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${STAGING_VERSION}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0', EXPO_STAGING: '1' },
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('resolves the production version by default', async () => {
    process.env.ENVIRONMENT = 'production';
    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${PRODUCTION_VERSION}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0' },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('fetches cli-versions.json only once across multiple calls', async () => {
    process.env.ENVIRONMENT = 'production';
    await resolveEasCommandPrefixAndEnvAsync();
    await resolveEasCommandPrefixAndEnvAsync();
    expect(fetchEasCliVersionsAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back to the npm dist-tags and reports to Sentry when fetching cli-versions.json fails', async () => {
    const fetchError = new Error('not found');
    jest.mocked(fetchEasCliVersionsAsync).mockRejectedValue(fetchError);
    process.env.ENVIRONMENT = 'staging';
    const stagingResult = await resolveEasCommandPrefixAndEnvAsync();
    expect(stagingResult).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${EasCliNpmTags.STAGING}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0', EXPO_STAGING: '1' },
    });

    process.env.ENVIRONMENT = 'production';
    const productionResult = await resolveEasCommandPrefixAndEnvAsync();
    expect(productionResult).toEqual({
      cmd: 'npx',
      args: ['-y', `eas-cli@${EasCliNpmTags.PRODUCTION}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0' },
    });

    expect(Sentry.capture).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch cli-versions.json'),
      fetchError,
      expect.objectContaining({ level: 'warning' })
    );
  });

  it('reports a timeout-specific Sentry error when the fetch times out', async () => {
    const timeoutError = new EasCliVersionsFetchTimeoutError('https://example.com', 10_000);
    jest.mocked(fetchEasCliVersionsAsync).mockRejectedValue(timeoutError);
    process.env.ENVIRONMENT = 'production';

    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result.args).toContain(`eas-cli@${EasCliNpmTags.PRODUCTION}`);

    expect(Sentry.capture).toHaveBeenCalledWith(
      expect.stringContaining('Timed out fetching cli-versions.json'),
      timeoutError,
      expect.objectContaining({ level: 'warning' })
    );
  });

  it('omits -y when npm is older than v7', async () => {
    jest.mocked(isAtLeastNpm7Async).mockResolvedValueOnce(false);
    process.env.ENVIRONMENT = 'production';
    const result = await resolveEasCommandPrefixAndEnvAsync();
    expect(result).toEqual({
      cmd: 'npx',
      args: [`eas-cli@${PRODUCTION_VERSION}`],
      extraEnv: { NPM_CONFIG_MIN_RELEASE_AGE: '0' },
    });
  });

  it('disables the minimum release age for every npx invocation', async () => {
    process.env.ENVIRONMENT = 'production';

    const result = await resolveEasCommandPrefixAndEnvAsync();

    expect(result.extraEnv).toEqual({ NPM_CONFIG_MIN_RELEASE_AGE: '0' });
  });
});

describe(runEasCliCommand, () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  beforeEach(() => {
    resetCachedEasCliVersionsForTest();
    jest.mocked(spawn).mockReset();
    jest.mocked(fetchEasCliVersionsAsync).mockReset();
    jest.mocked(fetchEasCliVersionsAsync).mockResolvedValue({
      STAGING: STAGING_VERSION,
      PRODUCTION: PRODUCTION_VERSION,
    });
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
      expect.arrayContaining([`eas-cli@${STAGING_VERSION}`, 'deploy', '--json']),
      expect.objectContaining({
        cwd: '/tmp/project',
        env: expect.objectContaining({
          FOO: 'bar',
          EXPO_STAGING: '1',
        }),
      })
    );
  });

  it('overrides a user-provided minimum release age', async () => {
    process.env.ENVIRONMENT = 'production';

    await runEasCliCommand({
      args: ['deploy', '--json'],
      options: {
        cwd: '/tmp/project',
        env: {
          FOO: 'bar',
          NPM_CONFIG_MIN_RELEASE_AGE: '365',
        },
      },
    });

    const spawnEnv = jest.mocked(spawn).mock.calls[0][2]?.env;
    expect(spawnEnv).toEqual({
      FOO: 'bar',
      NPM_CONFIG_MIN_RELEASE_AGE: '0',
    });
  });
});
