import mockdate from 'mockdate';

import { asMock } from '../../../../__tests__/utils';
import Log from '../../../../log';
import {
  testAndroidAppCredentialsFragment,
  testGoogleServiceAccountKeyFragment,
  testLegacyAndroidFcmFragment,
} from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../../actions/BuildCredentialsUtils';
import { displayAndroidAppCredentials } from '../printCredentials';

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
    const loggedSoFar = asMock(Log.log).mock.calls.reduce((acc, mockValue) => acc + mockValue);
    expect(loggedSoFar).toMatchSnapshot();
  });
});
