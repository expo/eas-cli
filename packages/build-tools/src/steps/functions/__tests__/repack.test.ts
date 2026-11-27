import { type Android, type Ios } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { repackAppAndroidAsync, repackAppIosAsync } from '@expo/repack-app';
import turtleSpawnAsync from '@expo/turtle-spawn';
import assert from 'node:assert';
import fg from 'fast-glob';
import { vol } from 'memfs';
import path from 'node:path';
import resolveFrom from 'resolve-from';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestAndroidJob, createTestIosJob } from '../../../__tests__/utils/job';
import IosCredentialsManager from '../../utils/ios/credentials/manager';
import ProvisioningProfile, {
  DistributionType,
} from '../../utils/ios/credentials/provisioningProfile';
import {
  createRepackBuildFunction,
  resolveAndroidSigningOptionsAsync,
  resolveIosSigningOptionsAsync,
} from '../repack';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@expo/repack-app');
jest.mock('resolve-from', () => jest.fn(() => '@expo/repack-app'));
jest.mock('../../utils/ios/credentials/manager');

describe(createRepackBuildFunction, () => {
  beforeEach(() => {
    jest.mocked(turtleSpawnAsync).mockImplementation((async (_command: string, args: string[]) => {
      const sandbox = args[args.indexOf('--prefix') + 1];
      const packageName = args[args.length - 1].replace(/@[^@/]*$/, '');
      vol.fromJSON({
        [path.join(sandbox, 'node_modules', packageName, 'package.json')]: JSON.stringify({
          version: '2.0.0-next.1',
        }),
      });
    }) as unknown as typeof turtleSpawnAsync);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    vol.reset();
  });

  it('installs the repack package with npm in a sandbox whose env is only PATH and HOME, through the npm cache registry', async () => {
    const globalCtx = createGlobalContextMock({
      staticContextContent: {
        job: {},
      },
    });
    globalCtx.updateEnv({
      PATH: '/usr/local/bin:/usr/bin',
      EAS_BUILD_NPM_CACHE_URL: 'https://npm-cache.expo.test',
      NPM_TOKEN: 'secret',
    });
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        platform: 'ios',
        source_app_path: '/path/to/source_app.ipa',
        repack_package: '@scope/fork',
        repack_version: 'next',
      },
    });
    const logInfo = jest.spyOn(repackStep.ctx.logger, 'info');

    await repackStep.executeAsync();

    const [installCall] = jest.mocked(turtleSpawnAsync).mock.calls;
    const npmEnv = installCall[2]?.env;
    assert(npmEnv);
    expect(Object.keys(npmEnv).sort()).toEqual(['HOME', 'PATH']);
    expect(npmEnv.PATH).toMatch(/\/usr\/local\/bin:\/usr\/bin$/);
    expect(installCall).toEqual([
      'npm',
      [
        'install',
        '--prefix',
        npmEnv.HOME,
        '--no-save',
        '--package-lock=false',
        '--no-audit',
        '--no-fund',
        '--no-update-notifier',
        '--registry',
        'https://npm-cache.expo.test',
        '@scope/fork@next',
      ],
      { env: npmEnv, logger: repackStep.ctx.logger },
    ]);
    expect(logInfo).toHaveBeenCalledWith('Using repack from: @scope/fork@next (2.0.0-next.1)');
    expect(resolveFrom).toHaveBeenCalledWith(npmEnv.HOME, '@scope/fork');
  });

  it('installs the repack package from the default registry when the job has no npm cache', async () => {
    const globalCtx = createGlobalContextMock({
      staticContextContent: {
        job: {},
      },
    });
    globalCtx.updateEnv({ PATH: '/usr/local/bin:/usr/bin' });
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        platform: 'ios',
        source_app_path: '/path/to/source_app.ipa',
      },
    });

    await repackStep.executeAsync();

    const [installCall] = jest.mocked(turtleSpawnAsync).mock.calls;
    expect(installCall[1]).not.toContain('--registry');
  });

  it('should set generated output path for successful repack', async () => {
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        staticContextContent: {
          job: {},
        },
      }),
      {
        callInputs: {
          platform: 'ios',
          source_app_path: '/path/to/source_app.ipa',
        },
      }
    );

    await repackStep.executeAsync();
    expect(repackStep.outputById['output_path'].value).toMatch(/repacked-.*\.ipa$/);
  });

  it('should rename generated aab output path to apk', async () => {
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        staticContextContent: {
          job: createTestAndroidJob(),
        },
      }),
      {
        callInputs: {
          platform: 'android',
          source_app_path: '/path/to/source_app.aab',
        },
      }
    );

    await repackStep.executeAsync();
    expect(repackStep.outputById['output_path'].value).toMatch(/repacked-.*\.apk$/);
  });

  it('should throw for unsupported platforms', async () => {
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        staticContextContent: {
          job: {},
        },
      }),
      {
        callInputs: {
          platform: 'unknown',
          source_app_path: '/path/to/source_app',
        },
      }
    );

    await expect(repackStep.executeAsync()).rejects.toThrow(/Unsupported platform/);
  });

  it('should cleanup android keystore files after execution', async () => {
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        staticContextContent: {
          job: createTestAndroidJob(),
        },
      }),
      {
        callInputs: {
          platform: 'android',
          source_app_path: '/path/to/source_app',
        },
      }
    );

    await repackStep.executeAsync();
    const tmpDir = path.dirname(repackStep.outputById['output_path'].value as string);
    const keystoreFiles = await fg(`${tmpDir}/keystore*`, { onlyFiles: true });
    expect(keystoreFiles.length).toBe(0);
  });

  it('passes the iOS version from the job to repack', async () => {
    const version: Ios.Job['version'] = { buildNumber: '3011', appVersion: '1.2.3' };
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        staticContextContent: {
          job: { version },
        },
      }),
      {
        callInputs: {
          platform: 'ios',
          source_app_path: '/path/to/source_app.ipa',
        },
      }
    );

    await repackStep.executeAsync();

    expect(repackAppIosAsync).toHaveBeenCalledWith(
      expect.objectContaining({ appVersion: '1.2.3', appBuildVersion: '3011' })
    );
  });

  it('passes the Android version from the job to repack', async () => {
    const version: Android.Job['version'] = { versionCode: '296', versionName: '1.2.3' };
    const repack = createRepackBuildFunction();
    const repackStep = repack.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        staticContextContent: {
          job: { version },
        },
      }),
      {
        callInputs: {
          platform: 'android',
          source_app_path: '/path/to/source_app.apk',
        },
      }
    );

    await repackStep.executeAsync();

    expect(repackAppAndroidAsync).toHaveBeenCalledWith(
      expect.objectContaining({ appVersion: '1.2.3', appBuildVersion: '296' })
    );
  });

  it.each([
    { platform: 'ios', repackAppAsync: repackAppIosAsync },
    { platform: 'android', repackAppAsync: repackAppAndroidAsync },
  ])(
    'passes no version to repack when the $platform job has none',
    async ({ platform, repackAppAsync }) => {
      const repack = createRepackBuildFunction();
      const repackStep = repack.createBuildStepFromFunctionCall(
        createGlobalContextMock({
          staticContextContent: {
            job: {},
          },
        }),
        {
          callInputs: {
            platform,
            source_app_path: '/path/to/source_app',
          },
        }
      );

      await repackStep.executeAsync();

      const [[options]] = jest.mocked(repackAppAsync).mock.calls;
      expect(options).not.toHaveProperty('appVersion');
      expect(options).not.toHaveProperty('appBuildVersion');
    }
  );
});

describe(resolveAndroidSigningOptionsAsync, () => {
  afterEach(() => {
    jest.restoreAllMocks();
    vol.reset();
  });

  it('should resolve android signing options', async () => {
    const job = createTestAndroidJob();
    const tmpDir = '/tmp';
    vol.mkdirSync(tmpDir, { recursive: true });
    const signingOptions = await resolveAndroidSigningOptionsAsync({
      job,
      tmpDir: '/tmp',
    });

    expect(signingOptions).not.toBeNull();
    expect(signingOptions?.keyStorePath).toMatch(/\/tmp\/keystore/);
    expect(signingOptions?.keyStorePassword).toEqual(
      `pass:${job.secrets?.buildCredentials?.keystore.keystorePassword}`
    );
    expect(signingOptions?.keyAlias).toEqual(job.secrets?.buildCredentials?.keystore.keyAlias);
    expect(signingOptions?.keyPassword).toEqual(
      `pass:${job.secrets?.buildCredentials?.keystore.keyPassword}`
    );
  });

  it('should return undefined if no build credentials are provided', async () => {
    // @ts-expect-error: createTestAndroidJob does not support buildCredentials as null
    const job = createTestAndroidJob({ buildCredentials: null });
    const signingOptions = await resolveAndroidSigningOptionsAsync({
      job,
      tmpDir: '/tmp',
    });
    expect(signingOptions).toBeUndefined();
  });
});

describe(resolveIosSigningOptionsAsync, () => {
  afterEach(() => {
    jest.restoreAllMocks();
    vol.reset();
  });

  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as bunyan;

  it('should resolve ios signing options', async () => {
    const job = createTestIosJob();
    const credentialsManagerSpy = jest.spyOn(IosCredentialsManager.prototype, 'prepare');
    const mockProvisioningProfile = new ProvisioningProfile(
      Buffer.from('test-profile'),
      '/tmp/ios_provisioning_profile',
      'testapp',
      'Test App Certificate'
    );
    const provisioningProfileData = {
      path: '/tmp/ios_provisioning_profile',
      target: 'testapp',
      bundleIdentifier: 'com.example.testapp',
      teamId: 'TEAMID123',
      uuid: 'UUID123',
      name: 'Test App Provisioning Profile',
      distributionType: DistributionType.AD_HOC,
      developerCertificate: Buffer.from('test-developer-certificate'),
      certificateCommonName: 'Test App Certificate',
    };
    jest.spyOn(mockProvisioningProfile, 'data', 'get').mockReturnValue(provisioningProfileData);
    credentialsManagerSpy.mockResolvedValue({
      applicationTargetProvisioningProfile: mockProvisioningProfile,
      keychainPath: '/tmp/ios_keychain',
      targetProvisioningProfiles: {
        testapp: provisioningProfileData,
      },
      distributionType: DistributionType.AD_HOC,
      teamId: 'TEAMID123',
    });

    const signingOptions = await resolveIosSigningOptionsAsync({
      job,
      logger: mockLogger,
      tmpDir: '/tmp',
    });

    expect(signingOptions).not.toBeNull();
    expect(signingOptions).toMatchObject({
      keychainPath: '/tmp/ios_keychain',
      signingIdentity: 'Test App Certificate',
      provisioningProfile: {
        'com.example.testapp': '/tmp/ios_provisioning_profile',
      },
    });
  });

  it('should resolve zsign signing options without touching the keychain', async () => {
    const job = createTestIosJob();
    const tmpDir = '/tmp';
    vol.mkdirSync(tmpDir, { recursive: true });
    const credentialsManagerSpy = jest.spyOn(IosCredentialsManager.prototype, 'prepare');

    const signingOptions = await resolveIosSigningOptionsAsync({
      job,
      logger: mockLogger,
      backend: 'zsign',
      tmpDir,
    });

    expect(credentialsManagerSpy).not.toHaveBeenCalled();
    expect(signingOptions).toMatchObject({
      backend: 'zsign',
      keyPassword: job.secrets?.buildCredentials?.['testapp'].distributionCertificate.password,
    });
    assert(signingOptions?.backend === 'zsign');
    expect(signingOptions.certificatePath).toMatch(/\/tmp\/dist-cert-.*\.p12/);
    expect(vol.existsSync(signingOptions.certificatePath)).toBe(true);
    assert(typeof signingOptions.provisioningProfile === 'object');
    const profilePath = signingOptions.provisioningProfile['testapp'];
    expect(profilePath).toMatch(/\/tmp\/profile-testapp-.*\.mobileprovision/);
    expect(vol.existsSync(profilePath)).toBe(true);
  });

  it('should return undefined if no build credentials are provided', async () => {
    // @ts-expect-error: createTestIosJob does not support buildCredentials as null
    const job = createTestIosJob({ buildCredentials: null });
    const signingOptions = await resolveIosSigningOptionsAsync({
      job,
      logger: mockLogger,
      tmpDir: '/tmp',
    });
    expect(signingOptions).toBeUndefined();
  });

  it('should return undefined if the job is for a simulator', async () => {
    const job = createTestIosJob();
    job.simulator = true; // Simulate a job for the iOS simulator
    const signingOptions = await resolveIosSigningOptionsAsync({
      job,
      logger: mockLogger,
      tmpDir: '/tmp',
    });
    expect(signingOptions).toBeUndefined();
  });
});
