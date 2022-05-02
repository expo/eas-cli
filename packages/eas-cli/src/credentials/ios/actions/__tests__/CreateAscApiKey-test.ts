import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKey, testTargets } from '../../../__tests__/fixtures-ios';
import { AppStoreApiKeyPurpose } from '../AscApiKeyUtils';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { CreateAscApiKey } from '../CreateAscApiKey';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

describe(CreateAscApiKey, () => {
  it('creates a App Store API Key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        createAscApiKeyAsync: jest.fn(() => testAscApiKey),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createAscApiKeyAction = new CreateAscApiKey(appLookupParams.account);
    await createAscApiKeyAction.runAsync(ctx, AppStoreApiKeyPurpose.SUBMISSION_SERVICE);

    // expect api key to be created on expo servers
    expect(jest.mocked(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(1);
    // expect api key to be created on apple portal
    expect(jest.mocked(ctx.appStore.createAscApiKeyAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createAscApiKeyAction = new CreateAscApiKey(appLookupParams.account);
    await expect(
      createAscApiKeyAction.runAsync(ctx, AppStoreApiKeyPurpose.SUBMISSION_SERVICE)
    ).rejects.toThrowError();
  });
});
