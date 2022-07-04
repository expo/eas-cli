import { promptAsync } from '../../../../prompts.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils.js';
import { CreateFcm } from '../CreateFcm.js';

jest.mock('../../../../prompts');
jest.mocked(promptAsync).mockImplementation(async () => ({ fcmApiKey: 'blah' }));

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
