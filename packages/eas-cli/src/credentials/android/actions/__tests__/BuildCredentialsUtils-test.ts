import { confirmAsync, promptAsync } from '../../../../prompts';
import {
  getNewAndroidApiMock,
  testAndroidAppCredentialsFragment,
  testJksAndroidKeystoreFragment,
  testLegacyAndroidAppCredentialsFragment,
  testLegacyAndroidBuildCredentialsFragment,
  testLegacyAndroidFcmFragment,
} from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  canCopyLegacyCredentialsAsync,
  getAppLookupParamsFromContextAsync,
  promptUserAndCopyLegacyCredentialsAsync,
} from '../BuildCredentialsUtils';

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

describe('BuildCredentialsUtils', () => {
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
      (promptAsync as jest.Mock).mockImplementation(() => ({ providedName: 'test-provided-name' }));
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
        ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync as any
      ).toHaveBeenCalledTimes(1);
      expect(ctx.android.createFcmAsync as any).toHaveBeenCalledTimes(1);
      expect(ctx.android.updateAndroidAppCredentialsAsync as any).toHaveBeenCalledTimes(1);
      expect(ctx.android.createKeystoreAsync as any).toHaveBeenCalledTimes(1);
      expect(ctx.android.createAndroidAppBuildCredentialsAsync as any).toHaveBeenCalledTimes(1);
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
