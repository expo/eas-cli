import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { GraphqlError } from '../../client';
import { WorkflowJobStatus } from '../../generated';
import { WorkflowJobSshQuery } from '../WorkflowJobSshQuery';

describe(WorkflowJobSshQuery.connectInfoForWorkflowJobAsync.name, () => {
  function makeClient(byId: unknown): {
    graphqlClient: ExpoGraphqlClient;
    query: jest.Mock;
  } {
    const query = jest.fn().mockReturnValue({
      toPromise: async () => ({ data: { workflowJobs: { byId } } }),
    });
    return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
  }

  it('maps workflowJobs.byId into connect info', async () => {
    const { graphqlClient, query } = makeClient({
      id: 'job-1',
      status: WorkflowJobStatus.InProgress,
      workflowRun: { sshSettings: { idleTimeoutSeconds: 0 } },
      turtleJobRun: {
        sshSession: {
          id: 'ts-1',
          connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx', reconnecting: false },
        },
      },
      turtleBuild: null,
    });

    expect(
      await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'job-1')
    ).toEqual({
      sshRequested: true,
      jobCompleted: false,
      session: {
        id: 'ts-1',
        connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx', reconnecting: false },
      },
    });
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      { workflowJobId: 'job-1' },
      { requestPolicy: 'network-only' }
    );
  });

  it('is not ssh-requested when the run has no sshSettings', async () => {
    const { graphqlClient } = makeClient({
      id: 'job-1',
      status: WorkflowJobStatus.InProgress,
      workflowRun: { sshSettings: null },
      turtleJobRun: null,
      turtleBuild: { sshSession: null },
    });

    expect(
      await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'job-1')
    ).toMatchObject({ sshRequested: false });
  });

  it('returns null when the job is not found', async () => {
    const query = jest.fn().mockReturnValue({
      toPromise: async () => ({
        data: undefined,
        error: new GraphqlError({
          graphQLErrors: [
            { message: 'Entity not found', extensions: { errorCode: 'ENTITY_NOT_FOUND' } },
          ],
          networkError: undefined,
          response: undefined,
        }),
      }),
    });
    const graphqlClient = { query } as unknown as ExpoGraphqlClient;
    expect(
      await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'missing')
    ).toBeNull();
  });

  it('returns null for not-found errors matched by message or code', async () => {
    for (const graphQLErrors of [
      [{ message: 'Workflow job not found', extensions: {} }],
      [{ message: 'missing', extensions: { code: 'ENTITY_NOT_FOUND' } }],
    ]) {
      const query = jest.fn().mockReturnValue({
        toPromise: async () => ({
          data: undefined,
          error: new GraphqlError({
            graphQLErrors,
            networkError: undefined,
            response: undefined,
          }),
        }),
      });
      const graphqlClient = { query } as unknown as ExpoGraphqlClient;
      expect(
        await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'missing')
      ).toBeNull();
    }
  });

  it('uses the turtleBuild session when there is no turtleJobRun', async () => {
    const { graphqlClient } = makeClient({
      id: 'job-1',
      status: WorkflowJobStatus.Success,
      workflowRun: { sshSettings: { idleTimeoutSeconds: 60 } },
      turtleJobRun: null,
      turtleBuild: {
        sshSession: {
          id: 'ts-build',
          connectionConfig: { host: 'relay.expo.dev', secret: 'TOK', reconnecting: true },
        },
      },
    });

    expect(
      await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'job-1')
    ).toEqual({
      sshRequested: true,
      jobCompleted: true,
      session: {
        id: 'ts-build',
        connectionConfig: { host: 'relay.expo.dev', secret: 'TOK', reconnecting: true },
      },
    });
  });

  it('rethrows GraphQL errors that are not not-found', async () => {
    const error = new GraphqlError({
      graphQLErrors: [{ message: 'boom', extensions: { errorCode: 'INTERNAL' } }],
      networkError: undefined,
      response: undefined,
    });
    const query = jest.fn().mockReturnValue({
      toPromise: async () => ({ data: undefined, error }),
    });
    const graphqlClient = { query } as unknown as ExpoGraphqlClient;
    await expect(
      WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'job-1')
    ).rejects.toBe(error);
  });

  it('rethrows unexpected non-GraphQL errors', async () => {
    const query = jest.fn().mockReturnValue({
      toPromise: async () => {
        throw new Error('network down');
      },
    });
    const graphqlClient = { query } as unknown as ExpoGraphqlClient;
    await expect(
      WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, 'job-1')
    ).rejects.toThrow('network down');
  });
});
