import { anything, capture, instance, mock, when } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AuditLogQuery } from '../AuditLogQuery';

describe(AuditLogQuery.getAllForAccountAsync.name, () => {
  it('returns the audit log connection for an account and forwards pagination params', async () => {
    const connection = {
      edges: [
        {
          cursor: 'cursor-1',
          node: {
            id: 'audit-log-id',
            createdAt: '2026-05-21T17:43:32.433Z',
            websiteMessage: 'Created a new Project',
            targetEntityTypePublicName: 'Project',
            targetEntityMutationType: 'CREATE',
            actor: { id: 'actor-id', displayName: 'tester' },
          },
        },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: 'cursor-1',
        endCursor: 'cursor-1',
      },
    };

    const graphqlClientMock = mock<ExpoGraphqlClient>();
    when(graphqlClientMock.query(anything(), anything(), anything())).thenReturn({
      toPromise: () =>
        Promise.resolve({ data: { account: { byId: { auditLogsPaginated: connection } } } }),
    } as any);
    const graphqlClient = instance(graphqlClientMock);

    const result = await AuditLogQuery.getAllForAccountAsync(graphqlClient, 'account-id', {
      first: 10,
      after: 'cursor-0',
    });

    expect(result).toBe(connection);

    const [, variables] = capture<any, any, any>(graphqlClientMock.query as any).first();
    expect(variables).toMatchObject({ accountId: 'account-id', first: 10, after: 'cursor-0' });
  });
});
