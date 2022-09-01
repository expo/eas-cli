import { CredentialsSource } from '@expo/eas-json';
import { vol } from 'memfs';

import { IosAppBuildCredentialsFragment } from '../../../graphql/generated';
import { findApplicationTarget } from '../../../project/ios/target';
import { getAppstoreMock } from '../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../__tests__/fixtures-ios';
import IosCredentialsProvider from '../IosCredentialsProvider';
import { getAppLookupParamsFromContext } from '../actions/BuildCredentialsUtils';

jest.mock('fs');
jest.mock('../validators/validateProvisioningProfile', () => ({
  validateProvisioningProfileAsync: async (
    _ctx: any,
    _target: any,
    _app: any,
    buildCredentials: Partial<IosAppBuildCredentialsFragment> | null
  ): Promise<boolean> => {
    return !!(
      buildCredentials &&
      buildCredentials.distributionCertificate &&
      buildCredentials.provisioningProfile
    );
  },
}));
jest.mock('../../../project/ios/bundleIdentifier');

beforeEach(() => {
  vol.reset();
});

describe(IosCredentialsProvider, () => {
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
        const appLookupParams = getAppLookupParamsFromContext(
          ctx,
          findApplicationTarget(testTargets)
        );
        const provider = new IosCredentialsProvider(ctx, {
          app: {
            account: {
              id: `id-${appLookupParams.account.name}`,
              name: appLookupParams.account.name,
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
        const appLookupParams = getAppLookupParamsFromContext(
          ctx,
          findApplicationTarget(testTargets)
        );
        const provider = new IosCredentialsProvider(ctx, {
          app: {
            account: {
              id: `id-${appLookupParams.account.name}`,
              name: appLookupParams.account.name,
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
