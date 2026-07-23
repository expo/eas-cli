import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { TurtleSshSessionQuery } from '../TurtleSshSessionQuery';

describe(TurtleSshSessionQuery.connectInfoForResourceAsync.name, () => {
  function makeClient(connectInfoForResource: unknown): {
    graphqlClient: ExpoGraphqlClient;
    query: jest.Mock;
  } {
    const query = jest.fn().mockReturnValue({
      toPromise: async () => ({ data: { turtleSshSessions: { connectInfoForResource } } }),
    });
    return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
  }

  it('returns the connect info for the resource id and forwards the id (network-only)', async () => {
    const connectInfo = {
      sshRequested: true,
      jobCompleted: false,
      session: { id: 'ts-1', connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx' } },
    };
    const { graphqlClient, query } = makeClient(connectInfo);

    expect(await TurtleSshSessionQuery.connectInfoForResourceAsync(graphqlClient, 'job-1')).toEqual(
      connectInfo
    );
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'job-1' },
      {
        requestPolicy: 'network-only',
      }
    );
  });

  it('returns null when the resource does not resolve', async () => {
    const { graphqlClient } = makeClient(null);
    expect(
      await TurtleSshSessionQuery.connectInfoForResourceAsync(graphqlClient, 'job-1')
    ).toBeNull();
  });
});
