import { CredentialsSource } from '@expo/eas-json';
import { vol } from 'memfs';

import { getAppstoreMock } from '../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../__tests__/fixtures-context';
import { testIosAppCredentialsWithBuildCredentialsQueryResult } from '../../__tests__/fixtures-ios';
import { getNewIosApiMockWithoutCredentials } from '../../__tests__/fixtures-new-ios';
import IosCredentialsProvider from '../IosCredentialsProvider';
import { getAppLookupParamsFromContext } from '../actions/new/BuildCredentialsUtils';

jest.mock('fs');

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

beforeEach(() => {
  vol.reset();
});

describe(IosCredentialsProvider, () => {
  describe('#hasRemoteAsync', () => {
    it('returns false when distribution === internal and there are local credentials', async () => {
      vol.fromJSON(
        {
          './credentials.json': JSON.stringify({
            ios: {
              provisioningProfilePath: './ios/certs/profile.mobileprovision',
              distributionCertificate: {
                path: './ios/certs/cert.p12',
                password: 'cert-password',
              },
            },
          }),
        },
        '/app'
      );
      const ctx = createCtxMock({
        nonInteractive: false,
        appStore: getAppstoreMock(),
        projectDir: '/app',
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
        distribution: 'internal',
      });
      await expect(provider.hasRemoteAsync()).resolves.toBe(false);
    });

    it('returns true when there are remote credentials', async () => {
      const ctx = createCtxMock({
        nonInteractive: false,
        appStore: getAppstoreMock(),
        projectDir: '/app',
        newIos: {
          ...getNewIosApiMockWithoutCredentials(),
          getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
            () => testIosAppCredentialsWithBuildCredentialsQueryResult
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
      await expect(provider.hasRemoteAsync()).resolves.toBe(true);
    });
  });

  describe('#getCredentialsAsync', () => {
    describe('remote credentials', () => {
      it('throws an error is credentials do not exist', async () => {
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: getAppstoreMock(),
          projectDir: '/app',
          newIos: {
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
          skipCredentialsCheck: true,
        });

        await expect(provider.getCredentialsAsync(CredentialsSource.REMOTE)).rejects.toThrowError();
      });

      it('returns credentials if they exist', async () => {
        const ctx = createCtxMock({
          nonInteractive: false,
          appStore: getAppstoreMock(),
          projectDir: '/app',
          newIos: {
            ...getNewIosApiMockWithoutCredentials(),
            getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
              () => testIosAppCredentialsWithBuildCredentialsQueryResult
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
          skipCredentialsCheck: true,
        });

        const buildCredentials =
          testIosAppCredentialsWithBuildCredentialsQueryResult.iosAppBuildCredentialsArray[0];
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
