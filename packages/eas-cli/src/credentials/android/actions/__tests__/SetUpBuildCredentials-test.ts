import { AppQuery } from '../../../../graphql/queries/AppQuery';
import {
  getNewAndroidApiMock,
  testAndroidBuildCredentialsFragment,
  testJksAndroidKeystoreFragment,
} from '../../../__tests__/fixtures-android';
import {
  jester as mockJester,
  testAppQueryByIdResponse,
} from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { MissingCredentialsNonInteractiveError } from '../../../errors';
import { generateRandomKeystoreAsync } from '../../utils/keystore';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpBuildCredentials } from '../SetUpBuildCredentials';

jest.mock('../../../../ora');
jest.mock('../../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));
jest.mock('../../../../prompts', () => ({ confirmAsync: jest.fn(() => true) }));
jest.mock('../../utils/keystore', () => ({ generateRandomKeystoreAsync: jest.fn() }));
jest.mock('../../../../graphql/queries/AppQuery');

describe('SetUpBuildCredentials', () => {
  beforeEach(() => {
    jest.mocked(generateRandomKeystoreAsync).mockReset();
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
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
