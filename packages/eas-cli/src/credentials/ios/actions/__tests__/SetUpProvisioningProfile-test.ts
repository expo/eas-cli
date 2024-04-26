import nullthrows from 'nullthrows';

import { IosDistributionType } from '../../../../graphql/generated';
import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testAppleAppIdentifierFragment,
  testCommonIosAppCredentialsFragment,
  testIosAppBuildCredentialsFragment,
  testTarget,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../../errors';
import { AuthenticationMode } from '../../appstore/authenticateTypes';
import { validateProvisioningProfileAsync } from '../../validators/validateProvisioningProfile';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpProvisioningProfile } from '../SetUpProvisioningProfile';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../SetUpDistributionCertificate');
jest.mock('../ConfigureProvisioningProfile');
jest.mock('../CreateProvisioningProfile');
jest.mock('../../validators/validateProvisioningProfile');
jest.mock('../../../../graphql/queries/AppQuery');

describe('SetUpProvisioningProfile', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });

  const testCases = ['NON_INTERACTIVE', 'INTERACTIVE'];
  test.each(testCases)(
    'repairs existing Provisioning Profile with bad build credentials in %s Mode',
    async mode => {
      jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
      const ctx = createCtxMock({
        nonInteractive: mode === 'NON_INTERACTIVE',
        appStore: {
          ...getAppstoreMock(),
          defaultAuthenticationMode:
            mode === 'NON_INTERACTIVE' ? AuthenticationMode.API_KEY : AuthenticationMode.USER,
          ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
          authCtx: testAuthCtx,
          listProvisioningProfilesAsync: jest.fn(() => [
            {
              provisioningProfileId: nullthrows(
                testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0]
                  .provisioningProfile
              ).developerPortalIdentifier,
            },
          ]),
        },
        ios: {
          ...getNewIosApiMock(),
          getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
          createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
          createOrUpdateIosAppBuildCredentialsAsync: jest.fn(
            () => testIosAppBuildCredentialsFragment
          ),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(
        ctx,
        findApplicationTarget(testTargets)
      );
      const setupProvisioningProfileAction = new SetUpProvisioningProfile(
        appLookupParams,
        testTarget,
        IosDistributionType.AppStore
      );
      await setupProvisioningProfileAction.runAsync(ctx);

      // expect build credentials to be created or updated on expo servers
      expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
        1
      );
      // expect provisioning profile not to be deleted on expo servers
      expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
    }
  );

  test.each(testCases)(
    'sets up a new Provisioning Profile with bad build credentials in %s Mode',
    async mode => {
      jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
      const ctx = createCtxMock({
        nonInteractive: mode === 'NON_INTERACTIVE',
        appStore: {
          ...getAppstoreMock(),
          defaultAuthenticationMode:
            mode === 'NON_INTERACTIVE' ? AuthenticationMode.API_KEY : AuthenticationMode.USER,
          ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
          authCtx: testAuthCtx,
          listProvisioningProfilesAsync: jest.fn(() => []),
        },
        ios: {
          ...getNewIosApiMock(),
          getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
          createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(
        ctx,
        findApplicationTarget(testTargets)
      );
      const setupProvisioningProfileAction = new SetUpProvisioningProfile(
        appLookupParams,
        testTarget,
        IosDistributionType.AppStore
      );
      await setupProvisioningProfileAction.runAsync(ctx);

      // expect build credentials to be created or updated on expo servers
      expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
        1
      );
      // expect provisioning profile to be deleted on expo servers
      expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(1);
    }
  );

  test.each(testCases)(
    'skips setting up a Provisioning Profile with prior build credentials configured properly in %s Mode',
    async mode => {
      jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => true);
      const ctx = createCtxMock({
        nonInteractive: mode === 'NON_INTERACTIVE',
        appStore: {
          ...getAppstoreMock(),
          defaultAuthenticationMode:
            mode === 'NON_INTERACTIVE' ? AuthenticationMode.API_KEY : AuthenticationMode.USER,
          ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
          authCtx: testAuthCtx,
        },
        ios: {
          ...getNewIosApiMock(),
          getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
          createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(
        ctx,
        findApplicationTarget(testTargets)
      );
      const setupProvisioningProfileAction = new SetUpProvisioningProfile(
        appLookupParams,
        testTarget,
        IosDistributionType.AppStore
      );
      await setupProvisioningProfileAction.runAsync(ctx);

      // expect build credentials not to be created or updated on expo servers
      expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
        0
      );
      // expect provisioning profile not to be deleted on expo servers
      expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
    }
  );

  test.each(testCases)(
    'sets up a Provisioning Profile with no prior build credentials configured in %s Mode',
    async mode => {
      jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
      const ctx = createCtxMock({
        nonInteractive: mode === 'NON_INTERACTIVE',
        appStore: {
          ...getAppstoreMock(),
          defaultAuthenticationMode:
            mode === 'NON_INTERACTIVE' ? AuthenticationMode.API_KEY : AuthenticationMode.USER,
          ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
          authCtx: testAuthCtx,
        },
        ios: {
          ...getNewIosApiMock(),
          createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(
        ctx,
        findApplicationTarget(testTargets)
      );
      const setupProvisioningProfileAction = new SetUpProvisioningProfile(
        appLookupParams,
        testTarget,
        IosDistributionType.AppStore
      );
      await setupProvisioningProfileAction.runAsync(ctx);

      // expect build credentials to be created or updated on expo servers
      expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
        1
      );
      // expect provisioning profile not to be deleted on expo servers
      expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
    }
  );

  it('errors with --freeze-credentials flag', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      freezeCredentials: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupProvisioningProfileAction = new SetUpProvisioningProfile(
      appLookupParams,
      testTarget,
      IosDistributionType.AppStore
    );
    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrowError(
      ForbidCredentialModificationError
    );

    // expect build credentials not to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    // expect provisioning profile not to be deleted on expo servers
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });

  it('errors with wrong authentication type in nonInteractive mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupProvisioningProfileAction = new SetUpProvisioningProfile(
      appLookupParams,
      testTarget,
      IosDistributionType.AppStore
    );
    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrowError(
      InsufficientAuthenticationNonInteractiveError
    );

    // expect build credentials not to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    // expect provisioning profile not to be deleted on expo servers
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });
});
