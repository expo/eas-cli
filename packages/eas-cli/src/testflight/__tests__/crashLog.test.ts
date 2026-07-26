import { App, BetaCrashLog, BetaFeedbackCrashSubmission } from '@expo/apple-utils';

import { fetchTestFlightCrashAsync } from '../fetch';
import { formatTestFlightCrashDetails } from '../format';

jest.mock('@expo/apple-utils', () => ({
  BetaCrashLog: { getCrashLogAsync: jest.fn() },
  BetaFeedbackCrashSubmission: { infoAsync: jest.fn() },
}));

const app = { context: {} } as unknown as App;

const submission = {
  id: 'crash-id',
  attributes: {
    createdDate: '2026-07-20T10:00:00.000Z',
    comment: null,
    deviceModel: 'iPhone15,2',
    osVersion: '18.2',
  },
};

describe(fetchTestFlightCrashAsync, () => {
  beforeEach(() => {
    jest.mocked(BetaFeedbackCrashSubmission.infoAsync).mockResolvedValue(submission as any);
    jest.mocked(BetaCrashLog.getCrashLogAsync).mockReset();
  });

  it('returns the crash log when App Store Connect has one', async () => {
    jest
      .mocked(BetaCrashLog.getCrashLogAsync)
      .mockResolvedValue({ attributes: { logText: 'Thread 0 Crashed:' } } as any);

    const { logText, logError } = await fetchTestFlightCrashAsync(app, 'crash-id');

    expect(logText).toBe('Thread 0 Crashed:');
    expect(logError).toBeNull();
  });

  it('reports no log when App Store Connect answers without one', async () => {
    jest
      .mocked(BetaCrashLog.getCrashLogAsync)
      .mockResolvedValue({ attributes: { logText: undefined } } as any);

    const { logText, logError } = await fetchTestFlightCrashAsync(app, 'crash-id');

    expect(logText).toBeNull();
    expect(logError).toBeNull();
  });

  it('distinguishes a failed request from an absent log', async () => {
    jest
      .mocked(BetaCrashLog.getCrashLogAsync)
      .mockRejectedValue(new Error('Request failed with status code 403'));

    const { crash, logText, logError } = await fetchTestFlightCrashAsync(app, 'crash-id');

    // The crash metadata still comes back — only the log is missing.
    expect(crash.id).toBe('crash-id');
    expect(logText).toBeNull();
    expect(logError).toBe('Request failed with status code 403');
  });

  it('handles a non-Error rejection without producing "undefined"', async () => {
    jest.mocked(BetaCrashLog.getCrashLogAsync).mockRejectedValue('socket hang up');

    const { logError } = await fetchTestFlightCrashAsync(app, 'crash-id');

    expect(logError).toBe('socket hang up');
  });
});

describe(`${formatTestFlightCrashDetails.name} log states`, () => {
  const crash = {
    id: 'crash-id',
    createdDate: '2026-07-20T10:00:00.000Z',
    comment: null,
    deviceModel: 'iPhone15,2',
    osVersion: '18.2',
    locale: null,
    timeZone: null,
    architecture: null,
    connectionType: null,
    deviceFamily: null,
    appUptimeInMilliseconds: null,
    batteryPercentage: null,
    diskBytesAvailable: null,
    diskBytesTotal: null,
    buildVersion: null,
    testerName: null,
    testerEmail: null,
  };

  it('prints the log when present', () => {
    expect(formatTestFlightCrashDetails(crash, 'Thread 0 Crashed:', null)).toContain(
      'Thread 0 Crashed:'
    );
  });

  it('says no log is available when there is none', () => {
    expect(formatTestFlightCrashDetails(crash, null, null)).toContain(
      'No crash log is available for this submission yet.'
    );
  });

  it('surfaces a fetch failure instead of claiming there is no log', () => {
    const output = formatTestFlightCrashDetails(crash, null, 'Request failed with status code 403');

    expect(output).toContain('Could not fetch the crash log: Request failed with status code 403');
    expect(output).not.toContain('No crash log is available');
  });
});
