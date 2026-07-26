import { App } from '@expo/apple-utils';

import { getTestFlightCrashesQuery, getTestFlightFeedbackQuery } from '../fetch';

function createSubmission(overrides: Record<string, any> = {}): any {
  return {
    id: 'submission-id',
    attributes: {
      createdDate: '2026-07-20T10:00:00.000Z',
      comment: 'The login button does nothing',
      email: null,
      deviceModel: 'iPhone15,2',
      osVersion: '18.2',
      locale: 'en-GB',
      timeZone: 'Europe/London',
      architecture: 'arm64e',
      connectionType: 'WIFI',
      deviceFamily: 'IPHONE',
      appUptimeInMilliseconds: 12_000,
      batteryPercentage: 42,
      diskBytesAvailable: 1024 ** 3,
      diskBytesTotal: 4 * 1024 ** 3,
      build: { id: 'build-id', attributes: { version: '42' } },
      tester: {
        id: 'tester-id',
        attributes: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
      },
      ...overrides,
    },
  };
}

function createApp(submissions: any[]): App {
  return {
    getBetaFeedbackScreenshotSubmissionsAsync: jest.fn().mockResolvedValue(submissions),
    getBetaFeedbackCrashSubmissionsAsync: jest.fn().mockResolvedValue(submissions),
  } as unknown as App;
}

describe(getTestFlightFeedbackQuery, () => {
  it('normalizes submissions, including the build and tester relationships', async () => {
    const query = getTestFlightFeedbackQuery(createApp([createSubmission({ screenshots: [] })]));

    const items = await query.queryAsync(20, 0);

    expect(await query.getTotalAsync()).toBe(1);
    expect(items[0]).toMatchObject({
      id: 'submission-id',
      comment: 'The login button does nothing',
      deviceModel: 'iPhone15,2',
      osVersion: '18.2',
      buildVersion: '42',
      testerName: 'Jane Doe',
      testerEmail: 'jane@example.com',
      screenshots: [],
    });
  });

  it('maps screenshots', async () => {
    const query = getTestFlightFeedbackQuery(
      createApp([
        createSubmission({
          screenshots: [
            {
              url: 'https://example.com/screenshot.png',
              width: 1170,
              height: 2532,
              expirationDate: '2026-07-27T10:00:00.000Z',
            },
          ],
        }),
      ])
    );

    const items = await query.queryAsync(20, 0);

    expect(items[0].screenshots).toEqual([
      {
        url: 'https://example.com/screenshot.png',
        width: 1170,
        height: 2532,
        expirationDate: '2026-07-27T10:00:00.000Z',
      },
    ]);
  });

  it('falls back to the submission email when the tester relationship has none', async () => {
    const query = getTestFlightFeedbackQuery(
      createApp([
        createSubmission({
          screenshots: null,
          email: 'anonymous@example.com',
          tester: { id: 'tester-id', attributes: { firstName: 'Anonymous', lastName: null } },
        }),
      ])
    );

    const items = await query.queryAsync(20, 0);

    expect(items[0].testerName).toBe('Anonymous');
    expect(items[0].testerEmail).toBe('anonymous@example.com');
    expect(items[0].screenshots).toEqual([]);
  });

  it('serves pages by limit and offset from a single underlying fetch', async () => {
    const app = createApp([
      createSubmission({ screenshots: [], comment: 'first' }),
      createSubmission({ screenshots: [], comment: 'second' }),
      createSubmission({ screenshots: [], comment: 'third' }),
    ]);
    const query = getTestFlightFeedbackQuery(app);

    expect((await query.queryAsync(2, 0)).map(item => item.comment)).toEqual(['first', 'second']);
    expect((await query.queryAsync(2, 2)).map(item => item.comment)).toEqual(['third']);
    expect(await query.queryAsync(2, 5)).toEqual([]);
    expect(await query.getTotalAsync()).toBe(3);

    // Paging must not re-hit App Store Connect for every page.
    expect(app.getBetaFeedbackScreenshotSubmissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe(getTestFlightCrashesQuery, () => {
  it('normalizes crash submissions', async () => {
    const query = getTestFlightCrashesQuery(createApp([createSubmission({ comment: null })]));

    const items = await query.queryAsync(20, 0);

    expect(await query.getTotalAsync()).toBe(1);
    expect(items[0]).toMatchObject({
      id: 'submission-id',
      comment: null,
      buildVersion: '42',
      testerName: 'Jane Doe',
    });
  });

  it('tolerates submissions without build or tester relationships', async () => {
    const query = getTestFlightCrashesQuery(
      createApp([createSubmission({ build: undefined, tester: undefined, email: null })])
    );

    const items = await query.queryAsync(20, 0);

    expect(items[0].buildVersion).toBeNull();
    expect(items[0].testerName).toBeNull();
    expect(items[0].testerEmail).toBeNull();
  });
});
