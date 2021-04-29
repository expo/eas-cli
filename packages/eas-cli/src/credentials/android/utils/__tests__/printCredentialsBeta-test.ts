import mockdate from 'mockdate';

import Log from '../../../../log';
import {
  testAndroidAppCredentialsFragment,
  testLegacyAndroidAppCredentialsFragment,
} from '../../../__tests__/fixtures-android-new';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContext } from '../../actions/BuildCredentialsUtils';
import { displayAndroidAppCredentials } from '../printCredentialsBeta';

jest.mock('../../../../log');
jest.mock('chalk', () => ({ bold: jest.fn(log => log) }));

mockdate.set(new Date('4/20/2021'));

describe('print credentials', () => {
  it('prints the AndroidAppCredentials fragment', async () => {
    const ctx = createCtxMock();
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    displayAndroidAppCredentials({
      appLookupParams,
      legacyAppCredentials: testLegacyAndroidAppCredentialsFragment,
      appCredentials: testAndroidAppCredentialsFragment,
    });
    const loggedSoFar = (Log.log as jest.Mock).mock.calls.reduce(
      (acc, mockValue) => acc + mockValue
    );
    expect(loggedSoFar).toMatchSnapshot();
  });
});
