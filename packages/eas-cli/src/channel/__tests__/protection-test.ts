import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { protectUpdateChannelAsync, unprotectUpdateChannelAsync } from '../protection';

function makeGraphqlClient(data: unknown): {
  graphqlClient: ExpoGraphqlClient;
  mutation: jest.Mock;
} {
  const mutation = jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue({ data }),
  });
  return { graphqlClient: { mutation } as unknown as ExpoGraphqlClient, mutation };
}

describe(protectUpdateChannelAsync.name, () => {
  it('protects a channel by ID and returns the server state', async () => {
    const channel = {
      id: 'channel-id',
      name: 'production',
      branchMapping: '{"version":0,"data":[]}',
      isProtected: true,
    };
    const { graphqlClient, mutation } = makeGraphqlClient({
      updateChannel: { protectUpdateChannel: channel },
    });

    await expect(
      protectUpdateChannelAsync(graphqlClient, { channelId: 'channel-id' })
    ).resolves.toEqual(channel);

    expect(mutation.mock.calls[0][0].loc.source.body).toContain('protectUpdateChannel');
    expect(mutation.mock.calls[0][1]).toEqual({ channelId: 'channel-id' });
  });
});

describe(unprotectUpdateChannelAsync.name, () => {
  it('unprotects a channel by ID and returns the server state', async () => {
    const channel = {
      id: 'channel-id',
      name: 'production',
      branchMapping: '{"version":0,"data":[]}',
      isProtected: false,
    };
    const { graphqlClient, mutation } = makeGraphqlClient({
      updateChannel: { unprotectUpdateChannel: channel },
    });

    await expect(
      unprotectUpdateChannelAsync(graphqlClient, { channelId: 'channel-id' })
    ).resolves.toEqual(channel);

    expect(mutation.mock.calls[0][0].loc.source.body).toContain('unprotectUpdateChannel');
    expect(mutation.mock.calls[0][1]).toEqual({ channelId: 'channel-id' });
  });
});
