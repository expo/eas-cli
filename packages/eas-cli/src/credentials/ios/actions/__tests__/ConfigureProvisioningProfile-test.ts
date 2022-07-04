import { findApplicationTarget } from '../../../../project/ios/target.js';
import { confirmAsync } from '../../../../prompts.js';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testProvisioningProfileFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios.js';
import { MissingCredentialsNonInteractiveError } from '../../../errors.js';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils.js';
import { ConfigureProvisioningProfile } from '../ConfigureProvisioningProfile.js';

jest.mock('../../../../ora');
jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

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
    expect(jest.mocked(ctx.ios.updateProvisioningProfileAsync).mock.calls.length).toBe(1);
    // expect provisioning profile not to be updated on apple portal
    expect(jest.mocked(ctx.appStore.useExistingProvisioningProfileAsync).mock.calls.length).toBe(1);
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
    expect(jest.mocked(ctx.ios.updateProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be updated on apple portal
    expect(jest.mocked(ctx.appStore.useExistingProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
});
