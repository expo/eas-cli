import { CredentialsSource } from '@expo/eas-json';
import { vol } from 'memfs';

import { IosAppBuildCredentialsFragment } from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../project/ios/target';
import { getAppstoreMock } from '../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../__tests__/fixtures-constants';
import { createCtxMock } from '../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../__tests__/fixtures-ios';
import IosCredentialsProvider from '../IosCredentialsProvider';
import { getAppLookupParamsFromContextAsync } from '../actions/BuildCredentialsUtils';

jest.mock('fs');
jest.mock('../validators/validateProvisioningProfile', () => ({
  validateProvisioningProfileAsync: async (
    _ctx: any,
    _target: any,
    _app: any,
    buildCredentials: Partial<IosAppBuildCredentialsFragment> | null
  ): Promise<boolean> => {
    return !!(buildCredentials?.distributionCertificate && buildCredentials.provisioningProfile);
  },
}));
jest.mock('../../../project/ios/bundleIdentifier');
jest.mock('../../../graphql/queries/AppQuery');

beforeEach(() => {
  vol.reset();
});

describe(IosCredentialsProvider, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  describe('#getCredentialsAsync', () => {
    describe('remote credentials', () => {
      it('throws an error if credentials do not exist', async () => {
        const ctx = createCtxMock({
          nonInteractive: true,
          appStore: getAppstoreMock(),
          projectDir: '/app',
          ios: {
            ...getNewIosApiMock(),
            getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => null),
          },
        });
        const appLookupParams = await getAppLookupParamsFromContextAsync(
          ctx,
          findApplicationTarget(testTargets)
        );
        const provider = new IosCredentialsProvider(ctx, {
          app: {
            account: {
              id: `id-${appLookupParams.account.name}`,
              name: appLookupParams.account.name,
              users: [],
            },
            projectName: appLookupParams.projectName,
          },
          targets: [
            {
              targetName: 'testapp',
              bundleIdentifier: appLookupParams.bundleIdentifier,
              entitlements: {},
            },
          ],
          distribution: 'store',
        });
        await expect(provider.getCredentialsAsync(CredentialsSource.REMOTE)).rejects.toThrowError(
          /Credentials are not set up/
        );
      });

      it('returns credentials if they exist', async () => {
        const ctx = createCtxMock({
          nonInteractive: true,
          appStore: getAppstoreMock(),
          projectDir: '/app',
          ios: {
            ...getNewIosApiMock(),
            getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
              () => testCommonIosAppCredentialsFragment
            ),
            getDistributionCertificateForAppAsync: jest.fn(
              () =>
                testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0]
                  .distributionCertificate
            ),
          },
        });
        const appLookupParams = await getAppLookupParamsFromContextAsync(
          ctx,
          findApplicationTarget(testTargets)
        );
        const provider = new IosCredentialsProvider(ctx, {
          app: {
            account: {
              id: `id-${appLookupParams.account.name}`,
              name: appLookupParams.account.name,
              users: [],
            },
            projectName: appLookupParams.projectName,
          },
          targets: [
            {
              targetName: 'testapp',
              bundleIdentifier: appLookupParams.bundleIdentifier,
              entitlements: {},
            },
          ],
          distribution: 'store',
        });

        const buildCredentials = testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0];
        await expect(provider.getCredentialsAsync(CredentialsSource.REMOTE)).resolves.toMatchObject(
          {
            testapp: {
              distributionCertificate: {
                certificateP12: buildCredentials.distributionCertificate?.certificateP12,
                certificatePassword: buildCredentials.distributionCertificate?.certificatePassword,
              },
              provisioningProfile: buildCredentials.provisioningProfile?.provisioningProfile,
            },
          }
        );
      });
    });
  });
});
