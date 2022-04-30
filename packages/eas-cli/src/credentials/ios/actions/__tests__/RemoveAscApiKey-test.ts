import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKeyFragment } from '../../../__tests__/fixtures-ios';
import { RemoveAscApiKey } from '../RemoveAscApiKey';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

describe(RemoveAscApiKey, () => {
  it('removes an Asc API Key', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const removeAscApiKeyAction = new RemoveAscApiKey(testAscApiKeyFragment);
    await removeAscApiKeyAction.runAsync(ctx);
    expect(ctx.ios.deleteAscApiKeyAsync).toHaveBeenCalledTimes(1);
    expect(ctx.appStore.revokeAscApiKeyAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const removeAscApiKeyAction = new RemoveAscApiKey(testAscApiKeyFragment);
    await expect(removeAscApiKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
