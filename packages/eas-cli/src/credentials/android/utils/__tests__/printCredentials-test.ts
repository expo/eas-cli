import mockdate from 'mockdate';

import Log from '../../../../log.js';
import {
  testAndroidAppCredentialsFragment,
  testGoogleServiceAccountKeyFragment,
  testLegacyAndroidFcmFragment,
} from '../../../__tests__/fixtures-android.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { getAppLookupParamsFromContextAsync } from '../../actions/BuildCredentialsUtils.js';
import { displayAndroidAppCredentials } from '../printCredentials.js';

jest.mock('../../../../log');
jest.mock('chalk', () => ({ bold: jest.fn(log => log), cyan: { bold: jest.fn(log => log) } }));

mockdate.set(testLegacyAndroidFcmFragment.updatedAt);
mockdate.set(testGoogleServiceAccountKeyFragment.updatedAt);

describe('print credentials', () => {
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
