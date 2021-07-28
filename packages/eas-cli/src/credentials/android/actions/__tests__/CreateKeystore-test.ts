import { confirmAsync } from '../../../../prompts';
import { testKeystore } from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { askForUserProvidedAsync } from '../../../utils/promptForCredentials';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateKeystore } from '../CreateKeystore';

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

jest.mock('../../../utils/promptForCredentials');

describe('CreateKeystore', () => {
  it('creates a keystore in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createKeystoreAction = new CreateKeystore(appLookupParams.account);
    await createKeystoreAction.runAsync(ctx);

    // expect keystore to be created on expo servers
    expect(ctx.android.createKeystoreAsync as any).toHaveBeenCalledTimes(1);
  });
  it('creates a keystore by uploading', async () => {
    (askForUserProvidedAsync as jest.Mock).mockImplementation(() => testKeystore);
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createKeystoreAction = new CreateKeystore(appLookupParams.account);
    await createKeystoreAction.runAsync(ctx);

    // expect keystore to be created on expo servers
    expect(ctx.android.createKeystoreAsync as any).toHaveBeenCalledTimes(1);
    expect(ctx.android.createKeystoreAsync as any).toHaveBeenCalledWith(
      appLookupParams.account,
      expect.objectContaining(testKeystore)
    );
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createKeystoreAction = new CreateKeystore(appLookupParams.account);

    // fail if users are running in non-interactive mode
    await expect(createKeystoreAction.runAsync(ctx)).rejects.toThrowError();
  });
});
