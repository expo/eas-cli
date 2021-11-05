import { asMock } from '../../../../__tests__/utils';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetUpAscApiKey } from '../SetUpAscApiKey';
import {
  PROMPT_FOR_APP_SPECIFIC_PASSWORD,
  SetUpSubmissionCredentials,
} from '../SetUpSubmissionCredentials';

jest.mock('../../../../prompts');
asMock(confirmAsync).mockImplementation(() => true);

describe(SetUpSubmissionCredentials, () => {
  it('allows user to enter an App Specific Password', async () => {
    asMock(promptAsync)
      .mockImplementationOnce(() => ({
        choice: PROMPT_FOR_APP_SPECIFIC_PASSWORD,
      }))
      .mockImplementationOnce(() => ({
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
    expect(asMock(promptAsync).mock.calls.length).toBe(2);
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
