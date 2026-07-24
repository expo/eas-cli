import { UserError } from '@expo/eas-build-job';
import { BuildWorkflow } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestIosJob } from '../../../__tests__/utils/job';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { updateVersionsAsync } from '../../utils/ios/configure';
import IosCredentialsManager, { type Credentials } from '../../utils/ios/credentials/manager';
import { DistributionType } from '../../utils/ios/credentials/provisioningProfile';
import { configureIosCredentialsFunction } from '../configureIosCredentials';
import { configureIosVersionFunction } from '../configureIosVersion';

jest.mock('../../utils/ios/configure');
jest.mock('../../utils/ios/credentials/manager');

function createCredentials({
  targetNames = ['app', 'share-extension'],
}: {
  targetNames?: string[];
} = {}): Credentials {
  return {
    applicationTargetProvisioningProfile: {} as Credentials['applicationTargetProvisioningProfile'],
    keychainPath: '/tmp/keychain',
    targetProvisioningProfiles: Object.fromEntries(
      targetNames.map(targetName => [
        targetName,
        {
          path: `/tmp/${targetName}.mobileprovision`,
          target: targetName,
          bundleIdentifier: `com.example.${targetName}`,
          teamId: 'TEAMID123',
          uuid: `${targetName}-uuid`,
          name: `${targetName} profile`,
          distributionType: DistributionType.AD_HOC,
          developerCertificate: Buffer.from('certificate'),
          certificateCommonName: `${targetName} cert`,
        },
      ])
    ),
    distributionType: DistributionType.AD_HOC,
    teamId: 'TEAMID123',
  };
}

function createRawCredentials() {
  return {
    app: {
      provisioningProfileBase64: 'cHJvZmlsZQ==',
      distributionCertificate: {
        dataBase64: 'Y2VydA==',
        password: '',
      },
    },
  };
}

function createBuildStep({
  callInputs = {},
  job = createTestIosJob(),
}: {
  callInputs?: Record<string, unknown>;
  job?: ReturnType<typeof createTestIosJob>;
} = {}) {
  return configureIosVersionFunction().createBuildStepFromFunctionCall(
    createGlobalContextMock({
      logger: createMockLogger(),
      staticContextContent: { job },
    }),
    { callInputs }
  );
}

describe(configureIosVersionFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(updateVersionsAsync).mockResolvedValue(undefined);
  });

  it('uses target_names without an explicit credentials input', async () => {
    const buildStep = createBuildStep({
      callInputs: {
        target_names: ['app', 'widget'],
        build_number: '42',
      },
    });

    await buildStep.executeAsync();

    expect(updateVersionsAsync).toHaveBeenCalledWith(
      expect.anything(),
      buildStep.ctx.workingDirectory,
      {
        buildNumber: '42',
        appVersion: undefined,
      },
      {
        targetNames: ['app', 'widget'],
        buildConfiguration: 'Release',
      }
    );
  });

  it('uses credentials only to preserve the existing fallback path', async () => {
    jest
      .spyOn(IosCredentialsManager.prototype, 'prepare')
      .mockResolvedValue(createCredentials({ targetNames: ['app', 'widget'] }));
    const buildStep = createBuildStep({
      callInputs: {
        credentials: createRawCredentials(),
        app_version: '1.2.3',
      },
    });

    await buildStep.executeAsync();

    expect(IosCredentialsManager.prototype.prepare).toHaveBeenCalledTimes(1);
    expect(updateVersionsAsync).toHaveBeenCalledWith(
      expect.anything(),
      buildStep.ctx.workingDirectory,
      {
        buildNumber: undefined,
        appVersion: '1.2.3',
      },
      {
        targetNames: ['app', 'widget'],
        buildConfiguration: 'Release',
      }
    );
  });

  it('uses the implicit credentials default fallback from the job secrets', async () => {
    const prepareSpy = jest
      .spyOn(IosCredentialsManager.prototype, 'prepare')
      .mockResolvedValue(createCredentials({ targetNames: ['app', 'widget'] }));
    const buildStep = createBuildStep({
      job: createTestIosJob({ buildCredentials: createRawCredentials() }),
      callInputs: {
        app_version: '1.2.3',
      },
    });

    await buildStep.executeAsync();

    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(updateVersionsAsync).toHaveBeenCalledWith(
      expect.anything(),
      buildStep.ctx.workingDirectory,
      {
        buildNumber: undefined,
        appVersion: '1.2.3',
      },
      {
        targetNames: ['app', 'widget'],
        buildConfiguration: 'Release',
      }
    );
  });

  it('prefers target_names when both target_names and credentials are provided', async () => {
    const prepareSpy = jest
      .spyOn(IosCredentialsManager.prototype, 'prepare')
      .mockResolvedValue(createCredentials({ targetNames: ['credentials-target'] }));
    const buildStep = createBuildStep({
      callInputs: {
        target_names: ['input-target'],
        credentials: createRawCredentials(),
        app_version: '1.2.3',
      },
    });

    await buildStep.executeAsync();

    expect(prepareSpy).not.toHaveBeenCalled();
    expect(updateVersionsAsync).toHaveBeenCalledWith(
      expect.anything(),
      buildStep.ctx.workingDirectory,
      {
        buildNumber: undefined,
        appVersion: '1.2.3',
      },
      {
        targetNames: ['input-target'],
        buildConfiguration: 'Release',
      }
    );
  });

  it('parses target_names exported by configure_ios_credentials through workflow interpolation', async () => {
    const prepareSpy = jest
      .spyOn(IosCredentialsManager.prototype, 'prepare')
      .mockResolvedValue(createCredentials({ targetNames: ['app', 'widget'] }));
    const globalCtx = createGlobalContextMock({
      logger: createMockLogger(),
      staticContextContent: {
        job: createTestIosJob({ buildCredentials: createRawCredentials() }),
      },
    });
    const configureIosCredentialsStep =
      configureIosCredentialsFunction().createBuildStepFromFunctionCall(globalCtx, {
        id: 'configure_ios_credentials',
      });
    const configureIosVersionStep = configureIosVersionFunction().createBuildStepFromFunctionCall(
      globalCtx,
      {
        callInputs: {
          target_names: '${{ steps.configure_ios_credentials.outputs.target_names }}',
          app_version: '1.2.3',
        },
      }
    );

    await new BuildWorkflow(globalCtx, {
      buildSteps: [configureIosCredentialsStep, configureIosVersionStep],
      buildFunctions: {},
    }).executeAsync();

    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(configureIosCredentialsStep.outputById.target_names.value).toBe(
      JSON.stringify(['app', 'widget'])
    );
    expect(updateVersionsAsync).toHaveBeenCalledWith(
      expect.anything(),
      configureIosVersionStep.ctx.workingDirectory,
      {
        buildNumber: undefined,
        appVersion: '1.2.3',
      },
      {
        targetNames: ['app', 'widget'],
        buildConfiguration: 'Release',
      }
    );
  });

  it('accepts an empty target_names array without crashing', async () => {
    const prepareSpy = jest.spyOn(IosCredentialsManager.prototype, 'prepare');
    const buildStep = createBuildStep({
      callInputs: {
        target_names: [],
        app_version: '1.2.3',
      },
    });

    await expect(buildStep.executeAsync()).resolves.toBeUndefined();

    expect(prepareSpy).not.toHaveBeenCalled();
    expect(updateVersionsAsync).toHaveBeenCalledWith(
      expect.anything(),
      buildStep.ctx.workingDirectory,
      {
        buildNumber: undefined,
        appVersion: '1.2.3',
      },
      {
        targetNames: [],
        buildConfiguration: 'Release',
      }
    );
  });

  it('rejects invalid target_names', async () => {
    const buildStep = createBuildStep({
      callInputs: {
        target_names: ['app', 123],
        app_version: '1.2.3',
      },
    });

    const promise = buildStep.executeAsync();
    await expect(promise).rejects.toBeInstanceOf(UserError);
    await expect(promise).rejects.toThrow('"target_names" input must be an array of strings.');
  });

  it('uses the corrected App version error text', async () => {
    const buildStep = createBuildStep({
      callInputs: {
        target_names: ['app'],
        app_version: 'invalid-semver',
      },
    });

    await expect(buildStep.executeAsync()).rejects.toThrow(
      'App version provided by the "app_version" input is not a valid semver version: invalid-semver'
    );
  });
});
