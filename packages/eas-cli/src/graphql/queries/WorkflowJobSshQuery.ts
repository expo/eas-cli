import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { GraphqlError, withErrorHandlingAsync } from '../client';
import { JobRunStatus, WorkflowJobStatus } from '../generated';

const FINAL_WORKFLOW_JOB_STATUSES = new Set<WorkflowJobStatus>([
  WorkflowJobStatus.Success,
  WorkflowJobStatus.Failure,
  WorkflowJobStatus.Canceled,
  WorkflowJobStatus.Skipped,
]);

const FINAL_JOB_RUN_STATUSES = new Set<JobRunStatus>([
  JobRunStatus.Errored,
  JobRunStatus.Finished,
  JobRunStatus.Canceled,
]);

export type WorkflowJobSshConnectionConfig = {
  host: string;
  secret: string;
  reconnecting: boolean;
};

export type WorkflowJobSshSession = {
  id: string;
  connectionConfig: WorkflowJobSshConnectionConfig;
};

export type WorkflowJobSshConnectInfo = {
  sshRequested: boolean;
  jobCompleted: boolean;
  session: WorkflowJobSshSession | null;
};

type WorkflowJobSshPollQuery = {
  workflowJobs: {
    byId: {
      id: string;
      status: WorkflowJobStatus;
      workflowRun: {
        id: string;
        sshSettings: { idleTimeoutSeconds: number } | null;
      };
      turtleJobRun: { id: string; sshSession: WorkflowJobSshSession | null } | null;
      turtleBuild: { id: string; sshSession: WorkflowJobSshSession | null } | null;
    };
  };
};

type WorkflowJobSshPollQueryVariables = {
  workflowJobId: string;
};

type JobRunSshPollQuery = {
  jobRun: {
    byId: {
      id: string;
      status: JobRunStatus;
      sshSession: WorkflowJobSshSession | null;
    };
  };
};

type JobRunSshPollQueryVariables = {
  jobRunId: string;
};

function toConnectInfo(
  job: WorkflowJobSshPollQuery['workflowJobs']['byId']
): WorkflowJobSshConnectInfo {
  const hasTurtleTarget = job.turtleJobRun != null || job.turtleBuild != null;
  return {
    sshRequested: hasTurtleTarget && job.workflowRun.sshSettings != null,
    jobCompleted: FINAL_WORKFLOW_JOB_STATUSES.has(job.status),
    session: job.turtleJobRun?.sshSession ?? job.turtleBuild?.sshSession ?? null,
  };
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof GraphqlError)) {
    return false;
  }
  return error.graphQLErrors.some(e => {
    const code = e?.extensions?.errorCode ?? e?.extensions?.code;
    return (
      code === 'ENTITY_NOT_FOUND' ||
      /Entity not found/i.test(e?.message ?? '') ||
      /not found/i.test(e?.message ?? '')
    );
  });
}

export const WorkflowJobSshQuery = {
  async connectInfoForWorkflowJobAsync(
    graphqlClient: ExpoGraphqlClient,
    workflowJobId: string
  ): Promise<WorkflowJobSshConnectInfo | null> {
    let data: WorkflowJobSshPollQuery;
    try {
      data = await withErrorHandlingAsync(
        graphqlClient
          .query<WorkflowJobSshPollQuery, WorkflowJobSshPollQueryVariables>(
            gql`
              query WorkflowJobSshPoll($workflowJobId: ID!) {
                workflowJobs {
                  byId(workflowJobId: $workflowJobId) {
                    id
                    status
                    workflowRun {
                      id
                      sshSettings {
                        idleTimeoutSeconds
                      }
                    }
                    turtleJobRun {
                      id
                      sshSession {
                        id
                        connectionConfig {
                          host
                          secret
                          reconnecting
                        }
                      }
                    }
                    turtleBuild {
                      id
                      sshSession {
                        id
                        connectionConfig {
                          host
                          secret
                          reconnecting
                        }
                      }
                    }
                  }
                }
              }
            `,
            { workflowJobId },
            { requestPolicy: 'network-only' }
          )
          .toPromise()
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
    return toConnectInfo(data.workflowJobs.byId);
  },

  async connectInfoForJobRunAsync(
    graphqlClient: ExpoGraphqlClient,
    jobRunId: string
  ): Promise<WorkflowJobSshConnectInfo | null> {
    let data: JobRunSshPollQuery;
    try {
      data = await withErrorHandlingAsync(
        graphqlClient
          .query<JobRunSshPollQuery, JobRunSshPollQueryVariables>(
            gql`
              query JobRunSshPoll($jobRunId: ID!) {
                jobRun {
                  byId(jobRunId: $jobRunId) {
                    id
                    status
                    sshSession {
                      id
                      connectionConfig {
                        host
                        secret
                        reconnecting
                      }
                    }
                  }
                }
              }
            `,
            { jobRunId },
            { requestPolicy: 'network-only' }
          )
          .toPromise()
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
    const jobRun = data.jobRun.byId;
    const jobCompleted = FINAL_JOB_RUN_STATUSES.has(jobRun.status);
    return {
      sshRequested: jobRun.sshSession != null || jobCompleted,
      jobCompleted,
      session: jobRun.sshSession,
    };
  },

  async connectInfoForResourceIdAsync(
    graphqlClient: ExpoGraphqlClient,
    resourceId: string
  ): Promise<WorkflowJobSshConnectInfo | null> {
    return (
      (await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(graphqlClient, resourceId)) ??
      (await WorkflowJobSshQuery.connectInfoForJobRunAsync(graphqlClient, resourceId))
    );
  },
};
