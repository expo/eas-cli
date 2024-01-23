import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { testGoogleServiceAccountKeyFragment } from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { AssignGoogleServiceAccountKeyForSubmissions } from '../AssignGoogleServiceAccountKeyForSubmissions';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';

jest.mock('../../../../graphql/queries/AppQuery');

describe(AssignGoogleServiceAccountKeyForSubmissions, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('assigns a Google Service Account key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const assignGoogleServiceAccountKeyAction = new AssignGoogleServiceAccountKeyForSubmissions(
      appLookupParams
    );
    await assignGoogleServiceAccountKeyAction.runAsync(ctx, testGoogleServiceAccountKeyFragment);

    // expect app credentials to be fetched/created, then updated
    expect(
      ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync
    ).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateAndroidAppCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const assignGoogleServiceAccountKeyAction = new AssignGoogleServiceAccountKeyForSubmissions(
      appLookupParams
    );

    // dont fail if users are running in non-interactive mode
    await expect(
      assignGoogleServiceAccountKeyAction.runAsync(ctx, testGoogleServiceAccountKeyFragment)
    ).resolves.not.toThrowError();
  });
});
