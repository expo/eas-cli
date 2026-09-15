import { LogsState } from '../state';
import { RawLogLine } from '../types';

function fileLine(logId: string, msg: string, buildStepId = 'install'): RawLogLine {
  return { logId, buildStepId, msg };
}

function stepMessages(logsState: LogsState): string[] {
  return Array.from(logsState.getLogs().values()).flatMap(group =>
    group.logLines.map(logLine => logLine.msg)
  );
}

describe(LogsState, () => {
  it('hides realtime lines until the file logs reach them', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('5', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first']);
  });

  it('shows realtime lines once a published logId also appears in the file', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);
    logsState.ingestFileLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);
    logsState.ingestRealtimeLogLines([fileLine('3', 'newer')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed', 'newer']);
  });

  it('shows realtime logs when a publication repeats a logId already in the file', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });

  it('shows buffered realtime lines once the job is completed', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('9', 'pushed')]);

    logsState.markCompleted();
    logsState.markCompleted();

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });

  it('folds later publications once completion showed them', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('9', 'buffered')]);
    logsState.markCompleted();

    logsState.ingestRealtimeLogLines([fileLine('10', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'buffered', 'pushed']);
  });

  it('replaces the file snapshot instead of accumulating it', () => {
    const logsState = new LogsState();
    const keyless: RawLogLine = { buildStepId: 'install', msg: 'submission log' };

    logsState.ingestFileLogLines([keyless]);
    logsState.ingestFileLogLines([keyless]);

    expect(stepMessages(logsState)).toEqual(['submission log']);
  });

  it('drops a buffered realtime line once it lands in the file', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);
    logsState.ingestFileLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });

  it('ignores publications that are not arrays of log lines', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);

    expect(logsState.ingestRealtimeLogLines({ logId: '2', msg: 'not an array' })).toBe(false);
    expect(logsState.ingestRealtimeLogLines(['a string', 42, null])).toBe(false);
    expect(logsState.ingestRealtimeLogLines([{ msg: 'no logId' }])).toBe(false);
    expect(stepMessages(logsState)).toEqual(['first']);
  });

  it('deduplicates a line republished on the same channel', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });

  it('deduplicates a line republished later', () => {
    const logsState = new LogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);
    logsState.ingestRealtimeLogLines([fileLine('3', 'newer')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed', 'newer']);
  });
});
