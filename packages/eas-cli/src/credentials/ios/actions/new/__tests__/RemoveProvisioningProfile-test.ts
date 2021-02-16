import { createCtxMock } from '../../../../__tests__/fixtures-context';
import { ManageIosBeta } from '../../../../manager/ManageIosBeta';
import { RemoveProvisioningProfiles } from '../RemoveProvisioningProfile';

describe('RemoveProvisioningProfile', () => {
  it('Basic Case', async () => {
    const ctx = createCtxMock();
    const appLookupParams = ManageIosBeta.getAppLookupParamsFromContext(ctx);
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
    expect((ctx.newIos.deleteProvisioningProfilesAsync as any).mock.calls.length).toBe(1);
  });
});
