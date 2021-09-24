import { vol } from 'memfs';

import { promptAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateGoogleServiceAccountKey } from '../CreateGoogleServiceAccountKey';

jest.mock('../../../../prompts');
jest.mock('fs');
(promptAsync as jest.Mock).mockImplementation(() => ({
  keyJsonPath: '/google-service-account-key.json',
}));

describe(CreateGoogleServiceAccountKey, () => {
  it('creates a Google Service Account Key in Interactive Mode', async () => {
    vol.fromJSON({
      '/google-service-account-key.json': JSON.stringify({ private_key: 'super secret' }),
    });

    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createGsaKeyAction = new CreateGoogleServiceAccountKey(appLookupParams.account);
    await createGsaKeyAction.runAsync(ctx);

    // expect fcm api key to be created on expo servers
    expect(ctx.android.createGoogleServiceAccountKeyAsync as any).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createGsaKeyAction = new CreateGoogleServiceAccountKey(appLookupParams.account);

    // fail if users are running in non-interactive mode
    await expect(createGsaKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
