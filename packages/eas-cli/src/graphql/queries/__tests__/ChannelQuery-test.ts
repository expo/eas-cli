import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { ChannelQuery } from '../ChannelQuery';

function makeGraphqlClient(data: unknown): {
  graphqlClient: ExpoGraphqlClient;
  query: jest.Mock;
} {
  const query = jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue({ data }),
  });
  return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
}

describe(ChannelQuery.viewUpdateChannelAsync.name, () => {
  it('requests and returns channel protection state', async () => {
    const channel = {
      id: 'channel-id',
      name: 'production',
      isPaused: false,
      isProtected: true,
      updatedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      branchMapping: '{"version":0,"data":[]}',
      updateBranches: [],
    };
    const { graphqlClient, query } = makeGraphqlClient({
      app: { byId: { id: 'app-id', updateChannelByName: channel } },
    });

    await expect(
      ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
        appId: 'app-id',
        channelName: 'production',
      })
    ).resolves.toEqual(channel);

    expect(query.mock.calls[0][0].loc.source.body).toContain('isProtected');
  });
});

describe(ChannelQuery.viewUpdateChannelsOnAppAsync.name, () => {
  it('requests and returns protection state for every channel', async () => {
    const channels = [
      {
        id: 'channel-id',
        name: 'production',
        isPaused: false,
        isProtected: true,
        updatedAt: '2026-08-31T00:00:00.000Z',
        createdAt: '2026-08-31T00:00:00.000Z',
        branchMapping: '{"version":0,"data":[]}',
        updateBranches: [],
      },
    ];
    const { graphqlClient, query } = makeGraphqlClient({
      app: { byId: { id: 'app-id', updateChannels: channels } },
    });

    await expect(
      ChannelQuery.viewUpdateChannelsOnAppAsync(graphqlClient, {
        appId: 'app-id',
        limit: 10,
        offset: 0,
      })
    ).resolves.toEqual(channels);

    expect(query.mock.calls[0][0].loc.source.body).toContain('isProtected');
  });
});
