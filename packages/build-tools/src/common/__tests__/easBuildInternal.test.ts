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

  it('passes --refresh-ad-hoc-provisioning-profile to build:internal for iOS jobs with refreshAdHocProvisioningProfile', async () => {
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
      refreshAdHocProvisioningProfile: true,
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

  it('preserves refreshAdHocProvisioningProfile from the incoming job', async () => {
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
      refreshAdHocProvisioningProfile: true,
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

    expect((newJob as any).refreshAdHocProvisioningProfile).toBe(true);
  });

  describe('hooks retention', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() } as any;
    const originalHooks = { before_install_node_modules: [{ run: 'echo original' }] };

    function mockRegeneratedJob(hooks?: object): void {
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
        ...(hooks ? { hooks } : null),
      };
      jest.mocked(spawn).mockResolvedValue({
        stdout: Buffer.from(JSON.stringify({ job: internalJob, metadata: {} })),
        stderr: Buffer.from(''),
      } as any);
    }

    function runWith(jobHooks?: object): Promise<{ newJob: BuildJob }> {
      const job = {
        platform: Platform.IOS,
        buildProfile: 'preview',
        appId: 'app-id',
        initiatingUserId: 'user-id',
        secrets: { robotAccessToken: 'token' },
        ...(jobHooks ? { hooks: jobHooks } : null),
      } as unknown as BuildJob;
      return runEasBuildInternalAsync({ job, logger, env: {}, cwd: '/tmp/project' });
    }

    it('keeps the original hooks when the regenerated job has none', async () => {
      mockRegeneratedJob();
      const { newJob } = await runWith(originalHooks);
      expect((newJob as any).hooks).toEqual(originalHooks);
    });

    it('lets the original hooks win over hooks in the regenerated job', async () => {
      mockRegeneratedJob({ after_install_node_modules: [{ run: 'echo from-eas-json' }] });
      const { newJob } = await runWith(originalHooks);
      expect((newJob as any).hooks).toEqual(originalHooks);
    });

    it('carries no hooks when the original had none, even if the regenerated job adds some', async () => {
      mockRegeneratedJob({ before_install_node_modules: [{ run: 'echo from-eas-json' }] });
      const { newJob } = await runWith(undefined);
      expect((newJob as any).hooks).toBeUndefined();
    });
  });
});
