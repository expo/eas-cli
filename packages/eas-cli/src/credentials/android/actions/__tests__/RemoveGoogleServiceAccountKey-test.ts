import { confirmAsync } from '../../../../prompts.js';
import {
  getNewAndroidApiMock,
  testGoogleServiceAccountKeyFragment,
} from '../../../__tests__/fixtures-android.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { RemoveGoogleServiceAccountKey } from '../RemoveGoogleServiceAccountKey.js';

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
