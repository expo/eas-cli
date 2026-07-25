import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { GraphqlError } from '../../client';
import { WorkflowJobStatus, WorkflowJobType } from '../../generated';
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
      type: WorkflowJobType.Custom,
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

  it('treats GET_BUILD as not ssh-requested even when the run has sshSettings', async () => {
    const { graphqlClient } = makeClient({
      id: 'job-1',
      status: WorkflowJobStatus.InProgress,
      type: WorkflowJobType.GetBuild,
      workflowRun: { sshSettings: { idleTimeoutSeconds: 0 } },
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
});
