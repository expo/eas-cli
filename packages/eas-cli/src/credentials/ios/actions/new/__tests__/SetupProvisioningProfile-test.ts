import { confirmAsync } from '../../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../../__tests__/fixtures-appstore';
import { createCtxMock, createManagerMock } from '../../../../__tests__/fixtures-context';
import {
  testAppleAppIdentifierFragment,
  testIosAppBuildCredentialsFragment,
  testIosAppCredentialsWithBuildCredentialsQueryResult,
} from '../../../../__tests__/fixtures-ios';
import { getNewIosApiMockWithoutCredentials } from '../../../../__tests__/fixtures-new-ios';
import { ManageIosBeta } from '../../../../manager/ManageIosBeta';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { validateProvisioningProfileAsync } from '../../../validators/validateProvisioningProfile';
import { SetupProvisioningProfile } from '../SetupProvisioningProfile';
jest.mock('../../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);
jest.mock('../SetupDistributionCertificate');
jest.mock('../ConfigureProvisioningProfile');
jest.mock('../CreateProvisioningProfile');
jest.mock('../../../validators/validateProvisioningProfile');

describe('SetupProvisioningProfile', () => {
  it('repairs existing Provisioning Profile with bad build credentials in Interactive Mode', async () => {
    (validateProvisioningProfileAsync as jest.Mock).mockImplementation(() => ({
      error: 'testing: everything is fine, ignore this',
      ok: false,
    }));
    const manager = createManagerMock();
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listProvisioningProfilesAsync: jest.fn(() => [
          {
            provisioningProfileId:
              testIosAppCredentialsWithBuildCredentialsQueryResult.iosAppBuildCredentialsArray[0]
                .provisioningProfile.developerPortalIdentifier,
          },
        ]),
      },
      newIos: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testIosAppCredentialsWithBuildCredentialsQueryResult
        ),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
        createOrUpdateIosAppBuildCredentialsAsync: jest.fn(
          () => testIosAppBuildCredentialsFragment
        ),
      },
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const setupProvisioningProfileAction = new SetupProvisioningProfile(appLookupParams);
    await setupProvisioningProfileAction.runAsync(manager, ctx);

    // expect build credentials to be created or updated on expo servers
    expect((ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile not to be deleted on expo servers
    expect((ctx.newIos.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(0);
  });
  it('sets up a new Provisioning Profile with bad build credentials in Interactive Mode', async () => {
    (validateProvisioningProfileAsync as jest.Mock).mockImplementation(() => ({
      error: 'testing: everything is fine, ignore this',
      ok: false,
    }));
    const manager = createManagerMock();
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listProvisioningProfilesAsync: jest.fn(() => []),
      },
      newIos: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testIosAppCredentialsWithBuildCredentialsQueryResult
        ),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
      },
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const setupProvisioningProfileAction = new SetupProvisioningProfile(appLookupParams);
    await setupProvisioningProfileAction.runAsync(manager, ctx);

    // expect build credentials to be created or updated on expo servers
    expect((ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile to be deleted on expo servers
    expect((ctx.newIos.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(1);
  });
  it('skips setting up a Provisioning Profile with prior build credentials configured properly in Interactive Mode', async () => {
    (validateProvisioningProfileAsync as jest.Mock).mockImplementation(() => ({
      ok: true,
    }));
    const manager = createManagerMock();
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        //listProvisioningProfilesAsync: jest.fn(() => []),
      },
      newIos: {
        ...getNewIosApiMockWithoutCredentials(),
        getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(
          () => testIosAppCredentialsWithBuildCredentialsQueryResult
        ),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
      },
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const setupProvisioningProfileAction = new SetupProvisioningProfile(appLookupParams);
    await setupProvisioningProfileAction.runAsync(manager, ctx);

    // expect build credentials not to be created or updated on expo servers
    expect((ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile not to be deleted on expo servers
    expect((ctx.newIos.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(0);
  });
  it('sets up a Provisioning Profile with no prior build credentials configured in Interactive Mode', async () => {
    const manager = createManagerMock();
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
      },
      newIos: {
        ...getNewIosApiMockWithoutCredentials(),
        createOrGetExistingAppleAppIdentifierAsync: jest.fn(() => testAppleAppIdentifierFragment),
      },
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const setupProvisioningProfileAction = new SetupProvisioningProfile(appLookupParams);
    await setupProvisioningProfileAction.runAsync(manager, ctx);

    // expect build credentials to be created or updated on expo servers
    expect((ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile not to be deleted on expo servers
    expect((ctx.newIos.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(0);
  });
  it('errors in Non Interactive Mode', async () => {
    const manager = createManagerMock();
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const setupProvisioningProfileAction = new SetupProvisioningProfile(appLookupParams);
    await expect(setupProvisioningProfileAction.runAsync(manager, ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );

    // expect build credentials not to be created or updated on expo servers
    expect((ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile not to be deleted on expo servers
    expect((ctx.newIos.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(0);
  });
});
