import { v4 as uuidv4 } from 'uuid';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  SubmissionArchiveSourceType,
} from '../../../graphql/generated';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { getRecentBuildsForSubmissionAsync } from '../builds';

jest.mock('../../../graphql/queries/BuildQuery', () => ({
  BuildQuery: {
    viewBuildsOnAppAsync: jest.fn(),
  },
}));

const ARCHIVE_SOURCE = {
  type: SubmissionArchiveSourceType.Url,
  url: 'https://url.to/archive.tar.gz',
};

const MOCK_BUILD_FRAGMENTS: Partial<BuildFragment>[] = Array(5).map(() => ({
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
  createdAt: Date.now(),
  status: BuildStatus.Finished,
}));
const MOCK_IN_PROGRESS_BUILD_FRAGMENTS: Partial<BuildFragment>[] = Array(2).map(() => ({
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
  createdAt: Date.now(),
  status: BuildStatus.InProgress,
}));
const MOCK_IN_QUEUE_BUILD_FRAGMENTS = Array(2).map(() => ({
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
  createdAt: Date.now(),
  status: BuildStatus.InQueue,
}));
const MOCK_NEW_BUILD_FRAGMENTS = Array(1).map(() => ({
  id: uuidv4(),
  artifacts: {
    buildUrl: ARCHIVE_SOURCE.url,
  },
  appVersion: '1.2.3',
  platform: AppPlatform.Android,
  updatedAt: Date.now(),
  createdAt: Date.now(),
  status: BuildStatus.New,
}));

describe(getRecentBuildsForSubmissionAsync, () => {
  let graphqlClient: ExpoGraphqlClient;

  beforeEach(() => {
    graphqlClient = {} as any as ExpoGraphqlClient;
  });

  it('returns finished builds', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest
      .mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce(
        MOCK_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      );

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit }
    );

    expect(result).toMatchObject(
      MOCK_BUILD_FRAGMENTS.slice(0, Math.min(limit, MOCK_BUILD_FRAGMENTS.length))
    );
  });

  it('returns in-progress builds', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest
      .mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce(
        MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_IN_PROGRESS_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      )
      .mockResolvedValueOnce([] as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit }
    );

    expect(result).toMatchObject(
      MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(
        0,
        Math.min(limit, MOCK_IN_PROGRESS_BUILD_FRAGMENTS.length)
      )
    );
  });

  it('returns in-queue builds', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest
      .mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce(
        MOCK_IN_QUEUE_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_IN_QUEUE_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      )
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit }
    );

    expect(result).toMatchObject(
      MOCK_IN_QUEUE_BUILD_FRAGMENTS.slice(0, Math.min(limit, MOCK_IN_QUEUE_BUILD_FRAGMENTS.length))
    );
  });

  it('returns new builds', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest
      .mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce(
        MOCK_NEW_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_NEW_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      )
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[])
      .mockResolvedValueOnce([] as BuildFragment[]);

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit }
    );

    expect(result).toMatchObject(
      MOCK_NEW_BUILD_FRAGMENTS.slice(0, Math.min(limit, MOCK_NEW_BUILD_FRAGMENTS.length))
    );
  });

  it('returns up to "limit" newest builds regardless of status', async () => {
    const appId = uuidv4();
    const limit = 2;
    jest
      .mocked(BuildQuery.viewBuildsOnAppAsync)
      .mockResolvedValueOnce(
        MOCK_NEW_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_NEW_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      )
      .mockResolvedValueOnce(
        MOCK_IN_QUEUE_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_IN_QUEUE_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      )
      .mockResolvedValueOnce(
        MOCK_IN_PROGRESS_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_IN_PROGRESS_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      )
      .mockResolvedValueOnce(
        MOCK_BUILD_FRAGMENTS.slice(
          0,
          Math.min(limit, MOCK_BUILD_FRAGMENTS.length)
        ) as BuildFragment[]
      );

    const result = await getRecentBuildsForSubmissionAsync(
      graphqlClient,
      AppPlatform.Android,
      appId,
      { limit }
    );

    expect(result).toMatchObject([MOCK_NEW_BUILD_FRAGMENTS[0], MOCK_IN_QUEUE_BUILD_FRAGMENTS[1]]);
  });
});
