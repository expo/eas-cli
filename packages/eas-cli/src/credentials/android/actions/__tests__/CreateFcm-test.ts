import { asMock } from '../../../../__tests__/utils';
import { promptAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateFcm } from '../CreateFcm';

jest.mock('../../../../prompts');
asMock(promptAsync).mockImplementation(() => ({ fcmApiKey: 'blah' }));

describe(CreateFcm, () => {
  it('creates an fcm api key in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createFcmAction = new CreateFcm(appLookupParams.account);
    await createFcmAction.runAsync(ctx);

    // expect fcm api key to be created on expo servers
    expect(ctx.android.createFcmAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const createFcmAction = new CreateFcm(appLookupParams.account);

    // fail if users are running in non-interactive mode
    await expect(createFcmAction.runAsync(ctx)).rejects.toThrowError();
  });
});
