import { fetchAndParseLogsFromJobAsync, groupLogLinesIntoSteps, mergeLogLines } from './parseLogs';
import { WorkflowJobResult, WorkflowLogs, WorkflowRawLogLine } from '../types';
import {
  RealtimeLogsTargetInput,
  RealtimeLogsTargetType,
  WorkflowJobStatus,
} from '../../../graphql/generated';
import Log from '../../../log';
import { RealtimeLogsClient, RealtimeLogsSubscription } from '../../../utils/centrifuge';
import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';
import nullthrows from 'nullthrows';

type RealtimeLogLine = WorkflowRawLogLine & { logId: string };

function isRealtimeLogLine(entry: unknown): entry is RealtimeLogLine {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as Partial<WorkflowRawLogLine>).logId === 'string'
  );
}

export class WorkflowJobLogsState {
  private fileLogIds = new Set<string>();
  private realtimeLogLines: RealtimeLogLine[] = [];
  private realtimeLogIds = new Set<string>();
  private haveFileLogsCaughtUp = false;
  private realtimeLogsRevealed = false;
  private groupedLogs: WorkflowLogs = new Map();

  public ingestFileLogLines(logLines: WorkflowRawLogLine[]): void {
    this.fileLogIds = new Set(logLines.flatMap(logLine => (logLine.logId ? [logLine.logId] : [])));

    if (
      !this.haveFileLogsCaughtUp &&
      this.realtimeLogLines.some(logLine => this.fileLogIds.has(logLine.logId))
    ) {
      this.haveFileLogsCaughtUp = true;
    }
    this.realtimeLogLines = this.realtimeLogLines.filter(
      logLine => !this.fileLogIds.has(logLine.logId)
    );
    this.realtimeLogIds = new Set(this.realtimeLogLines.map(logLine => logLine.logId));

    if (this.haveFileLogsCaughtUp) {
      this.realtimeLogsRevealed = true;
    }
    this.groupedLogs = groupLogLinesIntoSteps(
      mergeLogLines(logLines, this.realtimeLogsRevealed ? this.realtimeLogLines : [])
    );
  }

  public ingestRealtimeLogLines(data: unknown): boolean {
    if (!Array.isArray(data)) {
      return false;
    }
    const publishedLogLines = data.filter(isRealtimeLogLine);
    if (publishedLogLines.length === 0) {
      return false;
    }

    if (
      !this.haveFileLogsCaughtUp &&
      publishedLogLines.some(logLine => this.fileLogIds.has(logLine.logId))
    ) {
      this.haveFileLogsCaughtUp = true;
    }

    const newLogLines = publishedLogLines.filter(
      logLine => !this.fileLogIds.has(logLine.logId) && !this.realtimeLogIds.has(logLine.logId)
    );
    for (const logLine of newLogLines) {
      this.realtimeLogLines.push(logLine);
      this.realtimeLogIds.add(logLine.logId);
    }

    if (!this.realtimeLogsRevealed) {
      if (this.haveFileLogsCaughtUp) {
        this.revealRealtimeLogs();
      }
    } else if (newLogLines.length > 0) {
      groupLogLinesIntoSteps(newLogLines, this.groupedLogs);
    }

    return true;
  }

  public markCompleted(): void {
    this.revealRealtimeLogs();
  }

  public getLogs(): WorkflowLogs {
    return this.groupedLogs;
  }

  private revealRealtimeLogs(): void {
    if (this.realtimeLogsRevealed) {
      return;
    }
    this.realtimeLogsRevealed = true;
    groupLogLinesIntoSteps(this.realtimeLogLines, this.groupedLogs);
  }
}

type TrackedJob = {
  logsState: WorkflowJobLogsState;
  subscription: RealtimeLogsSubscription | null;
};

export function realtimeLogsTargetForJob(job: WorkflowJobResult): RealtimeLogsTargetInput | null {
  if (job.turtleJobRun?.id) {
    return { type: RealtimeLogsTargetType.JobRun, id: job.turtleJobRun.id };
  }
  const buildId = job.turtleBuild?.id ?? job.outputs?.build_id;
  if (buildId) {
    return { type: RealtimeLogsTargetType.Build, id: buildId };
  }
  return null;
}

export class WorkflowRunLogsWatcher {
  private readonly trackedJobs = new Map<string, TrackedJob>();
  private realtimeLogsClient?: RealtimeLogsClient | null;

  constructor(
    private readonly graphqlClient: ExpoGraphqlClient,
    private readonly createRealtimeLogsClient: () => RealtimeLogsClient | null,
    private readonly onRealtimeLogs: () => void
  ) {}

  public async syncJobsAsync(
    jobs: WorkflowJobResult[]
  ): Promise<Map<string, WorkflowJobLogsState>> {
    await Promise.all(jobs.map(job => this.syncJobAsync(job)));
    return new Map(
      jobs.map(job => [
        job.id,
        nullthrows(
          this.trackedJobs.get(job.id),
          'job has to be in tracked jobs after it was synced'
        ).logsState,
      ])
    );
  }

  public close(): void {
    for (const trackedJob of this.trackedJobs.values()) {
      trackedJob.subscription?.close();
      trackedJob.subscription = null;
    }
    this.realtimeLogsClient?.close();
  }

  private async syncJobAsync(job: WorkflowJobResult): Promise<void> {
    let trackedJob = this.trackedJobs.get(job.id);
    if (!trackedJob) {
      trackedJob = { logsState: new WorkflowJobLogsState(), subscription: null };
      this.trackedJobs.set(job.id, trackedJob);
    }

    const workflowInProgress = job.status === WorkflowJobStatus.InProgress;
    if (!workflowInProgress) {
      trackedJob.subscription?.close();
      trackedJob.subscription = null;
      return;
    }

    await Promise.all([
      trackedJob.subscription ? Promise.resolve() : this.subscribeAsync(job, trackedJob),
      this.fetchLogsAsync(job, trackedJob),
    ]);
  }

  private async fetchLogsAsync(job: WorkflowJobResult, trackedJob: TrackedJob): Promise<void> {
    try {
      const logLines = await fetchAndParseLogsFromJobAsync(
        { graphqlClient: this.graphqlClient },
        job
      );
      if (logLines) {
        trackedJob.logsState.ingestFileLogLines(logLines);
      }
    } catch (err: any) {
      Log.debug(`Failed to fetch logs for job ${job.id}: ${err.message}`);
    }
  }

  private getRealtimeLogsClient(): RealtimeLogsClient | null {
    if (this.realtimeLogsClient === undefined) {
      this.realtimeLogsClient = this.createRealtimeLogsClient();
    }
    return this.realtimeLogsClient;
  }

  private async subscribeAsync(job: WorkflowJobResult, trackedJob: TrackedJob): Promise<void> {
    const target = realtimeLogsTargetForJob(job);
    if (!target) {
      return;
    }
    const realtimeLogsClient = this.getRealtimeLogsClient();
    if (!realtimeLogsClient) {
      return;
    }
    trackedJob.subscription = await realtimeLogsClient.subscribeAsync({ target }, data => {
      if (trackedJob.logsState.ingestRealtimeLogLines(data)) {
        this.onRealtimeLogs();
      }
    });
  }
}
