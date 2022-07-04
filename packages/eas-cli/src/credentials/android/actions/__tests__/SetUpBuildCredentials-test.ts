import {
  getNewAndroidApiMock,
  testAndroidBuildCredentialsFragment,
  testJksAndroidKeystoreFragment,
} from '../../../__tests__/fixtures-android.js';
import { jester as mockJester } from '../../../__tests__/fixtures-constants.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { MissingCredentialsNonInteractiveError } from '../../../errors.js';
import { generateRandomKeystoreAsync } from '../../utils/keystore.js';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils.js';
import { SetUpBuildCredentials } from '../SetUpBuildCredentials.js';

jest.mock('../../../../ora');
jest.mock('../../../../project/ensureProjectExists');
jest.mock('../../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));
jest.mock('../../../../prompts', () => ({ confirmAsync: jest.fn(() => true) }));
jest.mock('../../utils/keystore', () => ({ generateRandomKeystoreAsync: jest.fn() }));

describe('SetUpBuildCredentials', () => {
  beforeEach(() => {
    jest.mocked(generateRandomKeystoreAsync).mockReset();
  });

  it('skips setup when there are prior credentials', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        getDefaultAndroidAppBuildCredentialsAsync: jest.fn(
          () => testAndroidBuildCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetUpBuildCredentials({ app: appLookupParams });
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore not to be created
    expect(ctx.android.createKeystoreAsync).not.toHaveBeenCalled();
  });
  it('sets up credentials when there are no prior credentials', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        createKeystoreAsync: jest.fn(() => testJksAndroidKeystoreFragment),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetUpBuildCredentials({ app: appLookupParams });
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore to be created
    expect(ctx.android.createKeystoreAsync).toHaveBeenCalled();
    expect(generateRandomKeystoreAsync).toHaveBeenCalled();
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      android: {
        ...getNewAndroidApiMock(),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetUpBuildCredentials({ app: appLookupParams });
    await expect(setupBuildCredentialsAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );
  });
});
