import { promptAsync } from '../../../prompts.js';
import {
  getNewAndroidApiMock,
  testAndroidBuildCredentialsFragment,
} from '../../__tests__/fixtures-android.js';
import { createCtxMock } from '../../__tests__/fixtures-context.js';
import { getAppLookupParamsFromContextAsync } from '../../android/actions/BuildCredentialsUtils.js';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
} from '../SelectAndroidBuildCredentials.js';

const TEST_STRING = 'TEST_STRING';
jest.mock('../../../prompts');

beforeEach(() => {
  jest.mocked(promptAsync).mockReset();
});

describe(SelectAndroidBuildCredentials, () => {
  it('returns a request to make default build credentials when there are no credentials', async () => {
    jest.mocked(promptAsync).mockImplementation(async () => ({
      providedName: TEST_STRING,
    }));
    const ctx = createCtxMock({
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({
      resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
      result: { isDefault: true, name: TEST_STRING },
    });
  });
  it('returns a request to make build credentials when the user chooses to make a new one', async () => {
    jest.mocked(promptAsync).mockImplementation(async () => ({
      buildCredentialsResultOrRequestToCreateNew:
        SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
      providedName: TEST_STRING,
    }));
    const ctx = createCtxMock({
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => [
          testAndroidBuildCredentialsFragment,
        ]),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({
      resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
      result: { isDefault: false, name: TEST_STRING },
    });
  });
  it('returns a request to make default build credentials when the user chooses to make a new one, and if they have no existing credentials', async () => {
    jest.mocked(promptAsync).mockImplementation(async () => ({
      buildCredentialsResultOrRequestToCreateNew:
        SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
      providedName: TEST_STRING,
    }));
    const ctx = createCtxMock({
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({
      resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
      result: { isDefault: true, name: TEST_STRING },
    });
  });
  it('returns buildCredentials of the users choice', async () => {
    jest.mocked(promptAsync).mockImplementation(async () => ({
      buildCredentialsResultOrRequestToCreateNew: testAndroidBuildCredentialsFragment,
    }));
    const ctx = createCtxMock({
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppBuildCredentialsListAsync: jest.fn(() => [
          testAndroidBuildCredentialsFragment,
        ]),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const selectAndroidBuildCredentialsAction = new SelectAndroidBuildCredentials(appLookupParams);
    const buildCredentialsMetadataInput = await selectAndroidBuildCredentialsAction.runAsync(ctx);
    expect(buildCredentialsMetadataInput).toMatchObject({
      resultType: SelectAndroidBuildCredentialsResultType.EXISTING_CREDENTIALS,
      result: testAndroidBuildCredentialsFragment,
    });
  });
});
