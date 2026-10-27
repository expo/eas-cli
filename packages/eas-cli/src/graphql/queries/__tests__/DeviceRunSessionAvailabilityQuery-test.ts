import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionAvailabilityQuery } from '../DeviceRunSessionAvailabilityQuery';

function makeGraphqlClient(accountFeatureGates: Record<string, boolean>): ExpoGraphqlClient {
  return {
    query: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({
        data: {
          app: {
            byId: {
              id: 'app-1',
              ownerAccount: { id: 'account-1', name: 'testuser', accountFeatureGates },
            },
          },
        },
      }),
    }),
  } as unknown as ExpoGraphqlClient;
}

describe('DeviceRunSessionAvailabilityQuery.byAppIdAsync', () => {
  it('returns available true when the feature gate is enabled', async () => {
    const graphqlClient = makeGraphqlClient({ 'device-run-sessions': true });

    const result = await DeviceRunSessionAvailabilityQuery.byAppIdAsync(graphqlClient, 'app-1');

    expect(result).toEqual({ accountName: 'testuser', available: true });
  });

  it('returns available false when the feature gate is disabled or absent', async () => {
    const graphqlClient = makeGraphqlClient({});

    const result = await DeviceRunSessionAvailabilityQuery.byAppIdAsync(graphqlClient, 'app-1');

    expect(result).toEqual({ accountName: 'testuser', available: false });
  });
});
