import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { promptAsync } from '../../../../prompts';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { CreateFcm } from '../CreateFcm';

jest.mock('../../../../prompts');
jest.mocked(promptAsync).mockImplementation(async () => ({ fcmApiKey: 'blah' }));
jest.mock('../../../../graphql/queries/AppQuery');

describe(CreateFcm, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });

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
