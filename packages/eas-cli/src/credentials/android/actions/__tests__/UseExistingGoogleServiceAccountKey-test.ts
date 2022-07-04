import { promptAsync } from '../../../../prompts.js';
import {
  getNewAndroidApiMock,
  testGoogleServiceAccountKeyFragment,
} from '../../../__tests__/fixtures-android.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils.js';
import { UseExistingGoogleServiceAccountKey } from '../UseExistingGoogleServiceAccountKey.js';

jest.mock('../../../../prompts');
jest
  .mocked(promptAsync)
  .mockImplementation(async () => ({ chosenKey: testGoogleServiceAccountKeyFragment }));

describe(UseExistingGoogleServiceAccountKey, () => {
  it('uses an existing Google Service Account Key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        getGoogleServiceAccountKeysForAccountAsync: jest.fn(() => [
          testGoogleServiceAccountKeyFragment,
        ]),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const useExistingGoogleServiceAccountKeyAction = new UseExistingGoogleServiceAccountKey(
      appLookupParams.account
    );
    const selectedKey = await useExistingGoogleServiceAccountKeyAction.runAsync(ctx);
    expect(ctx.android.getGoogleServiceAccountKeysForAccountAsync).toHaveBeenCalledTimes(1);
    expect(selectedKey).toMatchObject(testGoogleServiceAccountKeyFragment);
  });
  it("returns null if the account doesn't have any Google Service Account Keys", async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        getGoogleServiceAccountKeysForAccountAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const useExistingGoogleServiceAccountKeyAction = new UseExistingGoogleServiceAccountKey(
      appLookupParams.account
    );
    const selectedKey = await useExistingGoogleServiceAccountKeyAction.runAsync(ctx);
    expect(ctx.android.getGoogleServiceAccountKeysForAccountAsync).toHaveBeenCalledTimes(1);
    expect(selectedKey).toBe(null);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const useExistingGoogleServiceAccountKeyAction = new UseExistingGoogleServiceAccountKey(
      appLookupParams.account
    );

    // fail if users are running in non-interactive mode
    await expect(useExistingGoogleServiceAccountKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
