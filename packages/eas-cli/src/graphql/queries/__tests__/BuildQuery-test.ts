import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { BuildQuery } from '../BuildQuery';

function makeGraphqlClient(data: unknown): {
  graphqlClient: ExpoGraphqlClient;
  query: jest.Mock;
} {
  const query = jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue({ data }),
  });
  return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
}

describe(BuildQuery.withSubmissionsByIdAsync.name, () => {
  it('returns the build submissions ordered from oldest to newest', async () => {
    const { graphqlClient, query } = makeGraphqlClient({
      builds: {
        byId: {
          id: 'build-id',
          submissionsPaginated: {
            edges: [
              { node: { id: 'newest-submission-id' } },
              { node: { id: 'oldest-submission-id' } },
            ],
          },
        },
      },
    });

    await expect(BuildQuery.withSubmissionsByIdAsync(graphqlClient, 'build-id')).resolves.toEqual({
      id: 'build-id',
      submissions: [{ id: 'oldest-submission-id' }, { id: 'newest-submission-id' }],
    });

    expect(query.mock.calls[0][0].loc.source.body).toContain('submissionsPaginated(first: 100)');
  });
});
