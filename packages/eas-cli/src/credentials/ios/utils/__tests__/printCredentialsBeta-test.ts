import mockdate from 'mockdate';
import nullthrows from 'nullthrows';

import Log from '../../../../log';
import { IosAppCredentialsQuery } from '../../api/graphql/queries/IosAppCredentialsQuery';
import { displayIosAppCredentials } from '../printCredentialsBeta';

jest.mock('../../../../log');
jest.mock('chalk', () => ({ bold: jest.fn(log => log) }));

jest.mock('../../api/graphql/queries/IosAppCredentialsQuery');
mockdate.set(new Date('4/20/2021'));

describe('print credentials', () => {
  it('prints the IosAppCredentials fragment', async () => {
    const testIosAppCredentialsData = await IosAppCredentialsQuery.withCommonFieldsByAppIdentifierIdAsync(
      '@foo/bar',
      {
        appleAppIdentifierId: 'test-id',
      }
    );
    displayIosAppCredentials(nullthrows(testIosAppCredentialsData));
    const loggedSoFar = (Log.log as jest.Mock).mock.calls.reduce(
      (acc, mockValue) => acc + mockValue
    );
    expect(loggedSoFar).toMatchSnapshot();
  });
});
