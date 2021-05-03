import { CredentialsSource } from '@expo/eas-json';
import { vol } from 'memfs';

import { IosAppBuildCredentialsFragment } from '../../../graphql/generated';
import { getAppstoreMock } from '../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../__tests__/fixtures-context';
import {
  getNewIosApiMockWithoutCredentials,
  testIosAppCredentialsWithBuildCredentialsQueryResult,
} from '../../__tests__/fixtures-ios';
import IosCredentialsProvider from '../IosCredentialsProvider';
import { getAppLookupParamsFromContext } from '../actions/BuildCredentialsUtils';

jest.mock('fs');
jest.mock('../validators/validateProvisioningProfile', () => ({
  validateProvisioningProfileAsync: async (
    _ctx: any,
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

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

beforeEach(() => {
  vol.reset();
});

describe(IosCredentialsProvider, () => {
  describe('#getCredentialsAsync', () => {
    describe('remote credentials', () => {
      it('throws an error is credentials do not exist', async () => {
        const ctx = createCtxMock({
          nonInteractive: true,
          appStore: getAppstoreMock(),
          projectDir: '/app',
          ios: {
            ...getNewIosApiMockWithoutCredentials(),
            getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(() => null),
          },
        });
        const appLookupParams = getAppLookupParamsFromContext(ctx);
        const provider = new IosCredentialsProvider(ctx, {
          app: {
            account: {
              id: `id-${appLookupParams.account.name}`,
              name: appLookupParams.account.name,
            },
            bundleIdentifier: appLookupParams.bundleIdentifier,
            projectName: appLookupParams.projectName,
          },
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
            ...getNewIosApiMockWithoutCredentials(),
            getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
              () => testIosAppCredentialsWithBuildCredentialsQueryResult
            ),
            getDistributionCertificateForAppAsync: jest.fn(
              () =>
                testIosAppCredentialsWithBuildCredentialsQueryResult.iosAppBuildCredentialsList[0]
                  .distributionCertificate
            ),
          },
        });
        const appLookupParams = getAppLookupParamsFromContext(ctx);
        const provider = new IosCredentialsProvider(ctx, {
          app: {
            account: {
              id: `id-${appLookupParams.account.name}`,
              name: appLookupParams.account.name,
            },
            bundleIdentifier: appLookupParams.bundleIdentifier,
            projectName: appLookupParams.projectName,
          },
          distribution: 'store',
        });

        const buildCredentials =
          testIosAppCredentialsWithBuildCredentialsQueryResult.iosAppBuildCredentialsList[0];
        await expect(provider.getCredentialsAsync(CredentialsSource.REMOTE)).resolves.toMatchObject(
          {
            distributionCertificate: {
              certP12: buildCredentials.distributionCertificate?.certificateP12,
              certPassword: buildCredentials.distributionCertificate?.certificatePassword,
            },
            provisioningProfile: buildCredentials.provisioningProfile?.provisioningProfile,
          }
        );
      });
    });
  });
});
