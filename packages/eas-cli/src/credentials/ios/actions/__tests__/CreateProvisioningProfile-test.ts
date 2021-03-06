import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { CreateProvisioningProfile } from '../CreateProvisioningProfile';
jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

describe('CreateProvisioningProfile', () => {
  it('creates a Provisioning Profile in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        createProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createProvProfAction = new CreateProvisioningProfile(
      appLookupParams,
      testDistCertFragmentNoDependencies
    );
    await createProvProfAction.runAsync(ctx);

    // expect provisioning profile to be created on expo servers
    expect((ctx.ios.createProvisioningProfileAsync as any).mock.calls.length).toBe(1);
    // expect provisioning profile to be created on apple portal
    expect((ctx.appStore.createProvisioningProfileAsync as any).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createProvProfAction = new CreateProvisioningProfile(
      appLookupParams,
      testDistCertFragmentNoDependencies
    );
    await expect(createProvProfAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );

    // expect provisioning profile not to be created on expo servers
    expect((ctx.ios.createProvisioningProfileAsync as any).mock.calls.length).toBe(0);
    // expect provisioning profile not to be created on apple portal
    expect((ctx.appStore.createProvisioningProfileAsync as any).mock.calls.length).toBe(0);
  });
});
