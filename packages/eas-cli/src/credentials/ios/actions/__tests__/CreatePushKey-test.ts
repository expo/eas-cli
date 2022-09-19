import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreatePushKey } from '../CreatePushKey';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe(CreatePushKey, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('creates a Push Key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createPushKeyAction = new CreatePushKey(appLookupParams.account);
    await createPushKeyAction.runAsync(ctx);

    // expect push key to be created on expo servers
    expect(jest.mocked(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(1);
    // expect push key to be created on apple portal
    expect(jest.mocked(ctx.appStore.createPushKeyAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createPushKeyAction = new CreatePushKey(appLookupParams.account);
    await expect(createPushKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
