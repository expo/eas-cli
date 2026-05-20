import { Env } from '@expo/eas-build-job';
import { EasJson } from '@expo/eas-json';

import { Analytics } from '../../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { Account, IosAppBuildCredentialsFragment } from '../../../../graphql/generated';
import { Actor } from '../../../../user/User';
import { Client } from '../../../../vcs/vcs';
import { CredentialsContext, CredentialsContextProjectInfo } from '../../../context';
import { SetUpAdhocProvisioningProfile } from '../SetUpAdhocProvisioningProfile';
import { SetUpInternalProvisioningProfile } from '../SetUpInternalProvisioningProfile';
import { SetUpTargetBuildCredentials } from '../SetUpTargetBuildCredentials';

jest.mock('../SetUpAdhocProvisioningProfile', () => ({
  SetUpAdhocProvisioningProfile: jest.fn(),
}));
jest.mock('../SetUpInternalProvisioningProfile', () => ({
  SetUpInternalProvisioningProfile: jest.fn(),
}));
jest.mock('../../../context');

describe(SetUpTargetBuildCredentials, () => {
  const app = {
    account: { name: 'account' } as Account,
    projectName: 'projName',
    bundleIdentifier: 'bundleId',
  };
  const target = { targetName: 'targetName', bundleIdentifier: 'bundleId', entitlements: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(SetUpAdhocProvisioningProfile).mockImplementation(
      () =>
        ({
          runAsync: jest.fn().mockResolvedValue({} as IosAppBuildCredentialsFragment),
        }) as any
    );
    jest.mocked(SetUpInternalProvisioningProfile).mockImplementation(
      () =>
        ({
          runAsync: jest.fn().mockResolvedValue({} as IosAppBuildCredentialsFragment),
        }) as any
    );
  });

  function createCtx(overrides: Partial<CredentialsContext> = {}): CredentialsContext {
    const ctx = jest.mocked(
      new CredentialsContext(
        {} as {
          projectInfo: CredentialsContextProjectInfo | null;
          easJsonCliConfig?: EasJson['cli'];
          nonInteractive: boolean;
          projectDir: string;
          user: Actor;
          graphqlClient: ExpoGraphqlClient;
          analytics: Analytics;
          env?: Env;
          vcsClient: Client;
        }
      )
    );
    Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', {
      value: true,
      writable: true,
    });
    return Object.assign(ctx, overrides);
  }

  it('errors when refresh is enabled for store distribution builds', async () => {
    const action = new SetUpTargetBuildCredentials({
      app,
      distribution: 'store',
      entitlements: {},
      target,
    });

    await expect(action.setupBuildCredentialsAsync(createCtx())).rejects.toThrow(
      '--refresh-ad-hoc-provisioning-profile is only supported for internal distribution builds.'
    );
  });

  it('errors when refresh is enabled for universal enterprise internal builds', async () => {
    const action = new SetUpTargetBuildCredentials({
      app,
      distribution: 'internal',
      enterpriseProvisioning: 'universal',
      entitlements: {},
      target,
    });

    await expect(action.setupBuildCredentialsAsync(createCtx())).rejects.toThrow(
      '--refresh-ad-hoc-provisioning-profile is only supported for ad-hoc internal builds.'
    );
  });

  it('delegates to internal provisioning setup when refresh is enabled for internal ad-hoc builds', async () => {
    const action = new SetUpTargetBuildCredentials({
      app,
      distribution: 'internal',
      entitlements: {},
      target,
    });
    const ctx = createCtx();

    await action.setupBuildCredentialsAsync(ctx);

    expect(SetUpInternalProvisioningProfile).toHaveBeenCalledWith({ app, target });
    expect(SetUpAdhocProvisioningProfile).not.toHaveBeenCalled();
  });
});
