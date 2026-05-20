import { ArchiveSourceType, BuildJob, Platform, Workflow } from '@expo/eas-build-job';
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
    jest.clearAllMocks();
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

  it('passes --refresh-ad-hoc-provisioning-profile to build:internal for iOS jobs with refresh_ad_hoc_provisioning_profile', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    } as any;

    const internalJob = {
      platform: Platform.IOS,
      type: Workflow.GENERIC,
      triggeredBy: 'EAS_CLI',
      projectArchive: { type: ArchiveSourceType.URL, url: 'https://example.com' },
      projectRootDirectory: '.',
      secrets: {
        buildCredentials: {
          testapp: {
            distributionCertificate: {
              dataBase64: 'YmluYXJ5Y29udGVudDE=',
              password: 'distCertPassword',
            },
            provisioningProfileBase64: 'MnRuZXRub2N5cmFuaWI=',
          },
        },
      },
      initiatingUserId: 'user-id',
      appId: 'app-id',
    };

    jest.mocked(spawn).mockResolvedValue({
      stdout: Buffer.from(
        JSON.stringify({
          job: internalJob,
          metadata: {},
        })
      ),
      stderr: Buffer.from(''),
    } as any);

    const job = {
      platform: Platform.IOS,
      buildProfile: 'preview',
      refresh_ad_hoc_provisioning_profile: true,
      appId: 'app-id',
      initiatingUserId: 'user-id',
      secrets: { robotAccessToken: 'token' },
    } as unknown as BuildJob;

    await runEasBuildInternalAsync({
      job,
      logger,
      env: {},
      cwd: '/tmp/project',
    });

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining([
        'build:internal',
        '--platform',
        Platform.IOS,
        '--profile',
        'preview',
        '--refresh-ad-hoc-provisioning-profile',
      ]),
      expect.any(Object)
    );
  });

  it('preserves refresh_ad_hoc_provisioning_profile from the incoming job', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    } as any;

    const internalJob = {
      platform: Platform.IOS,
      type: Workflow.GENERIC,
      triggeredBy: 'EAS_CLI',
      projectArchive: { type: ArchiveSourceType.URL, url: 'https://example.com' },
      projectRootDirectory: '.',
      secrets: {
        buildCredentials: {
          testapp: {
            distributionCertificate: {
              dataBase64: 'YmluYXJ5Y29udGVudDE=',
              password: 'distCertPassword',
            },
            provisioningProfileBase64: 'MnRuZXRub2N5cmFuaWI=',
          },
        },
      },
      initiatingUserId: 'user-id',
      appId: 'app-id',
    };

    jest.mocked(spawn).mockResolvedValue({
      stdout: Buffer.from(
        JSON.stringify({
          job: internalJob,
          metadata: {},
        })
      ),
      stderr: Buffer.from(''),
    } as any);

    const job = {
      platform: Platform.IOS,
      buildProfile: 'preview',
      refresh_ad_hoc_provisioning_profile: true,
      appId: 'app-id',
      initiatingUserId: 'user-id',
      secrets: { robotAccessToken: 'token' },
    } as unknown as BuildJob;

    const { newJob } = await runEasBuildInternalAsync({
      job,
      logger,
      env: {},
      cwd: '/tmp/project',
    });

    expect((newJob as any).refresh_ad_hoc_provisioning_profile).toBe(true);
  });
});
