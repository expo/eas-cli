import { Config } from '@oclif/core';
import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionStatus } from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import { downloadSimulatorArtifactAsync } from '../../../simulator/artifacts';
import Log from '../../../log';
import { loadSimulatorEnvAsync } from '../../../simulator/env';
import {
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
} from '../../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorCrashes from '../crashes';

jest.mock('../../../log');
jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../simulator/artifacts', () => ({
  ...jest.requireActual('../../../simulator/artifacts'),
  downloadSimulatorArtifactAsync: jest.fn(),
}));
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/preview', () => ({
  ...jest.requireActual('../../../simulator/preview'),
  resolveSimulatorPreviewAsync: jest.fn(),
  fetchSimulatorPreviewJsonAsync: jest.fn(),
}));
jest.mock('../../../utils/json');

const mockLoadSimulatorEnvAsync = jest.mocked(loadSimulatorEnvAsync);
const mockResolvePreviewAsync = jest.mocked(resolveSimulatorPreviewAsync);
const mockFetchJsonAsync = jest.mocked(fetchSimulatorPreviewJsonAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);
const mockWarn = jest.mocked(Log.warn);
const originalColorLevel = chalk.level;
const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test'),
  token: 'preview-token',
};
const graphqlClient = {} as ExpoGraphqlClient;
const projectDir = '/test/project';
const crash = {
  id: 'crash-id',
  appName: 'CoinFlip',
  procName: 'CoinFlip',
  capturedAt: '2026-10-05T12:00:00.000Z',
  exceptionType: 'EXC_CRASH',
  signal: 'SIGABRT',
  count: 2,
};

const crashLog = JSON.stringify({
  timestamp: '2026-10-05T11:59:59.000Z',
  processImagePath: '/Applications/CoinFlip.app/CoinFlip',
  processID: 42,
  eventMessage: '\u001b[31mlast app log\u001b[0m\u0007',
  messageType: 'Error',
});

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  return config;
}

describe(SimulatorCrashes, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EAS_SIMULATOR_SESSION_ID = 'session-id';
    chalk.level = 0;
    mockLoadSimulatorEnvAsync.mockResolvedValue();
    jest
      .mocked(DeviceRunSessionQuery.byIdAsync)
      .mockResolvedValue({ id: 'session-id', status: DeviceRunSessionStatus.InProgress } as Awaited<
        ReturnType<typeof DeviceRunSessionQuery.byIdAsync>
      >);
    mockResolvePreviewAsync.mockResolvedValue(preview);
    mockFetchJsonAsync.mockResolvedValue(createSnapshot());
  });

  afterEach(() => {
    delete process.env.EAS_SIMULATOR_SESSION_ID;
    chalk.level = originalColorLevel;
  });

  it.each([DeviceRunSessionStatus.Stopped, DeviceRunSessionStatus.Errored])(
    'downloads crash artifacts for a %s session without preview',
    async status => {
      const session = { id: 'session-id', status } as Awaited<
        ReturnType<typeof DeviceRunSessionQuery.byIdAsync>
      >;
      jest.mocked(DeviceRunSessionQuery.byIdAsync).mockResolvedValue(session);
      await createCommand(['--artifact', '2', '-o', 'crashes.zip', '--json']).runAsync();
      expect(downloadSimulatorArtifactAsync).toHaveBeenCalledWith(session, 'simulator-crashes', {
        artifact: 2,
        output: 'crashes.zip',
        nonInteractive: true,
        json: true,
      });
      expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
      expect(DeviceRunSessionQuery.byIdAsync).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects a report ID after the session stops with a download action', async () => {
    jest
      .mocked(DeviceRunSessionQuery.byIdAsync)
      .mockResolvedValue({ id: 'session-id', status: DeviceRunSessionStatus.Stopped } as Awaited<
        ReturnType<typeof DeviceRunSessionQuery.byIdAsync>
      >);
    await expect(createCommand(['--report-id', 'report-id']).runAsync()).rejects.toThrow(
      'Use --output <path>'
    );
    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['--artifact', '1'],
    ['--output', 'crashes.zip'],
  ])('rejects artifact flags on a running session %s', async (...args) => {
    await expect(createCommand(args).runAsync()).rejects.toThrow(
      'only available for stopped sessions'
    );
    expect(mockFetchJsonAsync).not.toHaveBeenCalled();
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

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(DeviceRunSessionQuery.byIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-id');
    expect(mockResolvePreviewAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-id' })
    );
    expect(mockFetchJsonAsync).toHaveBeenCalledWith(preview, '/crashes');
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      ...snapshot,
    });
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('uses the dotenv session ID and prints crash IDs for retrieving reports', async () => {
    mockFetchJsonAsync.mockResolvedValue(createSnapshot([crash]));
    mockLoadSimulatorEnvAsync.mockImplementation(async () => {
      process.env.EAS_SIMULATOR_SESSION_ID = 'dotenv-id';
    });

    await createCommand([]).runAsync();

    expect(mockLoadSimulatorEnvAsync).toHaveBeenCalledWith(projectDir);
    expect(DeviceRunSessionQuery.byIdAsync).toHaveBeenCalledWith(graphqlClient, 'dotenv-id');
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
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('explains an empty crash list when the watcher is healthy', async () => {
    await createCommand([]).runAsync();

    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(
      'No crash reports have been recorded. Reports can take a few seconds to appear.'
    );
  });

  it('arms the watcher before reading the report and encodes its ID as a path segment', async () => {
    const detail = {
      record: crash,
      occurrence: { index: 1, total: 2, logTail: [crashLog] },
      report: 'raw crash report',
      reportError: null,
    };
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce(detail);

    await createCommand(['--report-id', 'crash/with?#id', '--json']).runAsync();

    expect(mockFetchJsonAsync).toHaveBeenNthCalledWith(1, preview, '/crashes');
    expect(mockFetchJsonAsync).toHaveBeenNthCalledWith(
      2,
      preview,
      '/crashes/crash%2Fwith%3F%23id',
      {
        notFoundMessage:
          'The crash report was not found. The ID does not match a report in this session. Run `eas simulator:crashes` to see current report IDs.',
      }
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      ...detail,
    });
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

  it.each([false, true])('formats captured app logs with timestamp=%s', async timestamp => {
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce({
      record: crash,
      occurrence: { logTail: [crashLog] },
      report: 'raw crash report',
      reportError: null,
    });

    await createCommand([
      '--report-id',
      'crash-id',
      ...(timestamp ? ['--timestamp'] : []),
    ]).runAsync();

    expect(mockLog.mock.calls.map(([line]) => line)).toEqual([
      `${timestamp ? `${crash.capturedAt}  ` : ''}CoinFlip  EXC_CRASH  (2 occurrences)  crash-id`,
      'raw crash report',
      `${timestamp ? '2026-10-05T11:59:59.000Z  ' : ''}[CoinFlip:42] last app log`,
    ]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('does not invent timestamps for retained logs without a valid original timestamp', async () => {
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce({
      record: crash,
      occurrence: {
        logTail: [
          'plain log',
          JSON.stringify({ eventMessage: 'untimed app log' }),
          JSON.stringify({ timestamp: 'not a date', eventMessage: 'invalid time' }),
        ],
      },
      report: 'raw crash report',
      reportError: null,
    });

    await createCommand(['--report-id', 'crash-id', '--timestamp']).runAsync();

    expect(mockLog.mock.calls.map(([line]) => line)).toEqual([
      `${crash.capturedAt}  CoinFlip  EXC_CRASH  (2 occurrences)  crash-id`,
      'raw crash report',
      'plain log',
      '[unknown] untimed app log',
      '[unknown] invalid time',
    ]);
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

  it('explains a missing report when the session gives no reason', async () => {
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce({
      record: crash,
      occurrence: { logTail: ['last app log'] },
      report: null,
      reportError: null,
    });

    await createCommand(['--report-id', 'crash-id']).runAsync();

    expect(mockWarn).toHaveBeenCalledWith(
      'The crash report is unavailable. The session recorded the crash but did not return its report. The log lines recorded with the crash follow.'
    );
    expect(mockLog).toHaveBeenLastCalledWith('last app log');
  });

  it('suggests following logs when a missing report has no recorded log lines', async () => {
    mockFetchJsonAsync.mockResolvedValueOnce(createSnapshot([crash])).mockResolvedValueOnce({
      record: crash,
      occurrence: { logTail: [] },
      report: null,
      reportError: null,
    });

    await createCommand(['--report-id', 'crash-id']).runAsync();

    expect(mockWarn).toHaveBeenCalledWith(
      'The crash report is unavailable. The session recorded the crash but did not return its report. To collect logs, run `eas simulator:logs --follow --scope all` while you reproduce the crash.'
    );
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it('enables JSON output before rejecting invalid flags', async () => {
    await expect(createCommand(['--json', '--unknown']).runAsync()).rejects.toThrow();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
  });

  it('stops before contacting the preview when there is no session', async () => {
    delete process.env.EAS_SIMULATOR_SESSION_ID;

    await expect(createCommand([]).runAsync()).rejects.toThrow('No simulator session ID provided.');

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
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
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });
});

function createCommand(args: string[]): SimulatorCrashes {
  const command = new SimulatorCrashes(args, getMockOclifConfig());
  // @ts-expect-error getContextAsync is protected
  jest.spyOn(command, 'getContextAsync').mockResolvedValue({
    loggedIn: { graphqlClient },
    projectDir,
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
