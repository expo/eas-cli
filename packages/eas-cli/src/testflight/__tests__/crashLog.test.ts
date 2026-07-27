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

    const { logText } = await fetchTestFlightCrashAsync(app, 'crash-id');

    expect(logText).toBe('Thread 0 Crashed:');
  });

  it('reports no log when App Store Connect answers without one', async () => {
    jest
      .mocked(BetaCrashLog.getCrashLogAsync)
      .mockResolvedValue({ attributes: { logText: undefined } } as any);

    const { logText } = await fetchTestFlightCrashAsync(app, 'crash-id');

    expect(logText).toBeNull();
  });

  it('propagates a failed crash log request', async () => {
    const error = new Error('Request failed with status code 403');
    jest.mocked(BetaCrashLog.getCrashLogAsync).mockRejectedValue(error);

    await expect(fetchTestFlightCrashAsync(app, 'crash-id')).rejects.toThrow(error);
  });

  it('preserves a non-Error rejection', async () => {
    jest.mocked(BetaCrashLog.getCrashLogAsync).mockRejectedValue('socket hang up');

    await expect(fetchTestFlightCrashAsync(app, 'crash-id')).rejects.toBe('socket hang up');
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
    expect(formatTestFlightCrashDetails(crash, 'Thread 0 Crashed:')).toContain('Thread 0 Crashed:');
  });

  it('says no log is available when there is none', () => {
    expect(formatTestFlightCrashDetails(crash, null)).toContain(
      'No crash log is available for this submission yet.'
    );
  });
});
