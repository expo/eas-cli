import { confirmAsync } from '../../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../../__tests__/fixtures-appstore';
import { createCtxMock, createManagerMock } from '../../../../__tests__/fixtures-context';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testProvisioningProfileFragment,
} from '../../../../__tests__/fixtures-ios';
import { ManageIosBeta } from '../../../../manager/ManageIosBeta';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { ConfigureProvisioningProfile } from '../ConfigureProvisioningProfile';
jest.mock('../../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

describe('ConfigureProvisioningProfile', () => {
  it('configures a Provisioning Profile in Interactive Mode', async () => {
    const manager = createManagerMock();
    const mockProvisioningProfileFromApple = {
      provisioningProfileId: testProvisioningProfileFragment.developerPortalIdentifier,
      provisioningProfile: testProvisioningProfileFragment.provisioningProfile,
    };
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
        listProvisioningProfilesAsync: jest.fn(() => [mockProvisioningProfileFromApple]),
        useExistingProvisioningProfileAsync: jest.fn(() => mockProvisioningProfileFromApple),
      },
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const configureProvProfAction = new ConfigureProvisioningProfile(
      appLookupParams,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await configureProvProfAction.runAsync(manager, ctx);

    // expect provisioning profile not to be updated on expo servers
    expect((ctx.newIos.updateProvisioningProfileAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile not to be updated on apple portal
    expect((ctx.appStore.useExistingProvisioningProfileAsync as any).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const manager = createManagerMock();
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    const configureProvProfAction = new ConfigureProvisioningProfile(
      appLookupParams,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await expect(configureProvProfAction.runAsync(manager, ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );

    // expect provisioning profile not to be updated on expo servers
    expect((ctx.newIos.updateProvisioningProfileAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile not to be updated on apple portal
    expect((ctx.appStore.useExistingProvisioningProfileAsync as any).mock.calls.length).toBe(0);
  });
});
