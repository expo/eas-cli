import { App, Build } from '@expo/apple-utils';

import { getIosStoreStatusAsync } from '../status';

jest.mock('@expo/apple-utils', () => ({
  ...jest.requireActual('@expo/apple-utils'),
  Build: { getAsync: jest.fn() },
}));

const context = {};

function createApp(): App {
  return {
    id: 'app-id',
    context,
    getLiveAppStoreVersionAsync: jest.fn().mockResolvedValue(null),
    getInReviewAppStoreVersionAsync: jest.fn().mockResolvedValue(null),
    getPendingReleaseAppStoreVersionAsync: jest.fn().mockResolvedValue(null),
  } as unknown as App;
}

function createBuild(buildNumber: number, attributes: Record<string, any> = {}): Build {
  return {
    id: `build-${buildNumber}`,
    attributes: {
      version: String(buildNumber),
      uploadedDate: '2026-10-20T10:00:00-07:00',
      processingState: 'VALID',
      expired: false,
      ...attributes,
    },
  } as unknown as Build;
}

function createBuildWithDetails(buildNumber: number): Build {
  return createBuild(buildNumber, {
    preReleaseVersion: { attributes: { version: '1.2.0' } },
    buildBetaDetail: {
      attributes: {
        internalBuildState: 'IN_BETA_TESTING',
        externalBuildState: 'READY_FOR_BETA_SUBMISSION',
      },
    },
  });
}

describe(getIosStoreStatusAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('walks the builds by upload date only and loads details for the newest ones', async () => {
    const buildNumbers = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    jest
      .mocked(Build.getAsync)
      .mockResolvedValueOnce(buildNumbers.map(buildNumber => createBuild(buildNumber)))
      .mockResolvedValueOnce(buildNumbers.slice(0, 5).map(createBuildWithDetails));

    const status = await getIosStoreStatusAsync(createApp(), []);

    expect(Build.getAsync).toHaveBeenNthCalledWith(1, context, {
      query: {
        filter: { app: 'app-id' },
        fields: { builds: 'uploadedDate' },
        sort: '-uploadedDate',
        limit: 200,
        includes: [],
      },
    });
    expect(Build.getAsync).toHaveBeenNthCalledWith(2, context, {
      query: {
        filter: { app: 'app-id', id: 'build-12,build-11,build-10,build-9,build-8' },
        sort: '-uploadedDate',
        limit: 5,
        includes: ['buildBetaDetail', 'preReleaseVersion'],
      },
    });
    expect(status.testFlightBuilds.map(build => build.buildNumber)).toEqual([
      '12',
      '11',
      '10',
      '9',
      '8',
    ]);
    expect(status.testFlightBuilds[0]).toMatchObject({
      appVersion: '1.2.0',
      internalState: 'IN_BETA_TESTING',
      externalState: 'READY_FOR_BETA_SUBMISSION',
    });
  });

  it('does not request build details when the app has no builds', async () => {
    jest.mocked(Build.getAsync).mockResolvedValueOnce([]);

    const status = await getIosStoreStatusAsync(createApp(), []);

    expect(Build.getAsync).toHaveBeenCalledTimes(1);
    expect(status.testFlightBuilds).toEqual([]);
  });
});
