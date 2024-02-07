import mockdate from 'mockdate';

import { AppQuery } from '../../../../graphql/queries/AppQuery';
import Log from '../../../../log';
import {
  testAndroidAppCredentialsFragment,
  testGoogleServiceAccountKeyFragment,
  testLegacyAndroidFcmFragment,
} from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../../actions/BuildCredentialsUtils';
import { displayAndroidAppCredentials } from '../printCredentials';

jest.mock('../../../../log');
jest.mock('chalk', () => ({
  bold: jest.fn(log => log),
  cyan: { bold: jest.fn(log => log) },
  dim: jest.fn(log => log),
}));
jest.mock('../../../../graphql/queries/AppQuery');

mockdate.set(testLegacyAndroidFcmFragment.updatedAt);
mockdate.set(testGoogleServiceAccountKeyFragment.updatedAt);

describe('print credentials', () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('prints the AndroidAppCredentials fragment', async () => {
    const ctx = createCtxMock();
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    displayAndroidAppCredentials({
      appLookupParams,
      appCredentials: testAndroidAppCredentialsFragment,
    });
    const loggedSoFar = jest
      .mocked(Log.log)
      .mock.calls.reduce((acc, mockValue) => acc + mockValue.toString(), '');
    expect(loggedSoFar).toMatchSnapshot();
  });
});
