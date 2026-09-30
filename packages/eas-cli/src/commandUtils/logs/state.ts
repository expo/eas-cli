import { groupLogLinesIntoSteps, mergeLogLines } from './parseLogs';
import { JobLogs, RawLogLine } from './types';

type RealtimeLogLine = RawLogLine & { logId: string };

function isRealtimeLogLine(entry: unknown): entry is RealtimeLogLine {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as Partial<RawLogLine>).logId === 'string'
  );
}

export class LogsState {
  private fileLogIds = new Set<string>();
  private realtimeLogLines: RealtimeLogLine[] = [];
  private realtimeLogIds = new Set<string>();
  private haveFileLogsCaughtUp = false;
  private realtimeLogsRevealed = false;
  private jobLogs: JobLogs = new Map();

  public ingestFileLogLines(logLines: RawLogLine[]): void {
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
    this.jobLogs = groupLogLinesIntoSteps(
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
      groupLogLinesIntoSteps(newLogLines, this.jobLogs);
    }

    return true;
  }

  public markCompleted(): void {
    this.revealRealtimeLogs();
  }

  public getLogs(): JobLogs {
    return this.jobLogs;
  }

  private revealRealtimeLogs(): void {
    if (this.realtimeLogsRevealed) {
      return;
    }
    this.realtimeLogsRevealed = true;
    groupLogLinesIntoSteps(this.realtimeLogLines, this.jobLogs);
  }
}
