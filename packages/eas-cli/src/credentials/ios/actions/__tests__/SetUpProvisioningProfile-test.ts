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
import { AppleTeamType, AuthenticationMode } from '../../appstore/authenticateTypes';
import { validateProvisioningProfileAsync } from '../../validators/validateProvisioningProfile';
import { tryAuthenticateAppStoreWithEasAscApiKeyAsync } from '../AscApiKeyUtils';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpProvisioningProfile } from '../SetUpProvisioningProfile';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../SetUpDistributionCertificate');
jest.mock('../ConfigureProvisioningProfile');
jest.mock('../CreateProvisioningProfile');
jest.mock('../../validators/validateProvisioningProfile');
jest.mock('../AscApiKeyUtils');
jest.mock('../../../../graphql/queries/AppQuery');

describe('SetUpProvisioningProfile', () => {
  beforeEach(() => {
    delete process.env.EXPO_APPLE_TEAM_TYPE;
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
    jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mockReset();
    jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mockResolvedValue(false);
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

  it('auto-authenticates before validation in nonInteractive mode when credentials are already valid', async () => {
    let authAttemptedBeforeValidation = false;
    jest
      .mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync)
      .mockImplementation(async authedCtx => {
        authAttemptedBeforeValidation = true;
        (authedCtx.appStore as any).authCtx = testAuthCtx;
        return true;
      });
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => {
      expect(authAttemptedBeforeValidation).toBe(true);
      return true;
    });
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        authCtx: undefined,
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
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

    expect(jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mock.calls).toEqual([
      [ctx, appLookupParams, AppleTeamType.COMPANY_OR_ORGANIZATION],
    ]);
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });

  it('uses best-effort validation when Apple validation fails in nonInteractive mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => {
      throw new Error('Apple API request failed');
    });
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        authCtx: testAuthCtx,
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
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

    await expect(setupProvisioningProfileAction.runAsync(ctx)).resolves.toEqual(
      testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0]
    );

    expect(jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mock.calls.length).toBe(0);
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });

  it('rethrows Apple validation failures in interactive mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => {
      throw new Error('Apple API request failed');
    });
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        authCtx: testAuthCtx,
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
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

    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrow(
      'Apple API request failed'
    );
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });

  it('repairs the Provisioning Profile in nonInteractive mode after auto-authenticating with the EAS-stored ASC API key', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const appstoreMock = getAppstoreMock();
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...appstoreMock,
        defaultAuthenticationMode: AuthenticationMode.USER,
        authCtx: undefined,
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        listProvisioningProfilesAsync: jest.fn(() => [
          {
            provisioningProfileId: nullthrows(
              testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0].provisioningProfile
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
    jest
      .mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync)
      .mockImplementation(async authedCtx => {
        (authedCtx.appStore as any).authCtx = testAuthCtx;
        return true;
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

    // expect we attempted to auto-authenticate with the EAS-stored ASC API key
    expect(jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mock.calls).toEqual([
      [ctx, appLookupParams, AppleTeamType.COMPANY_OR_ORGANIZATION],
    ]);
    // expect build credentials to be created or updated on expo servers
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      1
    );
    // expect provisioning profile not to be deleted on expo servers (it still exists on Apple)
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });

  it('passes IN_HOUSE team type for enterprise profiles when auto-authenticating in nonInteractive mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const appstoreMock = getAppstoreMock();
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...appstoreMock,
        defaultAuthenticationMode: AuthenticationMode.USER,
        authCtx: undefined,
      },
    });

    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupProvisioningProfileAction = new SetUpProvisioningProfile(
      appLookupParams,
      testTarget,
      IosDistributionType.Enterprise
    );
    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrowError(
      InsufficientAuthenticationNonInteractiveError
    );

    expect(jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mock.calls).toEqual([
      [ctx, appLookupParams, AppleTeamType.IN_HOUSE],
    ]);
  });

  it('uses EXPO_APPLE_TEAM_TYPE over derived team type when auto-authenticating in nonInteractive mode', async () => {
    process.env.EXPO_APPLE_TEAM_TYPE = AppleTeamType.IN_HOUSE;
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const appstoreMock = getAppstoreMock();
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...appstoreMock,
        defaultAuthenticationMode: AuthenticationMode.USER,
        authCtx: undefined,
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
    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrowError(
      InsufficientAuthenticationNonInteractiveError
    );

    expect(jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mock.calls).toEqual([
      [ctx, appLookupParams, AppleTeamType.IN_HOUSE],
    ]);
  });

  it('errors in nonInteractive mode when the profile needs regeneration but no Apple authentication can be established', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    // tryAuthenticate fails to establish auth (default mock returns false and leaves authCtx unset).
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

    expect(jest.mocked(tryAuthenticateAppStoreWithEasAscApiKeyAsync).mock.calls.length).toBe(1);
    expect(jest.mocked(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(
      0
    );
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });
});
