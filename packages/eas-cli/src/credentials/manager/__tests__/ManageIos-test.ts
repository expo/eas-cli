import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { IosDistributionType } from '../../../graphql/generated';
import { Actor } from '../../../user/User';
import { Client } from '../../../vcs/vcs';
import { jester, testSlug } from '../../__tests__/fixtures-constants';
import { createCtxMock } from '../../__tests__/fixtures-context';
import { testTargets } from '../../__tests__/fixtures-ios';
import { CredentialsContext, CredentialsContextProjectInfo } from '../../context';
import { getAppLookupParamsFromContextAsync } from '../../ios/actions/BuildCredentialsUtils';
import { SetUpPushKey } from '../../ios/actions/SetUpPushKey';
import { UpdateCredentialsJson } from '../../ios/actions/UpdateCredentialsJson';
import { AppLookupParams } from '../../ios/api/graphql/types/AppLookupParams';
import { App, Target } from '../../ios/types';
import { IosActionType } from '../Actions';
import { Action } from '../HelperActions';
import { ManageIos } from '../ManageIos';

jest.mock('../../ios/actions/AscApiKeyUtils', () => ({
  ...jest.requireActual('../../ios/actions/AscApiKeyUtils'),
  selectAscApiKeysFromAccountAsync: jest.fn(),
}));
jest.mock('../../ios/actions/AssignAscApiKey');
jest.mock('../../ios/actions/AssignPushKey');
jest.mock('../../ios/actions/BuildCredentialsUtils');
jest.mock('../../ios/actions/CreateAscApiKey');
jest.mock('../../ios/actions/CreatePushKey');
jest.mock('../../ios/actions/PushKeyUtils');
jest.mock('../../ios/actions/SetUpAscApiKey');
jest.mock('../../ios/actions/SetUpPushKey');
jest.mock('../../ios/actions/UpdateCredentialsJson');

const testIosAppLookupParams: AppLookupParams = {
  account: jester.accounts[0],
  projectName: testSlug,
  bundleIdentifier: testTargets[0].bundleIdentifier,
};

const testApp: App = {
  account: jester.accounts[0],
  projectName: testSlug,
};

const simulatorBuildProfile = {
  distribution: 'internal',
  simulator: true,
} as BuildProfile<Platform.IOS>;

class ManageIosForTesting extends ManageIos {
  public async runProjectSpecificActionForTestingAsync(
    ctx: CredentialsContext,
    app: App,
    targets: Target[],
    buildProfile: BuildProfile<Platform.IOS>,
    action: IosActionType
  ): Promise<void> {
    await this.runProjectSpecificActionAsync(ctx, app, targets, buildProfile, action);
  }
}

function createManageIos(): ManageIosForTesting {
  return new ManageIosForTesting(
    {
      projectInfo: {} as CredentialsContextProjectInfo,
      actor: {} as Actor,
      graphqlClient: {} as ExpoGraphqlClient,
      analytics: {} as Analytics,
      vcsClient: {} as Client,
      getDynamicPrivateProjectConfigAsync: jest.fn().mockResolvedValue({ exp: {}, projectId: '' }),
      runAsync: jest.fn(),
    } as Action,
    ''
  );
}

describe('runProjectSpecificActionAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAppLookupParamsFromContextAsync).mockResolvedValue(testIosAppLookupParams);
  });

  it('sets up a push key for a build profile with a simulator distribution', async () => {
    // Push keys are app-level credentials and do not depend on the build distribution type,
    // so they must be configurable from a build profile with `ios.simulator: true`.
    // See: https://github.com/expo/eas-cli/issues/4109
    jest.mocked(SetUpPushKey.prototype.isPushKeySetupAsync).mockResolvedValue(false);
    const ctx = createCtxMock({ nonInteractive: false });

    await createManageIos().runProjectSpecificActionForTestingAsync(
      ctx,
      testApp,
      [testTargets[0]],
      simulatorBuildProfile,
      IosActionType.SetUpPushKey
    );

    expect(jest.mocked(SetUpPushKey)).toHaveBeenCalledWith(testIosAppLookupParams);
    expect(jest.mocked(SetUpPushKey.prototype.runAsync)).toHaveBeenCalledWith(ctx);
  });

  // Every project-scoped action that never reads a distribution type. Managing these credentials
  // must not be blocked by a build profile with `ios.simulator: true`.
  it.each([
    ['SetUpPushKey', IosActionType.SetUpPushKey],
    ['CreatePushKey', IosActionType.CreatePushKey],
    ['UseExistingPushKey', IosActionType.UseExistingPushKey],
    ['SetUpAscApiKeyForSubmissions', IosActionType.SetUpAscApiKeyForSubmissions],
    ['UseExistingAscApiKeyForSubmissions', IosActionType.UseExistingAscApiKeyForSubmissions],
    ['CreateAscApiKeyForSubmissions', IosActionType.CreateAscApiKeyForSubmissions],
  ])(
    'does not require a distribution type for %s on a simulator build profile',
    async (_name, action) => {
      const ctx = createCtxMock({ nonInteractive: false });

      await expect(
        createManageIos().runProjectSpecificActionForTestingAsync(
          ctx,
          testApp,
          [testTargets[0]],
          simulatorBuildProfile,
          action
        )
      ).resolves.not.toThrow();
    }
  );

  it('still resolves the distribution type for actions that need it', async () => {
    const buildProfile = {
      distribution: 'store',
    } as BuildProfile<Platform.IOS>;
    const ctx = createCtxMock({ nonInteractive: false });
    const targets = [testTargets[0]];

    await createManageIos().runProjectSpecificActionForTestingAsync(
      ctx,
      testApp,
      targets,
      buildProfile,
      IosActionType.UpdateCredentialsJson
    );

    expect(jest.mocked(UpdateCredentialsJson)).toHaveBeenCalledWith(
      testApp,
      targets,
      IosDistributionType.AppStore
    );
  });

  it('still rejects a simulator distribution for actions that need a distribution type', async () => {
    const ctx = createCtxMock({ nonInteractive: false });

    await expect(
      createManageIos().runProjectSpecificActionForTestingAsync(
        ctx,
        testApp,
        [testTargets[0]],
        simulatorBuildProfile,
        IosActionType.UpdateCredentialsJson
      )
    ).rejects.toThrow('A simulator distribution does not require credentials to be configured.');
    expect(jest.mocked(UpdateCredentialsJson)).not.toHaveBeenCalled();
  });
});
