import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { confirmAsync, promptAsync } from '../../../../prompts';
import {
  getNewAndroidApiMock,
  testAndroidAppCredentialsFragment,
  testJksAndroidKeystoreFragment,
  testLegacyAndroidAppCredentialsFragment,
  testLegacyAndroidBuildCredentialsFragment,
  testLegacyAndroidFcmFragment,
} from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  canCopyLegacyCredentialsAsync,
  getAppLookupParamsFromContextAsync,
  promptUserAndCopyLegacyCredentialsAsync,
} from '../BuildCredentialsUtils';

jest.mock('../../../../ora');
jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe('BuildCredentialsUtils', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  describe(canCopyLegacyCredentialsAsync, () => {
    it('returns true if the user has legacy credentials and no modern ones', async () => {
      const ctx = createCtxMock({
        nonInteractive: true,
        android: {
          ...getNewAndroidApiMock(),
          getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
          getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testLegacyAndroidAppCredentialsFragment
          ),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
      const canCopyLegacyCredentials = await canCopyLegacyCredentialsAsync(ctx, appLookupParams);
      expect(canCopyLegacyCredentials).toBe(true);
    });
    it('returns false if the user has modern credentials', async () => {
      const ctx = createCtxMock({
        nonInteractive: true,
        android: {
          ...getNewAndroidApiMock(),
          getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testAndroidAppCredentialsFragment
          ),
          getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testLegacyAndroidAppCredentialsFragment
          ),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
      const canCopyLegacyCredentials = await canCopyLegacyCredentialsAsync(ctx, appLookupParams);
      expect(canCopyLegacyCredentials).toBe(false);
    });
    it('returns false if the user has no legacy credentials', async () => {
      const ctx = createCtxMock({
        nonInteractive: true,
        android: {
          ...getNewAndroidApiMock(),
          getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
          getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
      const canCopyLegacyCredentials = await canCopyLegacyCredentialsAsync(ctx, appLookupParams);
      expect(canCopyLegacyCredentials).toBe(false);
    });
    it('works in Non-Interactive Mode', async () => {
      const ctx = createCtxMock({
        nonInteractive: true,
        android: {
          ...getNewAndroidApiMock(),
          getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
          getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testLegacyAndroidAppCredentialsFragment
          ),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
      const canCopyLegacyCredentials = await canCopyLegacyCredentialsAsync(ctx, appLookupParams);
      expect(canCopyLegacyCredentials).toBe(true);
    });
  });
  describe(promptUserAndCopyLegacyCredentialsAsync, () => {
    it('copies all legacy credentials to EAS if the user is eligible', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementation(async () => ({ providedName: 'test-provided-name' }));
      const ctx = createCtxMock({
        nonInteractive: false,
        android: {
          ...getNewAndroidApiMock(),
          getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
          getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testLegacyAndroidAppCredentialsFragment
          ),
          getLegacyAndroidAppBuildCredentialsAsync: jest.fn(
            () => testLegacyAndroidBuildCredentialsFragment
          ),
          createKeystoreAsync: jest.fn(() => testJksAndroidKeystoreFragment),
          createFcmAsync: jest.fn(() => testLegacyAndroidFcmFragment),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
      await promptUserAndCopyLegacyCredentialsAsync(ctx, appLookupParams);

      expect(
        ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync
      ).toHaveBeenCalledTimes(1);
      expect(ctx.android.createFcmAsync).toHaveBeenCalledTimes(1);
      expect(ctx.android.updateAndroidAppCredentialsAsync).toHaveBeenCalledTimes(1);
      expect(ctx.android.createKeystoreAsync).toHaveBeenCalledTimes(1);
      expect(ctx.android.createAndroidAppBuildCredentialsAsync).toHaveBeenCalledTimes(1);
    });
    it('errors in Non-Interactive Mode', async () => {
      const ctx = createCtxMock({
        nonInteractive: true,
        android: {
          ...getNewAndroidApiMock(),
          getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
          getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testLegacyAndroidAppCredentialsFragment
          ),
        },
      });
      const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
      await expect(
        promptUserAndCopyLegacyCredentialsAsync(ctx, appLookupParams)
      ).rejects.toThrowError();
    });
  });
});
