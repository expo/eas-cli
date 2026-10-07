import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { GraphqlError } from '../../client';
import { BuildStatus, JobRunStatus, WorkflowJobStatus } from '../../generated';
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

describe(WorkflowJobSshQuery.connectInfoForBuildAsync.name, () => {
  function makeClient(byId: unknown): {
    graphqlClient: ExpoGraphqlClient;
    query: jest.Mock;
  } {
    const query = jest.fn().mockReturnValue({
      toPromise: async () => ({ data: { builds: { byId } } }),
    });
    return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
  }

  it('maps builds.byId into connect info', async () => {
    const { graphqlClient, query } = makeClient({
      id: 'build-1',
      status: BuildStatus.InProgress,
      sshSession: {
        id: 'ts-1',
        connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx', reconnecting: false },
      },
    });

    expect(await WorkflowJobSshQuery.connectInfoForBuildAsync(graphqlClient, 'build-1')).toEqual({
      sshRequested: true,
      jobCompleted: false,
      session: {
        id: 'ts-1',
        connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx', reconnecting: false },
      },
    });
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      { buildId: 'build-1' },
      { requestPolicy: 'network-only' }
    );
  });

  it('is not ssh-requested when the build has no sshSession', async () => {
    const { graphqlClient } = makeClient({
      id: 'build-1',
      status: BuildStatus.InProgress,
      sshSession: null,
    });

    expect(await WorkflowJobSshQuery.connectInfoForBuildAsync(graphqlClient, 'build-1')).toEqual({
      sshRequested: false,
      jobCompleted: false,
      session: null,
    });
  });

  it.each([BuildStatus.Errored, BuildStatus.Finished, BuildStatus.Canceled])(
    'treats %s as completed',
    async status => {
      const { graphqlClient } = makeClient({ id: 'build-1', status, sshSession: null });

      expect(
        await WorkflowJobSshQuery.connectInfoForBuildAsync(graphqlClient, 'build-1')
      ).toMatchObject({ jobCompleted: true });
    }
  );

  it.each([BuildStatus.New, BuildStatus.InQueue, BuildStatus.PendingCancel])(
    'treats %s as not completed',
    async status => {
      const { graphqlClient } = makeClient({ id: 'build-1', status, sshSession: null });

      expect(
        await WorkflowJobSshQuery.connectInfoForBuildAsync(graphqlClient, 'build-1')
      ).toMatchObject({ jobCompleted: false });
    }
  );

  it('returns null when the build is not found', async () => {
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
    expect(await WorkflowJobSshQuery.connectInfoForBuildAsync(graphqlClient, 'missing')).toBeNull();
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
      WorkflowJobSshQuery.connectInfoForBuildAsync(graphqlClient, 'build-1')
    ).rejects.toBe(error);
  });
});

describe(WorkflowJobSshQuery.connectInfoForResourceIdAsync.name, () => {
  const notFound = new GraphqlError({
    graphQLErrors: [{ message: 'Entity not found', extensions: { errorCode: 'ENTITY_NOT_FOUND' } }],
    networkError: undefined,
    response: undefined,
  });
  const session = {
    id: 'ts-1',
    connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx', reconnecting: false },
  };

  function makeClient(found: { workflowJob?: unknown; build?: unknown; jobRun?: unknown }): {
    graphqlClient: ExpoGraphqlClient;
    query: jest.Mock;
  } {
    const query = jest.fn((_document: unknown, variables: Record<string, string>) => ({
      toPromise: async () => {
        if ('workflowJobId' in variables) {
          return found.workflowJob
            ? { data: { workflowJobs: { byId: found.workflowJob } } }
            : { data: undefined, error: notFound };
        }
        if ('buildId' in variables) {
          return found.build
            ? { data: { builds: { byId: found.build } } }
            : { data: undefined, error: notFound };
        }
        return found.jobRun
          ? { data: { jobRun: { byId: found.jobRun } } }
          : { data: undefined, error: notFound };
      },
    }));
    return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
  }

  function queriedVariables(query: jest.Mock): unknown[] {
    return query.mock.calls.map(([, variables]) => variables);
  }

  it('returns the workflow job without querying builds or job runs', async () => {
    const { graphqlClient, query } = makeClient({
      workflowJob: {
        id: 'id-1',
        status: WorkflowJobStatus.InProgress,
        workflowRun: { sshSettings: { idleTimeoutSeconds: 0 } },
        turtleJobRun: { sshSession: session },
        turtleBuild: null,
      },
      build: { id: 'id-1', status: BuildStatus.Finished, sshSession: null },
    });

    expect(await WorkflowJobSshQuery.connectInfoForResourceIdAsync(graphqlClient, 'id-1')).toEqual({
      sshRequested: true,
      jobCompleted: false,
      session,
    });
    expect(queriedVariables(query)).toEqual([{ workflowJobId: 'id-1' }]);
  });

  it('falls back to the build when the id is not a workflow job', async () => {
    const { graphqlClient, query } = makeClient({
      build: { id: 'id-1', status: BuildStatus.InProgress, sshSession: session },
      jobRun: { id: 'id-1', status: JobRunStatus.Finished, sshSession: null },
    });

    expect(await WorkflowJobSshQuery.connectInfoForResourceIdAsync(graphqlClient, 'id-1')).toEqual({
      sshRequested: true,
      jobCompleted: false,
      session,
    });
    expect(queriedVariables(query)).toEqual([{ workflowJobId: 'id-1' }, { buildId: 'id-1' }]);
  });

  it('falls back to the job run when the id is neither a workflow job nor a build', async () => {
    const { graphqlClient, query } = makeClient({
      jobRun: { id: 'id-1', status: JobRunStatus.InProgress, sshSession: session },
    });

    expect(await WorkflowJobSshQuery.connectInfoForResourceIdAsync(graphqlClient, 'id-1')).toEqual({
      sshRequested: true,
      jobCompleted: false,
      session,
    });
    expect(queriedVariables(query)).toEqual([
      { workflowJobId: 'id-1' },
      { buildId: 'id-1' },
      { jobRunId: 'id-1' },
    ]);
  });

  it('returns null when no resource matches the id', async () => {
    const { graphqlClient } = makeClient({});

    expect(
      await WorkflowJobSshQuery.connectInfoForResourceIdAsync(graphqlClient, 'missing')
    ).toBeNull();
  });
});
