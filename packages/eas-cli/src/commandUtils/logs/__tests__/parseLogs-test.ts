import { groupLogLinesIntoSteps, mergeLogLines, parseLogLines } from '../parseLogs';
import { RawLogLine } from '../types';

function logLine(overrides: Partial<RawLogLine> = {}): RawLogLine {
  return { msg: 'a message', ...overrides };
}

describe(parseLogLines, () => {
  it('parses a JSONL log file', () => {
    const { logLines, errors } = parseLogLines(
      [
        '{"logId":"1","buildStepId":"install","msg":"npm ci"}',
        '{"logId":"2","buildStepId":"install","msg":"done"}',
      ].join('\n')
    );

    expect(errors).toEqual([]);
    expect(logLines).toEqual([
      { logId: '1', buildStepId: 'install', msg: 'npm ci' },
      { logId: '2', buildStepId: 'install', msg: 'done' },
    ]);
  });

  it('skips blank lines, including a trailing newline', () => {
    const { logLines, errors } = parseLogLines('{"logId":"1","msg":"one"}\n\n');

    expect(errors).toEqual([]);
    expect(logLines).toHaveLength(1);
  });

  it('reports malformed lines as errors while keeping the parsable ones', () => {
    const { logLines, errors } = parseLogLines(
      ['{"logId":"1","msg":"one"}', 'this is not json', '{"logId":"2","msg":"two"}'].join('\n')
    );

    expect(logLines.map(line => line.msg)).toEqual(['one', 'two']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });

  it('parses a line that carries no message', () => {
    const { logLines, errors } = parseLogLines('{"logId":"1"}');

    expect(errors).toEqual([]);
    expect(logLines).toEqual([{ logId: '1' }]);
  });
});

describe(mergeLogLines, () => {
  it('keeps the rightmost line for a repeated logId', () => {
    const fileLogLines = [
      logLine({ logId: '1', msg: 'from the file' }),
      logLine({ logId: '2', msg: 'from the file' }),
    ];
    const realtimeLogLines = [
      logLine({ logId: '2', msg: 'from realtime' }),
      logLine({ logId: '3', msg: 'from realtime' }),
    ];

    expect(mergeLogLines(fileLogLines, realtimeLogLines)).toEqual([
      { logId: '1', msg: 'from the file' },
      { logId: '2', msg: 'from realtime' },
      { logId: '3', msg: 'from realtime' },
    ]);
  });

  it('keeps identical messages that have different logIds', () => {
    const merged = mergeLogLines(
      [logLine({ logId: '1', msg: 'Repeated text' })],
      [logLine({ logId: '2', msg: 'Repeated text' })]
    );

    expect(merged).toEqual([
      { logId: '1', msg: 'Repeated text' },
      { logId: '2', msg: 'Repeated text' },
    ]);
  });

  it('keeps identical lines without logId', () => {
    const merged = mergeLogLines(
      [logLine({ msg: 'same' }), logLine({ msg: 'same' })],
      [logLine({ msg: 'same' })]
    );

    expect(merged).toHaveLength(3);
  });

  it('deduplicates within a single group', () => {
    const merged = mergeLogLines([logLine({ logId: '1' }), logLine({ logId: '1' })]);

    expect(merged).toHaveLength(1);
  });
});

describe(groupLogLinesIntoSteps, () => {
  it('groups lines by step id and labels the step with its display name', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepId: 'step-id-1', msg: 'npm ci' }),
      logLine({
        buildStepId: 'step-id-1',
        buildStepDisplayName: 'Install dependencies',
        msg: 'ok',
      }),
    ]);

    expect(Array.from(logs.keys())).toEqual(['step-id-1']);
    expect(logs.get('step-id-1')).toEqual({
      key: 'step-id-1',
      label: 'Install dependencies',
      logLines: [
        { time: undefined, msg: 'npm ci', result: undefined, marker: undefined, err: undefined },
        { time: undefined, msg: 'ok', result: undefined, marker: undefined, err: undefined },
      ],
    });
  });

  it('keeps steps in the order they first appear', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepId: 'first' }),
      logLine({ buildStepId: 'second' }),
      logLine({ buildStepId: 'first' }),
      logLine({ buildStepId: 'third' }),
    ]);

    expect(Array.from(logs.keys())).toEqual(['first', 'second', 'third']);
  });

  it('falls back to the display name, then the phase, when there is no step id', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepDisplayName: 'Run fastlane' }),
      logLine({ phase: 'PREPARE_CREDENTIALS' }),
    ]);

    expect(Array.from(logs.keys())).toEqual(['Run fastlane', 'PREPARE_CREDENTIALS']);
    expect(logs.get('PREPARE_CREDENTIALS')?.label).toBe('PREPARE_CREDENTIALS');
  });

  it('drops lines that belong to no step', () => {
    const logs = groupLogLinesIntoSteps([logLine({ msg: 'a line with no step' })]);

    expect(logs.size).toBe(0);
  });

  it('drops lines that carry no message, keeping the rest of the step', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepId: 'install', msg: undefined, marker: 'start-step' }),
      logLine({ buildStepId: 'install', msg: 'npm ci' }),
    ]);

    expect(logs.get('install')?.logLines).toEqual([
      { time: undefined, msg: 'npm ci', result: undefined, marker: undefined, err: undefined },
    ]);
  });

  it('creates no step for a line that carries no message', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepId: 'install', msg: undefined, marker: 'end-step', result: 'success' }),
    ]);

    expect(logs.size).toBe(0);
  });

  it('records the result of the first end marker and ignores a later one', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepId: 'install', msg: 'skipping', marker: 'end-step', result: 'skipped' }),
      logLine({ buildStepId: 'install', msg: 'retried', marker: 'end-step', result: 'success' }),
    ]);

    expect(logs.get('install')?.result).toBe('skipped');
  });

  it('leaves the result undefined for a step that has not ended', () => {
    const logs = groupLogLinesIntoSteps([logLine({ buildStepId: 'install', msg: 'npm ci' })]);

    expect(logs.get('install')?.result).toBeUndefined();
  });

  it('records an end marker that carries no result and does not let a later one replace it', () => {
    const logs = groupLogLinesIntoSteps([
      logLine({ buildStepId: 'install', msg: 'ended', marker: 'END_PHASE' }),
      logLine({ buildStepId: 'install', msg: 'retried', marker: 'END_PHASE', result: 'success' }),
    ]);

    expect(logs.get('install')?.result).toBe('');
  });
});
