import { TestFlightCrash, TestFlightFeedback } from '../fetch';
import {
  formatTestFlightCrash,
  formatTestFlightCrashDetails,
  formatTestFlightFeedback,
} from '../format';

const submission: TestFlightCrash = {
  id: 'f7a1c2d3-1111-2222-3333-444455556666',
  createdDate: '2026-07-24T10:00:00.000Z',
  comment: 'Tapping Continue does nothing.\nHappens every time on cellular.',
  deviceModel: 'iPhone15,2',
  osVersion: '18.2',
  locale: 'en-GB',
  timeZone: 'Europe/London',
  architecture: 'arm64e',
  connectionType: 'MOBILE_DATA',
  deviceFamily: 'IPHONE',
  appUptimeInMilliseconds: 42_300,
  batteryPercentage: 61,
  diskBytesAvailable: 12 * 1024 ** 3,
  diskBytesTotal: 128 * 1024 ** 3,
  buildVersion: '128',
  testerName: 'Jane Doe',
  testerEmail: 'jane@example.com',
};

const feedback: TestFlightFeedback = {
  ...submission,
  screenshots: [
    {
      url: 'https://example.com/screenshot.png',
      width: 1179,
      height: 2556,
      expirationDate: '2026-07-31T10:00:00.000Z',
    },
  ],
};

describe(formatTestFlightFeedback, () => {
  it('includes the tester, device, build, comment, and screenshots', () => {
    const output = formatTestFlightFeedback(feedback, 1);

    expect(output).toContain('1. Feedback f7a1c2d3-1111-2222-3333-444455556666');
    expect(output).toContain('Jane Doe <jane@example.com>');
    expect(output).toContain('iPhone15,2, iOS 18.2');
    expect(output).toContain('Build');
    expect(output).toContain('128');
    expect(output).toContain('battery 61%, disk 12.0 GB free of 128.0 GB, mobile data');
    expect(output).toContain('https://example.com/screenshot.png (1179x2556)');
  });

  it('indents multi-line comments under their label', () => {
    const output = formatTestFlightFeedback(feedback, 1);

    expect(output).toContain('Tapping Continue does nothing.\n             Happens every time');
  });

  it('marks feedback without a comment', () => {
    const output = formatTestFlightFeedback({ ...feedback, comment: null }, 1);

    expect(output).toContain('(no comment)');
  });

  it('omits the position when rendering a single submission', () => {
    const output = formatTestFlightFeedback(feedback);

    expect(output).toContain('Feedback f7a1c2d3-1111-2222-3333-444455556666');
    expect(output).not.toContain('1. Feedback');
  });
});

describe(formatTestFlightCrash, () => {
  it('numbers the crash by its absolute position and omits absent optional fields', () => {
    const output = formatTestFlightCrash({ ...submission, comment: null, locale: null }, 5);

    expect(output).toContain('5. Crash f7a1c2d3-1111-2222-3333-444455556666');
    expect(output).not.toContain('Comment');
    expect(output).not.toContain('Locale');
  });
});

describe(formatTestFlightCrashDetails, () => {
  it('appends the crash log', () => {
    const output = formatTestFlightCrashDetails(submission, 'Thread 0 Crashed:\n0 MyApp main + 32');

    expect(output).toContain('Arch');
    expect(output).toContain('arm64e');
    expect(output).toContain('Uptime');
    expect(output).toContain('42.3s');
    expect(output).toContain('Crash log');
    expect(output).toContain('Thread 0 Crashed:\n0 MyApp main + 32');
  });

  it('explains when no crash log is available', () => {
    const output = formatTestFlightCrashDetails(submission, null);

    expect(output).toContain('No crash log is available for this submission yet.');
  });
});
