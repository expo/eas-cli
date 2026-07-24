import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestIosJob } from '../../../__tests__/utils/job';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { configureCredentialsAsync } from '../../utils/ios/configure';
import IosCredentialsManager, { type Credentials } from '../../utils/ios/credentials/manager';
import { DistributionType } from '../../utils/ios/credentials/provisioningProfile';
import { configureIosCredentialsFunction } from '../configureIosCredentials';

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

describe(configureIosCredentialsFunction, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(configureCredentialsAsync).mockResolvedValue(undefined);
  });

  it('exports target_names from prepared credentials', async () => {
    jest
      .spyOn(IosCredentialsManager.prototype, 'prepare')
      .mockResolvedValue(createCredentials({ targetNames: ['app', 'widget'] }));

    const buildStep = configureIosCredentialsFunction().createBuildStepFromFunctionCall(
      createGlobalContextMock({
        logger: createMockLogger(),
        staticContextContent: { job: createTestIosJob() },
      }),
      {
        callInputs: {
          credentials: createRawCredentials(),
        },
      }
    );

    await buildStep.executeAsync();

    expect(configureCredentialsAsync).toHaveBeenCalled();
    expect(buildStep.outputById.target_names.value).toBe(JSON.stringify(['app', 'widget']));
  });
});
