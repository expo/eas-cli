import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { RemoveProvisioningProfiles } from '../RemoveProvisioningProfile';

jest.mock('../../../../graphql/queries/AppQuery');

describe('RemoveProvisioningProfile', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('Basic Case', async () => {
    const ctx = createCtxMock();
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
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
