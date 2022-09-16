import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testPushKey, testTargets } from '../../../__tests__/fixtures-ios';
import { AssignPushKey } from '../AssignPushKey';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';

jest.mock('../../../../graphql/queries/AppQuery');

describe(AssignPushKey, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('assigns a push key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const assignPushKeyAction = new AssignPushKey(appLookupParams);
    await assignPushKeyAction.runAsync(ctx, testPushKey);

    // expect app credentials to be fetched/created, then updated
    expect(ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync).toHaveBeenCalledTimes(1);
    expect(ctx.ios.updateIosAppCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const assignPushKeyAction = new AssignPushKey(appLookupParams);
    await assignPushKeyAction.runAsync(ctx, testPushKey);

    // dont fail if users are running in non-interactive mode
    await expect(assignPushKeyAction.runAsync(ctx, testPushKey)).resolves.not.toThrowError();
  });
});
