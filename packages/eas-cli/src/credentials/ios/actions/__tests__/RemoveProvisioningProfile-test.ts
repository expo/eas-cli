import { findApplicationTarget } from '../../../../project/ios/target';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemoveProvisioningProfiles } from '../RemoveProvisioningProfile';

describe('RemoveProvisioningProfile', () => {
  it('Basic Case', async () => {
    const ctx = createCtxMock();
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const testProvisioningProfile = {
      id: 'test-id',
      developerPortalIdentifier: 'test-developer-portal-identifier',
    };
    const removeProfilesAction = new RemoveProvisioningProfiles(
      [appLookupParams],
      [testProvisioningProfile]
    );
    await removeProfilesAction.runAsync(ctx);

    // expect provisioning profile to be deleted from servers
    expect((ctx.ios.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(1);
  });
});
