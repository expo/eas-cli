import { vol } from 'memfs';

import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { promptAsync } from '../../../../prompts';
import {
  getNewAndroidApiMock,
  testAndroidAppCredentialsFragment,
  testGoogleServiceAccountKeyFragment,
} from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpGoogleServiceAccountKeyForSubmissions } from '../SetUpGoogleServiceAccountKeyForSubmissions';

jest.mock('../../../../prompts');
jest.mock('fs');
jest.mocked(promptAsync).mockImplementation(async () => ({
  filePath: '/google-service-account-key.json',
}));
jest.mock('../../../../graphql/queries/AppQuery');

beforeEach(() => {
  vol.reset();
});

describe(SetUpGoogleServiceAccountKeyForSubmissions, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('skips setup when there is a Google Service Account Key already assigned to the project', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
          () => testAndroidAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupGoogleServiceAccountKeyAction = new SetUpGoogleServiceAccountKeyForSubmissions(
      appLookupParams
    );
    await setupGoogleServiceAccountKeyAction.runAsync(ctx);

    expect(ctx.android.createGoogleServiceAccountKeyAsync).not.toHaveBeenCalled();
    expect(ctx.android.updateAndroidAppCredentialsAsync).not.toHaveBeenCalled();
  });
  it('sets up a Google Service Account Key when there is none already setup', async () => {
    vol.fromJSON({
      '/google-service-account-key.json': JSON.stringify({
        type: 'service_account',
        private_key: 'super secret',
        client_email: 'beep-boop@iam.gserviceaccount.com',
      }),
    });
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        createGoogleServiceAccountKeyAsync: jest.fn(() => testGoogleServiceAccountKeyFragment),
        getGoogleServiceAccountKeysForAccountAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupGoogleServiceAccountKeyAction = new SetUpGoogleServiceAccountKeyForSubmissions(
      appLookupParams
    );
    await setupGoogleServiceAccountKeyAction.runAsync(ctx);

    expect(ctx.android.createGoogleServiceAccountKeyAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateAndroidAppCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupGoogleServiceAccountKeyAction = new SetUpGoogleServiceAccountKeyForSubmissions(
      appLookupParams
    );
    await expect(setupGoogleServiceAccountKeyAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );
  });
});
