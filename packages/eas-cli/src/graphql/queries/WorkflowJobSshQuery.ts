import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { GraphqlError, withErrorHandlingAsync } from '../client';
import { WorkflowJobStatus } from '../generated';

const FINAL_WORKFLOW_JOB_STATUSES = new Set<WorkflowJobStatus>([
  WorkflowJobStatus.Success,
  WorkflowJobStatus.Failure,
  WorkflowJobStatus.Canceled,
  WorkflowJobStatus.Skipped,
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
};
