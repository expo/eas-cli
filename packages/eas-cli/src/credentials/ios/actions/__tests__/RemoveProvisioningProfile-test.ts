import { findApplicationTarget } from '../../../../project/ios/target.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { testTargets } from '../../../__tests__/fixtures-ios.js';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils.js';
import { RemoveProvisioningProfiles } from '../RemoveProvisioningProfile.js';

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
    expect(jest.mocked(ctx.ios.deleteProvisioningProfilesAsync).mock.calls.length).toBe(1);
  });
});
