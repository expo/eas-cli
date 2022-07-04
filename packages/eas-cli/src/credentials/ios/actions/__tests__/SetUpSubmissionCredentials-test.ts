import { findApplicationTarget } from '../../../../project/ios/target.js';
import { confirmAsync, promptAsync } from '../../../../prompts.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios.js';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils.js';
import { SetUpAscApiKey } from '../SetUpAscApiKey.js';
import {
  PROMPT_FOR_APP_SPECIFIC_PASSWORD,
  SetUpSubmissionCredentials,
} from '../SetUpSubmissionCredentials.js';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

describe(SetUpSubmissionCredentials, () => {
  it('allows user to enter an App Specific Password', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({
        choice: PROMPT_FOR_APP_SPECIFIC_PASSWORD,
      }))
      .mockImplementationOnce(async () => ({
        appSpecificPassword: 'super secret',
      }));
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupAscApiKeyAction = new SetUpSubmissionCredentials(appLookupParams);
    const asp = await setupAscApiKeyAction.runAsync(ctx);

    // prompt to choose ASP, then prompt to input ASP
    expect(jest.mocked(promptAsync).mock.calls.length).toBe(2);
    expect(asp).toBe('super secret');
  });
  it('returns an ASC API key', async () => {
    try {
      jest
        .spyOn(SetUpAscApiKey.prototype, 'runAsync')
        .mockImplementation(async _ctx => testCommonIosAppCredentialsFragment);
      const ctx = createCtxMock();
      const appLookupParams = getAppLookupParamsFromContext(
        ctx,
        findApplicationTarget(testTargets)
      );
      const setupAscApiKeyAction = new SetUpSubmissionCredentials(appLookupParams);
      const asc = await setupAscApiKeyAction.runAsync(ctx);

      expect(asc).toEqual(testCommonIosAppCredentialsFragment);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
