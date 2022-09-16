import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { promptAsync } from '../../../../prompts';
import {
  getNewAndroidApiMock,
  testGoogleServiceAccountKeyFragment,
} from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { UseExistingGoogleServiceAccountKey } from '../UseExistingGoogleServiceAccountKey';

jest.mock('../../../../prompts');
jest
  .mocked(promptAsync)
  .mockImplementation(async () => ({ chosenKey: testGoogleServiceAccountKeyFragment }));
jest.mock('../../../../graphql/queries/AppQuery');

describe(UseExistingGoogleServiceAccountKey, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
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
