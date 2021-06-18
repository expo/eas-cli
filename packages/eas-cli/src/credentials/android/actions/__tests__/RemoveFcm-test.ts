import { confirmAsync } from '../../../../prompts';
import {
  getNewAndroidApiMock,
  testAndroidAppCredentialsFragment,
} from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemoveFcm } from '../RemoveFcm';

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});
describe(RemoveFcm, () => {
  it('removes an FCM Api Key', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
          () => testAndroidAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeFcmApiKeyAction = new RemoveFcm(appLookupParams);
    await removeFcmApiKeyAction.runAsync(ctx);
    expect(ctx.android.deleteFcmAsync as any).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeFcmApiKeyAction = new RemoveFcm(appLookupParams);
    await expect(removeFcmApiKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
