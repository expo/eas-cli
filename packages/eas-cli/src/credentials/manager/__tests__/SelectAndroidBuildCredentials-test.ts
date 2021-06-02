import { promptAsync } from '../../../prompts';
import {
  getNewAndroidApiMockWithoutCredentials,
  testAndroidBuildCredentialsFragment,
} from '../../__tests__/fixtures-android-new';
import { createCtxMock } from '../../__tests__/fixtures-context';
import { getAppLookupParamsFromContext } from '../../android/actions/BuildCredentialsUtils';
import {
  CREATE_NEW_BUILD_CREDENTIALS,
  SelectAndroidBuildCredentials,
} from '../SelectAndroidBuildCredentials';

const TEST_STRING = 'TEST_STRING';
jest.mock('../../../prompts');

beforeEach(() => {
  (promptAsync as jest.Mock).mockReset();
});

describe(SelectAndroidBuildCredentials, () => {
  it('returns a request to make default build credentials when there are no credentials', async () => {
    (promptAsync as jest.Mock).mockImplementation(() => ({
      providedName: TEST_STRING,
    }));
    const ctx = createCtxMock({
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({ isDefault: true, name: TEST_STRING });
  });
  it('returns a request to make build credentials when the user chooses to make a new one', async () => {
    (promptAsync as jest.Mock).mockImplementation(() => ({
      buildCredentialsResultOrRequestToCreateNew: CREATE_NEW_BUILD_CREDENTIALS,
      providedName: TEST_STRING,
    }));
    const ctx = createCtxMock({
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => [
          testAndroidBuildCredentialsFragment,
        ]),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({ isDefault: false, name: TEST_STRING });
  });
  it('returns a request to make default build credentials when the user chooses to make a new one, and if they have no existing credentials', async () => {
    (promptAsync as jest.Mock).mockImplementation(() => ({
      buildCredentialsResultOrRequestToCreateNew: CREATE_NEW_BUILD_CREDENTIALS,
      providedName: TEST_STRING,
    }));
    const ctx = createCtxMock({
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({ isDefault: true, name: TEST_STRING });
  });
  it('returns buildCredentials of the users choice', async () => {
    (promptAsync as jest.Mock).mockImplementation(() => ({
      buildCredentialsResultOrRequestToCreateNew: testAndroidBuildCredentialsFragment,
    }));
    const ctx = createCtxMock({
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => [
          testAndroidBuildCredentialsFragment,
        ]),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toBe(testAndroidBuildCredentialsFragment);
  });
});
