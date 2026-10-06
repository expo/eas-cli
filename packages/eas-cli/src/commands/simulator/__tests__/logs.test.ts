import { Config } from '@oclif/core';
import chalk from 'chalk';

import Log from '../../../log';
import {
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
  streamSimulatorPreviewAsync,
} from '../../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorLogs from '../logs';

jest.mock('../../../log');
jest.mock('../../../simulator/preview', () => ({
  ...jest.requireActual('../../../simulator/preview'),
  resolveSimulatorPreviewAsync: jest.fn(),
  fetchSimulatorPreviewJsonAsync: jest.fn(),
  streamSimulatorPreviewAsync: jest.fn(),
}));
jest.mock('../../../utils/json');

const mockResolvePreviewAsync = jest.mocked(resolveSimulatorPreviewAsync);
const mockFetchJsonAsync = jest.mocked(fetchSimulatorPreviewJsonAsync);
const mockStreamAsync = jest.mocked(streamSimulatorPreviewAsync);
const mockPrintJson = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);
const mockWarn = jest.mocked(Log.warn);
const originalColorLevel = chalk.level;
const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test'),
  token: 'preview-token',
};
const line = {
  seq: 7,
  at: Date.parse('2026-10-05T12:00:00.000Z'),
  raw: JSON.stringify({
    timestamp: '2026-10-05T12:00:00.000Z',
    processImagePath: '/apps/CoinFlip.app/CoinFlip',
    processID: 42,
    eventMessage: 'Initialization request completed.',
  }),
};

describe(SimulatorLogs, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chalk.level = 0;
    mockResolvePreviewAsync.mockResolvedValue(preview);
    mockFetchJsonAsync.mockResolvedValue(createSnapshot());
  });

  afterEach(() => {
    chalk.level = originalColorLevel;
  });

  it.each(['Error', 16, 'Fault', 17, 'Debug', 2])(
    'styles OS severity %s after removing remote terminal controls',
    async messageType => {
      chalk.level = 1;
      mockFetchJsonAsync.mockResolvedValue(
        createSnapshot([
          {
            ...line,
            raw: JSON.stringify({
              ...JSON.parse(line.raw),
              messageType,
              processImagePath: '/apps/\u001b[35mCoinFlip\u001b[0m',
              eventMessage: '\u001b[35mInitialization request completed.\u001b[0m\u0007',
            }),
          },
        ])
      );

      await createCommand(['--timestamp']).runAsync();

      const output = mockLog.mock.calls[0][0];
      expect(output).toContain('\u001b[36m[CoinFlip:42]\u001b[39m');
      expect(output).not.toContain('\u001b[35m');
      expect(output).not.toContain('\u0007');
      const message = 'Initialization request completed.';
      const styledMessage =
        messageType === 'Debug' || messageType === 2
          ? chalk.dim(message)
          : messageType === 'Fault' || messageType === 17
            ? chalk.red.bold(message)
            : chalk.red(message);
      expect(output).toContain(styledMessage);
    }
  );

  it('prints the full JSON snapshot for an explicit session without starting the log source', async () => {
    const snapshot = createSnapshot([line]);
    mockFetchJsonAsync.mockResolvedValue(snapshot);
    const command = createCommand(['--id', 'session-id', '--json']);

    await command.runAsync();

    expect(enableJsonOutput).toHaveBeenCalled();
    expect(mockResolvePreviewAsync).toHaveBeenCalledWith({}, '/test/project', 'session-id');
    expect(mockFetchJsonAsync).toHaveBeenCalledWith(preview, '/logs', {
      scope: 'user-apps',
      limit: '100',
      snapshot: '1',
    });
    expect(mockPrintJson).toHaveBeenCalledWith({ deviceRunSessionId: 'session-id', ...snapshot });
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockStreamAsync).not.toHaveBeenCalled();
  });

  it('uses shared session selection when no ID is provided', async () => {
    await createCommand(['--json']).runAsync();

    expect(mockResolvePreviewAsync).toHaveBeenCalledWith({}, '/test/project', undefined);
  });

  it('formats app messages and forwards scope and buffer limit', async () => {
    mockFetchJsonAsync.mockResolvedValue(createSnapshot([line]));

    await createCommand(['--scope', 'all', '--limit', '3']).runAsync();

    expect(mockFetchJsonAsync).toHaveBeenCalledWith(preview, '/logs', {
      scope: 'all',
      limit: '3',
      snapshot: '1',
    });
    expect(mockLog).toHaveBeenCalledWith('[CoinFlip:42] Initialization request completed.');
  });

  it('shows original timestamps for parsed and unparsed snapshot lines when requested', async () => {
    mockFetchJsonAsync.mockResolvedValue(
      createSnapshot([line, { ...line, raw: '\u001b[31mraw message\u001b[0m\u0007' }])
    );

    await createCommand(['--timestamp']).runAsync();

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      '2026-10-05T12:00:00.000Z  [CoinFlip:42] Initialization request completed.'
    );
    expect(mockLog).toHaveBeenLastCalledWith('2026-10-05T12:00:00.000Z  raw message');
  });

  it('prints unparsed lines safely and reports an unhealthy log source', async () => {
    mockFetchJsonAsync.mockResolvedValue({
      ...createSnapshot([{ ...line, raw: '\u001b[31mraw message\u001b[0m\u0007' }]),
      streamError: '\u001b[31mlog source restarting\u001b[0m\u0007',
    });

    await createCommand([]).runAsync();

    expect(mockLog).toHaveBeenCalledWith('raw message');
    expect(mockWarn).toHaveBeenCalledWith('log source restarting');
  });

  it('explains that an empty snapshot needs following before actions', async () => {
    await createCommand([]).runAsync();

    expect(mockLog).toHaveBeenCalledWith(
      'No buffered logs. Use --follow to collect logs before performing actions.'
    );
  });

  it('formats replayed and new raw SSE logs without requiring envelopes', async () => {
    mockStreamAsync.mockImplementation(async (_preview, _path, onData) => {
      onData(line.raw);
      onData('\u001b[31mnew message\u001b[0m\u0007');
    });

    await createCommand(['--id', 'session-id', '--follow']).runAsync();

    expect(mockStreamAsync).toHaveBeenCalledWith(preview, '/logs', expect.any(Function), {
      scope: 'user-apps',
      limit: '100',
    });
    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockLog).toHaveBeenNthCalledWith(1, '[CoinFlip:42] Initialization request completed.');
    expect(mockLog).toHaveBeenLastCalledWith('new message');
    expect(mockFetchJsonAsync).not.toHaveBeenCalled();
    expect(mockPrintJson).not.toHaveBeenCalled();
  });

  it('uses server envelopes for accurate timestamps while following unparsed logs', async () => {
    mockStreamAsync.mockImplementation(async (_preview, _path, onData) => {
      onData(JSON.stringify(line));
      onData(JSON.stringify({ ...line, at: line.at + 1_000, raw: 'new message' }));
    });

    await createCommand(['--follow', '--timestamp']).runAsync();

    expect(mockStreamAsync).toHaveBeenCalledWith(preview, '/logs', expect.any(Function), {
      scope: 'user-apps',
      limit: '100',
      envelope: '1',
    });
    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      '2026-10-05T12:00:00.000Z  [CoinFlip:42] Initialization request completed.'
    );
    expect(mockLog).toHaveBeenLastCalledWith('2026-10-05T12:00:01.000Z  new message');
  });

  it('rejects JSON follow output before resolving a session', async () => {
    await expect(createCommand(['--json', '--follow']).runAsync()).rejects.toThrow();

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
  });

  it.each(['0', '-1'])('rejects a nonpositive buffer limit %s', async limit => {
    await expect(createCommand(['--limit', limit]).runAsync()).rejects.toThrow();

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
  });

  it('rejects invalid scopes', async () => {
    await expect(createCommand(['--scope', 'system']).runAsync()).rejects.toThrow();

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
  });

  it('stops before contacting the preview when there is no session', async () => {
    mockResolvePreviewAsync.mockRejectedValue(new Error('No simulator session ID provided.'));

    await expect(createCommand([]).runAsync()).rejects.toThrow('No simulator session ID provided.');

    expect(mockFetchJsonAsync).not.toHaveBeenCalled();
    expect(mockStreamAsync).not.toHaveBeenCalled();
  });

  it('propagates preview errors without printing an empty result', async () => {
    mockFetchJsonAsync.mockRejectedValue(new Error('The simulator preview refused access.'));

    await expect(createCommand([]).runAsync()).rejects.toThrow(
      'The simulator preview refused access.'
    );

    expect(mockLog).not.toHaveBeenCalled();
  });
});

function createCommand(args: string[]): SimulatorLogs {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  const command = new SimulatorLogs(args, config);
  Object.assign(command, {
    getContextAsync: jest.fn().mockResolvedValue({
      loggedIn: { graphqlClient: {} },
      projectDir: '/test/project',
    }),
  });
  return command;
}

function createSnapshot(lines: (typeof line)[] = []): object {
  return {
    device: 'device-id',
    latestSeq: 7,
    oldestSeq: 1,
    bufferedBytes: 200,
    status: 'streaming',
    streamError: null,
    lines,
  };
}
