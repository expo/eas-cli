import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testProvisioningProfileFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { ConfigureProvisioningProfile } from '../ConfigureProvisioningProfile';
jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

describe('ConfigureProvisioningProfile', () => {
  it('configures a Provisioning Profile in Interactive Mode', async () => {
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const provProfConfigurator = new ConfigureProvisioningProfile(
      appLookupParams,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await provProfConfigurator.runAsync(ctx);

    // expect provisioning profile not to be updated on expo servers
    expect((ctx.ios.updateProvisioningProfileAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile not to be updated on apple portal
    expect((ctx.appStore.useExistingProvisioningProfileAsync as any).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const provProfConfigurator = new ConfigureProvisioningProfile(
      appLookupParams,
      testDistCertFragmentNoDependencies,
      testProvisioningProfileFragment
    );
    await expect(provProfConfigurator.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );

    // expect provisioning profile not to be updated on expo servers
    expect((ctx.ios.updateProvisioningProfileAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile not to be updated on apple portal
    expect((ctx.appStore.useExistingProvisioningProfileAsync as any).mock.calls.length).toBe(0);
  });
});
