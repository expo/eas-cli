import mockdate from 'mockdate';

import Log from '../../../../log';
import {
  testAndroidAppCredentialsFragment,
  testLegacyAndroidFcmFragment,
} from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../../actions/BuildCredentialsUtils';
import { displayAndroidAppCredentials } from '../printCredentials';

jest.mock('../../../../log');
jest.mock('chalk', () => ({ bold: jest.fn(log => log) }));

mockdate.set(testLegacyAndroidFcmFragment.updatedAt);

describe('print credentials', () => {
  it('prints the AndroidAppCredentials fragment', async () => {
    const ctx = createCtxMock();
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    displayAndroidAppCredentials({
      appLookupParams,
      appCredentials: testAndroidAppCredentialsFragment,
    });
    const loggedSoFar = (Log.log as jest.Mock).mock.calls.reduce(
      (acc, mockValue) => acc + mockValue
    );
    expect(loggedSoFar).toMatchSnapshot();
  });
});
