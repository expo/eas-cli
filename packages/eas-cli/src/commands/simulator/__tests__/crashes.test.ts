import { Config } from '@oclif/core';
import chalk from 'chalk';

import Log from '../../../log';
import {
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
} from '../../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorCrashes from '../crashes';

jest.mock('../../../log');
jest.mock('../../../simulator/preview', () => ({
  ...jest.requireActual('../../../simulator/preview'),
  resolveSimulatorPreviewAsync: jest.fn(),
  fetchSimulatorPreviewJsonAsync: jest.fn(),
}));
jest.mock('../../../utils/json');

const mockResolvePreviewAsync = jest.mocked(resolveSimulatorPreviewAsync);
const mockFetchJsonAsync = jest.mocked(fetchSimulatorPreviewJsonAsync);
const mockPrintJson = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);
const mockWarn = jest.mocked(Log.warn);
const originalColorLevel = chalk.level;
const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test'),
  token: 'preview-token',
};
const crash = {
  id: 'crash-id',
  appName: 'CoinFlip',
  procName: 'CoinFlip',
  capturedAt: '2026-10-05T12:00:00.000Z',
  exceptionType: 'EXC_CRASH',
  signal: 'SIGABRT',
  count: 2,
};

describe(SimulatorCrashes, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chalk.level = 0;
    mockResolvePreviewAsync.mockResolvedValue(preview);
    mockFetchJsonAsync.mockResolvedValue(createSnapshot());
  });

  afterEach(() => {
    chalk.level = originalColorLevel;
  });

  it('styles the crash summary while removing remote terminal controls', async () => {
    chalk.level = 1;
    mockFetchJsonAsync.mockResolvedValue(
      createSnapshot([
        {
          ...crash,
          appName: '\u001b[35mCoinFlip\u001b[0m',
          exceptionType: '\u001b[35mEXC_CRASH\u001b[0m\u0007',
        },
      ])
    );

    await createCommand(['--timestamp']).runAsync();

    const output = mockLog.mock.calls[0][0];
    expect(output).toContain('\u001b[1mCoinFlip\u001b[22m');
    expect(output).toContain('\u001b[31m');
    expect(output).not.toContain('\u001b[35m');
    expect(output).not.toContain('\u0007');
    expect(output).toContain('EXC_CRASH');
  });

  it('prints the full crash list and source metadata as JSON', async () => {
    const snapshot = createSnapshot([crash]);
    mockFetchJsonAsync.mockResolvedValue(snapshot);

    await createCommand(['--id', 'session-id', '--json']).runAsync();

    expect(enableJsonOutput).toHaveBeenCalled();
    expect(mockResolvePreviewAsync).toHaveBeenCalledWith({}, '/test/project', 'session-id');
    expect(mockFetchJsonAsync).toHaveBeenCalledWith(preview, '/crashes');
    expect(mockPrintJson).toHaveBeenCalledWith({ deviceRunSessionId: 'session-id', ...snapshot });
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('uses shared session selection and prints crash IDs for retrieving reports', async () => {
    mockFetchJsonAsync.mockResolvedValue(createSnapshot([crash]));

    await createCommand([]).runAsync();

    expect(mockResolvePreviewAsync).toHaveBeenCalledWith({}, '/test/project', undefined);
    expect(mockLog).toHaveBeenCalledWith('CoinFlip  EXC_CRASH  (2 occurrences)  crash-id');
  });

  it.each([crash.capturedAt, null])(
    'shows requested crash timestamps, including %s',
    async capturedAt => {
      mockFetchJsonAsync.mockResolvedValue({
        ...createSnapshot(),
        crashes: [{ ...crash, capturedAt }],
      });

      await createCommand(['--timestamp']).runAsync();

      expect(mockLog).toHaveBeenCalledWith(
        `${capturedAt ?? 'Unknown time'}  CoinFlip  EXC_CRASH  (2 occurrences)  crash-id`
      );
    }
  );

  it('prints source failures instead of silently treating them as no crashes', async () => {
    mockFetchJsonAsync.mockResolvedValue({
      ...createSnapshot(),
      meta: { status: 'unavailable', statusError: '\u001b[31mwatcher unavailable\u001b[0m\u0007' },
    });

    await createCommand([]).runAsync();

    expect(mockWarn).toHaveBeenCalledWith('watcher unavailable');
    expect(mockLog).toHaveBeenCalledWith(
      'No crash reports have been recorded. Reports can take a few seconds to appear.'
    );
  });

  it('arms the watcher before reading the report and encodes its ID as a path segment', async () => {
    const detail = {
      record: crash,
      occurrence: { index: 1, total: 2, logTail: ['last app log'] },
      report: 'raw crash report',
      reportError: null,
    };
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce(detail);

    await createCommand(['--report-id', 'crash/with?#id', '--json']).runAsync();

    expect(mockFetchJsonAsync).toHaveBeenNthCalledWith(1, preview, '/crashes');
    expect(mockFetchJsonAsync).toHaveBeenNthCalledWith(2, preview, '/crashes/crash%2Fwith%3F%23id');
    expect(mockPrintJson).toHaveBeenCalledWith({ deviceRunSessionId: 'session-id', ...detail });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('prints the crash report while removing terminal escape sequences', async () => {
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce({
      record: crash,
      occurrence: { logTail: [] },
      report: 'header\n\u001b[31mreport body\u001b[0m\u0007',
      reportError: null,
    });

    await createCommand(['--report-id', 'crash-id']).runAsync();

    expect(mockLog).toHaveBeenLastCalledWith('header\nreport body');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('shows why a raw report disappeared and prints the retained app log tail', async () => {
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce({
      record: crash,
      occurrence: { logTail: ['\u001b[31mlast app log\u001b[0m'] },
      report: null,
      reportError: 'macOS deleted this report.',
    });

    await createCommand(['--report-id', 'crash-id']).runAsync();

    expect(mockWarn).toHaveBeenCalledWith('macOS deleted this report.');
    expect(mockLog).toHaveBeenLastCalledWith('last app log');
  });

  it('stops before contacting the preview when there is no session', async () => {
    mockResolvePreviewAsync.mockRejectedValue(new Error('No simulator session ID provided.'));

    await expect(createCommand([]).runAsync()).rejects.toThrow('No simulator session ID provided.');

    expect(mockFetchJsonAsync).not.toHaveBeenCalled();
  });

  it('propagates a missing report error without printing a successful result', async () => {
    mockFetchJsonAsync
      .mockResolvedValueOnce(createSnapshot([crash]))
      .mockRejectedValueOnce(new Error('The requested report was not found.'));

    await expect(createCommand(['--report-id', 'stale-id']).runAsync()).rejects.toThrow(
      'The requested report was not found.'
    );

    expect(mockLog).not.toHaveBeenCalled();
    expect(mockPrintJson).not.toHaveBeenCalled();
  });
});

function createCommand(args: string[]): SimulatorCrashes {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  const command = new SimulatorCrashes(args, config);
  Object.assign(command, {
    getContextAsync: jest.fn().mockResolvedValue({
      loggedIn: { graphqlClient: {} },
      projectDir: '/test/project',
    }),
  });
  return command;
}

function createSnapshot(crashes: (typeof crash)[] = []): object {
  return {
    meta: {
      status: 'watching',
      statusError: null,
      schemaVersion: 1,
      reportDelaySeconds: 5,
    },
    crashes,
  };
}
