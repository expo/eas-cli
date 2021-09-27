import nullthrows from 'nullthrows';

import { asMock } from '../../../../__tests__/utils';
import { IosDistributionType } from '../../../../graphql/generated';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testAppleAppIdentifierFragment,
  testCommonIosAppCredentialsFragment,
  testIosAppBuildCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { validateProvisioningProfileAsync } from '../../validators/validateProvisioningProfile';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetupProvisioningProfile } from '../SetupProvisioningProfile';

jest.mock('../../../../prompts');
asMock(confirmAsync).mockImplementation(() => true);
jest.mock('../SetupDistributionCertificate');
jest.mock('../ConfigureProvisioningProfile');
jest.mock('../CreateProvisioningProfile');
jest.mock('../../validators/validateProvisioningProfile');

describe('SetupProvisioningProfile', () => {
  it('repairs existing Provisioning Profile with bad build credentials in Interactive Mode', async () => {
    asMock(validateProvisioningProfileAsync).mockImplementation(() => false);
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupProvisioningProfileAction = new SetupProvisioningProfile(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupProvisioningProfileAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(1);
    // expect provisioning profile not to be deleted on expo servers
    expect(asMock(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });
  it('sets up a new Provisioning Profile with bad build credentials in Interactive Mode', async () => {
    asMock(validateProvisioningProfileAsync).mockImplementation(() => false);
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupProvisioningProfileAction = new SetupProvisioningProfile(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupProvisioningProfileAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be deleted on expo servers
    expect(asMock(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(1);
  });
  it('skips setting up a Provisioning Profile with prior build credentials configured properly in Interactive Mode', async () => {
    asMock(validateProvisioningProfileAsync).mockImplementation(() => true);
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupProvisioningProfileAction = new SetupProvisioningProfile(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupProvisioningProfileAction.runAsync(ctx);

    // expect build credentials not to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be deleted on expo servers
    expect(asMock(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });
  it('sets up a Provisioning Profile with no prior build credentials configured in Interactive Mode', async () => {
    asMock(validateProvisioningProfileAsync).mockImplementation(() => false);
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupProvisioningProfileAction = new SetupProvisioningProfile(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await setupProvisioningProfileAction.runAsync(ctx);

    // expect build credentials to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(1);
    // expect provisioning profile not to be deleted on expo servers
    expect(asMock(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });
  it('errors in Non Interactive Mode', async () => {
    asMock(validateProvisioningProfileAsync).mockImplementation(() => false);
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupProvisioningProfileAction = new SetupProvisioningProfile(
      appLookupParams,
      IosDistributionType.AppStore
    );
    await expect(setupProvisioningProfileAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );

    // expect build credentials not to be created or updated on expo servers
    expect(asMock(ctx.ios.createOrUpdateIosAppBuildCredentialsAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be deleted on expo servers
    expect(asMock(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(0);
  });
});
