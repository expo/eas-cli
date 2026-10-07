import { Config } from '@oclif/core';
import chalk from 'chalk';
import { stripVTControlCharacters } from 'node:util';

import Log from '../../../log';
import {
  downloadNetworkCaptureAsync,
  readNetworkRequestsAsync,
  streamNetworkRequestsAsync,
} from '../../../simulator/networkRequests';
import { resolveSimulatorPreviewAsync } from '../../../simulator/preview';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorNetworkRequests from '../network-requests';

jest.mock('../../../log');
jest.mock('../../../simulator/networkRequests');
jest.mock('../../../simulator/preview', () => ({
  ...jest.requireActual('../../../simulator/preview'),
  resolveSimulatorPreviewAsync: jest.fn(),
}));
jest.mock('../../../utils/json');

const mockResolvePreviewAsync = jest.mocked(resolveSimulatorPreviewAsync);
const mockReadRequestsAsync = jest.mocked(readNetworkRequestsAsync);
const mockDownloadCaptureAsync = jest.mocked(downloadNetworkCaptureAsync);
const mockStreamRequestsAsync = jest.mocked(streamNetworkRequestsAsync);
const mockPrintJson = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);
const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test'),
  token: 'preview-token',
};
const requestSummary = {
  id: 'request-id',
  startedAt: Date.parse('2026-10-05T12:00:00.000Z'),
  startedDateTime: '2026-10-05T12:00:00.000Z',
  method: 'POST',
  url: 'https://example.test/posts',
  status: 201,
  duration: 50,
  requestSize: 100,
  responseSize: 200,
};
const request = {
  _captureId: 'request-id',
  startedDateTime: '2026-10-05T12:00:00.000Z',
  time: 50,
  request: {
    method: 'POST',
    url: 'https://example.test/posts',
    bodySize: 100,
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    postData: { mimeType: 'application/json', text: '{"title":"Coin Flip"}' },
  },
  response: {
    status: 201,
    bodySize: 200,
    content: { mimeType: 'application/json', text: '{"id":101}' },
  },
};

describe(SimulatorNetworkRequests, () => {
  const originalColorLevel = chalk.level;
  beforeEach(() => {
    jest.clearAllMocks();
    chalk.level = 0;
    mockResolvePreviewAsync.mockResolvedValue(preview);
    mockReadRequestsAsync.mockResolvedValue([]);
    mockDownloadCaptureAsync.mockResolvedValue('/test/capture.har');
  });

  afterEach(() => {
    chalk.level = originalColorLevel;
  });

  it('prints a JSON list for an explicit session with the default limit', async () => {
    mockReadRequestsAsync.mockResolvedValue([requestSummary]);

    await createCommand(['--id', 'session-id', '--json']).runAsync();

    expect(enableJsonOutput).toHaveBeenCalled();
    expect(mockResolvePreviewAsync).toHaveBeenCalledWith({}, '/test/project', 'session-id');
    expect(mockReadRequestsAsync).toHaveBeenCalledWith(preview, {
      limit: 100,
      requestId: undefined,
    });
    expect(mockPrintJson).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      requests: [requestSummary],
    });
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockDownloadCaptureAsync).not.toHaveBeenCalled();
  });

  it('prints a full request detail including captured headers and bodies as JSON', async () => {
    mockReadRequestsAsync.mockResolvedValue(request);

    await createCommand(['--request-id', 'request-id', '--json']).runAsync();

    expect(mockReadRequestsAsync).toHaveBeenCalledWith(preview, {
      limit: 100,
      requestId: 'request-id',
    });
    expect(mockPrintJson).toHaveBeenCalledWith({ deviceRunSessionId: 'session-id', request });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('downloads a HAR and prints only the resulting file metadata as JSON', async () => {
    await createCommand(['--output', './capture.har', '--json']).runAsync();

    expect(mockDownloadCaptureAsync).toHaveBeenCalledWith(preview, './capture.har');
    expect(mockPrintJson).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      filePath: '/test/capture.har',
    });
    expect(mockReadRequestsAsync).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('prints the saved path safely for human output', async () => {
    mockDownloadCaptureAsync.mockResolvedValue('/test/\u001b[31mcapture.har\u001b[0m\u0007');

    await createCommand(['-o', './capture.har']).runAsync();

    expect(mockLog).toHaveBeenCalledWith('Saved network capture to /test/capture.har.');
    expect(mockPrintJson).not.toHaveBeenCalled();
    expect(mockReadRequestsAsync).not.toHaveBeenCalled();
  });

  it('forwards an explicit limit and uses shared session selection', async () => {
    mockReadRequestsAsync.mockResolvedValue([requestSummary]);

    await createCommand(['--limit', '3']).runAsync();

    expect(mockResolvePreviewAsync).toHaveBeenCalledWith({}, '/test/project', undefined);
    expect(mockReadRequestsAsync).toHaveBeenCalledWith(preview, { limit: 3, requestId: undefined });
    expect(mockLog).toHaveBeenCalledWith(
      'request-id  POST    https://example.test/posts  201  50ms'
    );
  });

  it('sanitizes terminal controls in human request summaries', async () => {
    mockReadRequestsAsync.mockResolvedValue([
      { ...requestSummary, url: '\u001b[31mhttps://example.test/posts\u001b[0m\u0007' },
    ]);

    await createCommand([]).runAsync();

    expect(mockLog).toHaveBeenCalledWith(
      'request-id  POST    https://example.test/posts  201  50ms'
    );
  });

  it('rounds floating-point HAR timing noise only in human summaries', async () => {
    const summary = { ...requestSummary, duration: 2.8999999999999995 };
    mockReadRequestsAsync.mockResolvedValue([summary]);

    await createCommand([]).runAsync();

    expect(mockLog).toHaveBeenCalledWith(
      'request-id  POST    https://example.test/posts  201  2.9ms'
    );

    await createCommand(['--json']).runAsync();

    expect(mockPrintJson).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      requests: [summary],
    });
  });

  it('adds intentional colors after sanitizing remote text and preserves full URLs', async () => {
    chalk.level = 1;
    const url = `https://example.test/${'long-path/'.repeat(30)}`;
    mockReadRequestsAsync.mockResolvedValue([
      {
        ...requestSummary,
        id: '\u001b[35mr1\u001b[0m\u0007',
        startedDateTime: '\u001b[35m2026-10-05T12:00:00.000Z\u001b[0m\u0007',
        method: '\u001b[35mGET\u001b[0m\u0007',
        url: `\u001b[35m${url}\u001b[0m\u0007`,
      },
    ]);

    await createCommand(['--timestamp']).runAsync();

    const output = mockLog.mock.calls[0][0] as string;
    expect(output).toBe(
      [
        chalk.dim('2026-10-05T12:00:00.000Z'),
        chalk.dim('r1   '),
        chalk.bold.cyan('GET   '),
        url,
        chalk.green('201'),
        chalk.dim('50ms'),
      ].join('  ')
    );
    expect(output).toContain('\u001b[1m\u001b[36mGET   ');
    expect(output).not.toContain('\u001b[35m');
    expect(output).not.toContain('\u0007');
    expect(stripVTControlCharacters(output)).toBe(
      `2026-10-05T12:00:00.000Z  r1     GET     ${url}  201  50ms`
    );
  });

  it.each([
    [200, '\u001b[32m'],
    [299, '\u001b[32m'],
    [301, '\u001b[36m'],
    [399, '\u001b[36m'],
    [404, '\u001b[33m'],
    [499, '\u001b[33m'],
    [500, '\u001b[31m'],
    [599, '\u001b[31m'],
    [0, '\u001b[31m'],
  ])('colors numeric status %i by response class', async (status, color) => {
    chalk.level = 1;
    mockReadRequestsAsync.mockResolvedValue([{ ...requestSummary, status }]);

    await createCommand([]).runAsync();

    expect(mockLog.mock.calls[0][0]).toContain(`${color}${status}\u001b[39m`);
  });

  it('leaves JSON data untouched when terminal color is enabled', async () => {
    chalk.level = 1;
    mockReadRequestsAsync.mockResolvedValue([requestSummary]);

    await createCommand(['--json']).runAsync();

    expect(mockPrintJson).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      requests: [requestSummary],
    });
    expect(JSON.stringify(mockPrintJson.mock.calls[0][0])).not.toContain('\\u001b');
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('shows request start timestamps only when requested in human output', async () => {
    mockReadRequestsAsync.mockResolvedValue([requestSummary]);

    await createCommand(['--timestamp']).runAsync();

    expect(mockLog).toHaveBeenCalledWith(
      '2026-10-05T12:00:00.000Z  request-id  POST    https://example.test/posts  201  50ms'
    );
  });

  it.each(['--follow', '-f'])(
    'streams human summaries with %s without fetching a finite list',
    async follow => {
      mockStreamRequestsAsync.mockImplementation(async (_preview, onRequest) => {
        onRequest(requestSummary);
      });

      await createCommand([follow, '--timestamp']).runAsync();

      expect(mockStreamRequestsAsync).toHaveBeenCalledWith(preview, expect.any(Function));
      expect(mockLog).toHaveBeenCalledWith(
        '2026-10-05T12:00:00.000Z  request-id  POST    https://example.test/posts  201  50ms'
      );
      expect(mockReadRequestsAsync).not.toHaveBeenCalled();
      expect(mockDownloadCaptureAsync).not.toHaveBeenCalled();
      expect(mockPrintJson).not.toHaveBeenCalled();
    }
  );

  it.each([
    { options: ['--json'] },
    { options: ['--limit', '1'] },
    { options: ['--request-id', 'r1'] },
    { options: ['--output', 'capture.har'] },
  ])('rejects incompatible follow options $options before session access', async ({ options }) => {
    await expect(createCommand(['--follow', ...options]).runAsync()).rejects.toThrow();

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
    expect(mockStreamRequestsAsync).not.toHaveBeenCalled();
  });

  it('enables JSON output before rejecting invalid flags', async () => {
    await expect(createCommand(['--json', '--follow']).runAsync()).rejects.toThrow();

    expect(enableJsonOutput).toHaveBeenCalled();
  });

  it('prints a full request detail for human output', async () => {
    mockReadRequestsAsync.mockResolvedValue(request);

    await createCommand(['--request-id', 'request-id']).runAsync();

    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(request, null, 2));
    expect(mockPrintJson).not.toHaveBeenCalled();
  });

  it('explains the initial-launch limitation when the capture is empty', async () => {
    await createCommand([]).runAsync();

    expect(mockLog).toHaveBeenCalledWith(
      'No completed network requests were captured. Initial-launch requests may have been missed.'
    );
  });

  it('rejects combining a request detail and HAR output before resolving a session', async () => {
    await expect(
      createCommand(['--request-id', 'request-id', '--output', './capture.har']).runAsync()
    ).rejects.toThrow();

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
    expect(mockReadRequestsAsync).not.toHaveBeenCalled();
    expect(mockDownloadCaptureAsync).not.toHaveBeenCalled();
  });

  it('rejects a nonpositive request limit', async () => {
    await expect(createCommand(['--limit', '0']).runAsync()).rejects.toThrow();

    expect(mockResolvePreviewAsync).not.toHaveBeenCalled();
  });

  it('propagates a missing capture error without printing an empty list', async () => {
    mockReadRequestsAsync.mockRejectedValue(
      new Error('No network capture was found. Start the session with --network-capture.')
    );

    await expect(createCommand([]).runAsync()).rejects.toThrow(
      'Start the session with --network-capture.'
    );

    expect(mockLog).not.toHaveBeenCalled();
    expect(mockPrintJson).not.toHaveBeenCalled();
  });

  it('propagates HAR download failures without claiming a file was saved', async () => {
    mockDownloadCaptureAsync.mockRejectedValue(new Error('The output file already exists.'));

    await expect(createCommand(['--output', './capture.har', '--json']).runAsync()).rejects.toThrow(
      'The output file already exists.'
    );

    expect(mockPrintJson).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockReadRequestsAsync).not.toHaveBeenCalled();
  });

  it('stops before reading traffic when there is no simulator session', async () => {
    mockResolvePreviewAsync.mockRejectedValue(new Error('No simulator session ID provided.'));

    await expect(createCommand([]).runAsync()).rejects.toThrow('No simulator session ID provided.');

    expect(mockReadRequestsAsync).not.toHaveBeenCalled();
    expect(mockDownloadCaptureAsync).not.toHaveBeenCalled();
  });
});

function createCommand(args: string[]): SimulatorNetworkRequests {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  const command = new SimulatorNetworkRequests(args, config);
  Object.assign(command, {
    getContextAsync: jest.fn().mockResolvedValue({
      loggedIn: { graphqlClient: {} },
      projectDir: '/test/project',
    }),
  });
  return command;
}
