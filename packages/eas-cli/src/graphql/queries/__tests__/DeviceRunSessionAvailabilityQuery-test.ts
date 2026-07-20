import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionAvailabilityQuery } from '../DeviceRunSessionAvailabilityQuery';

function makeGraphqlClient(data: unknown): ExpoGraphqlClient {
  return {
    query: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data }),
    }),
  } as unknown as ExpoGraphqlClient;
}

describe('DeviceRunSessionAvailabilityQuery.byAppIdAsync', () => {
  it('returns the owner account availability from the GraphQL response', async () => {
    const ownerAccount = {
      id: 'account-1',
      name: 'testuser',
      deviceRunSessionsEnabled: true,
    };
    const graphqlClient = makeGraphqlClient({ app: { byId: { id: 'app-1', ownerAccount } } });

    const result = await DeviceRunSessionAvailabilityQuery.byAppIdAsync(graphqlClient, 'app-1');

    expect(result).toEqual(ownerAccount);
  });
});
