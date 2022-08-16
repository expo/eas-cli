import { confirmAsync } from '../../../../prompts';
import {
  getNewAndroidApiMock,
  testGoogleServiceAccountKeyFragment,
} from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { RemoveGoogleServiceAccountKey } from '../RemoveGoogleServiceAccountKey';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

describe(RemoveGoogleServiceAccountKey, () => {
  it('removes an Google Service Account Key', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
      },
    });
    const removeGoogleServiceAccountKeyAction = new RemoveGoogleServiceAccountKey(
      testGoogleServiceAccountKeyFragment
    );
    await removeGoogleServiceAccountKeyAction.runAsync(ctx);
    expect(ctx.android.deleteGoogleServiceAccountKeyAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const removeGoogleServiceAccountKeyAction = new RemoveGoogleServiceAccountKey(
      testGoogleServiceAccountKeyFragment
    );
    await expect(removeGoogleServiceAccountKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
