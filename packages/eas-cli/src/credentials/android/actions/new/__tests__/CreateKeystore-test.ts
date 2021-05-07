import { confirmAsync } from '../../../../../prompts';
import { createCtxMock } from '../../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContext } from '../../BuildCredentialsUtils';
import { CreateKeystore } from '../CreateKeystore';

jest.mock('../../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

describe('CreateKeystore', () => {
  it('creates a keystore in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const createKeystoreAction = new CreateKeystore(appLookupParams.account);
    await createKeystoreAction.runAsync(ctx);

    // expect keystore to be created on expo servers
    expect((ctx.newAndroid.createKeystoreAsync as any).mock.calls.length).toBe(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const createKeystoreAction = new CreateKeystore(appLookupParams.account);

    // fail if users are trying to delete a dist cert with dependencies in non-interactive mode
    await expect(createKeystoreAction.runAsync(ctx)).rejects.toThrowError();
  });
});
