import { findApplicationTarget } from '../../../../project/ios/target.js';
import { confirmAsync } from '../../../../prompts.js';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import {
  testDistCertFragmentNoDependencies,
  testProvisioningProfile,
  testTargets,
} from '../../../__tests__/fixtures-ios.js';
import { MissingCredentialsNonInteractiveError } from '../../../errors.js';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils.js';
import { CreateProvisioningProfile } from '../CreateProvisioningProfile.js';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

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
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(1);
    // expect provisioning profile to be created on apple portal
    expect(jest.mocked(ctx.appStore.createProvisioningProfileAsync).mock.calls.length).toBe(1);
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
    expect(jest.mocked(ctx.ios.createProvisioningProfileAsync).mock.calls.length).toBe(0);
    // expect provisioning profile not to be created on apple portal
    expect(jest.mocked(ctx.appStore.createProvisioningProfileAsync).mock.calls.length).toBe(0);
  });
});
