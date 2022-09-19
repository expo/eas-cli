import { vol } from 'memfs';

import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { promptAsync } from '../../../../prompts';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateGoogleServiceAccountKey } from '../CreateGoogleServiceAccountKey';

jest.mock('../../../../prompts');
jest.mock('fs');
jest.mocked(promptAsync).mockImplementation(async () => ({
  filePath: '/google-service-account-key.json',
}));
jest.mock('../../../../graphql/queries/AppQuery');

beforeEach(() => {
  vol.reset();
});

describe(CreateGoogleServiceAccountKey, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });

  it('creates a Google Service Account Key in Interactive Mode', async () => {
    vol.fromJSON({
      '/google-service-account-key.json': JSON.stringify({
        type: 'service_account',
        private_key: 'super secret',
        client_email: 'beep-boop@iam.gserviceaccount.com',
      }),
    });

    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createGsaKeyAction = new CreateGoogleServiceAccountKey(appLookupParams.account);
    await createGsaKeyAction.runAsync(ctx);

    // expect fcm api key to be created on expo servers
    expect(ctx.android.createGoogleServiceAccountKeyAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createGsaKeyAction = new CreateGoogleServiceAccountKey(appLookupParams.account);

    // fail if users are running in non-interactive mode
    await expect(createGsaKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
