import { getMockWorkflowRunWithJobsFragment } from '../../../__tests__/commands/utils';
import {
  RealtimeLogsTargetType,
  WorkflowJobStatus,
  WorkflowJobType,
} from '../../../graphql/generated';
import { fetchRawLogsForJobAsync } from '../fetchLogs';
import { logSourceForWorkflowJob } from '../logs';
import { WorkflowJobResult } from '../types';

jest.mock('../fetchLogs');

function inProgressJob(): WorkflowJobResult {
  const job = getMockWorkflowRunWithJobsFragment().jobs[0];
  return { ...job, status: WorkflowJobStatus.InProgress };
}

describe(logSourceForWorkflowJob, () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keys the source by the job id', () => {
    expect(logSourceForWorkflowJob({} as any, inProgressJob()).key).toBe('job1');
  });

  it('is in progress only while the job is in progress', () => {
    const job = inProgressJob();

    expect(logSourceForWorkflowJob({} as any, job).isInProgress).toBe(true);
    for (const status of [
      WorkflowJobStatus.New,
      WorkflowJobStatus.ActionRequired,
      WorkflowJobStatus.PendingCancel,
      WorkflowJobStatus.Success,
      WorkflowJobStatus.Failure,
      WorkflowJobStatus.Canceled,
      WorkflowJobStatus.Skipped,
    ]) {
      expect(logSourceForWorkflowJob({} as any, { ...job, status }).isInProgress).toBe(false);
    }
  });

  it('targets the turtle job run when there is one', () => {
    const job = { ...inProgressJob(), turtleJobRun: { id: 'job-run-id' } } as WorkflowJobResult;

    expect(logSourceForWorkflowJob({} as any, job).realtimeTarget).toEqual({
      type: RealtimeLogsTargetType.JobRun,
      id: 'job-run-id',
    });
  });

  it('falls back to the build when there is no turtle job run', () => {
    const withTurtleBuild = {
      ...inProgressJob(),
      turtleJobRun: null,
      turtleBuild: { id: 'build-id' },
    } as WorkflowJobResult;
    const withBuildOutput = {
      ...inProgressJob(),
      turtleJobRun: null,
      turtleBuild: null,
      outputs: { build_id: 'output-build-id' },
    } as WorkflowJobResult;

    expect(logSourceForWorkflowJob({} as any, withTurtleBuild).realtimeTarget).toEqual({
      type: RealtimeLogsTargetType.Build,
      id: 'build-id',
    });
    expect(logSourceForWorkflowJob({} as any, withBuildOutput).realtimeTarget).toEqual({
      type: RealtimeLogsTargetType.Build,
      id: 'output-build-id',
    });
  });

  it('has no realtime target when neither is present', () => {
    const job = {
      ...inProgressJob(),
      turtleJobRun: null,
      turtleBuild: null,
      outputs: null,
    } as WorkflowJobResult;

    expect(logSourceForWorkflowJob({} as any, job).realtimeTarget).toBeNull();
  });

  it('fetches and parses the job logs with the graphql client it was given', async () => {
    const graphqlClient = {} as any;
    const job = { ...inProgressJob(), type: WorkflowJobType.Build } as WorkflowJobResult;
    jest
      .mocked(fetchRawLogsForJobAsync)
      .mockResolvedValue(
        [
          '{"logId":"1","buildStepId":"install","msg":"npm ci"}',
          '{"logId":"2","buildStepId":"install","msg":"done"}',
        ].join('\n')
      );

    await expect(
      logSourceForWorkflowJob(graphqlClient, job).fetchRawLogLinesAsync()
    ).resolves.toEqual([
      { logId: '1', buildStepId: 'install', msg: 'npm ci' },
      { logId: '2', buildStepId: 'install', msg: 'done' },
    ]);

    expect(fetchRawLogsForJobAsync).toHaveBeenCalledWith({ graphqlClient }, job);
  });
});
