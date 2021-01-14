import { IosAppCredentialsQuery } from '../../api/graphql/queries/IosAppCredentialsQuery';
import { displayIosAppCredentials } from '../printCredentialsBeta';

const mockLog = {
  __esModule: true, // this property makes it work
  default: jest.fn(toLog => toLog),
};
(mockLog.default as any).newLine = jest.fn();
jest.mock('../../../../log', () => mockLog);
jest.mock('../../api/graphql/queries/IosAppCredentialsQuery');

describe('print credentials', () => {
  it('prints the IosAppCredentials fragment', async () => {
    const testIosAppCredentialsData = await IosAppCredentialsQuery.withCommonFieldsByAppIdentifierIdAsync(
      '@foo/bar',
      {
        appleAppIdentifierId: 'test-id',
      }
    );
    displayIosAppCredentials(testIosAppCredentialsData);
    const loggedSoFar = mockLog.default.mock.results
      .map(mockCall => mockCall.value)
      .reduce((acc, mockValue) => acc + mockValue);
    expect(loggedSoFar).toMatchSnapshot();
  });
});
