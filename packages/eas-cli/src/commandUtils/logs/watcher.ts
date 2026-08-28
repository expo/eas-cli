import { LogsState } from './state';
import { RawLogLine } from './types';
import { RealtimeLogsTargetInput } from '../../graphql/generated';
import Log from '../../log';
import { RealtimeLogsClient, RealtimeLogsSubscription } from '../../utils/centrifuge';
import nullthrows from 'nullthrows';

export type LogSource = {
  key: string;
  realtimeTarget: RealtimeLogsTargetInput | null;
  isInProgress: boolean;
  fetchRawLogLinesAsync: () => Promise<RawLogLine[] | null>;
};

type TrackedSource = {
  logsState: LogsState;
  subscription: RealtimeLogsSubscription | null;
};

export class LogsWatcher {
  private readonly trackedSources = new Map<string, TrackedSource>();
  private realtimeLogsClient?: RealtimeLogsClient | null;

  constructor(
    private readonly createRealtimeLogsClient: () => RealtimeLogsClient | null,
    private readonly onRealtimeLogs: () => void
  ) {}

  public async syncAsync(sources: LogSource[]): Promise<Map<string, LogsState>> {
    await Promise.all(sources.map(source => this.syncSourceAsync(source)));
    return new Map(
      sources.map(source => [
        source.key,
        nullthrows(
          this.trackedSources.get(source.key),
          'source has to be in tracked sources after it was synced'
        ).logsState,
      ])
    );
  }

  public close(): void {
    for (const trackedSource of this.trackedSources.values()) {
      trackedSource.subscription?.close();
      trackedSource.subscription = null;
    }
    this.realtimeLogsClient?.close();
  }

  private async syncSourceAsync(source: LogSource): Promise<void> {
    let trackedSource = this.trackedSources.get(source.key);
    if (!trackedSource) {
      trackedSource = { logsState: new LogsState(), subscription: null };
      this.trackedSources.set(source.key, trackedSource);
    }

    if (!source.isInProgress) {
      trackedSource.subscription?.close();
      trackedSource.subscription = null;
      return;
    }

    await Promise.all([
      trackedSource.subscription ? Promise.resolve() : this.subscribeAsync(source, trackedSource),
      this.fetchLogsAsync(source, trackedSource),
    ]);
  }

  private async fetchLogsAsync(source: LogSource, trackedSource: TrackedSource): Promise<void> {
    try {
      const logLines = await source.fetchRawLogLinesAsync();
      if (logLines) {
        trackedSource.logsState.ingestFileLogLines(logLines);
      }
    } catch (err: any) {
      Log.debug(`Failed to fetch logs for job ${source.key}: ${err.message}`);
    }
  }

  private getRealtimeLogsClient(): RealtimeLogsClient | null {
    if (this.realtimeLogsClient === undefined) {
      this.realtimeLogsClient = this.createRealtimeLogsClient();
    }
    return this.realtimeLogsClient;
  }

  private async subscribeAsync(source: LogSource, trackedSource: TrackedSource): Promise<void> {
    const target = source.realtimeTarget;
    if (!target) {
      return;
    }
    const realtimeLogsClient = this.getRealtimeLogsClient();
    if (!realtimeLogsClient) {
      return;
    }
    trackedSource.subscription = await realtimeLogsClient.subscribeAsync({ target }, data => {
      if (trackedSource.logsState.ingestRealtimeLogLines(data)) {
        this.onRealtimeLogs();
      }
    });
  }
}
