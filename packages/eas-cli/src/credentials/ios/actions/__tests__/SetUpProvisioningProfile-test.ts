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
  testProvisioningProfileFragment,
  testTarget,
  testTargets,
} from '../../../__tests__/fixtures-ios';
// import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { validateProvisioningProfileAsync } from '../../validators/validateProvisioningProfile';
import * as BuildCredentialsUtils from '../BuildCredentialsUtils';
import {
  getAppLookupParamsFromContextAsync,
  // getProvisioningProfileAsync,
} from '../BuildCredentialsUtils';
import { SetUpProvisioningProfile } from '../SetUpProvisioningProfile';
import { MissingCredentialsNonInteractiveError } from '../../../errors';

const getProvisioningProfileAsync = jest.spyOn(
  BuildCredentialsUtils,
  'getProvisioningProfileAsync'
);
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
  it('repairs existing Provisioning Profile with bad build credentials in Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
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
  });
  it('sets up a new Provisioning Profile with bad build credentials in Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
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
  });
  it('skips setting up a Provisioning Profile with prior build credentials configured properly in Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => true);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        //listProvisioningProfilesAsync: jest.fn(() => []),
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
  });
  it('sets up a Provisioning Profile with no prior build credentials configured in Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
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
  });
  it('repairs existing Provisioning Profile with bad build credentials in Non Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
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
    // expect provisioning profile to be deleted from expo servers
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(1);
  });
  it('sets up a new Provisioning Profile with bad build credentials in Non Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
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
  });
  it('skips setting up a Provisioning Profile with prior build credentials configured properly in Non Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => true);
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        //listProvisioningProfilesAsync: jest.fn(() => []),
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
  });
  it('sets up a Provisioning Profile with no prior build credentials configured in Non Interactive Mode', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
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
  });
  it.only('errors in Non Interactive Mode if not authenticated with App Store', async () => {
    jest.mocked(validateProvisioningProfileAsync).mockImplementation(async () => false);
    jest
      .mocked(getProvisioningProfileAsync)
      .mockImplementation(async () => testProvisioningProfileFragment);

    const ctx = createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => null),
        authCtx: null,
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
    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );
  });
});
