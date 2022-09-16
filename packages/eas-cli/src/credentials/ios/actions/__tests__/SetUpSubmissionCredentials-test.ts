import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpAscApiKey } from '../SetUpAscApiKey';
import {
  PROMPT_FOR_APP_SPECIFIC_PASSWORD,
  SetUpSubmissionCredentials,
} from '../SetUpSubmissionCredentials';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe(SetUpSubmissionCredentials, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
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
      const appLookupParams = await getAppLookupParamsFromContextAsync(
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
